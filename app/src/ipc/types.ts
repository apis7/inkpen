/** Mirrors `src-tauri/src/model.rs`. Keep the two in step. */

export type Encoding = 'utf8' | 'utf8Bom' | 'utf16Le' | 'utf16Be' | 'windows1252'
export type LineEnding = 'lf' | 'crlf' | 'mixed'

export type ErrorKind =
  | 'notFound'
  | 'permissionDenied'
  | 'locked'
  | 'diskFull'
  | 'invalidEncoding'
  | 'tooLarge'
  | 'stale'
  | 'cancelled'
  | 'io'

export interface InkpenError {
  kind: ErrorKind
  message: string
  path?: string
}

export interface FileOpen {
  path: string
  name: string
  content: string
  encoding: Encoding
  lineEnding: LineEnding
  size: number
  mtime: number
  readOnly: boolean
  fastMode: boolean
  language: string
}

export interface SaveResult {
  path: string
  name: string
  mtime: number
  size: number
}

export interface FileMeta {
  mtime: number
  size: number
  readOnly: boolean
}

export const ENCODING_LABEL: Record<Encoding, string> = {
  utf8: 'UTF-8',
  utf8Bom: 'UTF-8 BOM',
  utf16Le: 'UTF-16 LE',
  utf16Be: 'UTF-16 BE',
  windows1252: 'Windows-1252',
}

export const LINE_ENDING_LABEL: Record<LineEnding, string> = {
  lf: 'LF',
  crlf: 'CRLF',
  mixed: 'Mixed',
}

export const LANGUAGE_LABEL: Record<string, string> = {
  markdown: 'Markdown',
  json: 'JSON',
  yaml: 'YAML',
  toml: 'TOML',
  ini: 'INI',
  javascript: 'JavaScript',
  typescript: 'TypeScript',
  rust: 'Rust',
  python: 'Python',
  html: 'HTML',
  css: 'CSS',
  xml: 'XML',
  shell: 'Shell',
  powershell: 'PowerShell',
  sql: 'SQL',
  text: 'Plain Text',
}

export function isInkpenError(e: unknown): e is InkpenError {
  return typeof e === 'object' && e !== null && 'kind' in e && 'message' in e
}

export function errorMessage(e: unknown): string {
  if (isInkpenError(e)) return e.message
  if (e instanceof Error) return e.message
  return String(e)
}
