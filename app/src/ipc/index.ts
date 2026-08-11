/**
 * Typed wrappers over the Rust commands.
 *
 * Hard rule from ARCHITECTURE §1: the frontend never touches the filesystem.
 * There is no `plugin-fs` import anywhere in `src/` — every read, write and
 * clipboard operation goes through this module.
 */

import { invoke } from '@tauri-apps/api/core'
import { open as openDialog, save as saveDialog } from '@tauri-apps/plugin-dialog'
import type { Encoding, FileMeta, FileOpen, LineEnding, SaveResult } from './types'

const TEXT_FILTERS = [
  { name: 'Markdown', extensions: ['md', 'markdown', 'mdown', 'mkd'] },
  { name: 'Text', extensions: ['txt', 'log', 'text'] },
  {
    name: 'Data & config',
    extensions: ['json', 'yaml', 'yml', 'toml', 'ini', 'cfg', 'conf', 'xml', 'csv'],
  },
  { name: 'All files', extensions: ['*'] },
]

export const openFile = (path: string) => invoke<FileOpen>('open_file', { path })

export const fileMetadata = (path: string) => invoke<FileMeta>('file_metadata', { path })

export const saveFile = (
  path: string,
  content: string,
  encoding: Encoding,
  lineEnding: LineEnding,
  expectedMtime: number | null,
) => invoke<SaveResult>('save_file', { path, content, encoding, lineEnding, expectedMtime })

export const revealInExplorer = (path: string) => invoke<void>('reveal_in_explorer', { path })

/** Plain UTF-8 only — this is what Ctrl+C calls, and why paste into a terminal works. */
export const copyPlain = (text: string) => invoke<void>('copy_plain', { text })

/** Adds an HTML flavour alongside the plain one. Never the default. */
export const copyRich = (text: string, html: string) => invoke<void>('copy_rich', { text, html })

export const settingsLoad = () => invoke<Record<string, unknown>>('settings_load')
export const settingsSave = (settings: unknown) => invoke<void>('settings_save', { settings })
export const settingsPath = () => invoke<string>('settings_path')
export const logPath = () => invoke<string>('log_path')
export const themesList = () => invoke<unknown[]>('themes_list')
export const themesDir = () => invoke<string>('themes_dir')

export const sessionLoad = () => invoke<unknown>('session_load')
export const sessionSave = (session: unknown) => invoke<void>('session_save', { session })

export const renderHtml = (markdown: string, title: string) =>
  invoke<string>('render_html', { markdown, title })

export const exportHtml = (markdown: string, title: string, path: string) =>
  invoke<string>('export_html', { markdown, title, path })

export async function pickExportPath(suggested: string, ext: string): Promise<string | null> {
  return await saveDialog({
    defaultPath: suggested,
    filters: [{ name: ext.toUpperCase(), extensions: [ext] }],
  })
}

export interface UpdateCheck {
  checked: boolean
  current: string
  available: string | null
  notes: string | null
  url: string | null
  nextCheckInDays: number
}

export const checkUpdate = (force: boolean, endpoint: string, intervalDays: number) =>
  invoke<UpdateCheck>('check_update', { force, endpoint, intervalDays })

export const startupArgs = () => invoke<string[]>('startup_args')
export const startupFlags = () => invoke<string[]>('startup_flags')
export const perfWrite = (report: string) => invoke<string>('perf_write', { report })

// --- recovery journal -------------------------------------------------------

export const journalAppend = (docId: string, record: string) =>
  invoke<void>('journal_append', { docId, record })

export const journalSnapshot = (docId: string, records: string[]) =>
  invoke<void>('journal_snapshot', { docId, records })

export const journalList = () =>
  invoke<{ docId: string; records: string[] }[]>('journal_list')

export const journalRelease = (docId: string) => invoke<void>('journal_release', { docId })

export const journalSync = () => invoke<void>('journal_sync')

export const journalSweep = (days: number) => invoke<number>('journal_sweep', { days })

// --- file watching ----------------------------------------------------------

export const watchPath = (docId: string, path: string) =>
  invoke<void>('watch_path', { docId, path })

export const unwatch = (docId: string) => invoke<void>('unwatch', { docId })

export async function pickOpenPaths(): Promise<string[]> {
  const picked = await openDialog({ multiple: true, filters: TEXT_FILTERS })
  if (!picked) return []
  return Array.isArray(picked) ? picked : [picked]
}

export async function pickSavePath(suggested: string): Promise<string | null> {
  return await saveDialog({ defaultPath: suggested, filters: TEXT_FILTERS })
}
