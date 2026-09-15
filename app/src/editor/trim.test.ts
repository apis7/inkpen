/** Trim-on-save must not eat the whitespace the cursor is sitting after. */

import { EditorSelection, EditorState } from '@codemirror/state'
import type { StateCommand } from '@codemirror/state'
import { describe, expect, it } from 'vitest'
import { trimTrailingWhitespace, trimTrailingWhitespaceOnSave } from './commands'

function run(command: StateCommand, doc: string, cursors: number[]): string {
  let state = EditorState.create({
    doc,
    selection: EditorSelection.create(cursors.map((c) => EditorSelection.cursor(c))),
    extensions: EditorState.allowMultipleSelections.of(true),
  })
  command({ state, dispatch: (tr) => (state = tr.state) })
  return state.doc.toString()
}

describe('trimTrailingWhitespaceOnSave', () => {
  it('keeps the space just typed at the cursor', () => {
    const doc = 'Typed thing 123. '
    expect(run(trimTrailingWhitespaceOnSave, doc, [doc.length])).toBe(doc)
  })

  it('keeps whitespace when the cursor is inside it', () => {
    expect(run(trimTrailingWhitespaceOnSave, 'a   ', [2])).toBe('a   ')
  })

  it('still trims lines the cursor is not on', () => {
    expect(run(trimTrailingWhitespaceOnSave, 'one  \ntwo ', [10])).toBe('one\ntwo ')
  })

  it('trims when the cursor sits before the whitespace', () => {
    expect(run(trimTrailingWhitespaceOnSave, 'a  ', [1])).toBe('a')
  })

  it('spares every cursor', () => {
    expect(run(trimTrailingWhitespaceOnSave, 'a \nb \nc ', [2, 5])).toBe('a \nb \nc')
  })
})

describe('trimTrailingWhitespace', () => {
  it('trims everything, cursor or not', () => {
    expect(run(trimTrailingWhitespace, 'a \nb ', [5])).toBe('a\nb')
  })
})
