/**
 * Enter behaviour, driven through a real editor.
 *
 * The unit tests for `dedentWidth` passed while the feature did nothing at all:
 * the binding was registered after `defaultKeymap`, so CodeMirror gave the
 * default Enter precedence and ours was never consulted. Testing the arithmetic
 * proved nothing about whether the key was wired up.
 *
 * These tests mount an editor with the same extension order the app uses and
 * press Enter for real.
 *
 * @vitest-environment jsdom
 */

import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { indentUnit } from '@codemirror/language'
import { EditorState } from '@codemirror/state'
import { EditorView, keymap } from '@codemirror/view'
import { afterEach, describe, expect, it } from 'vitest'
import { smartListContinuation } from './list-continuation'

let view: EditorView | null = null

afterEach(() => {
  view?.destroy()
  view = null
})

/** Same ordering as createEditor: defaults first, markdown extensions after. */
function mount(doc: string, opts: { unit?: string; cursorAt?: number } = {}) {
  const { unit = '    ', cursorAt = doc.length } = opts
  const parent = document.createElement('div')
  document.body.appendChild(parent)
  view = new EditorView({
    parent,
    state: EditorState.create({
      doc,
      selection: { anchor: cursorAt },
      extensions: [
        history(),
        indentUnit.of(unit),
        keymap.of([...historyKeymap, ...defaultKeymap]),
        markdown({ base: markdownLanguage, addKeymap: false }),
        smartListContinuation,
      ],
    }),
  })
  return view
}

function pressEnter(v: EditorView) {
  v.contentDOM.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true, cancelable: true }),
  )
}

describe('Enter on an indented blank line gives the indent back', () => {
  it('removes a single tab instead of adding a line', () => {
    const v = mount('\t')
    pressEnter(v)
    expect(v.state.doc.toString()).toBe('')
    expect(v.state.doc.lines).toBe(1)
  })

  it('removes one indent unit of spaces', () => {
    const v = mount('    ')
    pressEnter(v)
    expect(v.state.doc.toString()).toBe('')
  })

  it('unwinds nesting one press at a time', () => {
    const v = mount('\t\t')
    pressEnter(v)
    expect(v.state.doc.toString()).toBe('\t')
    pressEnter(v)
    expect(v.state.doc.toString()).toBe('')
  })

  it('reproduces the reported sequence, with spaces for indentation', () => {
    // Auto-indent reproduces the indentation using the configured unit, which
    // is spaces by default — the new line is not literally a tab.
    const v = mount('\tTab1')
    pressEnter(v)
    expect(v.state.doc.toString()).toBe('\tTab1\n    ')
    pressEnter(v)
    expect(v.state.doc.toString()).toBe('\tTab1\n')
    expect(v.state.doc.lines).toBe(2)
  })

  it('reproduces the reported sequence with tab indentation', () => {
    const v = mount('\tTab1', { unit: '\t' })
    pressEnter(v)
    expect(v.state.doc.toString()).toBe('\tTab1\n\t')
    pressEnter(v)
    expect(v.state.doc.toString()).toBe('\tTab1\n')
  })
})

describe('Enter still behaves normally elsewhere', () => {
  it('inserts a newline on a line with content', () => {
    const v = mount('hello')
    pressEnter(v)
    expect(v.state.doc.toString()).toBe('hello\n')
  })

  it('inserts a newline on an already-flush empty line', () => {
    const v = mount('a\n')
    pressEnter(v)
    expect(v.state.doc.lines).toBe(3)
  })

  it('preserves indentation when the line has content', () => {
    const v = mount('\ttext')
    pressEnter(v)
    // Indented, using the configured unit rather than copying the tab verbatim.
    expect(v.state.doc.toString()).toBe('\ttext\n    ')
  })
})

describe('list continuation is reachable too', () => {
  it('continues a bullet list', () => {
    const v = mount('- first')
    pressEnter(v)
    expect(v.state.doc.toString()).toBe('- first\n- ')
  })

  it('continues a numbered list with the next number', () => {
    const v = mount('1. first')
    pressEnter(v)
    expect(v.state.doc.toString()).toBe('1. first\n2. ')
  })

  it('carries a task checkbox as unchecked', () => {
    const v = mount('- [x] done')
    pressEnter(v)
    expect(v.state.doc.toString()).toBe('- [x] done\n- [ ] ')
  })

  it('ends the list on an empty item', () => {
    const v = mount('- first\n- ')
    pressEnter(v)
    expect(v.state.doc.toString()).toBe('- first\n')
  })
})
