import { describe, expect, it } from 'vitest'
import { parseSession } from './session'

const valid = {
  version: 2,
  tabs: [
    { path: 'C:\\notes\\a.md', cursor: 10, scrollTop: 40, pinned: false },
    { path: 'C:\\notes\\b.txt', cursor: 0, scrollTop: 0, pinned: true },
  ],
  activeIndex: 1,
  outlineOpen: true,
  window: { width: 1200, height: 800, x: 40, y: 60, maximized: false },
}

describe('parseSession', () => {
  it('round-trips a well-formed session', () => {
    const s = parseSession(valid)
    expect(s.tabs).toHaveLength(2)
    expect(s.activeIndex).toBe(1)
    expect(s.outlineOpen).toBe(true)
    expect(s.window?.width).toBe(1200)
    expect(s.tabs[1].pinned).toBe(true)
  })

  it('discards a session from an older format', () => {
    expect(parseSession({ ...valid, version: 1 }).tabs).toHaveLength(0)
  })

  it('survives arbitrary garbage', () => {
    for (const junk of [null, undefined, 42, 'nope', [], {}, { tabs: 'no' }]) {
      const s = parseSession(junk)
      expect(s.tabs).toEqual([])
      expect(s.activeIndex).toBe(0)
    }
  })

  it('drops malformed tab entries but keeps good ones', () => {
    const s = parseSession({
      ...valid,
      tabs: [{ path: '', cursor: 0 }, null, { cursor: 5 }, valid.tabs[0], { path: 'x', cursor: 'no' }],
    })
    expect(s.tabs).toHaveLength(1)
    expect(s.tabs[0].path).toBe('C:\\notes\\a.md')
  })

  it('clamps activeIndex into range', () => {
    expect(parseSession({ ...valid, activeIndex: 99 }).activeIndex).toBe(1)
    expect(parseSession({ ...valid, activeIndex: -5 }).activeIndex).toBe(0)
    expect(parseSession({ ...valid, tabs: [], activeIndex: 3 }).activeIndex).toBe(0)
  })

  it('rejects an absurd window size rather than restoring an unusable window', () => {
    expect(parseSession({ ...valid, window: { width: 1, height: 1 } }).window).toBeUndefined()
    expect(parseSession({ ...valid, window: { width: 0, height: 0 } }).window).toBeUndefined()
  })

  it('clamps negative cursor and scroll values', () => {
    const s = parseSession({ ...valid, tabs: [{ path: 'a', cursor: -9, scrollTop: -3 }] })
    expect(s.tabs[0].cursor).toBe(0)
    expect(s.tabs[0].scrollTop).toBe(0)
  })

  it('caps the tab count', () => {
    const many = Array.from({ length: 400 }, (_, i) => ({ path: `f${i}.md`, cursor: 0 }))
    expect(parseSession({ ...valid, tabs: many }).tabs).toHaveLength(100)
  })
})
