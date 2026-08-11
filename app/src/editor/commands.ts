/** Editing commands: Markdown formatting, line operations, case conversion. */

import { EditorSelection } from '@codemirror/state'
import type { ChangeSpec, StateCommand } from '@codemirror/state'
import type { EditorView } from '@codemirror/view'
import { copyPlain, copyRich } from '../ipc'
import { reflowText } from './reflow'

/** Wrap each selection in `before`/`after`, or unwrap if already wrapped. */
function wrapWith(before: string, after = before): StateCommand {
  return ({ state, dispatch }) => {
    const changes = state.changeByRange((range) => {
      const text = state.sliceDoc(range.from, range.to)

      // Already wrapped — toggle it off rather than nesting.
      const outer = state.sliceDoc(range.from - before.length, range.to + after.length)
      if (outer === before + text + after) {
        return {
          changes: [
            { from: range.from - before.length, to: range.from },
            { from: range.to, to: range.to + after.length },
          ],
          range: EditorSelection.range(range.from - before.length, range.to - before.length),
        }
      }

      if (text.startsWith(before) && text.endsWith(after) && text.length > before.length + after.length) {
        return {
          changes: { from: range.from, to: range.to, insert: text.slice(before.length, text.length - after.length) },
          range: EditorSelection.range(range.from, range.to - before.length - after.length),
        }
      }

      return {
        changes: { from: range.from, to: range.to, insert: before + text + after },
        range: range.empty
          ? EditorSelection.cursor(range.from + before.length)
          : EditorSelection.range(range.from, range.to + before.length + after.length),
      }
    })
    dispatch(state.update(changes, { scrollIntoView: true, userEvent: 'input.format' }))
    return true
  }
}

/** Apply a per-line prefix across the selection, toggling if every line has it. */
function togglePrefix(prefix: string | ((n: number) => string)): StateCommand {
  return ({ state, dispatch }) => {
    const changes: ChangeSpec[] = []
    const seen = new Set<number>()
    const lines: { from: number; text: string }[] = []

    for (const range of state.selection.ranges) {
      let pos = range.from
      while (pos <= range.to) {
        const line = state.doc.lineAt(pos)
        if (!seen.has(line.from)) {
          seen.add(line.from)
          lines.push({ from: line.from, text: line.text })
        }
        if (line.to >= state.doc.length) break
        pos = line.to + 1
      }
    }

    const literal = typeof prefix === 'string' ? prefix : null
    const allPrefixed =
      literal !== null && lines.length > 0 && lines.every((l) => l.text.startsWith(literal))

    lines.forEach((line, i) => {
      const p = literal ?? (prefix as (n: number) => string)(i + 1)
      if (allPrefixed) {
        changes.push({ from: line.from, to: line.from + p.length })
      } else if (!literal || !line.text.startsWith(p)) {
        changes.push({ from: line.from, insert: p })
      }
    })

    if (!changes.length) return false
    dispatch(state.update({ changes, userEvent: 'input.format' }))
    return true
  }
}

export const toggleBold = wrapWith('**')
export const toggleItalic = wrapWith('*')
export const toggleStrike = wrapWith('~~')
export const toggleInlineCode = wrapWith('`')
export const toggleQuote = togglePrefix('> ')
export const toggleBulletList = togglePrefix('- ')
export const toggleTaskList = togglePrefix('- [ ] ')
export const toggleOrderedList = togglePrefix((n) => `${n}. `)

export function setHeading(level: number): StateCommand {
  return ({ state, dispatch }) => {
    const changes: ChangeSpec[] = []
    const seen = new Set<number>()

    for (const range of state.selection.ranges) {
      let pos = range.from
      while (pos <= range.to) {
        const line = state.doc.lineAt(pos)
        if (!seen.has(line.from)) {
          seen.add(line.from)
          const existing = /^(#{1,6})\s+/.exec(line.text)
          const wanted = level === 0 ? '' : '#'.repeat(level) + ' '
          const currentLen = existing ? existing[0].length : 0
          // Setting the level it already has clears it — the button toggles.
          const insert = existing && existing[1].length === level ? '' : wanted
          changes.push({ from: line.from, to: line.from + currentLen, insert })
        }
        if (line.to >= state.doc.length) break
        pos = line.to + 1
      }
    }
    if (!changes.length) return false
    dispatch(state.update({ changes, userEvent: 'input.format' }))
    return true
  }
}

export const insertLink: StateCommand = ({ state, dispatch }) => {
  const changes = state.changeByRange((range) => {
    const text = state.sliceDoc(range.from, range.to)
    const isUrl = /^https?:\/\//i.test(text)
    const insert = isUrl ? `[](${text})` : `[${text}](url)`
    // Land the caret where the user has to type next.
    const caret = isUrl ? range.from + 1 : range.from + text.length + 3
    return {
      changes: { from: range.from, to: range.to, insert },
      range: isUrl
        ? EditorSelection.cursor(caret)
        : EditorSelection.range(caret, caret + 3),
    }
  })
  dispatch(state.update(changes, { userEvent: 'input.format' }))
  return true
}

export const insertImage: StateCommand = ({ state, dispatch }) => {
  const changes = state.changeByRange((range) => {
    const text = state.sliceDoc(range.from, range.to)
    const insert = `![${text}](url)`
    const caret = range.from + text.length + 4
    return {
      changes: { from: range.from, to: range.to, insert },
      range: EditorSelection.range(caret, caret + 3),
    }
  })
  dispatch(state.update(changes, { userEvent: 'input.format' }))
  return true
}

export const insertCodeBlock: StateCommand = ({ state, dispatch }) => {
  const changes = state.changeByRange((range) => {
    const text = state.sliceDoc(range.from, range.to)
    const insert = '```\n' + text + '\n```'
    return {
      changes: { from: range.from, to: range.to, insert },
      range: EditorSelection.cursor(range.from + 3),
    }
  })
  dispatch(state.update(changes, { userEvent: 'input.format' }))
  return true
}

// ------------------------------------------------------------ line operations --

function selectedLineSpan(state: import('@codemirror/state').EditorState) {
  const first = state.doc.lineAt(state.selection.main.from)
  const last = state.doc.lineAt(state.selection.main.to)
  return { from: first.from, to: last.to }
}

export const duplicateLine: StateCommand = ({ state, dispatch }) => {
  const { from, to } = selectedLineSpan(state)
  const text = state.sliceDoc(from, to)
  dispatch(
    state.update({
      changes: { from: to, insert: '\n' + text },
      selection: EditorSelection.cursor(to + 1 + (state.selection.main.head - from)),
      userEvent: 'input.duplicate',
    }),
  )
  return true
}

export const joinLines: StateCommand = ({ state, dispatch }) => {
  const { from, to } = selectedLineSpan(state)
  const text = state.sliceDoc(from, to)
  if (!text.includes('\n')) return false
  dispatch(
    state.update({
      changes: { from, to, insert: text.split('\n').map((l) => l.trim()).join(' ') },
      userEvent: 'input.join',
    }),
  )
  return true
}

export const sortLines: StateCommand = ({ state, dispatch }) => {
  const { from, to } = selectedLineSpan(state)
  const lines = state.sliceDoc(from, to).split('\n')
  if (lines.length < 2) return false
  const sorted = [...lines].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
  dispatch(state.update({ changes: { from, to, insert: sorted.join('\n') }, userEvent: 'input.sort' }))
  return true
}

function convertCase(fn: (s: string) => string): StateCommand {
  return ({ state, dispatch }) => {
    if (state.selection.ranges.every((r) => r.empty)) return false
    const changes = state.changeByRange((range) => ({
      changes: { from: range.from, to: range.to, insert: fn(state.sliceDoc(range.from, range.to)) },
      range,
    }))
    dispatch(state.update(changes, { userEvent: 'input.case' }))
    return true
  }
}

export const upperCase = convertCase((s) => s.toUpperCase())
export const lowerCase = convertCase((s) => s.toLowerCase())
export const titleCase = convertCase((s) =>
  s.replace(/\w\S*/g, (w) => w[0].toUpperCase() + w.slice(1).toLowerCase()),
)
export const sentenceCase = convertCase((s) => {
  const lower = s.toLowerCase()
  return lower.replace(/(^\s*\w|[.!?]\s+\w)/g, (c) => c.toUpperCase())
})

export const trimTrailingWhitespace: StateCommand = ({ state, dispatch }) => {
  const changes: ChangeSpec[] = []
  for (let n = 1; n <= state.doc.lines; n++) {
    const line = state.doc.line(n)
    const trimmed = line.text.replace(/[ \t]+$/, '')
    if (trimmed.length !== line.text.length) {
      changes.push({ from: line.from + trimmed.length, to: line.to })
    }
  }
  if (!changes.length) return false
  dispatch(state.update({ changes, userEvent: 'input.trim' }))
  return true
}

/**
 * Re-align Markdown table pipes into even columns. Operates on the contiguous
 * run of pipe-rows containing the cursor.
 */
export const formatTables: StateCommand = ({ state, dispatch }) => {
  const cursorLine = state.doc.lineAt(state.selection.main.head).number
  const isRow = (n: number) => n >= 1 && n <= state.doc.lines && state.doc.line(n).text.trim().startsWith('|')
  if (!isRow(cursorLine)) return false

  let first = cursorLine
  let last = cursorLine
  while (isRow(first - 1)) first--
  while (isRow(last + 1)) last++
  if (last - first < 1) return false

  const rows: string[][] = []
  const aligns: string[] = []
  let separatorAt = -1

  for (let n = first; n <= last; n++) {
    const cells = state.doc
      .line(n)
      .text.trim()
      .replace(/^\||\|$/g, '')
      .split('|')
      .map((c) => c.trim())
    if (cells.every((c) => /^:?-{1,}:?$/.test(c))) {
      separatorAt = rows.length
      cells.forEach((c, i) => {
        aligns[i] = c.startsWith(':') && c.endsWith(':') ? 'c' : c.endsWith(':') ? 'r' : 'l'
      })
    }
    rows.push(cells)
  }

  const cols = Math.max(...rows.map((r) => r.length))
  const widths = Array.from({ length: cols }, (_, i) =>
    Math.max(3, ...rows.map((r, ri) => (ri === separatorAt ? 0 : (r[i] ?? '').length))),
  )

  const pad = (text: string, width: number, align: string) => {
    const gap = width - text.length
    if (align === 'r') return ' '.repeat(gap) + text
    if (align === 'c') {
      const left = Math.floor(gap / 2)
      return ' '.repeat(left) + text + ' '.repeat(gap - left)
    }
    return text + ' '.repeat(gap)
  }

  const out = rows.map((cells, ri) => {
    const rendered = widths.map((w, i) => {
      const align = aligns[i] ?? 'l'
      if (ri === separatorAt) {
        const bar = '-'.repeat(w)
        return align === 'c' ? `:${bar.slice(2)}:` : align === 'r' ? `${bar.slice(1)}:` : bar
      }
      return pad(cells[i] ?? '', w, align)
    })
    return `| ${rendered.join(' | ')} |`
  })

  dispatch(
    state.update({
      changes: { from: state.doc.line(first).from, to: state.doc.line(last).to, insert: out.join('\n') },
      userEvent: 'input.table',
    }),
  )
  return true
}

/**
 * Rejoin hard-wrapped lines in the selection, keeping paragraphs and structure.
 * With no selection it works on the whole document.
 */
export const reflowSelection: StateCommand = ({ state, dispatch }) => {
  const ranges = state.selection.ranges.filter((r) => !r.empty)

  if (!ranges.length) {
    const text = state.doc.toString()
    const next = reflowText(text)
    if (next === text) return false
    dispatch(
      state.update({
        changes: { from: 0, to: state.doc.length, insert: next },
        userEvent: 'input.reflow',
      }),
    )
    return true
  }

  // Whole lines, so a selection that starts mid-paragraph still reflows sanely.
  const changes = ranges.map((r) => {
    const from = state.doc.lineAt(r.from).from
    const to = state.doc.lineAt(r.to).to
    return { from, to, insert: reflowText(state.sliceDoc(from, to)) }
  })
  dispatch(state.update({ changes, userEvent: 'input.reflow' }))
  return true
}

// ----------------------------------------------------------------- clipboard --

/**
 * Ctrl+C and Ctrl+X go through Rust so the clipboard carries `CF_UNICODETEXT`
 * and nothing else. Left to itself, WebView2 volunteers an HTML flavour — which
 * is exactly the bug that makes pasting into a terminal unreliable.
 */
export function installClipboard(view: EditorView) {
  const plainFromSelection = () => {
    const { state } = view
    if (state.selection.ranges.every((r) => r.empty)) {
      const line = state.doc.lineAt(state.selection.main.head)
      return line.text + '\n'
    }
    return state.selection.ranges.map((r) => state.sliceDoc(r.from, r.to)).join('\n')
  }

  const onCopy = (event: ClipboardEvent) => {
    event.preventDefault()
    void copyPlain(plainFromSelection())
  }

  const onCut = (event: ClipboardEvent) => {
    event.preventDefault()
    const text = plainFromSelection()
    void copyPlain(text)
    if (!view.state.selection.ranges.every((r) => r.empty)) {
      view.dispatch(view.state.replaceSelection(''))
    }
  }

  view.dom.addEventListener('copy', onCopy)
  view.dom.addEventListener('cut', onCut)
  return () => {
    view.dom.removeEventListener('copy', onCopy)
    view.dom.removeEventListener('cut', onCut)
  }
}

/** Explicit, separate, and never the default. */
export function copySelectionAsRichText(view: EditorView) {
  const { state } = view
  const text = state.selection.ranges.map((r) => state.sliceDoc(r.from, r.to)).join('\n')
  if (!text) return
  const html = markdownToInlineHtml(text)
  void copyRich(text, html)
}

/** Deliberately small: enough for a paste into Word or Outlook, no more. */
function markdownToInlineHtml(md: string): string {
  const escape = (s: string) =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

  return md
    .split('\n')
    .map((line) => {
      const heading = /^(#{1,6})\s+(.*)$/.exec(line)
      const body = escape(heading ? heading[2] : line)
        .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
        .replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>')
        .replace(/~~([^~]+)~~/g, '<s>$1</s>')
        .replace(/`([^`]+)`/g, '<code>$1</code>')
        .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>')
      if (heading) return `<h${heading[1].length}>${body}</h${heading[1].length}>`
      return line.trim() ? `<p>${body}</p>` : ''
    })
    .join('')
}
