/**
 * Smart list continuation.
 *
 * Enter inside a list item starts the next marker; Enter on an empty item ends
 * the list instead of leaving a dangling bullet behind.
 */

import { getIndentUnit } from '@codemirror/language'
import { EditorSelection, Prec } from '@codemirror/state'
import type { ChangeSpec, Text } from '@codemirror/state'
import { keymap } from '@codemirror/view'
import type { KeyBinding } from '@codemirror/view'

const LIST_ITEM = /^(\s*)(?:([-*+])|(\d+)([.)]))(\s+)(\[[ xX]\]\s+)?(.*)$/

/**
 * Bump the numbers of the items after `afterLine` so an inserted item doesn't
 * leave a duplicate behind: `1. 2. [new 3.] 3.` becomes `1. 2. 3. 4.`.
 *
 * Only siblings move — same indent, same delimiter. Plain lines and deeper
 * items are content between items (`(i) sub-step`) and are stepped over; a
 * blank line, or a bullet or shallower item, ends the list. Stops early once an
 * item already has a number at or past the one it needs, so gaps are kept.
 */
function renumberFollowing(
  doc: Text,
  afterLine: number,
  indent: string,
  delim: string,
  firstNumber: number,
): ChangeSpec[] {
  const changes: ChangeSpec[] = []
  let expected = firstNumber

  for (let n = afterLine + 1; n <= doc.lines; n++) {
    const line = doc.line(n)
    if (!line.text.trim()) break

    const m = LIST_ITEM.exec(line.text)
    if (!m || m[1].length > indent.length) continue
    if (m[1] !== indent || !m[3] || m[4] !== delim) break

    const current = Number(m[3])
    if (current >= expected) break

    const from = line.from + indent.length
    changes.push({ from, to: from + m[3].length, insert: String(expected) })
    expected++
  }
  return changes
}

const continueList: KeyBinding['run'] =({ state, dispatch }) => {
  const range = state.selection.main
  if (!range.empty) return false

  const line = state.doc.lineAt(range.head)
  const m = LIST_ITEM.exec(line.text)
  if (!m) return false

  const [, indent, bullet, number, delim, space, task, content] = m

  // Caret must be past the marker; Enter before it should just split the line.
  const markerEnd = line.from + (m[0].length - content.length)
  if (range.head < markerEnd) return false

  // Empty item — end the list rather than adding another marker.
  if (!content.trim()) {
    dispatch(
      state.update({
        changes: { from: line.from, to: line.to, insert: '' },
        selection: EditorSelection.cursor(line.from),
        userEvent: 'input.list',
      }),
    )
    return true
  }

  const marker = bullet
    ? bullet
    : `${Number(number) + 1}${delim}`
  const nextTask = task ? '[ ] ' : ''
  const insert = `\n${indent}${marker}${space}${nextTask}`

  const renumber = bullet
    ? []
    : renumberFollowing(state.doc, line.number, indent, delim, Number(number) + 2)

  dispatch(
    state.update({
      changes: [{ from: range.head, insert }, ...renumber],
      selection: EditorSelection.cursor(range.head + insert.length),
      scrollIntoView: true,
      userEvent: 'input.list',
    }),
  )
  return true
}

/**
 * How many characters of trailing indentation one Enter should remove.
 *
 * Returns 0 when there is nothing to give back, which lets Enter behave
 * normally. Exported for testing — the arithmetic around mixed tabs and spaces
 * is where this would quietly get wrong.
 */
export function dedentWidth(lineText: string, indentUnit: number): number {
  // Only a line made entirely of whitespace, and not an empty one.
  if (lineText.length === 0 || /\S/.test(lineText)) return 0

  if (lineText.endsWith('\t')) return 1

  let spaces = 0
  while (spaces < indentUnit && lineText[lineText.length - 1 - spaces] === ' ') spaces++
  return spaces
}

/**
 * Enter on a blank but indented line steps the indentation back instead of
 * carrying it onto yet another empty line.
 *
 *   tab, type, Enter          -> next line starts indented
 *   tab, type, Enter, Enter   -> the second Enter gives the indent back
 *
 * One level per press, so deeper nesting unwinds a step at a time. Once the
 * line is flush, Enter inserts a newline as usual.
 */
const dedentBlankLine: KeyBinding['run'] = ({ state, dispatch }) => {
  const range = state.selection.main
  if (!range.empty) return false

  const line = state.doc.lineAt(range.head)
  // Only when the caret sits at the end of that whitespace.
  if (range.head !== line.to) return false

  const width = dedentWidth(line.text, getIndentUnit(state))
  if (width === 0) return false

  const from = line.to - width
  dispatch(
    state.update({
      changes: { from, to: line.to },
      selection: EditorSelection.cursor(from),
      userEvent: 'delete.dedent',
    }),
  )
  return true
}

/**
 * List continuation runs first: an empty list item is its own case, and its
 * marker means the line is not pure whitespace anyway.
 *
 * `Prec.high` is essential. CodeMirror resolves keymaps by extension
 * precedence, and these are registered after `defaultKeymap` — without raising
 * them, the default Enter handles the key first and neither of these ever runs.
 */
export const smartListContinuation = Prec.high(
  keymap.of([
    { key: 'Enter', run: continueList },
    { key: 'Enter', run: dedentBlankLine },
  ]),
)
