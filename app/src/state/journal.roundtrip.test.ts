/**
 * Round-trip test: drive the real write path, then replay what it produced.
 *
 * The unit tests for `replay` alone cannot catch a bug in `flush` — this is the
 * test that would have caught the missing base snapshot, where a recovered
 * document came back holding only the edits and not the text the file was
 * opened with.
 */

import { ChangeSet } from '@codemirror/state'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const written: string[] = []

vi.mock('../ipc', () => ({
  journalAppend: (_id: string, record: string) => {
    written.push(record)
    return Promise.resolve()
  },
  journalSnapshot: (_id: string, records: string[]) => {
    written.length = 0
    written.push(...records)
    return Promise.resolve()
  },
  journalRelease: () => Promise.resolve(),
  journalSync: () => Promise.resolve(),
  journalList: () => Promise.resolve([]),
}))

const { begin, record, replay, syncNow } = await import('./journal')

const META = {
  path: null,
  title: 'Untitled 1',
  encoding: 'utf8' as const,
  lineEnding: 'crlf' as const,
  language: 'markdown',
}

/** Applies a single edit and returns the resulting text plus its ChangeSet. */
function edit(doc: string, from: number, to: number, insert: string) {
  const changes = ChangeSet.of([{ from, to, insert }], doc.length)
  return { changes, text: changes.apply(ChangeSet.of([], 0).apply as never) as never }
}

function apply(doc: string, from: number, to: number, insert: string) {
  const changes = ChangeSet.of([{ from, to, insert }], doc.length)
  const text = doc.slice(0, from) + insert + doc.slice(to)
  return { changes, text }
}

describe('journal write/replay round trip', () => {
  beforeEach(() => {
    written.length = 0
    vi.useFakeTimers()
  })

  it('preserves the text the document was opened with', async () => {
    const id = 'doc-1'
    const initial = '# Existing file\n\nAlready on disk.\n'
    begin(id, META, initial)

    const first = apply(initial, initial.length, initial.length, 'typed')
    record(id, first.changes, first.text)

    await vi.advanceTimersByTimeAsync(300)

    const out = replay(written)
    expect(out).not.toBeNull()
    // The whole document, not just the five characters that were typed.
    expect(out!.content).toBe(initial + 'typed')
  })

  it('accumulates edits after the base snapshot', async () => {
    const id = 'doc-2'
    let text = 'base'
    begin(id, META, text)

    for (const word of [' one', ' two', ' three']) {
      const step = apply(text, text.length, text.length, word)
      record(id, step.changes, step.text)
      text = step.text
      await vi.advanceTimersByTimeAsync(300)
    }

    expect(replay(written)!.content).toBe('base one two three')
  })

  it('replays deletions correctly', async () => {
    const id = 'doc-3'
    let text = 'keep this remove this'
    begin(id, META, text)

    let step = apply(text, text.length, text.length, '!')
    record(id, step.changes, step.text)
    text = step.text
    await vi.advanceTimersByTimeAsync(300)

    step = apply(text, 9, 21, '')
    record(id, step.changes, step.text)
    text = step.text
    await vi.advanceTimersByTimeAsync(300)

    expect(replay(written)!.content).toBe(text)
  })

  it('survives losing everything after an arbitrary record', async () => {
    // Simulates a hard kill mid-write: every prefix of the journal must still
    // replay to *some* valid earlier state rather than to corrupt text.
    const id = 'doc-4'
    let text = 'start'
    begin(id, META, text)
    for (const word of [' a', ' b', ' c', ' d']) {
      const step = apply(text, text.length, text.length, word)
      record(id, step.changes, step.text)
      text = step.text
      await vi.advanceTimersByTimeAsync(300)
    }

    for (let cut = 2; cut <= written.length; cut++) {
      const out = replay(written.slice(0, cut))
      expect(out, `prefix of ${cut} records`).not.toBeNull()
      expect(text.startsWith(out!.content)).toBe(true)
    }
  })

  it('flushes pending edits on syncNow', async () => {
    const id = 'doc-5'
    const initial = 'unflushed'
    begin(id, META, initial)
    const step = apply(initial, initial.length, initial.length, '!')
    record(id, step.changes, step.text)

    // No timer advance — the debounce has not fired.
    expect(written).toHaveLength(0)
    await syncNow()
    expect(replay(written)!.content).toBe('unflushed!')
  })
})

// Keep the unused helper from tripping noUnusedLocals in the editor.
void edit
