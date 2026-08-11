/**
 * Reflow rewrites text the user has selected, so the risk is not that it does
 * too little — it is that it silently destroys structure. Most of these tests
 * are about what must survive untouched.
 */

import { describe, expect, it } from 'vitest'
import { reflowText } from './reflow'

describe('joining wrapped lines', () => {
  it('joins a hard-wrapped paragraph', () => {
    const input = 'This sentence was\nwrapped across three\nseparate lines.'
    expect(reflowText(input)).toBe('This sentence was wrapped across three separate lines.')
  })

  it('keeps paragraphs separated by a blank line', () => {
    const input = 'First para\nwrapped here.\n\nSecond para\nalso wrapped.'
    expect(reflowText(input)).toBe('First para wrapped here.\n\nSecond para also wrapped.')
  })

  it('collapses runs of blank lines to one', () => {
    expect(reflowText('a\n\n\n\nb')).toBe('a\n\nb')
  })

  it('trims the ragged indentation copied from a browser', () => {
    expect(reflowText('Some text that\n   continues here\n  and here')).toBe(
      'Some text that continues here and here',
    )
  })

  it('leaves an already-unwrapped paragraph alone', () => {
    const input = 'A single line that needs nothing doing to it.'
    expect(reflowText(input)).toBe(input)
  })
})

describe('structure that must survive', () => {
  it('never joins list items together', () => {
    const input = '- first item\n- second item\n- third item'
    expect(reflowText(input)).toBe(input)
  })

  it('joins a wrapped continuation into its list item', () => {
    const input = '- an item that is long enough\n  to wrap onto a second line\n- next item'
    expect(reflowText(input)).toBe('- an item that is long enough to wrap onto a second line\n- next item')
  })

  it('handles ordered lists', () => {
    expect(reflowText('1. first\n2. second')).toBe('1. first\n2. second')
  })

  it('keeps headings on their own line', () => {
    const input = '# Title\nBody text follows.'
    expect(reflowText(input)).toBe(input)
  })

  it('does not pull the line after a heading up into it', () => {
    expect(reflowText('## Section\nfirst line\nsecond line')).toBe('## Section\nfirst line second line')
  })

  it('leaves fenced code exactly as written', () => {
    const input = '```js\nconst a = 1\n\nconst b = 2\n```'
    expect(reflowText(input)).toBe(input)
  })

  it('resumes reflowing after a fence closes', () => {
    const input = 'before\ntext\n\n```\ncode\nhere\n```\n\nafter\ntext'
    expect(reflowText(input)).toBe('before text\n\n```\ncode\nhere\n```\n\nafter text')
  })

  it('leaves table rows alone', () => {
    const input = '| a | b |\n| - | - |\n| 1 | 2 |'
    expect(reflowText(input)).toBe(input)
  })

  it('keeps blockquote lines separate from surrounding prose', () => {
    expect(reflowText('> quoted line\nplain line')).toBe('> quoted line plain line')
  })

  it('leaves a horizontal rule alone', () => {
    expect(reflowText('above\n\n---\n\nbelow')).toBe('above\n\n---\n\nbelow')
  })

  it('leaves an indented code block alone', () => {
    const input = 'text\n\n    indented code\n    more code\n\nafter'
    expect(reflowText(input)).toBe(input)
  })
})

describe('hyphenation', () => {
  it('joins a trailing hyphen without adding a space', () => {
    expect(reflowText('state-\nof-the-art design')).toBe('state-of-the-art design')
  })

  it('keeps the hyphen rather than guessing at a split word', () => {
    // "inter-\nnational" could be a split word or a real compound. Removing the
    // hyphen would fix one and break the other, so it stays.
    expect(reflowText('inter-\nnational')).toBe('inter-national')
  })
})

describe('edge cases', () => {
  it('handles empty input', () => {
    expect(reflowText('')).toBe('')
  })

  it('handles whitespace-only input', () => {
    expect(reflowText('   \n  \n')).toBe('')
  })

  it('normalises CRLF', () => {
    expect(reflowText('one\r\ntwo')).toBe('one two')
  })

  it('is idempotent', () => {
    const input = '# Title\n\nA wrapped\nparagraph.\n\n- a list item\n- another\n\n```\ncode\n```'
    const once = reflowText(input)
    expect(reflowText(once)).toBe(once)
  })

  it('survives an unclosed code fence without eating the rest', () => {
    const input = 'text\n\n```\nunclosed code\nmore code'
    expect(reflowText(input)).toBe(input)
  })
})
