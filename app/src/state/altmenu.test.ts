import { describe, expect, it } from 'vitest'
import { createAltTracker } from './altmenu'

const alt = (mods: Partial<{ ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }> = {}) => ({
  key: 'Alt',
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
  ...mods,
})
const key = (k: string, mods: Partial<{ ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }> = {}) => ({
  key: k,
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
  ...mods,
})

describe('bare Alt', () => {
  it('opens the menu on release', () => {
    const t = createAltTracker()
    t.keydown(alt())
    expect(t.keyup({ key: 'Alt' })).toBe(true)
  })

  it('does not open on press alone', () => {
    const t = createAltTracker()
    t.keydown(alt())
    // Nothing has been released yet, so nothing should have happened.
    expect(t.keyup({ key: 'Z' })).toBe(false)
  })

  it('needs a preceding Alt press', () => {
    const t = createAltTracker()
    expect(t.keyup({ key: 'Alt' })).toBe(false)
  })

  it('does not re-fire on a second release', () => {
    const t = createAltTracker()
    t.keydown(alt())
    expect(t.keyup({ key: 'Alt' })).toBe(true)
    expect(t.keyup({ key: 'Alt' })).toBe(false)
  })
})

describe('Alt chords do not open the menu', () => {
  it('Alt+Tab — the case that prompted this', () => {
    const t = createAltTracker()
    t.keydown(alt())
    t.keydown(key('Tab', { altKey: true } as never))
    expect(t.keyup({ key: 'Alt' })).toBe(false)
  })

  it('Alt+Tab where Windows steals focus before the keyup', () => {
    // The switcher takes focus, so our keyup may never arrive — and when the
    // window comes back the stale Alt must not fire.
    const t = createAltTracker()
    t.keydown(alt())
    t.blur()
    expect(t.keyup({ key: 'Alt' })).toBe(false)
  })

  it('Alt+Z (an app shortcut)', () => {
    const t = createAltTracker()
    t.keydown(alt())
    t.keydown(key('z'))
    expect(t.keyup({ key: 'Alt' })).toBe(false)
  })

  it('Alt+F4', () => {
    const t = createAltTracker()
    t.keydown(alt())
    t.keydown(key('F4'))
    expect(t.keyup({ key: 'Alt' })).toBe(false)
  })

  it('Ctrl+Alt is a chord, not a bare Alt', () => {
    const t = createAltTracker()
    t.keydown(alt({ ctrlKey: true }))
    expect(t.keyup({ key: 'Alt' })).toBe(false)
  })

  it('Shift+Alt is a chord too', () => {
    const t = createAltTracker()
    t.keydown(alt({ shiftKey: true }))
    expect(t.keyup({ key: 'Alt' })).toBe(false)
  })
})

describe('other cancellations', () => {
  it('a mouse click cancels a pending Alt', () => {
    const t = createAltTracker()
    t.keydown(alt())
    t.pointer()
    expect(t.keyup({ key: 'Alt' })).toBe(false)
  })

  it('reset clears the pending state', () => {
    const t = createAltTracker()
    t.keydown(alt())
    t.reset()
    expect(t.keyup({ key: 'Alt' })).toBe(false)
  })

  it('recovers for the next genuine bare Alt', () => {
    const t = createAltTracker()
    t.keydown(alt())
    t.blur()
    expect(t.keyup({ key: 'Alt' })).toBe(false)
    // A fresh press afterwards still works.
    t.keydown(alt())
    expect(t.keyup({ key: 'Alt' })).toBe(true)
  })

  it('repeated Alt+Tab cycling never opens the menu', () => {
    const t = createAltTracker()
    for (let i = 0; i < 5; i++) {
      t.keydown(alt())
      t.keydown(key('Tab'))
      t.blur()
      expect(t.keyup({ key: 'Alt' })).toBe(false)
    }
  })
})
