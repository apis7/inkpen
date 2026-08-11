/**
 * Document store behaviour, including the store↔journal boundary.
 *
 * That boundary is where the `pendingContent` bug lived: `journal.begin` read
 * `doc.pendingContent` *after* `patchDoc` had cleared it, so every journal
 * started from an empty base. Neither the journal tests nor the replay tests
 * could see it, because it sits between them.
 */

import { beforeEach, describe, expect, it } from 'vitest'
import {
  closeDoc,
  contentOf,
  documents,
  docById,
  openSettings,
  openUntitled,
  patchDoc,
  popClosed,
  unsavedUntitled,
} from './documents'

function reset() {
  for (const d of [...documents.docs]) closeDoc(d.id)
  while (popClosed()) { /* drain */ }
}

beforeEach(reset)

describe('contentOf', () => {
  it('reads pendingContent before a view exists', () => {
    const doc = openUntitled('hello world')
    expect(contentOf(doc)).toBe('hello world')
  })

  it('still reads content after unrelated patches', () => {
    const doc = openUntitled('keep me')
    patchDoc(doc.id, { dirty: true })
    expect(contentOf(docById(doc.id)!)).toBe('keep me')
  })

  it('returns empty once pendingContent is cleared and no view took over', () => {
    // Reproduces the shape of the original bug: clearing pendingContent without
    // a view means the content is gone. Callers must capture it beforehand.
    const doc = openUntitled('vanishing')
    patchDoc(doc.id, { pendingContent: null })
    expect(contentOf(docById(doc.id)!)).toBe('')
  })
})

describe('untitled titles', () => {
  it('numbers sequentially', () => {
    expect(openUntitled().title).toBe('Untitled 1')
    expect(openUntitled().title).toBe('Untitled 2')
  })

  it('reuses a freed number', () => {
    const a = openUntitled()
    openUntitled()
    closeDoc(a.id)
    expect(openUntitled().title).toBe('Untitled 1')
  })

  it('renumbers a restored title that collides', () => {
    openUntitled('first')
    // A recovered buffer carries its old title; two tabs reading "Untitled 1"
    // is worse than renumbering one.
    const restored = openUntitled('recovered', 'some-id', 'Untitled 1')
    expect(restored.title).not.toBe('Untitled 1')
  })

  it('keeps a restored title that does not collide', () => {
    const restored = openUntitled('recovered', 'some-id', 'Untitled 7')
    expect(restored.title).toBe('Untitled 7')
  })
})

describe('unsavedUntitled', () => {
  it('includes an untitled buffer with content', () => {
    openUntitled('real work')
    expect(unsavedUntitled()).toHaveLength(1)
  })

  it('excludes an empty buffer', () => {
    openUntitled('   \n\n')
    expect(unsavedUntitled()).toHaveLength(0)
  })

  it('excludes app-authored placeholder text', () => {
    // The welcome document is ours, not the user's. Prompting to save text they
    // never wrote is worse than useless.
    openUntitled('# Welcome', undefined, undefined, true)
    expect(unsavedUntitled()).toHaveLength(0)
  })

  it('includes it once the user edits it', () => {
    const doc = openUntitled('# Welcome', undefined, undefined, true)
    patchDoc(doc.id, { synthetic: false, dirty: true })
    expect(unsavedUntitled()).toHaveLength(1)
  })

  it('excludes the settings tab', () => {
    openSettings()
    expect(unsavedUntitled()).toHaveLength(0)
  })
})

describe('closing', () => {
  it('pushes content onto the reopen stack', () => {
    const doc = openUntitled('bring me back')
    closeDoc(doc.id)
    expect(popClosed()?.content).toBe('bring me back')
  })

  it('activates a neighbour', () => {
    const a = openUntitled('a')
    const b = openUntitled('b')
    closeDoc(b.id)
    expect(documents.activeId).toBe(a.id)
  })

  it('leaves no active document when the last one closes', () => {
    const a = openUntitled('a')
    closeDoc(a.id)
    expect(documents.activeId).toBeNull()
  })
})

describe('settings tab', () => {
  it('is a pseudo-document with no path', () => {
    const s = openSettings()
    expect(s.kind).toBe('settings')
    expect(s.path).toBeNull()
  })

  it('never opens twice', () => {
    const a = openSettings()
    openUntitled('other')
    const b = openSettings()
    expect(b.id).toBe(a.id)
    expect(documents.docs.filter((d) => d.kind === 'settings')).toHaveLength(1)
  })
})
