/**
 * Alt-to-open-menu, with Windows' actual semantics.
 *
 * The naive version opens the menu on Alt *keydown*, which breaks every system
 * chord that starts with Alt. Alt+Tab is the worst of them: the app sees the
 * keydown, Windows steals focus for the switcher, and the menu is left hanging
 * open to be dismissed by hand on return.
 *
 * The rule Windows actually uses: the menu opens when Alt is *released*, and
 * only if nothing happened in between. Any other key, any mouse button, or the
 * window losing focus all cancel it.
 */

export interface AltTracker {
  /** @returns true when this keydown should be treated as menu activation. */
  keydown(e: { key: string; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }): void
  /** @returns true when the menu should toggle. */
  keyup(e: { key: string }): boolean
  /** Any pointer activity cancels a pending Alt. */
  pointer(): void
  /** Focus loss cancels — this is the Alt+Tab case. */
  blur(): void
  reset(): void
}

export function createAltTracker(): AltTracker {
  let armed = false

  return {
    keydown(e) {
      if (e.key === 'Alt') {
        // Ctrl+Alt or Shift+Alt are chords, not a bare Alt press.
        armed = !e.ctrlKey && !e.metaKey && !e.shiftKey
      } else {
        // Alt+<anything> is a shortcut; the menu must stay shut.
        armed = false
      }
    },

    keyup(e) {
      if (e.key !== 'Alt') return false
      const fire = armed
      armed = false
      return fire
    },

    pointer() {
      armed = false
    },

    blur() {
      // Alt+Tab, Alt+F4, Alt+Space and the rest all take focus away before the
      // keyup arrives. Cancelling here is what stops the menu appearing.
      armed = false
    },

    reset() {
      armed = false
    },
  }
}
