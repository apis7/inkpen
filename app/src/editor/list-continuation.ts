/**
 * Smart list continuation.
 *
 * Enter inside a list item starts the next marker; Enter on an empty item ends
 * the list instead of leaving a dangling bullet behind.
 */

import { getIndentUnit } from '@codemirror/language'
import { EditorSelection, Prec } from '@codemirror/state'
import { keymap } from '@codemirror/view'
import type { KeyBinding } from '@codemirror/view'

const LIST_ITEM = /^(\s*)(?:([-*+])|(\d+)([.)]))(\s+)(\[[ xX]\]\s+)?(.*)$/

const continueList: KeyBinding['run'] = ({ state, dispatch }) => {
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

  dispatch(
    state.update({
      changes: { from: range.head, insert },
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
