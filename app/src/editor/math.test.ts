import { describe, expect, it } from 'vitest'
import { MATH_INLINE, findBlockMath } from './math'

function inlineMatches(line: string): string[] {
  return [...line.matchAll(MATH_INLINE)].map((m) => m[1])
}

describe('inline math detection', () => {
  it('finds a simple formula', () => {
    expect(inlineMatches('cost is $x^2$ here')).toEqual(['x^2'])
  })

  it('finds a formula containing backslash commands', () => {
    // This is the exact shape used in the welcome document.
    expect(inlineMatches('costs $t < 1\\,\\text{ms}$ inside')).toEqual(['t < 1\\,\\text{ms}'])
  })

  it('finds two formulas on one line', () => {
    expect(inlineMatches('$a$ and $b$')).toEqual(['a', 'b'])
  })

  it('ignores an escaped dollar', () => {
    expect(inlineMatches('costs \\$5 and \\$6')).toEqual([])
  })

  it('ignores currency amounts', () => {
    expect(inlineMatches('it costs $5 or $10 total')).toEqual([])
  })

  it('ignores an empty pair', () => {
    expect(inlineMatches('$$')).toEqual([])
  })

  it('requires non-space just inside the delimiters', () => {
    expect(inlineMatches('$ x $')).toEqual([])
  })
})

describe('block math detection', () => {
  const doc = ['intro', '$$', 'a = b', 'c = d', '$$', 'outro'].join('\n')

  it('finds a fenced block and its body', () => {
    const found = findBlockMath(doc.split('\n'))
    expect(found).toHaveLength(1)
    expect(found[0].startLine).toBe(2)
    expect(found[0].endLine).toBe(5)
    expect(found[0].source).toBe('a = b\nc = d')
  })

  it('ignores an unclosed fence', () => {
    expect(findBlockMath(['$$', 'a = b'])).toEqual([])
  })

  it('finds several blocks', () => {
    expect(findBlockMath(['$$', 'a', '$$', 'x', '$$', 'b', '$$'])).toHaveLength(2)
  })

  it('handles an empty block', () => {
    const found = findBlockMath(['$$', '$$'])
    expect(found).toHaveLength(1)
    expect(found[0].source).toBe('')
  })
})
