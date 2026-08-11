/**
 * Custom themes.
 *
 * A theme is a `.toml` file in `%APPDATA%\Inkpen\themes\` overriding any subset
 * of the design tokens. Every colour in the app already resolves through those
 * tokens, so a theme is a data file — nothing needs recompiling, and a partial
 * theme inherits the rest from light or dark.
 *
 *   name = "Solarized"
 *   base = "light"          # which built-in to inherit from
 *
 *   [tokens]
 *   bg = "#fdf6e3"
 *   fg = "#657b83"
 *   accent = "#268bd2"
 */

import * as ipc from '../ipc'

export interface CustomTheme {
  name: string
  base: 'light' | 'dark'
  tokens: Record<string, string>
}

/** Only tokens the stylesheet actually defines; anything else is ignored so a
 *  theme file cannot inject arbitrary CSS. */
export const THEME_TOKENS = [
  'bg', 'chrome-bg', 'fg', 'fg-muted', 'fg-faint', 'accent', 'border',
  'selection', 'active-line', 'code-bg', 'block-bg', 'quote-border', 'guide',
  'warn', 'error', 'kw', 'str', 'fn', 'num', 'typ', 'cmt',
] as const

/** Colours only: `#rgb`, `#rrggbb`, `#rrggbbaa`, or a CSS colour keyword.
 *  Rejects anything containing a bracket, semicolon or `url(`. */
const COLOUR = /^(#[0-9a-f]{3,8}|[a-z]+)$/i

export function sanitiseTheme(raw: unknown): CustomTheme | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const name = typeof r.name === 'string' && r.name.trim() ? r.name.trim() : null
  if (!name) return null

  const base = r.base === 'dark' ? 'dark' : 'light'
  const src = (r.tokens && typeof r.tokens === 'object' ? r.tokens : {}) as Record<string, unknown>

  const tokens: Record<string, string> = {}
  for (const key of THEME_TOKENS) {
    const value = src[key]
    if (typeof value === 'string' && COLOUR.test(value.trim())) {
      tokens[key] = value.trim()
    }
  }
  return { name, base, tokens }
}

/** Applies a theme by setting custom properties on the root element. */
export function applyTheme(theme: CustomTheme | null) {
  const root = document.documentElement
  for (const key of THEME_TOKENS) root.style.removeProperty(`--${key}`)
  if (!theme) return
  root.dataset.theme = theme.base
  for (const [key, value] of Object.entries(theme.tokens)) {
    root.style.setProperty(`--${key}`, value)
  }
}

export async function loadThemes(): Promise<CustomTheme[]> {
  try {
    const raw = await ipc.themesList()
    return raw.map(sanitiseTheme).filter((t): t is CustomTheme => t !== null)
  } catch {
    return []
  }
}
