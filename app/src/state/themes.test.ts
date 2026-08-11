/**
 * Theme files are user-authored data that ends up as CSS custom properties, so
 * validation is a trust boundary, not a formatting nicety.
 */

import { describe, expect, it } from 'vitest'
import { sanitiseTheme } from './themes'

describe('sanitiseTheme', () => {
  it('accepts a well-formed theme', () => {
    const t = sanitiseTheme({
      name: 'Solarized',
      base: 'light',
      tokens: { bg: '#fdf6e3', fg: '#657b83', accent: '#268bd2' },
    })
    expect(t?.name).toBe('Solarized')
    expect(t?.base).toBe('light')
    expect(t?.tokens.bg).toBe('#fdf6e3')
  })

  it('defaults an unknown base to light', () => {
    expect(sanitiseTheme({ name: 'x', base: 'chartreuse', tokens: {} })?.base).toBe('light')
    expect(sanitiseTheme({ name: 'x', base: 'dark', tokens: {} })?.base).toBe('dark')
  })

  it('requires a name', () => {
    expect(sanitiseTheme({ tokens: {} })).toBeNull()
    expect(sanitiseTheme({ name: '   ', tokens: {} })).toBeNull()
  })

  it('rejects non-objects', () => {
    for (const junk of [null, undefined, 42, 'theme', []]) {
      expect(sanitiseTheme(junk)).toBeNull()
    }
  })

  it('drops tokens the stylesheet does not define', () => {
    const t = sanitiseTheme({ name: 'x', tokens: { bg: '#fff', notAToken: '#fff' } })
    expect(t?.tokens.bg).toBe('#fff')
    expect(t?.tokens).not.toHaveProperty('notAToken')
  })

  it('rejects values that are not plain colours', () => {
    // These end up in a CSS custom property; anything with a function call or
    // a statement terminator must not survive.
    const hostile = {
      name: 'x',
      tokens: {
        bg: 'url(http://evil/x.png)',
        fg: 'red; background: url(javascript:alert(1))',
        accent: 'expression(alert(1))',
        border: '#fff}',
        warn: 'var(--something)',
      },
    }
    expect(sanitiseTheme(hostile)?.tokens).toEqual({})
  })

  it('accepts colour keywords and every hex length', () => {
    const t = sanitiseTheme({
      name: 'x',
      tokens: { bg: '#fff', fg: '#ffffff', accent: '#ffffffaa', border: 'rebeccapurple' },
    })
    expect(Object.keys(t!.tokens).sort()).toEqual(['accent', 'bg', 'border', 'fg'])
  })

  it('tolerates a missing tokens table', () => {
    expect(sanitiseTheme({ name: 'bare' })?.tokens).toEqual({})
  })

  it('trims whitespace around values', () => {
    expect(sanitiseTheme({ name: 'x', tokens: { bg: '  #abc  ' } })?.tokens.bg).toBe('#abc')
  })
})
