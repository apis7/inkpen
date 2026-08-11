/**
 * Outline extraction.
 *
 * Reads the existing CodeMirror syntax tree — no separate parser, no extra
 * dependency, and incremental reparsing comes free. Markdown headings plus the
 * four structured config formats, capped at 4 levels so a deeply nested file
 * gives an overview rather than a thousand-row tree.
 */

import { syntaxTree } from '@codemirror/language'
import type { EditorState } from '@codemirror/state'

export interface OutlineItem {
  text: string
  level: number
  pos: number
  truncated?: boolean
}

export const OUTLINE_LANGUAGES = new Set(['markdown', 'json', 'yaml', 'toml', 'ini'])
const MAX_DEPTH = 4
const MAX_ITEMS = 500

export function extractOutline(state: EditorState, language: string): OutlineItem[] {
  switch (language) {
    case 'markdown':
      return markdownOutline(state)
    case 'json':
      return jsonOutline(state)
    case 'yaml':
      return yamlOutline(state)
    case 'toml':
    case 'ini':
      return sectionOutline(state)
    default:
      return []
  }
}

function markdownOutline(state: EditorState): OutlineItem[] {
  const items: OutlineItem[] = []
  syntaxTree(state).iterate({
    enter: (node) => {
      const m = /^(?:ATXHeading|SetextHeading)(\d)$/.exec(node.name)
      if (!m) return
      const level = Number(m[1])
      const line = state.doc.lineAt(node.from)
      const text = line.text.replace(/^\s*#{1,6}\s*/, '').replace(/\s*#+\s*$/, '').trim()
      if (text) items.push({ text, level, pos: line.from })
    },
  })
  return items.slice(0, MAX_ITEMS)
}

/** Brace/bracket depth tracking over the raw text. Cheaper and far more robust
 *  against a half-typed document than walking the JSON tree. */
function jsonOutline(state: EditorState): OutlineItem[] {
  const items: OutlineItem[] = []
  let depth = 0
  let inString = false
  let escaped = false
  let truncatedAt = -1

  for (let n = 1; n <= state.doc.lines && items.length < MAX_ITEMS; n++) {
    const line = state.doc.line(n)
    const keyMatch = /^\s*"((?:[^"\\]|\\.)*)"\s*:/.exec(line.text)

    if (keyMatch && depth >= 1 && depth <= MAX_DEPTH) {
      items.push({ text: keyMatch[1], level: depth, pos: line.from })
      truncatedAt = -1
    } else if (keyMatch && depth > MAX_DEPTH && truncatedAt !== depth) {
      items.push({ text: '⋯', level: MAX_DEPTH + 1, pos: line.from, truncated: true })
      truncatedAt = depth
    }

    for (const ch of line.text) {
      if (escaped) { escaped = false; continue }
      if (ch === '\\') { escaped = true; continue }
      if (ch === '"') { inString = !inString; continue }
      if (inString) continue
      if (ch === '{' || ch === '[') depth++
      else if (ch === '}' || ch === ']') depth = Math.max(0, depth - 1)
    }
  }
  return items
}

/** Indentation is the structure in YAML, so indentation is what we read. */
function yamlOutline(state: EditorState): OutlineItem[] {
  const items: OutlineItem[] = []
  const stops: number[] = []

  for (let n = 1; n <= state.doc.lines && items.length < MAX_ITEMS; n++) {
    const line = state.doc.line(n)
    if (!line.text.trim() || /^\s*#/.test(line.text)) continue

    const m = /^(\s*)([A-Za-z0-9_.$-]+)\s*:(?:\s|$)/.exec(line.text)
    if (!m) continue

    const indent = m[1].length
    while (stops.length && stops[stops.length - 1] >= indent) stops.pop()
    stops.push(indent)
    const level = stops.length

    if (level <= MAX_DEPTH) {
      items.push({ text: m[2], level, pos: line.from })
    }
  }
  return items
}

/** `[table]`, `[[array-of-table]]` and INI `[section]` — nested by dotted path. */
function sectionOutline(state: EditorState): OutlineItem[] {
  const items: OutlineItem[] = []
  for (let n = 1; n <= state.doc.lines && items.length < MAX_ITEMS; n++) {
    const line = state.doc.line(n)
    const m = /^\s*(\[{1,2})\s*([^\]]+?)\s*\]{1,2}\s*$/.exec(line.text)
    if (!m) continue
    const parts = m[2].split('.')
    const level = Math.min(parts.length, MAX_DEPTH)
    const prefix = m[1] === '[[' ? '⋮ ' : ''
    items.push({ text: prefix + parts[parts.length - 1], level, pos: line.from })
  }
  return items
}

/** The deepest heading at or above the cursor — what the `◀` marker points at. */
export function currentOutlineIndex(items: OutlineItem[], pos: number): number {
  let index = -1
  for (let i = 0; i < items.length; i++) {
    if (items[i].pos <= pos) index = i
    else break
  }
  return index
}
