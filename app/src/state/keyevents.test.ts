/**
 * The keydown path, driven by real KeyboardEvent objects.
 *
 * This is the gap that hand-testing could not close: synthesised OS input does
 * not reach the WebView on the development machine, so "does a remapped key
 * actually fire" had no coverage at all. Dispatching genuine DOM events tests
 * everything except the OS→WebView hop.
 *
 * @vitest-environment jsdom
 */

import { describe, expect, it } from 'vitest'
import { buildLookup, matchEvent, resolveBindings } from './keymap'

function lookupFor(overrides: Record<string, string> = {}) {
  return buildLookup(resolveBindings(overrides)).lookup
}

/** A real KeyboardEvent, as the browser would deliver it. */
function press(key: string, mods: { ctrl?: boolean; shift?: boolean; alt?: boolean } = {}) {
  return new KeyboardEvent('keydown', {
    key,
    ctrlKey: !!mods.ctrl,
    shiftKey: !!mods.shift,
    altKey: !!mods.alt,
    bubbles: true,
    cancelable: true,
  })
}

describe('default bindings fire', () => {
  const lookup = lookupFor()

  it('Ctrl+S saves', () => {
    expect(matchEvent(press('s', { ctrl: true }), lookup)).toEqual({ kind: 'command', id: 'file.save' })
  })

  it('Ctrl+Shift+P opens the palette', () => {
    expect(matchEvent(press('P', { ctrl: true, shift: true }), lookup)).toEqual({
      kind: 'command',
      id: 'palette.open',
    })
  })

  it('Ctrl+Shift+O toggles the outline', () => {
    expect(matchEvent(press('O', { ctrl: true, shift: true }), lookup)).toEqual({
      kind: 'command',
      id: 'view.outline',
    })
  })

  it('Alt+Z toggles word wrap', () => {
    expect(matchEvent(press('z', { alt: true }), lookup)).toEqual({ kind: 'command', id: 'view.wrap' })
  })

  it('distinguishes Ctrl+S from Ctrl+Shift+S', () => {
    expect(matchEvent(press('s', { ctrl: true }), lookup)).toEqual({ kind: 'command', id: 'file.save' })
    expect(matchEvent(press('S', { ctrl: true, shift: true }), lookup)).toEqual({
      kind: 'command',
      id: 'file.saveAs',
    })
  })
})

describe('plain typing is never swallowed', () => {
  const lookup = lookupFor()

  it('lets ordinary characters through', () => {
    for (const ch of ['a', 'Z', '1', ' ', ',', '$']) {
      expect(matchEvent(press(ch), lookup), `key ${ch}`).toBeNull()
    }
  })

  it('lets navigation keys through', () => {
    for (const key of ['ArrowLeft', 'Home', 'End', 'PageDown', 'Backspace', 'Enter', 'Tab']) {
      expect(matchEvent(press(key), lookup), key).toBeNull()
    }
  })

  it('ignores bare modifier presses', () => {
    expect(matchEvent(press('Control', { ctrl: true }), lookup)).toBeNull()
    expect(matchEvent(press('Shift', { shift: true }), lookup)).toBeNull()
  })

  it('lets an unbound chord through to the editor', () => {
    // Ctrl+D is CodeMirror's; the app table must not intercept it.
    expect(matchEvent(press('d', { ctrl: true }), lookup)).toBeNull()
    expect(matchEvent(press('z', { ctrl: true }), lookup)).toBeNull()
    expect(matchEvent(press('f', { ctrl: true }), lookup)).toBeNull()
  })
})

describe('built-in actions', () => {
  const lookup = lookupFor()

  it('Escape dismisses', () => {
    expect(matchEvent(press('Escape'), lookup)).toEqual({ kind: 'dismiss' })
  })

  it('leaves Alt entirely to the keyup tracker', () => {
    // Opening the menu on keydown broke Alt+Tab: the menu appeared and stayed
    // open while Windows switched away. Alt now means nothing to this function.
    expect(matchEvent(press('Alt', { alt: true }), lookup)).toBeNull()
    expect(matchEvent(press('Alt'), lookup)).toBeNull()
  })

  it('Alt as a modifier still resolves its chord', () => {
    expect(matchEvent(press('z', { alt: true }), lookup)).toEqual({ kind: 'command', id: 'view.wrap' })
  })
})

describe('remapping takes effect', () => {
  it('a rebound command answers to its new chord', () => {
    const lookup = lookupFor({ 'view.outline': 'Ctrl+Alt+9' })
    expect(matchEvent(press('9', { ctrl: true, alt: true }), lookup)).toEqual({
      kind: 'command',
      id: 'view.outline',
    })
  })

  it('and stops answering to the old one', () => {
    const lookup = lookupFor({ 'view.outline': 'Ctrl+Alt+9' })
    expect(matchEvent(press('O', { ctrl: true, shift: true }), lookup)).toBeNull()
  })

  it('an unbound command fires for nothing', () => {
    const lookup = lookupFor({ 'file.save': '' })
    expect(matchEvent(press('s', { ctrl: true }), lookup)).toBeNull()
  })

  it('two commands can swap chords', () => {
    const lookup = lookupFor({ 'file.save': 'Ctrl+O', 'file.open': 'Ctrl+S' })
    expect(matchEvent(press('o', { ctrl: true }), lookup)).toEqual({ kind: 'command', id: 'file.save' })
    expect(matchEvent(press('s', { ctrl: true }), lookup)).toEqual({ kind: 'command', id: 'file.open' })
  })

  it('a remap onto an occupied chord is reported, and first-declared wins', () => {
    const bindings = resolveBindings({ 'file.new': 'Ctrl+S' })
    const { lookup, conflicts } = buildLookup(bindings)
    expect(conflicts).toContain('Ctrl+S')
    // file.new is declared before file.save in the table, so it takes the chord.
    expect(matchEvent(press('s', { ctrl: true }), lookup)).toEqual({ kind: 'command', id: 'file.new' })
  })

  it('survives a garbage override without breaking other keys', () => {
    const lookup = lookupFor({ 'file.save': '!!!not a chord!!!' })
    expect(matchEvent(press('P', { ctrl: true, shift: true }), lookup)).toEqual({
      kind: 'command',
      id: 'palette.open',
    })
  })
})

describe('event dispatch reaches a document listener', () => {
  it('a real dispatched event resolves to its command', () => {
    const lookup = lookupFor()
    const seen: string[] = []
    const handler = (e: Event) => {
      const out = matchEvent(e as KeyboardEvent, lookup)
      if (out?.kind === 'command') seen.push(out.id)
    }
    document.addEventListener('keydown', handler)
    document.dispatchEvent(press('s', { ctrl: true }))
    document.dispatchEvent(press('P', { ctrl: true, shift: true }))
    document.dispatchEvent(press('x'))
    document.removeEventListener('keydown', handler)

    expect(seen).toEqual(['file.save', 'palette.open'])
  })
})
