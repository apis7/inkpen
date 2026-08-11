import { describe, expect, it } from 'vitest'
import { replay } from './journal'

const header = JSON.stringify({
  t: 'header',
  docId: 'a',
  ts: 1,
  path: null,
  title: 'Untitled 1',
  encoding: 'utf8',
  lineEnding: 'crlf',
  language: 'markdown',
})

const change = (seq: number, changes: [number, number, string][]) =>
  JSON.stringify({ t: 'change', seq, ts: seq, changes })

const snapshot = (seq: number, content: string) =>
  JSON.stringify({ t: 'snapshot', seq, ts: seq, content })

describe('journal replay', () => {
  it('rebuilds text from an empty buffer', () => {
    const out = replay([header, change(1, [[0, 0, 'hello']]), change(2, [[5, 5, ' world']])])
    expect(out?.content).toBe('hello world')
  })

  it('applies deletions and replacements', () => {
    const out = replay([
      header,
      change(1, [[0, 0, 'hello world']]),
      change(2, [[0, 5, 'goodbye']]),
      change(3, [[7, 13, '']]),
    ])
    expect(out?.content).toBe('goodbye')
  })

  it('applies multiple edits inside one record in order', () => {
    const out = replay([header, change(1, [[0, 0, 'abc'], [3, 3, 'def']])])
    expect(out?.content).toBe('abcdef')
  })

  it('resumes from a snapshot and discards earlier history', () => {
    const out = replay([
      header,
      change(1, [[0, 0, 'noise that should never appear']]),
      snapshot(2, 'clean base'),
      change(3, [[10, 10, ' plus more']]),
    ])
    expect(out?.content).toBe('clean base plus more')
  })

  it('survives a truncated final line from a hard crash', () => {
    const out = replay([header, change(1, [[0, 0, 'kept']]), '{"t":"change","seq":2,"ch'])
    expect(out?.content).toBe('kept')
  })

  it('survives a garbage line mid-journal', () => {
    const out = replay([header, change(1, [[0, 0, 'ab']]), 'not json at all', change(2, [[2, 2, 'cd']])])
    expect(out?.content).toBe('abcd')
  })

  it('refuses to produce corrupt text when a record cannot apply', () => {
    // Offsets past the end of the buffer mean the journal is inconsistent.
    // Returning partial text would silently hand the user a damaged document.
    expect(replay([header, change(1, [[50, 60, 'x']])])).toBeNull()
    expect(replay([header, change(1, [[0, 0, 'ab']]), change(2, [[5, 9, 'x']])])).toBeNull()
  })

  it('returns null without a header', () => {
    expect(replay([change(1, [[0, 0, 'orphan']])])).toBeNull()
  })

  it('carries the metadata needed to restore the tab', () => {
    const out = replay([header, change(1, [[0, 0, 'x']])])
    expect(out?.meta.title).toBe('Untitled 1')
    expect(out?.meta.language).toBe('markdown')
    expect(out?.meta.encoding).toBe('utf8')
  })

  it('handles astral-plane characters as UTF-16 units', () => {
    // CodeMirror offsets are UTF-16 code units; an emoji is two of them.
    // Replaying with code-point indexing would corrupt this.
    const out = replay([header, change(1, [[0, 0, '🙂ab']]), change(2, [[2, 2, 'X']])])
    expect(out?.content).toBe('🙂Xab')
  })
})
