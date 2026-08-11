/**
 * KaTeX rendering for `$inline$` and `$$block$$`.
 *
 * KaTeX is ~280 KB with its fonts, so it is loaded lazily on first sight of math
 * rather than sitting on the cold-start path. Until it arrives, the source stays
 * as plain text — which is correct anyway, since raw characters never disappear
 * in this editor.
 *
 * Clicking into a rendered formula reveals the LaTeX for editing: the widget is
 * suppressed while the caret is inside it.
 */

import { StateEffect, StateField } from '@codemirror/state'
import type { EditorState, Range } from '@codemirror/state'
import { Decoration, EditorView, ViewPlugin, WidgetType } from '@codemirror/view'
import type { DecorationSet, ViewUpdate } from '@codemirror/view'

/** Only the surface actually used — the package's default export shape differs
 *  between its CJS and ESM builds, and pinning to the whole module type breaks. */
interface Katex {
  render(tex: string, element: HTMLElement, options?: Record<string, unknown>): void
}

let katex: Katex | null = null
let loading: Promise<void> | null = null

/** Fired when KaTeX finishes loading, so mounted views can rebuild. */
const mathReady = StateEffect.define<null>()

/** Diagnostic, surfaced in the performance report — a silent failure here is
 *  indistinguishable from "the document contains no math". */
export let katexStatus: 'idle' | 'loading' | 'ready' | 'failed' = 'idle'
export let katexError = ''

function ensureKatex(view: EditorView) {
  if (katex || loading) return
  katexStatus = 'loading'
  loading = (async () => {
    // The CSS is imported separately: bundling it into the same await meant a
    // stylesheet failure took the renderer down with it.
    const mod = await import('katex')
    const resolved = (mod as unknown as { default?: Katex }).default ?? (mod as unknown as Katex)
    if (typeof resolved?.render !== 'function') {
      throw new Error(`katex module has no render(); keys: ${Object.keys(mod).join(',')}`)
    }
    katex = resolved
    katexStatus = 'ready'
    // Nudge every mounted editor to rebuild now that rendering is possible.
    view.dispatch({ effects: mathReady.of(null) })
    await import('katex/dist/katex.min.css').catch(() => {
      // Unstyled math still beats raw source.
    })
  })().catch((e) => {
    katexStatus = 'failed'
    katexError = String(e?.message ?? e)
  })
}

class MathWidget extends WidgetType {
  constructor(readonly source: string, readonly block: boolean) {
    super()
  }

  eq(other: MathWidget) {
    return other.source === this.source && other.block === this.block
  }

  toDOM() {
    const el = document.createElement(this.block ? 'div' : 'span')
    el.className = this.block ? 'ink-math ink-math-block' : 'ink-math'
    try {
      katex!.render(this.source, el, {
        displayMode: this.block,
        throwOnError: false,
        output: 'html',
        strict: false,
      })
    } catch {
      // A malformed formula shows its source rather than an error box.
      el.classList.add('ink-math-error')
      el.textContent = this.source
    }
    return el
  }

  ignoreEvent() {
    return false
  }
}

/**
 * Inline `$…$`.
 *
 * Exported so it can be tested directly — the first version of this file was
 * only reachable through a mounted EditorView, which made a rendering failure
 * impossible to diagnose without rebuilding the whole app.
 *
 * `(?!\d)` after the closing delimiter keeps "$5 or $10" from being read as math.
 */
export const MATH_INLINE = /(?<!\\)\$(?!\s)((?:[^$\\\n]|\\.)+?)(?<!\s)\$(?!\d)/g

export interface BlockMath {
  /** 1-based line numbers of the opening and closing fences. */
  startLine: number
  endLine: number
  source: string
}

/** Locates `$$` fenced blocks. Pure, so it can be tested without an editor. */
export function findBlockMath(lines: string[]): BlockMath[] {
  const out: BlockMath[] = []
  let open = -1
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() !== '$$') continue
    if (open < 0) {
      open = i
    } else {
      out.push({
        startLine: open + 1,
        endLine: i + 1,
        source: lines.slice(open + 1, i).join('\n'),
      })
      open = -1
    }
  }
  return out
}

/** True when any cursor or selection touches [from, to] — reveal the source. */
function caretInside(state: EditorState, from: number, to: number): boolean {
  return state.selection.ranges.some((r) => r.to >= from && r.from <= to)
}

/** Line numbers covered by a `$$` block, so inline scanning can skip them. */
function blockLines(blocks: BlockMath[]): Set<number> {
  const set = new Set<number>()
  for (const b of blocks) for (let n = b.startLine; n <= b.endLine; n++) set.add(n)
  return set
}

/**
 * Locating `$$` fences needs the whole document — a block can open above the
 * viewport and close below it — but the naive `doc.line(n)` loop allocates a
 * Line object per line and measurably slowed every keystroke. `iterLines`
 * streams the text instead, and the fast-path bails before touching the
 * document at all when there is no `$$` in it.
 */
function blocksOf(state: EditorState): BlockMath[] {
  const lines: string[] = []
  let sawFence = false
  for (const text of state.doc.iterLines()) {
    if (!sawFence && text.length === 2 && text === '$$') sawFence = true
    else if (!sawFence && text.trim() === '$$') sawFence = true
    lines.push(text)
  }
  if (!sawFence) return []
  return findBlockMath(lines)
}

/**
 * Block math lives in a StateField, not a ViewPlugin.
 *
 * CodeMirror refuses block `Decoration.replace` ranges that span line breaks
 * when they come from a plugin — the view cannot safely recompute line geometry
 * from a source that is itself derived from the view. Providing them from a
 * field is the supported route. Getting this wrong throws inside the update
 * cycle, which leaves the editor applying later transactions against stale
 * positions and quietly corrupting the document.
 */
const blockMathField = StateField.define<DecorationSet>({
  create: (state) => buildBlockMath(state),
  update(value, tr) {
    if (!tr.docChanged && !tr.selection && !tr.effects.some((e) => e.is(mathReady))) {
      return value.map(tr.changes)
    }
    return buildBlockMath(tr.state)
  },
  provide: (f) => EditorView.decorations.from(f),
})

function buildBlockMath(state: EditorState): DecorationSet {
  if (!katex) return Decoration.none
  const decos: Range<Decoration>[] = []
  for (const b of blocksOf(state)) {
    const from = state.doc.line(b.startLine).from
    const to = state.doc.line(b.endLine).to
    // Caret inside: show the LaTeX so it can be edited.
    if (caretInside(state, from, to)) continue
    decos.push(
      Decoration.replace({ widget: new MathWidget(b.source, true), block: true }).range(from, to),
    )
  }
  return Decoration.set(decos, true)
}

/** Inline `$…$` never spans a line break, so a plugin is fine — and cheaper,
 *  because it only scans the viewport. */
function buildInlineMath(view: EditorView): DecorationSet {
  if (!katex) return Decoration.none
  const { state } = view
  // Only pay for the whole-document fence scan when the viewport could actually
  // contain inline math.
  let anyDollar = false
  for (const { from, to } of view.visibleRanges) {
    if (state.doc.sliceString(from, to).includes('$')) { anyDollar = true; break }
  }
  if (!anyDollar) return Decoration.none

  const skip = blockLines(blocksOf(state))
  const decos: Range<Decoration>[] = []

  for (const { from, to } of view.visibleRanges) {
    const first = state.doc.lineAt(from).number
    const last = state.doc.lineAt(to).number
    for (let n = first; n <= last; n++) {
      if (skip.has(n)) continue
      const line = state.doc.line(n)
      for (const m of line.text.matchAll(MATH_INLINE)) {
        if (m.index == null) continue
        const start = line.from + m.index
        const end = start + m[0].length
        if (caretInside(state, start, end)) continue
        decos.push(Decoration.replace({ widget: new MathWidget(m[1], false) }).range(start, end))
      }
    }
  }
  return Decoration.set(decos, true)
}

const inlineMathPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet

    constructor(view: EditorView) {
      if (/\$/.test(view.state.doc.sliceString(0, 20000))) ensureKatex(view)
      this.decorations = buildInlineMath(view)
    }

    update(update: ViewUpdate) {
      const ready = update.transactions.some((t) => t.effects.some((e) => e.is(mathReady)))
      // Selection matters here, unlike the Markdown layer: moving the caret into
      // a formula must reveal its source.
      if (update.docChanged || update.viewportChanged || update.selectionSet || ready) {
        if (update.docChanged && /\$/.test(update.state.doc.sliceString(0, 20000))) {
          ensureKatex(update.view)
        }
        this.decorations = buildInlineMath(update.view)
      }
    }
  },
  { decorations: (v) => v.decorations },
)

export const mathPlugin = [blockMathField, inlineMathPlugin]
