import { createStore, produce } from 'solid-js/store'
import type { EditorView } from '@codemirror/view'
import type { Encoding, FileOpen, LineEnding } from '../ipc/types'

export interface Doc {
  id: string
  /** `settings` is a pseudo-document: it occupies a tab but has no editor. */
  kind: 'text' | 'settings'
  path: string | null
  title: string
  encoding: Encoding
  lineEnding: LineEnding
  language: string
  fastMode: boolean
  readOnly: boolean
  dirty: boolean
  mtime: number | null
  pinned: boolean

  /** Null until the tab is first activated — background tabs are metadata only,
   *  so forty open tabs cost forty objects, not forty editors. */
  view: EditorView | null
  pendingContent: string | null
  scrollTop: number
  cursor: number
  /** Set when the file changed on disk while this buffer was dirty. */
  conflict: boolean
  /**
   * App-authored placeholder content (the welcome document) that the user has
   * not touched. It must never be treated as unsaved work — prompting someone
   * to save text they did not write is worse than useless. Cleared on first edit.
   */
  synthetic: boolean
}

export interface ClosedDoc {
  path: string | null
  title: string
  content: string
  cursor: number
}

interface State {
  docs: Doc[]
  activeId: string | null
  closedStack: ClosedDoc[]
}

/** Journals are keyed by this and outlive the process, so it must be stable and
 *  globally unique — not a session-local counter. */
const nextId = () => crypto.randomUUID()

const [state, setState] = createStore<State>({ docs: [], activeId: null, closedStack: [] })

export const documents = state

export function activeDoc(): Doc | null {
  return state.docs.find((d) => d.id === state.activeId) ?? null
}

export function docById(id: string): Doc | null {
  return state.docs.find((d) => d.id === id) ?? null
}

function untitledTitle(): string {
  const used = new Set(
    state.docs
      .filter((d) => !d.path)
      .map((d) => Number(/^Untitled (\d+)$/.exec(d.title)?.[1] ?? 0)),
  )
  let n = 1
  while (used.has(n)) n++
  return `Untitled ${n}`
}

export function openUntitled(
  content = '',
  id?: string,
  title?: string,
  synthetic = false,
): Doc {
  // A restored buffer carries its old title, which may already be taken by a
  // document in this session — two tabs both reading "Untitled 1" is worse than
  // renumbering one of them.
  const taken = title != null && state.docs.some((d) => d.title === title)

  const doc: Doc = {
    id: id ?? nextId(),
    kind: 'text',
    path: null,
    title: taken || title == null ? untitledTitle() : title,
    encoding: 'utf8',
    lineEnding: 'crlf',
    language: 'markdown',
    fastMode: false,
    readOnly: false,
    dirty: false,
    mtime: null,
    pinned: false,
    view: null,
    pendingContent: content,
    scrollTop: 0,
    cursor: 0,
    conflict: false,
    synthetic,
  }
  setState('docs', (docs) => [...docs, doc])
  setState('activeId', doc.id)
  return doc
}

export function openFromDisk(file: FileOpen): Doc {
  // Already open? Focus it rather than opening a second copy.
  const existing = state.docs.find((d) => d.path === file.path)
  if (existing) {
    setState('activeId', existing.id)
    return existing
  }

  const doc: Doc = {
    id: nextId(),
    kind: 'text',
    path: file.path,
    title: file.name,
    encoding: file.encoding,
    lineEnding: file.lineEnding,
    language: file.language,
    fastMode: file.fastMode,
    readOnly: file.readOnly,
    dirty: false,
    mtime: file.mtime,
    pinned: false,
    view: null,
    pendingContent: file.content,
    scrollTop: 0,
    cursor: 0,
    conflict: false,
    synthetic: false,
  }
  setState('docs', (docs) => [...docs, doc])
  setState('activeId', doc.id)
  return doc
}

/** One settings tab at most; a second invocation focuses the existing one. */
export function openSettings(): Doc {
  const existing = state.docs.find((d) => d.kind === 'settings')
  if (existing) {
    setState('activeId', existing.id)
    return existing
  }
  const doc: Doc = {
    id: nextId(),
    kind: 'settings',
    path: null,
    title: 'Settings',
    encoding: 'utf8',
    lineEnding: 'crlf',
    language: 'text',
    fastMode: false,
    readOnly: true,
    dirty: false,
    mtime: null,
    pinned: false,
    view: null,
    pendingContent: null,
    scrollTop: 0,
    cursor: 0,
    conflict: false,
    synthetic: true,
  }
  setState('docs', (docs) => [...docs, doc])
  setState('activeId', doc.id)
  return doc
}

export function patchDoc(id: string, patch: Partial<Doc>) {
  setState('docs', (d) => d.id === id, patch)
}

export function setActive(id: string) {
  setState('activeId', id)
}

export function contentOf(doc: Doc): string {
  return doc.view ? doc.view.state.doc.toString() : (doc.pendingContent ?? '')
}

export function closeDoc(id: string) {
  const doc = docById(id)
  if (!doc) return

  setState(
    produce((s) => {
      const index = s.docs.findIndex((d) => d.id === id)
      if (index < 0) return

      s.closedStack.unshift({
        path: doc.path,
        title: doc.title,
        content: contentOf(doc),
        cursor: doc.cursor,
      })
      s.closedStack.splice(12)

      s.docs.splice(index, 1)
      if (s.activeId === id) {
        const next = s.docs[index] ?? s.docs[index - 1] ?? null
        s.activeId = next ? next.id : null
      }
    }),
  )
  doc.view?.destroy()
}

export function popClosed(): ClosedDoc | null {
  const entry = state.closedStack[0]
  if (!entry) return null
  setState('closedStack', (stack) => stack.slice(1))
  return entry
}

export function moveTab(fromIndex: number, toIndex: number) {
  setState(
    produce((s) => {
      const [moved] = s.docs.splice(fromIndex, 1)
      s.docs.splice(toIndex, 0, moved)
    }),
  )
}

export function dirtyDocs(): Doc[] {
  return state.docs.filter((d) => d.dirty)
}

/**
 * Untitled buffers holding work the user actually authored. These are the only
 * things that prompt on quit: named files autosave, so they are never unsaved,
 * and untouched app-authored placeholder text is not the user's to lose.
 */
export function unsavedUntitled(): Doc[] {
  return state.docs.filter((d) => !d.path && !d.synthetic && contentOf(d).trim().length > 0)
}
