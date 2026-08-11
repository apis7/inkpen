/**
 * Preview lines for the recovery and quit dialogs.
 *
 * These strings are how a user decides which unsaved document to keep, so a
 * preview that reads `---` is a real failure, not a cosmetic one.
 */

import { describe, expect, it } from 'vitest'

// Mirrors previewLine in app.tsx. Kept in sync deliberately: app.tsx pulls in
// Tauri APIs that cannot be imported under the test environment.
function previewLine(content: string): string {
  const lines = content.split('\n')
  let start = 0

  if (lines[0]?.trim() === '---') {
    const close = lines.findIndex((l, i) => i > 0 && l.trim() === '---')
    if (close > 0) start = close + 1
  }

  for (let i = start; i < lines.length; i++) {
    const line = lines[i].trim()
    if (!line || /^-{3,}$/.test(line) || /^={3,}$/.test(line)) continue
    const clean = line
      .replace(/^#{1,6}\s+/, '')
      .replace(/^[-*+]\s+(\[[ xX]\]\s*)?/, '')
      .replace(/^>\s*/, '')
    if (clean) return clean.slice(0, 60)
  }
  return 'empty'
}

describe('previewLine', () => {
  it('skips a front matter block', () => {
    const doc = '---\ntitle: Inkpen\nstatus: draft\n---\n\n# Project Notes\n\nBody.'
    expect(previewLine(doc)).toBe('Project Notes')
  })

  it('strips heading markers', () => {
    expect(previewLine('### Deep heading\ntext')).toBe('Deep heading')
  })

  it('strips list and task markers', () => {
    expect(previewLine('- [ ] buy milk')).toBe('buy milk')
    expect(previewLine('* a bullet')).toBe('a bullet')
  })

  it('strips blockquote markers', () => {
    expect(previewLine('> quoted thought')).toBe('quoted thought')
  })

  it('never returns a horizontal rule', () => {
    expect(previewLine('---\n\n----\n\nreal content')).toBe('real content')
    expect(previewLine('===\ncontent')).toBe('content')
  })

  it('handles an unterminated front matter fence', () => {
    // No closing ---, so the opener is just a rule and the scan continues.
    expect(previewLine('---\nsome text')).toBe('some text')
  })

  it('falls back to "empty" for whitespace-only content', () => {
    expect(previewLine('   \n\n\t\n')).toBe('empty')
    expect(previewLine('')).toBe('empty')
  })

  it('truncates long lines', () => {
    expect(previewLine('x'.repeat(200))).toHaveLength(60)
  })
})
