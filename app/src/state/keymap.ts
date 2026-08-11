/**
 * Keybindings as data.
 *
 * Shortcuts used to be a chain of conditionals in the keydown handler, which
 * made them impossible to remap or even to list. They are now a table: defaults
 * here, user overrides in `settings.toml`, resolved into a lookup keyed by a
 * normalised chord string.
 */

export interface Binding {
  id: string
  label: string
  /** Chord in canonical form, e.g. `Ctrl+Shift+P`. Empty string = unbound. */
  key: string
}

/** Canonical chord form: modifiers in a fixed order, single keys title-cased. */
export function chordOf(e: KeyboardEvent): string {
  const parts: string[] = []
  if (e.ctrlKey || e.metaKey) parts.push('Ctrl')
  if (e.altKey) parts.push('Alt')
  if (e.shiftKey) parts.push('Shift')

  let key = e.key
  if (['Control', 'Alt', 'Shift', 'Meta'].includes(key)) return ''
  if (key === ' ') key = 'Space'
  else if (key.length === 1) key = key.toUpperCase()

  parts.push(key)
  return parts.join('+')
}

export function normaliseChord(input: string): string {
  const raw = input.split('+').map((p) => p.trim()).filter(Boolean)
  if (!raw.length) return ''
  const mods = new Set<string>()
  let key = ''
  for (const part of raw) {
    const lower = part.toLowerCase()
    if (lower === 'ctrl' || lower === 'control' || lower === 'cmd' || lower === 'meta') mods.add('Ctrl')
    else if (lower === 'alt') mods.add('Alt')
    else if (lower === 'shift') mods.add('Shift')
    else key = part.length === 1 ? part.toUpperCase() : part[0].toUpperCase() + part.slice(1)
  }
  if (!key) return ''
  const out: string[] = []
  if (mods.has('Ctrl')) out.push('Ctrl')
  if (mods.has('Alt')) out.push('Alt')
  if (mods.has('Shift')) out.push('Shift')
  out.push(key)
  return out.join('+')
}

/**
 * Defaults. Editing commands that CodeMirror already owns (undo, find,
 * multi-cursor) are deliberately absent — rebinding them here would fight the
 * editor's own keymap rather than override it.
 */
export const DEFAULT_BINDINGS: Binding[] = [
  { id: 'file.new', label: 'New File', key: 'Ctrl+N' },
  { id: 'file.open', label: 'Open File…', key: 'Ctrl+O' },
  { id: 'file.save', label: 'Save', key: 'Ctrl+S' },
  { id: 'file.saveAs', label: 'Save As…', key: 'Ctrl+Shift+S' },
  { id: 'file.close', label: 'Close Tab', key: 'Ctrl+W' },
  { id: 'file.reopen', label: 'Reopen Closed Tab', key: 'Ctrl+Shift+T' },
  { id: 'export.print', label: 'Print…', key: 'Ctrl+P' },

  { id: 'palette.open', label: 'Command Palette', key: 'Ctrl+Shift+P' },
  { id: 'view.outline', label: 'Toggle Outline Panel', key: 'Ctrl+Shift+O' },
  { id: 'view.wrap', label: 'Toggle Word Wrap', key: 'Alt+Z' },
  { id: 'view.zoomIn', label: 'Zoom In', key: 'Ctrl+=' },
  { id: 'view.zoomOut', label: 'Zoom Out', key: 'Ctrl+-' },
  { id: 'view.zoomReset', label: 'Reset Zoom', key: 'Ctrl+0' },

  { id: 'fmt.bold', label: 'Bold', key: 'Ctrl+B' },
  { id: 'fmt.italic', label: 'Italic', key: 'Ctrl+I' },
  { id: 'fmt.link', label: 'Insert Link', key: 'Ctrl+K' },

  { id: 'edit.duplicate', label: 'Duplicate Line', key: 'Ctrl+Shift+D' },

  { id: 'tab.next', label: 'Next Tab', key: 'Ctrl+Tab' },
  { id: 'tab.prev', label: 'Previous Tab', key: 'Ctrl+Shift+Tab' },

  { id: 'app.settings', label: 'Settings', key: 'Ctrl+,' },
]

/** Defaults merged with user overrides. An override of `""` unbinds. */
export function resolveBindings(overrides: Record<string, string>): Binding[] {
  return DEFAULT_BINDINGS.map((b) =>
    Object.prototype.hasOwnProperty.call(overrides, b.id)
      ? { ...b, key: normaliseChord(overrides[b.id]) }
      : b,
  )
}

/**
 * What a key event should do, given the resolved bindings.
 *
 * Extracted from the keydown handler so it can be tested against real
 * `KeyboardEvent` objects. Previously this logic lived inside a component that
 * imports Tauri APIs, which made it unreachable from a test — the shortcut
 * *table* was covered while the path that actually consumes it was not.
 *
 * Returns a command id, one of the two built-in actions, or null to let the
 * event through to the editor.
 */
export type KeyOutcome = { kind: 'command'; id: string } | { kind: 'menu' } | { kind: 'dismiss' } | null

export function matchEvent(e: KeyboardEvent, lookup: Map<string, string>): KeyOutcome {
  if (e.key === 'Escape') return { kind: 'dismiss' }
  // Alt is handled on keyup by the alt tracker, not here — opening the menu on
  // keydown breaks every system chord that starts with Alt, Alt+Tab worst of all.
  if (e.key === 'Alt') return null

  const chord = chordOf(e)
  if (!chord) return null

  const id = lookup.get(chord)
  return id ? { kind: 'command', id } : null
}

/** Chord → command id. Later entries lose, so a conflict is reported not silent. */
export function buildLookup(bindings: Binding[]): {
  lookup: Map<string, string>
  conflicts: string[]
} {
  const lookup = new Map<string, string>()
  const conflicts: string[] = []
  for (const b of bindings) {
    if (!b.key) continue
    if (lookup.has(b.key)) conflicts.push(b.key)
    else lookup.set(b.key, b.id)
  }
  return { lookup, conflicts }
}
