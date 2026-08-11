/**
 * Session persistence — which files were open, where the caret was, how the
 * window was arranged.
 *
 * Only *named* files are recorded here. Untitled buffers are the recovery
 * journal's job; duplicating them would restore the same text twice.
 *
 * Lives in `%LOCALAPPDATA%\Inkpen\session.json` because it is cache, not
 * configuration — it should not roam between machines.
 */

import * as ipc from '../ipc'

const VERSION = 2

export interface SessionTab {
  path: string
  cursor: number
  scrollTop: number
  pinned: boolean
}

export interface SessionWindow {
  width: number
  height: number
  x: number
  y: number
  maximized: boolean
}

export interface Session {
  version: number
  tabs: SessionTab[]
  activeIndex: number
  outlineOpen: boolean
  window?: SessionWindow
}

const EMPTY: Session = { version: VERSION, tabs: [], activeIndex: 0, outlineOpen: false }

/** A malformed or older session is a cache miss, never an error the user sees. */
export function parseSession(raw: unknown): Session {
  if (!raw || typeof raw !== 'object') return { ...EMPTY }
  const s = raw as Partial<Session>
  if (s.version !== VERSION || !Array.isArray(s.tabs)) return { ...EMPTY }

  const tabs = s.tabs
    .filter(
      (t): t is SessionTab =>
        !!t && typeof t.path === 'string' && t.path.length > 0 && typeof t.cursor === 'number',
    )
    .map((t) => ({
      path: t.path,
      cursor: Math.max(0, Math.floor(t.cursor)),
      scrollTop: Math.max(0, Math.floor(t.scrollTop ?? 0)),
      pinned: !!t.pinned,
    }))
    .slice(0, 100)

  const window =
    s.window &&
    typeof s.window.width === 'number' &&
    typeof s.window.height === 'number' &&
    s.window.width > 200 &&
    s.window.height > 150
      ? {
          width: Math.floor(s.window.width),
          height: Math.floor(s.window.height),
          x: Math.floor(s.window.x ?? 0),
          y: Math.floor(s.window.y ?? 0),
          maximized: !!s.window.maximized,
        }
      : undefined

  return {
    version: VERSION,
    tabs,
    activeIndex: Math.min(Math.max(0, Math.floor(s.activeIndex ?? 0)), Math.max(0, tabs.length - 1)),
    outlineOpen: !!s.outlineOpen,
    window,
  }
}

export async function loadSession(): Promise<Session> {
  try {
    return parseSession(await ipc.sessionLoad())
  } catch {
    return { ...EMPTY }
  }
}

let saveTimer: number | undefined

/** Debounced: session writes must never sit on an interaction path. */
export function scheduleSessionSave(build: () => Session) {
  clearTimeout(saveTimer)
  saveTimer = window.setTimeout(() => {
    void ipc.sessionSave(build()).catch(() => {})
  }, 700)
}

export async function saveSessionNow(session: Session) {
  clearTimeout(saveTimer)
  try {
    await ipc.sessionSave(session)
  } catch {
    /* losing a session is not worth interrupting a quit */
  }
}
