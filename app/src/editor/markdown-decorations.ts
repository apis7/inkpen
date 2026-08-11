/**
 * Hybrid Markdown rendering.
 *
 * The document stays literal Markdown. `#`, `**` and backticks remain in the DOM
 * at 35% opacity — they are de-emphasised, never removed. That is the whole design
 * premise: nothing is replaced, so the caret never drifts and selection never lies.
 *
 * Budget: a full-viewport rebuild must stay under 4ms. The rules that keep it there:
 *   1. Iterate `view.visibleRanges` only, never the whole document.
 *   2. Rebuild on docChanged / viewportChanged / config change — not on cursor moves.
 *   3. Mark decorations for styling; widgets only where something is genuinely
 *      replaced (task checkboxes, images), because widgets cost an order more.
 *   4. Every widget implements `eq()`, or CodeMirror rebuilds its DOM on each update.
 */

import { syntaxTree } from '@codemirror/language'
import type { EditorState, Range } from '@codemirror/state'
import { Decoration, EditorView, ViewPlugin, WidgetType } from '@codemirror/view'
import type { DecorationSet, ViewUpdate } from '@codemirror/view'
import { time } from '../perf'

const mark = Decoration.mark({ class: 'ink-mark' })

const HEADING_LINE: Record<string, Decoration> = {
  ATXHeading1: Decoration.line({ class: 'ink-h ink-h1' }),
  ATXHeading2: Decoration.line({ class: 'ink-h ink-h2' }),
  ATXHeading3: Decoration.line({ class: 'ink-h ink-h3' }),
  ATXHeading4: Decoration.line({ class: 'ink-h ink-h4' }),
  ATXHeading5: Decoration.line({ class: 'ink-h ink-h5' }),
  ATXHeading6: Decoration.line({ class: 'ink-h ink-h6' }),
  SetextHeading1: Decoration.line({ class: 'ink-h ink-h1' }),
  SetextHeading2: Decoration.line({ class: 'ink-h ink-h2' }),
}

const INLINE_MARK: Record<string, Decoration> = {
  StrongEmphasis: Decoration.mark({ class: 'ink-strong' }),
  Emphasis: Decoration.mark({ class: 'ink-em' }),
  Strikethrough: Decoration.mark({ class: 'ink-strike' }),
  InlineCode: Decoration.mark({ class: 'ink-code' }),
  URL: Decoration.mark({ class: 'ink-url' }),
  Link: Decoration.mark({ class: 'ink-link' }),
  Image: Decoration.mark({ class: 'ink-link' }),
}

const MARK_NODES = new Set([
  'HeaderMark',
  'EmphasisMark',
  'StrikethroughMark',
  'CodeMark',
  'QuoteMark',
  'LinkMark',
  'CodeInfo',
])

const quoteLine = Decoration.line({ class: 'ink-quote' })
const codeLine = Decoration.line({ class: 'ink-codeblock' })
const codeFirst = Decoration.line({ class: 'ink-codeblock ink-codeblock-first' })
const codeLast = Decoration.line({ class: 'ink-codeblock ink-codeblock-last' })
const listMark = Decoration.mark({ class: 'ink-listmark' })
const hrLine = Decoration.line({ class: 'ink-hr' })
const frontLine = Decoration.line({ class: 'ink-frontmatter' })

// ------------------------------------------------------------------ widgets --

class CheckboxWidget extends WidgetType {
  constructor(readonly checked: boolean, readonly pos: number) {
    super()
  }

  // Without this, CodeMirror rebuilds the DOM on every update.
  eq(other: CheckboxWidget) {
    return other.checked === this.checked && other.pos === this.pos
  }

  toDOM() {
    const box = document.createElement('span')
    box.className = 'ink-check'
    box.dataset.checked = String(this.checked)
    box.dataset.pos = String(this.pos)
    box.setAttribute('role', 'checkbox')
    box.setAttribute('aria-checked', String(this.checked))
    box.textContent = this.checked ? '✓' : ''
    return box
  }

  ignoreEvent() {
    return false
  }
}

class ImageWidget extends WidgetType {
  constructor(readonly url: string, readonly alt: string) {
    super()
  }

  eq(other: ImageWidget) {
    return other.url === this.url && other.alt === this.alt
  }

  toDOM() {
    const wrap = document.createElement('div')
    wrap.className = 'ink-img'
    const img = document.createElement('img')
    img.src = this.url
    img.alt = this.alt
    img.loading = 'lazy'
    // A broken path must not leave a torn layout behind.
    img.onerror = () => wrap.classList.add('ink-img-failed')
    wrap.appendChild(img)
    return wrap
  }

  ignoreEvent() {
    return true
  }
}

/** Only sources the webview can actually load. Local paths need the asset
 *  protocol, which is deliberately not enabled — a missing preview beats a
 *  broken one. */
function loadableUrl(raw: string): string | null {
  const url = raw.trim().replace(/^<|>$/g, '')
  if (/^https?:\/\//i.test(url) || /^data:image\//i.test(url)) return url
  return null
}

// ------------------------------------------------------------------- builder --

function buildDecorations(view: EditorView): DecorationSet {
  const decos: Range<Decoration>[] = []
  const { state } = view
  const tree = syntaxTree(state)

  // Front matter is a document-level concern, not a node the grammar exposes.
  markFrontMatter(state, view, decos)

  for (const { from, to } of view.visibleRanges) {
    tree.iterate({
      from,
      to,
      enter: (node) => {
        const name = node.name

        if (MARK_NODES.has(name)) {
          if (node.to > node.from) decos.push(mark.range(node.from, node.to))
          return
        }

        const heading = HEADING_LINE[name]
        if (heading) {
          decos.push(heading.range(state.doc.lineAt(node.from).from))
          return
        }

        const inline = INLINE_MARK[name]
        if (inline && node.to > node.from) {
          decos.push(inline.range(node.from, node.to))
          if (name === 'Image') addImage(state, node.from, node.to, decos)
          return
        }

        switch (name) {
          case 'Blockquote':
            eachLine(state, node.from, node.to, (line) => decos.push(quoteLine.range(line.from)))
            return
          case 'FencedCode':
          case 'CodeBlock': {
            const first = state.doc.lineAt(node.from).number
            const last = state.doc.lineAt(node.to).number
            eachLine(state, node.from, node.to, (line) => {
              const d =
                line.number === first ? codeFirst : line.number === last ? codeLast : codeLine
              decos.push(d.range(line.from))
            })
            return
          }
          case 'ListMark':
            decos.push(listMark.range(node.from, node.to))
            return
          case 'TaskMarker': {
            const text = state.doc.sliceString(node.from, node.to)
            const checked = /\[[xX]\]/.test(text)
            decos.push(
              Decoration.replace({
                widget: new CheckboxWidget(checked, node.from),
              }).range(node.from, node.to),
            )
            return
          }
          case 'HorizontalRule':
            decos.push(hrLine.range(state.doc.lineAt(node.from).from))
            return
        }
      },
    })
  }

  // `true` sorts for us — cheaper and far less error-prone than keeping a
  // RangeSetBuilder in order across line and mark decorations.
  return Decoration.set(decos, true)
}

function eachLine(
  state: EditorState,
  from: number,
  to: number,
  fn: (line: { from: number; number: number }) => void,
) {
  let pos = from
  while (pos <= to) {
    const line = state.doc.lineAt(pos)
    fn(line)
    if (line.to >= state.doc.length) break
    pos = line.to + 1
  }
}

function addImage(state: EditorState, from: number, to: number, decos: Range<Decoration>[]) {
  const src = state.doc.sliceString(from, to)
  const m = /^!\[([^\]]*)\]\(([^)]+)\)$/.exec(src)
  if (!m) return
  const url = loadableUrl(m[2].split(/\s+/)[0])
  if (!url) return

  const line = state.doc.lineAt(to)
  decos.push(
    Decoration.widget({ widget: new ImageWidget(url, m[1]), block: true, side: 1 }).range(line.to),
  )
}

/** A `---` fence on line 1 opening a YAML block. The grammar has no node for it. */
function markFrontMatter(state: EditorState, view: EditorView, decos: Range<Decoration>[]) {
  if (state.doc.lines < 2) return
  if (state.doc.line(1).text.trim() !== '---') return

  let end = 0
  for (let n = 2; n <= Math.min(state.doc.lines, 200); n++) {
    if (state.doc.line(n).text.trim() === '---') {
      end = n
      break
    }
  }
  if (!end) return

  const visibleFrom = view.visibleRanges[0]?.from ?? 0
  if (state.doc.line(end).to < visibleFrom) return

  for (let n = 1; n <= end; n++) decos.push(frontLine.range(state.doc.line(n).from))
}

// -------------------------------------------------------------------- plugin --

export const markdownDecorations = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet

    constructor(view: EditorView) {
      this.decorations = buildDecorations(view)
    }

    update(update: ViewUpdate) {
      // Deliberately not `selectionSet` — cursor movement must not rebuild.
      if (update.docChanged || update.viewportChanged) {
        this.decorations = time('decorations.rebuild', () => buildDecorations(update.view))
      }
    }
  },
  {
    decorations: (v) => v.decorations,

    eventHandlers: {
      mousedown(event, view) {
        const target = event.target as HTMLElement
        if (!target.classList.contains('ink-check')) return false

        const pos = Number(target.dataset.pos)
        if (Number.isNaN(pos)) return false

        // Rewrite the source characters; the widget follows from the new text.
        const text = view.state.doc.sliceString(pos, pos + 3)
        const next = /\[[xX]\]/.test(text) ? '[ ]' : '[x]'
        view.dispatch({ changes: { from: pos, to: pos + 3, insert: next } })
        event.preventDefault()
        return true
      },
    },
  },
)

/** Ctrl+Click a link to open it in the default browser. */
export const linkClickHandler = EditorView.domEventHandlers({
  mousedown(event, view) {
    if (!event.ctrlKey) return false
    const pos = view.posAtCoords({ x: event.clientX, y: event.clientY })
    if (pos == null) return false

    const line = view.state.doc.lineAt(pos)
    const col = pos - line.from
    for (const m of line.text.matchAll(/\[[^\]]*\]\(([^)]+)\)|<(https?:\/\/[^>]+)>/g)) {
      if (m.index == null) continue
      if (col < m.index || col > m.index + m[0].length) continue
      const url = (m[1] ?? m[2] ?? '').split(/\s+/)[0]
      if (/^https?:\/\//i.test(url)) {
        window.open(url, '_blank')
        event.preventDefault()
        return true
      }
    }
    return false
  },
})
