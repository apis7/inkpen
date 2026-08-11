import { createStore } from 'solid-js/store'
import { settingsLoad, settingsSave } from '../ipc'

export interface Settings {
  editor: {
    fontSize: number
    lineHeight: number
    lineNumbers: boolean
    wordWrap: boolean
    showWhitespace: boolean
    indentSize: number
    indentWithTabs: boolean
    trimTrailingWhitespace: boolean
    vimMode: boolean
    spellcheck: boolean
    /** Hold the active line at a fixed height on screen. */
    typewriter: boolean
  }
  appearance: {
    /** `light`, `dark`, `auto`, or the name of a file in `themes/`. */
    theme: string
    zoom: number
  }
  files: {
    /** On by default, 2s after the last keystroke. Named files only. */
    autosave: 'off' | 'afterDelay' | 'onFocusChange'
    autosaveDelayMs: number
    autosaveExclude: string[]
    fastModeThresholdMb: number
    reloadUnmodified: boolean
  }
  ui: {
    outlineOpen: boolean
    outlineWidth: number
    formatBarPinned: boolean
    alwaysOnTop: boolean
    /** Tapping Alt on its own opens the application menu. */
    altOpensMenu: boolean
    /** The introductory document is shown once, on first run, and never again. */
    welcomeShown: boolean
    /** Most-recently-opened paths, newest first. */
    recentFiles: string[]
  }
  updates: {
    enabled: boolean
    /** Empty means no release server is configured — nothing is requested. */
    endpoint: string
    intervalDays: number
  }
  diagnostics: {
    /**
     * Record a running account of lifecycle events to `errors.log`.
     * Off by default: it is an investigation tool, not something to leave on.
     * Uncaught errors are recorded either way.
     */
    verboseLogging: boolean
  }
  /** Command id → chord. Absent means "use the default"; `""` means unbound. */
  keymap: Record<string, string>
}

export const DEFAULTS: Settings = {
  editor: {
    fontSize: 15,
    lineHeight: 1.65,
    lineNumbers: true,
    wordWrap: true,
    showWhitespace: false,
    indentSize: 4,
    indentWithTabs: false,
    trimTrailingWhitespace: true,
    vimMode: false,
    spellcheck: true,
    typewriter: false,
  },
  appearance: { theme: 'light', zoom: 1 },
  files: {
    autosave: 'afterDelay',
    autosaveDelayMs: 2000,
    autosaveExclude: [],
    fastModeThresholdMb: 10,
    reloadUnmodified: true,
  },
  ui: {
    outlineOpen: false,
    outlineWidth: 240,
    formatBarPinned: false,
    alwaysOnTop: false,
    altOpensMenu: true,
    welcomeShown: false,
    recentFiles: [],
  },
  // No release server exists yet, so the shipped default makes no network calls.
  updates: { enabled: true, endpoint: '', intervalDays: 30 },
  diagnostics: { verboseLogging: false },
  keymap: {},
}

const [settings, setSettings] = createStore<Settings>(structuredClone(DEFAULTS))
export { settings }

/** Deep-merges only keys we know about; anything unrecognised in the TOML is
 *  left alone on disk so hand-editing never loses content. */
/** Open-ended dictionaries: merged wholesale rather than key-by-key, because
 *  their keys are user-defined and would otherwise all be discarded. */
const DICTIONARIES = new Set(['keymap'])

function merge(target: Record<string, unknown>, source: Record<string, unknown>) {
  for (const [key, value] of Object.entries(source)) {
    if (!(key in target)) continue

    if (DICTIONARIES.has(key)) {
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        const clean: Record<string, string> = {}
        for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
          if (typeof v === 'string') clean[k] = v
        }
        target[key] = clean
      }
      continue
    }

    const current = target[key]
    if (current && typeof current === 'object' && !Array.isArray(current) && value && typeof value === 'object') {
      merge(current as Record<string, unknown>, value as Record<string, unknown>)
    } else if (typeof current === typeof value || Array.isArray(current)) {
      target[key] = value
    }
  }
}

export async function loadSettings() {
  try {
    const raw = await settingsLoad()
    if (raw && typeof raw === 'object') {
      const next = structuredClone(DEFAULTS) as unknown as Record<string, unknown>
      merge(next, raw as Record<string, unknown>)
      setSettings(next as unknown as Settings)
    }
  } catch {
    // A malformed settings file falls back to defaults rather than blocking start-up.
  }
  applyAppearance()
}

let saveTimer: number | undefined
export function updateSettings(patch: (s: Settings) => void) {
  setSettings(produceSettings(patch))
  applyAppearance()
  clearTimeout(saveTimer)
  saveTimer = window.setTimeout(() => void settingsSave(unwrapSettings()), 400)
}

function produceSettings(patch: (s: Settings) => void) {
  return (current: Settings) => {
    const next = structuredClone(unwrap(current))
    patch(next)
    return next
  }
}

function unwrap(s: Settings): Settings {
  return JSON.parse(JSON.stringify(s)) as Settings
}

function unwrapSettings(): Settings {
  return unwrap(settings)
}

let customThemes: import('./themes').CustomTheme[] = []

export function setCustomThemes(list: import('./themes').CustomTheme[]) {
  customThemes = list
  applyAppearance()
}

export function availableThemes(): string[] {
  return ['light', 'dark', 'auto', ...customThemes.map((t) => t.name)]
}

export function applyAppearance() {
  const root = document.documentElement
  const choice = settings.appearance.theme

  const custom = customThemes.find((t) => t.name === choice)
  if (custom) {
    // Custom themes set tokens directly; applyTheme also stamps the base so
    // anything the file omits inherits from light or dark.
    void import('./themes').then((m) => m.applyTheme(custom))
  } else {
    void import('./themes').then((m) => m.applyTheme(null))
    root.dataset.theme =
      choice === 'auto'
        ? window.matchMedia('(prefers-color-scheme: dark)').matches
          ? 'dark'
          : 'light'
        : choice === 'dark'
          ? 'dark'
          : 'light'
  }

  root.style.setProperty('--ed-size', `${settings.editor.fontSize * settings.appearance.zoom}px`)
  root.style.setProperty('--ed-lh', String(settings.editor.lineHeight))
}

window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
  if (settings.appearance.theme === 'auto') applyAppearance()
})
