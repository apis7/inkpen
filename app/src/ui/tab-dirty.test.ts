/**
 * Unsaved tabs render their filename in italics.
 *
 * This is styling, so the obvious test — "does the component set the
 * attribute" — proves half of it. A correct attribute paired with a selector
 * that never matches looks exactly like a working feature to a passing suite
 * and exactly like a broken one to the user. So these tests read the real
 * stylesheet off disk and check the computed style, which fails if either side
 * of the pair is wrong.
 *
 * The attempt before this one was a screenshot, which produced two identical
 * images because the synthetic keystroke never reached the window.
 *
 * @vitest-environment jsdom
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'

// jsdom serves import.meta.url over http, so resolve from the project root.
const CSS_PATH = resolve(process.cwd(), 'src/styles/app.css')
const TITLEBAR_PATH = resolve(process.cwd(), 'src/ui/TitleBar.tsx')

beforeAll(() => {
  const style = document.createElement('style')
  style.textContent = readFileSync(CSS_PATH, 'utf8')
  document.head.appendChild(style)
})

afterEach(() => {
  document.body.innerHTML = ''
})

function renderName(cls: string, dirty: boolean): HTMLElement {
  const span = document.createElement('span')
  span.className = cls
  span.setAttribute('data-dirty', String(dirty))
  span.textContent = 'notes.md'
  document.body.appendChild(span)
  return span
}

describe('unsaved tab names', () => {
  it('leans when the document is dirty', () => {
    expect(getComputedStyle(renderName('tab-name', true)).fontStyle).toBe('italic')
  })

  it('stands upright once saved', () => {
    expect(getComputedStyle(renderName('tab-name', false)).fontStyle).toBe('normal')
  })

  it('applies the same rule in the overflow menu', () => {
    expect(getComputedStyle(renderName('tab-overflow-name', true)).fontStyle).toBe('italic')
    expect(getComputedStyle(renderName('tab-overflow-name', false)).fontStyle).toBe('normal')
  })
})

describe('the titlebar supplies the attribute', () => {
  const source = readFileSync(TITLEBAR_PATH, 'utf8')

  // Guards the other half of the pair: the CSS above can only match if the
  // component actually emits data-dirty on both names.
  it('binds data-dirty on the tab name', () => {
    expect(source).toMatch(/class="tab-name"\s+data-dirty=\{doc\.dirty\}/)
  })

  it('binds data-dirty on the overflow name', () => {
    expect(source).toMatch(/class="tab-overflow-name"\s+data-dirty=\{doc\.dirty\}/)
  })
})
