import { describe, expect, it } from 'vitest'
import { DEFAULT_BINDINGS, buildLookup, normaliseChord, resolveBindings } from './keymap'

describe('normaliseChord', () => {
  it('orders modifiers canonically', () => {
    expect(normaliseChord('shift+ctrl+p')).toBe('Ctrl+Shift+P')
    expect(normaliseChord('alt+ctrl+z')).toBe('Ctrl+Alt+Z')
  })

  it('accepts cmd and meta as Ctrl', () => {
    expect(normaliseChord('cmd+s')).toBe('Ctrl+S')
    expect(normaliseChord('meta+s')).toBe('Ctrl+S')
  })

  it('title-cases named keys and upper-cases single characters', () => {
    expect(normaliseChord('ctrl+tab')).toBe('Ctrl+Tab')
    expect(normaliseChord('ctrl+b')).toBe('Ctrl+B')
  })

  it('returns empty for modifier-only or empty input', () => {
    expect(normaliseChord('ctrl')).toBe('')
    expect(normaliseChord('')).toBe('')
    expect(normaliseChord('   ')).toBe('')
  })

  it('is idempotent', () => {
    for (const b of DEFAULT_BINDINGS) {
      expect(normaliseChord(b.key)).toBe(b.key)
    }
  })
})

describe('resolveBindings', () => {
  it('returns defaults when there are no overrides', () => {
    expect(resolveBindings({})).toEqual(DEFAULT_BINDINGS)
  })

  it('applies an override and normalises it', () => {
    const b = resolveBindings({ 'file.save': 'shift+ctrl+k' })
    expect(b.find((x) => x.id === 'file.save')!.key).toBe('Ctrl+Shift+K')
  })

  it('treats an empty override as unbound', () => {
    const b = resolveBindings({ 'file.save': '' })
    expect(b.find((x) => x.id === 'file.save')!.key).toBe('')
  })

  it('ignores overrides for unknown commands', () => {
    expect(resolveBindings({ 'nope.nothing': 'Ctrl+Q' })).toHaveLength(DEFAULT_BINDINGS.length)
  })
})

describe('buildLookup', () => {
  it('maps every default chord to its command', () => {
    const { lookup, conflicts } = buildLookup(DEFAULT_BINDINGS)
    expect(conflicts).toEqual([])
    expect(lookup.get('Ctrl+S')).toBe('file.save')
    expect(lookup.get('Ctrl+Shift+P')).toBe('palette.open')
  })

  it('ships with no conflicting defaults', () => {
    // A duplicate default would make one command silently unreachable.
    expect(buildLookup(DEFAULT_BINDINGS).conflicts).toEqual([])
  })

  it('reports a conflict rather than silently dropping a binding', () => {
    const { conflicts } = buildLookup(resolveBindings({ 'file.new': 'Ctrl+S' }))
    expect(conflicts).toContain('Ctrl+S')
  })

  it('skips unbound commands', () => {
    const { lookup } = buildLookup(resolveBindings({ 'file.save': '' }))
    expect(lookup.has('Ctrl+S')).toBe(false)
  })
})
