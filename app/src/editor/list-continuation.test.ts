import { describe, expect, it } from 'vitest'
import { dedentWidth } from './list-continuation'

describe('dedentWidth', () => {
  it('gives back one tab', () => {
    expect(dedentWidth('\t', 4)).toBe(1)
    expect(dedentWidth('\t\t\t', 4)).toBe(1)
  })

  it('gives back one indent unit of spaces', () => {
    expect(dedentWidth('    ', 4)).toBe(4)
    expect(dedentWidth('        ', 4)).toBe(4)
    expect(dedentWidth('  ', 2)).toBe(2)
  })

  it('gives back a partial unit rather than over-reaching', () => {
    // Three spaces with a unit of four: return what is actually there.
    expect(dedentWidth('   ', 4)).toBe(3)
  })

  it('does nothing on an already-flush line', () => {
    expect(dedentWidth('', 4)).toBe(0)
  })

  it('does nothing on a line with content', () => {
    // Enter must behave normally here, or typing would become unpredictable.
    expect(dedentWidth('\ttext', 4)).toBe(0)
    expect(dedentWidth('    text', 4)).toBe(0)
    expect(dedentWidth('text', 4)).toBe(0)
    expect(dedentWidth('  text  ', 4)).toBe(0)
  })

  it('handles a tab after spaces', () => {
    // Trailing tab wins, since that is the last thing typed.
    expect(dedentWidth('    \t', 4)).toBe(1)
  })

  it('handles spaces after a tab', () => {
    expect(dedentWidth('\t  ', 4)).toBe(2)
  })

  it('unwinds one level per press', () => {
    // Two levels of spaces: two Enters to get flush.
    let line = '        '
    line = line.slice(0, line.length - dedentWidth(line, 4))
    expect(line).toBe('    ')
    line = line.slice(0, line.length - dedentWidth(line, 4))
    expect(line).toBe('')
    expect(dedentWidth(line, 4)).toBe(0)
  })

  it('unwinds nested tabs one at a time', () => {
    let line = '\t\t'
    line = line.slice(0, line.length - dedentWidth(line, 4))
    expect(line).toBe('\t')
    line = line.slice(0, line.length - dedentWidth(line, 4))
    expect(line).toBe('')
  })
})
