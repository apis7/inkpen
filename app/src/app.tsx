import {
  Show,
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
  onMount,
  untrack,
} from 'solid-js'
import { getCurrentWindow, LogicalPosition, LogicalSize } from '@tauri-apps/api/window'
import { EditorSelection } from '@codemirror/state'
import type { ChangeSet } from '@codemirror/state'
import { openSearchPanel } from '@codemirror/search'
import { listen } from '@tauri-apps/api/event'
import { redo, undo } from '@codemirror/commands'

import { EditorView } from '@codemirror/view'
import { applyLiveSettings, createEditor } from './editor/create'
import {
  installDiagnostics,
  logEvent,
  logVerbose,
  setVerboseLogging,
  startHeartbeat,
  viewVitals,
  vitalsLine,
  watchForDeadView,
} from './diagnostics'
import * as cmd from './editor/commands'
import { currentOutlineIndex, extractOutline } from './editor/outline'
import type { OutlineItem } from './editor/outline'
import * as ipc from './ipc'
import { errorMessage, isInkpenError } from './ipc/types'
import type { Encoding, LineEnding } from './ipc/types'
import {
  activeDoc,
  closeDoc,
  contentOf,
  documents,
  docById,
  moveTab,
  openFromDisk,
  openSettings,
  openUntitled,
  patchDoc,
  popClosed,
  setActive,
  unsavedUntitled,
} from './state/documents'
import type { Doc } from './state/documents'
import { loadSettings, setCustomThemes, settings, updateSettings } from './state/settings'
import { loadThemes } from './state/themes'
import * as journal from './state/journal'
import * as perf from './perf'
import { loadSession, saveSessionNow, scheduleSessionSave } from './state/session'
import type { Session } from './state/session'
import { buildLookup, matchEvent, resolveBindings } from './state/keymap'
import { createAltTracker } from './state/altmenu'
import { Settings, isSection } from './ui/Settings'
import { ContextMenu } from './ui/ContextMenu'
import type { ContextItem } from './ui/ContextMenu'
import { About } from './ui/About'

import { AppMenu } from './ui/AppMenu'
import type { MenuEntry } from './ui/AppMenu'
import { ConfirmDialog, Notice } from './ui/Notice'
import type { ConfirmState, NoticeState } from './ui/Notice'
import { FormatToolbar } from './ui/FormatToolbar'
import { OutlinePanel } from './ui/OutlinePanel'
import { Palette } from './ui/Palette'
import type { Command } from './ui/Palette'
import { StatusBar } from './ui/StatusBar'
import { TitleBar } from './ui/TitleBar'

import './styles/app.css'
import './styles/editor.css'

const TOOLBAR_DWELL_MS = 180
const OUTLINE_DEBOUNCE_MS = 250

export function App() {
  let host!: HTMLDivElement
  const wrappers = new Map<string, HTMLDivElement>()

  const [tabMenu, setTabMenu] = createSignal<{ x: number; y: number; id: string } | null>(null)
  const [editorMenu, setEditorMenu] = createSignal<{ x: number; y: number } | null>(null)
  const [aboutOpen, setAboutOpen] = createSignal(false)
  const [settingsSection, setSettingsSection] =
    createSignal<Parameters<typeof Settings>[0]['initial']>(undefined)
  const [menuOpen, setMenuOpen] = createSignal(false)
  const [paletteOpen, setPaletteOpen] = createSignal(false)
  const [notice, setNotice] = createSignal<NoticeState | null>(null)
  const [confirm, setConfirm] = createSignal<ConfirmState | null>(null)

  const [line, setLine] = createSignal(1)
  const [col, setCol] = createSignal(1)
  const [selChars, setSelChars] = createSignal(0)
  const [selCount, setSelCount] = createSignal(0)
  const [words, setWords] = createSignal(0)
  const [chars, setChars] = createSignal(0)
  const [countMode, setCountMode] = createSignal(0)

  const [outline, setOutline] = createSignal<OutlineItem[]>([])
  const [outlineIndex, setOutlineIndex] = createSignal(-1)

  const [toolbar, setToolbar] = createSignal<{ x: number; y: number; below: boolean } | null>(null)
  const [message, setMessage] = createSignal('')
  const [messageKind, setMessageKind] = createSignal<'info' | 'warn'>('info')

  const altTracker = createAltTracker()
  /** Set once the quit prompt has been answered, so the re-issued close passes through. */
  let quitting = false
  let messageTimer: number | undefined
  let toolbarTimer: number | undefined
  let outlineTimer: number | undefined
  const autosaveTimers = new Map<string, number>()
  /**
   * One save at a time per document, in call order.
   *
   * `save_file` runs off the main thread now, so a Ctrl+S landing on top of an
   * in-flight autosave genuinely overlaps. Two consequences, both bad: the two
   * calls share one temp file name, and the second carries the `mtime` from
   * before the first wrote — which the staleness guard reads as "changed on
   * disk" and reports as a conflict the user never caused.
   *
   * Chaining also means each save reads the buffer *after* the one before it
   * finished, so what reaches disk is the latest text rather than a snapshot
   * taken before a write that has since landed.
   */
  const saveChains = new Map<string, Promise<boolean>>()

  const win = getCurrentWindow()

  // ------------------------------------------------------------- messaging --

  function flash(text: string, kind: 'info' | 'warn' = 'info') {
    setMessage(text)
    setMessageKind(kind)
    clearTimeout(messageTimer)
    messageTimer = window.setTimeout(() => setMessage(''), 2500)
  }

  function raise(message: string, kind: 'warn' | 'error' = 'error', actions: NoticeState['actions'] = []) {
    setNotice({ kind, message, actions })
  }

  // ---------------------------------------------------------------- editor --

  function ensureView(doc: Doc): import('@codemirror/view').EditorView {
    if (doc.view) return doc.view

    const wrapper = document.createElement('div')
    wrapper.style.height = '100%'
    if (doc.fastMode) wrapper.classList.add('ink-fast')
    host.appendChild(wrapper)
    wrappers.set(doc.id, wrapper)

    // Read before patchDoc clears it — `doc` is a live store proxy, so reading
    // `doc.pendingContent` after the patch yields null and the journal would
    // start from an empty base.
    const initial = doc.pendingContent ?? ''

    const mountStart = performance.now()
    const view = createEditor({
      parent: wrapper,
      doc: initial,
      language: doc.language,
      fastMode: doc.fastMode,
      readOnly: doc.readOnly,
      lineNumbers: settings.editor.lineNumbers,
      wordWrap: settings.editor.wordWrap,
      indentSize: settings.editor.indentSize,
      indentWithTabs: settings.editor.indentWithTabs,
      spellcheck: settings.editor.spellcheck,
      showWhitespace: settings.editor.showWhitespace,
      typewriter: settings.editor.typewriter,
      onChange: (changes, text) => onDocChanged(doc.id, changes, text),
      onSelectionChange: () => {
        if (documents.activeId === doc.id) refreshSelection()
      },
    })

    perf.sample('editor.mount', performance.now() - mountStart)
    perf.installKeystrokeProbe(view.dom)

    // If the view stops painting, rebuild it from its own state. The text and
    // undo history live in the state, so nothing is lost by doing this.
    /**
     * Rebuild a view that has stopped rendering, and keep watching the *new*
     * one.
     *
     * The first attempt at this looped: it rebuilt once, then went on polling
     * the destroyed view — which is permanently dead — and retried every four
     * seconds forever. It also re-attached to `dead.dom.parentElement`, which in
     * the real failure was itself detached from the document, so the rebuilt
     * editor was invisible too.
     *
     * Both are fixed by re-attaching to the live host and re-arming the watcher
     * on the replacement.
     */
    let stopWatch: () => void = () => {}

    const arm = (target: import('@codemirror/view').EditorView) => {
      stopWatch = watchForDeadView(target, (dead) => {
        stopWatch() // stop polling the view that is about to be destroyed

        const state = dead.state
        const wrapper = wrappers.get(doc.id)
        dead.destroy()

        if (!wrapper) {
          logEvent('DEADVIEW', `no wrapper for "${doc.title}" — cannot rebuild`)
          return
        }
        // The wrapper may have been detached along with the view; put it back
        // rather than reviving into an element that is not in the document.
        if (!wrapper.isConnected) {
          logEvent('DEADVIEW', 'wrapper was detached from the host — re-attaching')
          host.appendChild(wrapper)
        }
        wrapper.replaceChildren()

        const revived = new EditorView({ state, parent: wrapper })
        patchDoc(doc.id, { view: revived })
        cmd.installClipboard(revived)
        if (documents.activeId === doc.id) revived.focus()
        logEvent(
          'DEADVIEW',
          `rebuilt "${doc.title}", ${state.doc.length} chars preserved, ` +
            `connected=${revived.contentDOM.isConnected}`,
        )
        flash('Editor was rebuilt after a display fault — your text is intact', 'warn')
        arm(revived)
      })
    }
    arm(view)
    onCleanup(() => stopWatch())

    logVerbose(
      'view',
      `mounted "${doc.title}" lang=${doc.language} chars=${initial.length} fast=${doc.fastMode}`,
    )
    cmd.installClipboard(view)
    patchDoc(doc.id, { view, pendingContent: null })

    // Restore caret and scroll from the session, clamped — the file may have
    // been edited elsewhere and shrunk since it was recorded.
    if (doc.cursor > 0 || doc.scrollTop > 0) {
      const pos = Math.min(doc.cursor, view.state.doc.length)
      view.dispatch({ selection: EditorSelection.cursor(pos) })
      requestAnimationFrame(() => {
        view.scrollDOM.scrollTop = doc.scrollTop
      })
    }

    // Start journalling from the moment the buffer becomes editable.
    journal.begin(doc.id, journalMeta(doc), initial)
    if (doc.path) void ipc.watchPath(doc.id, doc.path)

    return view
  }

  // ---------------------------------------------------------------- session --

  function buildSession(): Session {
    const named = documents.docs.filter((d) => d.path)
    const activeIndex = Math.max(0, named.findIndex((d) => d.id === documents.activeId))
    return {
      version: 2,
      tabs: named.map((d) => ({
        path: d.path!,
        cursor: d.view ? d.view.state.selection.main.head : d.cursor,
        scrollTop: d.view ? d.view.scrollDOM.scrollTop : d.scrollTop,
        pinned: d.pinned,
      })),
      activeIndex,
      outlineOpen: settings.ui.outlineOpen,
      window: windowGeometry,
    }
  }

  let windowGeometry: Session['window']

  async function captureGeometry() {
    try {
      const [size, pos, max] = await Promise.all([
        win.innerSize(),
        win.outerPosition(),
        win.isMaximized(),
      ])
      const scale = await win.scaleFactor()
      windowGeometry = {
        width: Math.round(size.width / scale),
        height: Math.round(size.height / scale),
        x: Math.round(pos.x / scale),
        y: Math.round(pos.y / scale),
        maximized: max,
      }
    } catch {
      /* geometry is a nicety; never let it break anything */
    }
  }

  const touchSession = () => scheduleSessionSave(buildSession)

  async function restoreSession(): Promise<boolean> {
    const session = await loadSession()
    if (session.window) {
      try {
        if (session.window.maximized) await win.maximize()
        else {
          await win.setSize(new LogicalSize(session.window.width, session.window.height))
          await win.setPosition(new LogicalPosition(session.window.x, session.window.y))
        }
      } catch {
        /* a monitor that no longer exists must not prevent start-up */
      }
    }
    if (session.outlineOpen !== settings.ui.outlineOpen) {
      updateSettings((s) => { s.ui.outlineOpen = session.outlineOpen })
    }
    if (!session.tabs.length) return false

    let restored = 0
    for (const tab of session.tabs) {
      try {
        const doc = openFromDisk(await ipc.openFile(tab.path))
        patchDoc(doc.id, { cursor: tab.cursor, scrollTop: tab.scrollTop, pinned: tab.pinned })
        restored++
      } catch {
        // A file deleted or moved since last run is skipped silently. Reporting
        // it would turn every launch after a cleanup into an error dialog.
      }
    }
    if (!restored) return false

    const target = documents.docs[Math.min(session.activeIndex, documents.docs.length - 1)]
    if (target) setActive(target.id)
    return true
  }

  function journalMeta(doc: Doc): journal.JournalMeta {
    return {
      path: doc.path,
      title: doc.title,
      encoding: doc.encoding,
      lineEnding: doc.lineEnding,
      language: doc.language,
    }
  }

  function showSettings() {
    openSettings()
    showActive()
  }

  function showActive() {
    const active = activeDoc()
    for (const [id, el] of wrappers) el.style.display = id === active?.id ? 'block' : 'none'
    if (!active) return

    // The settings tab is a pseudo-document: no editor, no journal, no file.
    if (active.kind === 'settings') {
      void win.setTitle('Settings — Inkpen')
      setOutline([])
      setToolbar(null)
      return
    }

    const view = ensureView(active)
    wrappers.get(active.id)!.style.display = 'block'
    view.focus()
    refreshSelection()
    scheduleOutline()
    void win.setTitle(`${active.dirty ? '• ' : ''}${active.title} — Inkpen`)
  }

  function onDocChanged(id: string, changes: ChangeSet, text: string) {
    const doc = docById(id)
    if (!doc) return
    // Journal first: durability comes before anything cosmetic.
    journal.record(id, changes, text)
    // The first edit makes placeholder content the user's work.
    if (!doc.dirty || doc.synthetic) patchDoc(id, { dirty: true, synthetic: false })
    scheduleOutline()
    scheduleAutosave(id)
    if (documents.activeId === id) {
      void win.setTitle(`• ${doc.title} — Inkpen`)
    }
  }

  function refreshSelection() {
    const doc = activeDoc()
    const view = doc?.view
    if (!doc || !view) return

    const state = view.state
    const head = state.selection.main.head
    const lineObj = state.doc.lineAt(head)
    setLine(lineObj.number)
    setCol(head - lineObj.from + 1)

    const ranges = state.selection.ranges.filter((r) => !r.empty)
    setSelChars(ranges.reduce((n, r) => n + (r.to - r.from), 0))
    setSelCount(ranges.length)

    const text = state.doc.toString()
    setChars(text.length)
    setWords(countWords(text))

    setOutlineIndex(currentOutlineIndex(outline(), head))
    scheduleToolbar()

    // Debounced inside scheduleSessionSave, so calling this per keystroke is cheap.
    patchDoc(doc.id, { cursor: head, scrollTop: view.scrollDOM.scrollTop })
    touchSession()
  }

  function scheduleOutline() {
    clearTimeout(outlineTimer)
    outlineTimer = window.setTimeout(() => {
      const doc = activeDoc()
      if (!doc?.view || doc.fastMode) {
        setOutline([])
        return
      }
      const items = extractOutline(doc.view.state, doc.language)
      setOutline(items)
      setOutlineIndex(currentOutlineIndex(items, doc.view.state.selection.main.head))
    }, OUTLINE_DEBOUNCE_MS)
  }

  /** 180ms dwell so the toolbar cannot flicker during a drag-select. */
  function scheduleToolbar() {
    clearTimeout(toolbarTimer)
    const doc = activeDoc()
    const view = doc?.view
    if (!doc || !view || doc.language !== 'markdown' || doc.fastMode) {
      setToolbar(null)
      return
    }
    const sel = view.state.selection.main
    if (sel.empty) {
      setToolbar(null)
      return
    }

    toolbarTimer = window.setTimeout(() => {
      const current = view.state.selection.main
      if (current.empty) return setToolbar(null)

      const start = view.coordsAtPos(current.from)
      const end = view.coordsAtPos(current.to)
      if (!start || !end) return setToolbar(null)

      const box = host.getBoundingClientRect()
      const cx = (Math.min(start.left, end.left) + Math.max(start.right, end.right)) / 2
      const top = Math.min(start.top, end.top)
      // Flip below when the selection sits too close to the top of the viewport.
      const below = top - box.top < 48
      setToolbar({
        x: Math.min(Math.max(cx - box.left, 130), box.width - 130),
        y: (below ? Math.max(start.bottom, end.bottom) : top) - box.top,
        below,
      })
    }, TOOLBAR_DWELL_MS)
  }

  // -------------------------------------------------------------- autosave --

  function excluded(path: string): boolean {
    return settings.files.autosaveExclude.some((glob) => {
      const rx = new RegExp(
        '^' + glob.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*\*/g, '.*').replace(/(?<!\.)\*/g, '[^\\\\/]*') + '$',
        'i',
      )
      return rx.test(path.replace(/\\/g, '/'))
    })
  }

  function scheduleAutosave(id: string) {
    const doc = docById(id)
    if (!doc) return
    if (settings.files.autosave !== 'afterDelay') return
    // Untitled buffers have nowhere to autosave to. Read-only and conflicted
    // documents must be resolved by hand first.
    if (!doc.path || doc.readOnly || doc.conflict) return
    if (excluded(doc.path)) return

    clearTimeout(autosaveTimers.get(id))
    autosaveTimers.set(
      id,
      window.setTimeout(() => void save(id, { silent: true }), settings.files.autosaveDelayMs),
    )
  }

  // ------------------------------------------------------------ file verbs --

  function save(id: string, opts: { silent?: boolean } = {}): Promise<boolean> {
    const previous = saveChains.get(id) ?? Promise.resolve(true)
    // A failed save must not poison the queue behind it.
    const next = previous.catch(() => false).then(() => saveNow(id, opts))
    saveChains.set(id, next)
    void next.finally(() => {
      if (saveChains.get(id) === next) saveChains.delete(id)
    })
    return next
  }

  async function saveNow(id: string, opts: { silent?: boolean } = {}): Promise<boolean> {
    const doc = docById(id)
    if (!doc) return false
    if (!doc.path) return saveAs(id)

    const view = doc.view
    let content = view ? view.state.doc.toString() : (doc.pendingContent ?? '')

    if (settings.editor.trimTrailingWhitespace && view) {
      cmd.trimTrailingWhitespace({ state: view.state, dispatch: (t) => view.dispatch(t) })
      content = view.state.doc.toString()
    }

    try {
      const result = await ipc.saveFile(doc.path, content, doc.encoding, doc.lineEnding, doc.mtime)
      patchDoc(id, { dirty: false, mtime: result.mtime, title: result.name, conflict: false })
      // The bytes are on disk; the journal has nothing left to protect.
      void journal.release(id)
      journal.begin(id, journalMeta({ ...doc, dirty: false }), content)
      if (!opts.silent) flash('Saved')
      if (documents.activeId === id) void win.setTitle(`${result.name} — Inkpen`)
      return true
    } catch (e) {
      if (isInkpenError(e) && e.kind === 'stale') {
        patchDoc(id, { conflict: true })
        raise(
          `“${doc.title}” changed on disk. Saving now would overwrite those changes.`,
          'warn',
          [
            { label: 'Overwrite', run: () => void forceSave(id) },
            { label: 'Reload', run: () => void reload(id) },
          ],
        )
      } else {
        // A failed autosave must not retry silently in a loop.
        patchDoc(id, { conflict: true })
        raise(`Could not save “${doc.title}” — ${errorMessage(e)}`, 'error', [
          { label: 'Retry', run: () => void forceSave(id) },
          { label: 'Save As…', run: () => void saveAs(id) },
        ])
      }
      return false
    }
  }

  async function forceSave(id: string) {
    const doc = docById(id)
    if (!doc?.path) return
    try {
      const content = contentOf(doc)
      const result = await ipc.saveFile(doc.path, content, doc.encoding, doc.lineEnding, null)
      patchDoc(id, { dirty: false, mtime: result.mtime, conflict: false })
      setNotice(null)
      flash('Saved')
    } catch (e) {
      raise(`Could not save — ${errorMessage(e)}`)
    }
  }

  async function saveAs(id: string): Promise<boolean> {
    const doc = docById(id)
    if (!doc) return false
    const suggested = doc.path ?? `${doc.title}.md`
    const target = await ipc.pickSavePath(suggested)
    if (!target) return false

    try {
      const content = contentOf(doc)
      const result = await ipc.saveFile(target, content, doc.encoding, doc.lineEnding, null)
      patchDoc(id, {
        path: result.path,
        title: result.name,
        dirty: false,
        mtime: result.mtime,
        conflict: false,
      })
      void journal.release(id)
      journal.begin(id, { ...journalMeta(doc), path: result.path, title: result.name }, content)
      void ipc.watchPath(id, result.path)
      flash('Saved')
      if (documents.activeId === id) void win.setTitle(`${result.name} — Inkpen`)
      return true
    } catch (e) {
      raise(`Could not save — ${errorMessage(e)}`)
      return false
    }
  }

  async function reload(id: string) {
    const doc = docById(id)
    if (!doc?.path) return
    try {
      const file = await ipc.openFile(doc.path)
      const view = doc.view
      if (view) {
        view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: file.content } })
      }
      patchDoc(id, {
        dirty: false,
        mtime: file.mtime,
        encoding: file.encoding,
        lineEnding: file.lineEnding,
        conflict: false,
      })
      setNotice(null)
      flash('Reloaded from disk')
    } catch (e) {
      raise(`Could not reload — ${errorMessage(e)}`)
    }
  }

  /** Newest first, de-duplicated, capped. Survives in settings, not session,
   *  because it is a preference about history rather than window state. */
  function rememberRecent(path: string) {
    updateSettings((s) => {
      s.ui.recentFiles = [path, ...s.ui.recentFiles.filter((p) => p !== path)].slice(0, 12)
    })
  }

  async function openPaths(paths: string[]) {
    for (const path of paths) {
      try {
        openFromDisk(await ipc.openFile(path))
        rememberRecent(path)
      } catch (e) {
        raise(`Could not open “${path}” — ${errorMessage(e)}`)
      }
    }
    showActive()
    touchSession()
  }

  async function openNewWindow() {
    try {
      const { WebviewWindow } = await import('@tauri-apps/api/webviewWindow')
      // A stable-but-unique label; Tauri rejects duplicates.
      await new WebviewWindow(`inkpen-${Date.now().toString(36)}`, {
        url: 'index.html',
        title: 'Inkpen',
        width: 1180,
        height: 720,
        decorations: false,
        center: true,
      }).once('tauri://error', (e) => raise(`Could not open a window — ${String(e.payload)}`))
    } catch (e) {
      raise(`Could not open a window — ${errorMessage(e)}`)
    }
  }

  async function toggleAlwaysOnTop() {
    const next = !settings.ui.alwaysOnTop
    try {
      await win.setAlwaysOnTop(next)
      updateSettings((s) => { s.ui.alwaysOnTop = next })
      flash(next ? 'Always on top' : 'Not always on top')
    } catch (e) {
      raise(`Could not change window order — ${errorMessage(e)}`)
    }
  }

  async function openDialog() {
    const paths = await ipc.pickOpenPaths()
    if (paths.length) await openPaths(paths)
  }

  function newTab() {
    openUntitled()
    showActive()
  }

  function requestClose(id: string) {
    const doc = docById(id)
    if (!doc) return

    // Named files autosave, so they are never unsaved. Untitled buffers with
    // content are the only thing worth stopping for.
    const isUnsavedScratch = !doc.path && !doc.synthetic && contentOf(doc).trim().length > 0
    if (!isUnsavedScratch) {
      finishClose(id)
      return
    }

    setConfirm({
      title: `Save “${doc.title}” before closing?`,
      body: 'This document has never been saved to a file.',
      actions: [
        {
          label: 'Save',
          primary: true,
          run: async () => {
            setConfirm(null)
            if (await saveAs(id)) finishClose(id)
          },
        },
        {
          label: "Don't Save",
          danger: true,
          run: () => {
            setConfirm(null)
            finishClose(id)
          },
        },
        { label: 'Cancel', run: () => setConfirm(null) },
      ],
    })
  }

  function finishClose(id: string) {
    clearTimeout(autosaveTimers.get(id))
    autosaveTimers.delete(id)
    void journal.release(id)
    void ipc.unwatch(id)
    wrappers.get(id)?.remove()
    wrappers.delete(id)
    closeDoc(id)
    if (!documents.docs.length) openUntitled()
    showActive()
    touchSession()
  }

  function reopenClosed() {
    const entry = popClosed()
    if (!entry) return
    if (entry.path) {
      void openPaths([entry.path])
    } else {
      openUntitled(entry.content)
      showActive()
    }
  }

  // ------------------------------------------------------------ quit guard --

  async function confirmQuit(): Promise<boolean> {
    const scratch = unsavedUntitled()
    if (!scratch.length) return true

    return await new Promise<boolean>((resolve) => {
      setConfirm({
        title: `You have ${scratch.length} unsaved document${scratch.length > 1 ? 's' : ''}`,
        body: 'These have never been saved to a file. Discarding them cannot be undone.',
        list: scratch.map((d) => `${d.title} — ${previewLine(contentOf(d))}`),
        actions: [
          {
            label: 'Save All',
            primary: true,
            run: async () => {
              setConfirm(null)
              for (const d of scratch) {
                if (!(await saveAs(d.id))) return resolve(false)
              }
              resolve(true)
            },
          },
          {
            label: 'Discard',
            danger: true,
            run: () => {
              // The only unrecoverable action in the app — so it asks twice.
              setConfirm({
                title: 'Discard all unsaved documents?',
                body: 'This cannot be undone.',
                actions: [
                  {
                    label: 'Discard',
                    danger: true,
                    run: () => {
                      setConfirm(null)
                      resolve(true)
                    },
                  },
                  { label: 'Cancel', run: () => { setConfirm(null); resolve(false) } },
                ],
              })
            },
          },
          { label: 'Cancel', run: () => { setConfirm(null); resolve(false) } },
        ],
      })
    })
  }

  // -------------------------------------------------------------- commands --

  const withView = (fn: (view: import('@codemirror/view').EditorView) => void) => () => {
    const view = activeDoc()?.view
    if (view) {
      fn(view)
      view.focus()
    }
  }

  const runCmd = (c: (ctx: { state: any; dispatch: any }) => boolean) =>
    withView((view) => c({ state: view.state, dispatch: (t: any) => view.dispatch(t) }))

  const formatActions = {
    bold: runCmd(cmd.toggleBold),
    italic: runCmd(cmd.toggleItalic),
    strike: runCmd(cmd.toggleStrike),
    heading: (level: number) => runCmd(cmd.setHeading(level))(),
    quote: runCmd(cmd.toggleQuote),
    code: runCmd(cmd.toggleInlineCode),
    link: runCmd(cmd.insertLink),
  }

  function goToPos(pos: number) {
    const view = activeDoc()?.view
    if (!view) return
    view.dispatch({ selection: EditorSelection.cursor(pos), scrollIntoView: true })
    view.focus()
  }

  function goToLine() {
    const view = activeDoc()?.view
    if (!view) return
    const answer = window.prompt(`Go to line (1–${view.state.doc.lines})`)
    const n = Number(answer)
    if (!answer || Number.isNaN(n)) return
    const target = Math.min(Math.max(1, Math.trunc(n)), view.state.doc.lines)
    goToPos(view.state.doc.line(target).from)
  }

  function cycleLineEnding() {
    const doc = activeDoc()
    if (!doc) return
    const next: LineEnding = doc.lineEnding === 'crlf' ? 'lf' : 'crlf'
    patchDoc(doc.id, { lineEnding: next, dirty: true })
    scheduleAutosave(doc.id)
    flash(`Line endings set to ${next.toUpperCase()}`)
  }

  function pickEncoding() {
    const doc = activeDoc()
    if (!doc) return
    const order: Encoding[] = ['utf8', 'utf8Bom', 'utf16Le', 'utf16Be', 'windows1252']
    const next = order[(order.indexOf(doc.encoding) + 1) % order.length]
    patchDoc(doc.id, { encoding: next, dirty: true })
    scheduleAutosave(doc.id)
    flash(`Encoding set to ${next}`)
  }

  // ----------------------------------------------------------------- export --

  function docTitle(doc: Doc): string {
    return doc.title.replace(/\.[^.]+$/, '')
  }

  async function exportHtmlFile() {
    const doc = activeDoc()
    if (!doc) return
    const target = await ipc.pickExportPath(`${docTitle(doc)}.html`, 'html')
    if (!target) return
    try {
      await ipc.exportHtml(contentOf(doc), docTitle(doc), target)
      flash('Exported HTML')
    } catch (e) {
      raise(`Could not export — ${errorMessage(e)}`)
    }
  }

  async function printDoc(forPdf: boolean) {
    const doc = activeDoc()
    if (!doc) return
    try {
      const html = await ipc.renderHtml(contentOf(doc), docTitle(doc))
      flash(forPdf ? 'Choose “Save as PDF” in the print dialog' : 'Opening print dialog…')
      const { printHtml } = await import('./print')
      await printHtml(html)
    } catch (e) {
      raise(`Could not print — ${errorMessage(e)}`)
    }
  }

  /**
   * Update check. Throttled in Rust, so the policy cannot be defeated here.
   * Never downloads, never installs — Inkpen is unsigned, and pushing a
   * SmartScreen prompt at someone unasked would be worse than a menu item.
   */
  /** Right-click menu for a tab. Replaces WebView2's, whose "Save as" saved the
   *  page as HTML rather than the document. */
  function tabMenuItems(id: string): ContextItem[] {
    const doc = docById(id)
    if (!doc) return []
    const index = documents.docs.findIndex((d) => d.id === id)
    const others = documents.docs.filter((d) => d.id !== id)
    const toRight = documents.docs.slice(index + 1)
    const saved = documents.docs.filter((d) => d.path && !d.dirty)

    return [
      { label: 'Save', key: 'Ctrl+S', run: () => void save(id), disabled: doc.kind !== 'text' },
      {
        label: 'Save As…',
        key: 'Ctrl+Shift+S',
        run: () => void saveAs(id),
        disabled: doc.kind !== 'text',
      },
      { separator: true },
      { label: 'Close', key: 'Ctrl+W', run: () => requestClose(id) },
      {
        label: 'Close Others',
        run: () => others.forEach((d) => requestClose(d.id)),
        disabled: !others.length,
      },
      {
        label: 'Close to the Right',
        run: () => toRight.forEach((d) => requestClose(d.id)),
        disabled: !toRight.length,
      },
      {
        label: 'Close Saved',
        run: () => saved.forEach((d) => requestClose(d.id)),
        disabled: !saved.length,
      },
      { separator: true },
      {
        label: doc.pinned ? 'Unpin' : 'Pin',
        run: () => {
          const next = !doc.pinned
          patchDoc(id, { pinned: next })
          // Pinned tabs sort to the left. Moving the tab in the store rather
          // than sorting at render time keeps drag-reorder indices honest.
          if (next) {
            const from = documents.docs.findIndex((d) => d.id === id)
            const to = documents.docs.filter((d) => d.pinned && d.id !== id).length
            if (from >= 0 && from !== to) moveTab(from, to)
          }
          touchSession()
        },
        disabled: doc.kind !== 'text',
      },
      { separator: true },
      {
        label: 'Copy Path',
        run: () => void ipc.copyPlain(doc.path ?? doc.title),
        disabled: !doc.path,
      },
      { label: 'Copy Filename', run: () => void ipc.copyPlain(doc.title) },
      {
        label: 'Open Containing Folder',
        run: () => doc.path && void ipc.revealInExplorer(doc.path),
        disabled: !doc.path,
      },
    ]
  }

  /** Right-click inside a selection. */
  function editorMenuItems(): ContextItem[] {
    const view = activeDoc()?.view
    const hasSelection = !!view && !view.state.selection.main.empty
    return [
      {
        label: 'Reflow — join wrapped lines',
        run: () => runCmd(cmd.reflowSelection)(),
        disabled: !hasSelection,
      },
      { separator: true },
      { label: 'Cut', key: 'Ctrl+X', run: () => document.execCommand('cut') },
      { label: 'Copy', key: 'Ctrl+C', run: () => document.execCommand('copy') },
      {
        label: 'Copy as Rich Text',
        run: () => view && cmd.copySelectionAsRichText(view),
        disabled: !hasSelection,
      },
      { separator: true },
      { label: 'Bold', key: 'Ctrl+B', run: formatActions.bold, disabled: !hasSelection },
      { label: 'Italic', key: 'Ctrl+I', run: formatActions.italic, disabled: !hasSelection },
      { label: 'Insert Link', key: 'Ctrl+K', run: formatActions.link, disabled: !hasSelection },
    ]
  }

  const toggleOutline = () =>
    updateSettings((s) => {
      s.ui.outlineOpen = !s.ui.outlineOpen
    })

  const commands = (): Command[] => [
    { id: 'file.new', label: 'New File', key: 'Ctrl+N', run: newTab },
    { id: 'file.open', label: 'Open File…', key: 'Ctrl+O', run: () => void openDialog() },
    { id: 'file.save', label: 'Save', key: 'Ctrl+S', run: () => { const d = activeDoc(); if (d) void save(d.id) } },
    { id: 'file.saveAs', label: 'Save As…', key: 'Ctrl+Shift+S', run: () => { const d = activeDoc(); if (d) void saveAs(d.id) } },
    { id: 'file.close', label: 'Close Tab', key: 'Ctrl+W', run: () => { const d = activeDoc(); if (d) requestClose(d.id) } },
    { id: 'file.reopen', label: 'Reopen Closed Tab', key: 'Ctrl+Shift+T', run: reopenClosed },
    { id: 'file.reveal', label: 'Open Containing Folder', run: () => { const d = activeDoc(); if (d?.path) void ipc.revealInExplorer(d.path) } },
    { id: 'file.newWindow', label: 'New Window', run: () => void openNewWindow() },
    ...settings.ui.recentFiles.map((path, i) => ({
      id: `file.recent.${i}`,
      label: `Open Recent: ${path.split(/[\\/]/).pop()}  —  ${path}`,
      run: () => void openPaths([path]),
    })),

    { id: 'edit.undo', label: 'Undo', key: 'Ctrl+Z', run: withView((v) => undo({ state: v.state, dispatch: (t) => v.dispatch(t) })) },
    { id: 'edit.redo', label: 'Redo', key: 'Ctrl+Y', run: withView((v) => redo({ state: v.state, dispatch: (t) => v.dispatch(t) })) },
    { id: 'edit.find', label: 'Find', key: 'Ctrl+F', run: withView((v) => openSearchPanel(v)) },
    { id: 'edit.copyRich', label: 'Copy as Rich Text', run: withView((v) => cmd.copySelectionAsRichText(v)) },
    { id: 'edit.duplicate', label: 'Duplicate Line', key: 'Ctrl+Shift+D', run: runCmd(cmd.duplicateLine) },
    { id: 'edit.join', label: 'Join Lines', run: runCmd(cmd.joinLines) },
    { id: 'edit.trim', label: 'Trim Trailing Whitespace', run: runCmd(cmd.trimTrailingWhitespace) },
    { id: 'edit.goto', label: 'Go to Line', run: goToLine },
    { id: 'edit.reflow', label: 'Reflow — join wrapped lines', run: runCmd(cmd.reflowSelection) },

    { id: 'fmt.bold', label: 'Bold', key: 'Ctrl+B', run: formatActions.bold },
    { id: 'fmt.italic', label: 'Italic', key: 'Ctrl+I', run: formatActions.italic },
    { id: 'fmt.strike', label: 'Strikethrough', run: formatActions.strike },
    { id: 'fmt.link', label: 'Insert Link', key: 'Ctrl+K', run: formatActions.link },
    { id: 'fmt.image', label: 'Insert Image', run: runCmd(cmd.insertImage) },
    { id: 'fmt.quote', label: 'Quote', run: formatActions.quote },
    { id: 'fmt.code', label: 'Inline Code', run: formatActions.code },
    { id: 'fmt.codeblock', label: 'Code Block', run: runCmd(cmd.insertCodeBlock) },
    { id: 'fmt.bullet', label: 'Bullet List', run: runCmd(cmd.toggleBulletList) },
    { id: 'fmt.ordered', label: 'Numbered List', run: runCmd(cmd.toggleOrderedList) },
    { id: 'fmt.task', label: 'Task List', run: runCmd(cmd.toggleTaskList) },
    { id: 'fmt.table', label: 'Format Tables', run: runCmd(cmd.formatTables) },
    ...[1, 2, 3, 4, 5, 6].map((n) => ({
      id: `fmt.h${n}`,
      label: `Heading ${n}`,
      run: () => formatActions.heading(n),
    })),

    { id: 'view.outline', label: 'Toggle Outline Panel', key: 'Ctrl+Shift+O', run: toggleOutline },
    { id: 'view.wrap', label: 'Toggle Word Wrap', key: 'Alt+Z', run: () => updateSettings((s) => { s.editor.wordWrap = !s.editor.wordWrap }) },
    { id: 'view.numbers', label: 'Toggle Line Numbers', run: () => updateSettings((s) => { s.editor.lineNumbers = !s.editor.lineNumbers }) },
    { id: 'view.theme', label: 'Toggle Dark / Light Theme', run: () => updateSettings((s) => { s.appearance.theme = s.appearance.theme === 'dark' ? 'light' : 'dark' }) },
    { id: 'view.whitespace', label: 'Toggle Whitespace', run: () => updateSettings((s) => { s.editor.showWhitespace = !s.editor.showWhitespace }) },
    { id: 'view.typewriter', label: 'Toggle Typewriter Scrolling', run: () => updateSettings((s) => { s.editor.typewriter = !s.editor.typewriter }) },
    { id: 'view.onTop', label: 'Toggle Always on Top', run: () => void toggleAlwaysOnTop() },
    { id: 'view.zoomIn', label: 'Zoom In', key: 'Ctrl+=', run: () => updateSettings((s) => { s.appearance.zoom = Math.min(2.5, s.appearance.zoom + 0.1) }) },
    { id: 'view.zoomOut', label: 'Zoom Out', key: 'Ctrl+-', run: () => updateSettings((s) => { s.appearance.zoom = Math.max(0.6, s.appearance.zoom - 0.1) }) },
    { id: 'view.zoomReset', label: 'Reset Zoom', key: 'Ctrl+0', run: () => updateSettings((s) => { s.appearance.zoom = 1 }) },
    { id: 'export.html', label: 'Export to HTML…', run: () => void exportHtmlFile() },
    { id: 'export.pdf', label: 'Export to PDF…', run: () => void printDoc(true) },
    { id: 'export.print', label: 'Print…', key: 'Ctrl+P', run: () => void printDoc(false) },

    { id: 'app.about', label: 'About Inkpen', run: () => setAboutOpen(true) },
    { id: 'app.settings', label: 'Settings', key: 'Ctrl+,', run: showSettings },
    { id: 'app.settingsFile', label: 'Open settings.toml', run: async () => { const p = await ipc.settingsPath(); void ipc.revealInExplorer(p) } },
    {
      id: 'debug.perf',
      label: 'Debug: Performance Report',
      run: () =>
        setConfirm({
          title: 'Performance',
          body: 'Measured on this machine, this session. Nothing leaves the device.',
          list: perf.formatReport().split('\n'),
          actions: [{ label: 'Close', primary: true, run: () => setConfirm(null) }],
        }),
    },
  ]

  const menuEntries = (): MenuEntry[] => {
    const byId = new Map(commands().map((c) => [c.id, c]))
    const item = (id: string): MenuEntry => {
      const c = byId.get(id)!
      return { label: c.label, key: c.key, run: c.run }
    }
    return [
      { label: '', group: 'File', separator: false },
      item('file.new'), item('file.newWindow'), item('file.open'), item('file.save'),
      item('file.saveAs'), item('file.close'), item('file.reopen'), item('file.reveal'),
      { label: '', separator: true },
      { label: '', group: 'Edit' },
      item('edit.undo'), item('edit.redo'), item('edit.find'), item('edit.copyRich'),
      item('edit.duplicate'), item('edit.trim'), item('edit.reflow'), item('edit.goto'),
      { label: '', separator: true },
      { label: '', group: 'Format' },
      item('fmt.bold'), item('fmt.italic'), item('fmt.link'), item('fmt.table'),
      { label: '', separator: true },
      { label: '', group: 'Export' },
      item('export.print'), item('export.html'), item('export.pdf'),
      { label: '', separator: true },
      { label: '', group: 'View' },
      item('view.outline'), item('view.wrap'), item('view.numbers'), item('view.whitespace'),
      item('view.theme'), item('view.typewriter'), item('view.onTop'),
      item('view.zoomIn'), item('view.zoomOut'), item('view.zoomReset'),
      { label: '', separator: true },
      item('app.settings'), item('app.settingsFile'),
      { label: '', separator: true },
      item('app.about'),
    ]
  }

  // ------------------------------------------------------------- shortcuts --

  /** Command id → action, for shortcuts. Palette entries reuse the same ids. */
  function runById(id: string): boolean {
    const doc = activeDoc()
    switch (id) {
      case 'file.new': newTab(); return true
      case 'file.open': void openDialog(); return true
      case 'file.save': if (doc) void save(doc.id); return true
      case 'file.saveAs': if (doc) void saveAs(doc.id); return true
      case 'file.close': if (doc) requestClose(doc.id); return true
      case 'file.reopen': reopenClosed(); return true
      case 'export.print': void printDoc(false); return true
      case 'palette.open': setPaletteOpen(true); return true
      case 'view.outline': toggleOutline(); return true
      case 'view.wrap': updateSettings((s) => { s.editor.wordWrap = !s.editor.wordWrap }); return true
      case 'view.zoomIn': updateSettings((s) => { s.appearance.zoom = Math.min(2.5, s.appearance.zoom + 0.1) }); return true
      case 'view.zoomOut': updateSettings((s) => { s.appearance.zoom = Math.max(0.6, s.appearance.zoom - 0.1) }); return true
      case 'view.zoomReset': updateSettings((s) => { s.appearance.zoom = 1 }); return true
      case 'fmt.bold': formatActions.bold(); return true
      case 'fmt.italic': formatActions.italic(); return true
      case 'fmt.link': formatActions.link(); return true
      case 'edit.duplicate': runCmd(cmd.duplicateLine)(); return true
      case 'app.settings': showSettings(); return true
      case 'tab.next':
      case 'tab.prev': {
        const list = documents.docs
        const i = list.findIndex((d) => d.id === documents.activeId)
        const step = id === 'tab.prev' ? -1 : 1
        const next = list[(i + step + list.length) % list.length]
        if (next) { setActive(next.id); showActive() }
        return true
      }
      default: return false
    }
  }

  // Resolved once per settings change rather than per keystroke.
  const keyLookup = createMemo(() => buildLookup(resolveBindings(settings.keymap)).lookup)

  function onKeyDown(e: KeyboardEvent) {
    if (e.key === 'Control') document.body.classList.add('ink-ctrl')

    altTracker.keydown(e)

    const outcome = matchEvent(e, keyLookup())
    if (outcome?.kind === 'dismiss') {
      setMenuOpen(false)
      setPaletteOpen(false)
      return
    }
    if (outcome?.kind === 'command' && runById(outcome.id)) {
      e.preventDefault()
      return
    }

    // Ctrl+1..9 jumps to a tab. Not in the rebindable table: nine near-identical
    // entries would bury the list for no real benefit.
    if ((e.ctrlKey || e.metaKey) && !e.altKey && /^[1-9]$/.test(e.key)) {
      e.preventDefault()
      const target = documents.docs[Number(e.key) - 1]
      if (target) { setActive(target.id); showActive() }
    }
  }

  function onKeyUp(e: KeyboardEvent) {
    if (e.key === 'Control') document.body.classList.remove('ink-ctrl')

    // The menu opens on Alt *release*, and only if nothing intervened. Anything
    // else — another key, a click, losing focus to Alt+Tab — cancels it.
    if (altTracker.keyup(e) && settings.ui.altOpensMenu) {
      e.preventDefault()
      setMenuOpen((v) => !v)
    }
  }

  // ----------------------------------------------------------------- mount --

  /**
   * Push editor settings into documents that are already open.
   *
   * The document list is read inside `untrack` deliberately. Reading it as a
   * dependency creates a feedback loop that destroys the editor: `refreshSelection`
   * writes the caret position back to the store on every cursor move, so tracking
   * the store would re-run this effect on each keystroke, dispatch reconfigure
   * transactions into every view, trigger fresh selection updates, and recurse.
   * The editor state survives that; its DOM does not — the view stops painting
   * and the window goes blank with the text still in memory.
   *
   * Only the settings values belong in the dependency set. New views get their
   * configuration at construction, so they never need this pass.
   */
  createEffect(() => {
    const live = {
      lineNumbers: settings.editor.lineNumbers,
      wordWrap: settings.editor.wordWrap,
      showWhitespace: settings.editor.showWhitespace,
      indentSize: settings.editor.indentSize,
      indentWithTabs: settings.editor.indentWithTabs,
      spellcheck: settings.editor.spellcheck,
      typewriter: settings.editor.typewriter,
    }
    untrack(() => {
      const targets = documents.docs.filter((d) => d.view)
      if (targets.length) {
        logVerbose('settings', `reconfiguring ${targets.length} view(s): ${JSON.stringify(live)}`)
      }
      for (const doc of targets) applyLiveSettings(doc.view!, live, doc.fastMode)
    })
  })

  // Verbose logging follows the setting, and is announced either way.
  createEffect(() => setVerboseLogging(settings.diagnostics.verboseLogging))

  onMount(async () => {
    installDiagnostics()
    await loadSettings()
    setCustomThemes(await loadThemes())

    document.addEventListener('keydown', onKeyDown)
    document.addEventListener('keyup', onKeyUp)

    // Closing must not depend on `destroy()`. The default path simply does not
    // call preventDefault, so the window closes through Tauri's own machinery
    // and Rust's exit handler flushes the journal. Only the "ask first" case
    // intercepts, and it finishes by re-issuing close rather than destroying —
    // so a missing window permission can never leave the app unclosable.
    const unlisten = await win.onCloseRequested(async (event) => {
      // Traced end to end because a close has been seen to go nowhere: an
      // instance acknowledged the OS close and simply stayed open, with no
      // evidence either way. Rust logs its own `close` line when the request
      // arrives (see lib.rs); this is the other half. A Rust line with no line
      // from here means the event never crossed into the webview. Both lines
      // with no `closing` means the handler stalled inside itself, and the last
      // step logged says where.
      logEvent('close', 'handler entered')

      // Even on the already-decided path, untitled journals must be released —
      // anything left behind reappears as a false recovery on the next launch.
      if (quitting) {
        for (const d of documents.docs) if (!d.path) void journal.release(d.id)
        logEvent('close', 'closing — quit already confirmed')
        return
      }

      const scratch = unsavedUntitled()
      if (!scratch.length) {
        await captureGeometry()
        logEvent('close', 'geometry captured')
        await saveSessionNow(buildSession())
        for (const d of documents.docs) if (!d.path) void journal.release(d.id)
        logEvent('close', 'closing — nothing unsaved')
        return
      }

      event.preventDefault()
      logEvent('close', `held for the quit prompt — ${scratch.length} unsaved`)
      if (await confirmQuit()) {
        for (const d of documents.docs) if (d.dirty && d.path) await save(d.id, { silent: true })
        // Untitled buffers resolved by the quit prompt release their journals;
        // anything still held would reappear as a false recovery next launch.
        for (const d of documents.docs) if (!d.path) await journal.release(d.id)
        await journal.syncNow()
        await captureGeometry()
        await saveSessionNow(buildSession())
        quitting = true
        logEvent('close', 'closing — quit confirmed')
        await win.close()
      } else {
        logEvent('close', 'cancelled at the quit prompt')
      }
    })
    onCleanup(unlisten)

    // External-change detection. Self-writes are suppressed in Rust, so
    // anything arriving here genuinely came from another program.
    const unlistenWatch = await listen<{ docId: string; kind: string; path: string }>(
      'file-changed',
      (event) => onExternalChange(event.payload.docId, event.payload.kind),
    )
    onCleanup(unlistenWatch)

    /*
     * Suppress WebView2's own context menu on application chrome.
     *
     * Left alone it offers browser commands that make no sense here — its
     * "Save as…" saves the *page* as HTML, which is what a right-click on a tab
     * was doing. Inside the editor text it stays, because that is where Windows
     * offers spellcheck suggestions and clipboard actions worth having.
     */
    const onContextMenu = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null
      const inEditorText = !!target?.closest('.cm-content')
      const inTextField = !!target?.closest('input, textarea')

      if (inEditorText) {
        // With a selection, offer our own commands. Without one, leave Windows'
        // menu alone — that is where spellcheck suggestions live, and losing
        // them to gain nothing would be a poor trade.
        const view = activeDoc()?.view
        if (view && !view.state.selection.main.empty) {
          e.preventDefault()
          setEditorMenu({ x: e.clientX, y: e.clientY })
        }
        return
      }
      if (!inTextField) e.preventDefault()
    }
    document.addEventListener('contextmenu', onContextMenu)
    onCleanup(() => document.removeEventListener('contextmenu', onContextMenu))

    // Focus loss is what makes Alt+Tab safe: the switcher takes focus before our
    // keyup arrives, so a pending Alt must be forgotten here.
    const onBlur = () => {
      altTracker.blur()
      void journal.syncNow()
    }
    window.addEventListener('blur', onBlur)
    const onPointer = () => altTracker.pointer()
    window.addEventListener('mousedown', onPointer, { passive: true })
    onCleanup(() => {
      window.removeEventListener('blur', onBlur)
      window.removeEventListener('mousedown', onPointer)
    })

    // Files dropped from Explorer. Tauri delivers these as a window event rather
    // than a DOM drop, because the WebView never sees the OS drag.
    const unlistenDrop = await win.onDragDropEvent((event) => {
      if (event.payload.type === 'drop') {
        const paths = event.payload.paths.filter(Boolean)
        if (paths.length) void openPaths(paths)
      }
    })
    onCleanup(unlistenDrop)

    if (settings.ui.alwaysOnTop) void win.setAlwaysOnTop(true).catch(() => {})

    let opened = false
    try {
      const args = await ipc.startupArgs()
      if (args.length) { await openPaths(args); opened = true }
    } catch { /* no launch arguments */ }

    // Files named on the command line win over the session — you asked for those
    // specifically, so they should not be buried behind yesterday's tabs.
    if (!opened) opened = await restoreSession()

    if (!opened) {
      // The introduction is a first-run courtesy, not a greeting to sit through
      // every launch. After that, a new window is an empty page.
      if (settings.ui.welcomeShown) {
        openUntitled()
      } else {
        // `synthetic`: our text, not theirs. Quitting must not interrogate the
        // user about a document they never wrote.
        openUntitled(WELCOME, undefined, undefined, true)
        updateSettings((s) => { s.ui.welcomeShown = true })
      }
    }
    showActive()

    // `--settings` (optionally `--settings=keyboard`) opens straight to
    // preferences. Useful for support — "open Settings without touching the
    // keyboard" — and it makes every panel reachable without synthesising OS
    // input, which is unreliable on a busy desktop.
    try {
      const flag = (await ipc.startupFlags()).find((f) => f.startsWith('--settings'))
      if (flag) {
        const section = flag.split('=')[1] ?? ''
        if (isSection(section)) setSettingsSection(section)
        showSettings()
      }
    } catch { /* no flags */ }

    await captureGeometry()
    const geometryWatch = [
      await win.onResized(() => { void captureGeometry().then(touchSession) }),
      await win.onMoved(() => { void captureGeometry().then(touchSession) }),
    ]
    onCleanup(() => geometryWatch.forEach((off) => off()))

    // First paint: the frame after the editor is mounted and focused.
    requestAnimationFrame(() => requestAnimationFrame(() => perf.milestone('boot.firstPaint')))

    // `--benchmark`: drive the real editor, write a report, exit. Deliberately
    // before any other deferred work so recovery prompts cannot interfere.
    try {
      const flags = await ipc.startupFlags()
      if (flags.includes('--benchmark')) {
        // Errors must never turn a benchmark run into a silent hang — an
        // exception inside the editor's update cycle is exactly the failure this
        // needs to report, and a process that never exits reports nothing.
        const failures: string[] = []
        const onError = (e: ErrorEvent) => failures.push(`error: ${e.message}`)
        const onRejection = (e: PromiseRejectionEvent) =>
          failures.push(`unhandled rejection: ${String(e.reason?.message ?? e.reason)}`)
        window.addEventListener('error', onError)
        window.addEventListener('unhandledrejection', onRejection)

        let text: string
        try {
          const view = activeDoc()?.view
          if (!view) throw new Error('no editor view was mounted')
          const { runBenchmark } = await import('./benchmark')
          // Hard deadline, so a hang becomes a report rather than a stuck process.
          text = await Promise.race([
            runBenchmark(view),
            new Promise<string>((_, reject) =>
              setTimeout(() => reject(new Error('benchmark exceeded 60s')), 60_000),
            ),
          ])
        } catch (e) {
          text = `BENCHMARK FAILED\n\n${String((e as Error)?.stack ?? e)}\n`
        }

        window.removeEventListener('error', onError)
        window.removeEventListener('unhandledrejection', onRejection)
        if (failures.length) {
          text += `\n\nRUNTIME FAILURES (${failures.length})\n${[...new Set(failures)].join('\n')}\n`
        }

        const boot = perf.report().find((r) => r.name === 'boot.firstPaint')
        await ipc
          .perfWrite(`boot.firstPaint  ${boot?.median.toFixed(2) ?? '?'} ms\n\n${text}\n`)
          .catch(() => {})

        // The benchmark edits a real buffer, which journals like any other. It
        // is not the user's work, so it must not survive as a recovery offer.
        for (const d of documents.docs) await journal.release(d.id).catch(() => {})
        quitting = true
        await win.close()
        return
      }
    } catch { /* not a benchmark run */ }

    // Startup may have closed a previous instance whose window was lost. It had
    // no logger of its own at the time; give it this one.
    void ipc
      .startupNotes()
      .then((notes) => notes.forEach((n) => logEvent('startup', n)))
      .catch(() => {})

    // Deferred off the cold-start path — nothing here blocks the cursor.
    setTimeout(() => void recoverCrashed(), 200)
    setTimeout(() => void ipc.journalSweep(30).catch(() => {}), 4000)

    // A slow drip of state, so a gradual failure is visible before the aftermath.
    onCleanup(
      startHeartbeat(() => {
        const active = activeDoc()
        const head =
          `docs=${documents.docs.length} active="${active?.title ?? 'none'}" ` +
          `dirty=${documents.docs.filter((d) => d.dirty).length}`
        // Geometry, not just content: a blank window once showed all 538
        // characters present in the DOM while nothing was on screen.
        return active?.view ? `${head} ${vitalsLine(viewVitals(active.view))}` : head
      }),
    )
  })

  // ------------------------------------------------------------- recovery --

  async function recoverCrashed() {
    const recovered = await journal.recoverAll()
    // A journal for a document already open belongs to this session.
    const live = new Set(documents.docs.map((d) => d.id))
    const orphans = recovered.filter((r) => !live.has(r.docId) && r.content.trim().length > 0)
    if (!orphans.length) return

    setConfirm({
      title: `Recovered ${orphans.length} unsaved document${orphans.length > 1 ? 's' : ''}`,
      body: 'Inkpen closed unexpectedly. These buffers were restored from the recovery journal.',
      list: orphans.map((o) => `${o.meta.title} — ${previewLine(o.content)}`),
      actions: [
        {
          label: 'Restore',
          primary: true,
          run: () => {
            setConfirm(null)
            for (const o of orphans) {
              openUntitled(o.content, o.docId, o.meta.title)
            }
            showActive()
            flash(`Restored ${orphans.length}`)
          },
        },
        {
          label: 'Discard',
          danger: true,
          run: () => {
            setConfirm(null)
            for (const o of orphans) void journal.release(o.docId)
          },
        },
      ],
    })
  }

  function onExternalChange(docId: string, kind: string) {
    const doc = docById(docId)
    if (!doc?.path) return

    if (kind === 'removed') {
      raise(`“${doc.title}” was deleted or moved on disk.`, 'warn', [
        { label: 'Save Again', run: () => void forceSave(docId) },
      ])
      return
    }

    // Clean buffer and the setting allows it: reload silently, no dialog.
    if (!doc.dirty && settings.files.reloadUnmodified) {
      void reload(docId)
      return
    }

    patchDoc(docId, { conflict: true })
    raise(`“${doc.title}” changed on disk.`, 'warn', [
      { label: 'Reload', run: () => void reload(docId) },
      {
        label: 'Keep Mine',
        run: () => {
          patchDoc(docId, { conflict: false })
          setNotice(null)
        },
      },
    ])
  }

  onCleanup(() => {
    document.removeEventListener('keydown', onKeyDown)
    document.removeEventListener('keyup', onKeyUp)
    for (const t of autosaveTimers.values()) clearTimeout(t)
  })

  // ------------------------------------------------------------------ view --

  return (
    <div class="shell">
      <TitleBar
        menuOpen={menuOpen()}
        onMenu={() => setMenuOpen((v) => !v)}
        onSelect={(id) => { setActive(id); showActive() }}
        onClose={requestClose}
        onNew={newTab}
        onContextMenu={(id, x, y) => setTabMenu({ id, x, y })}
      />

      <Show when={tabMenu()}>
        {(m) => (
          <ContextMenu
            x={m().x}
            y={m().y}
            items={tabMenuItems(m().id)}
            onDismiss={() => setTabMenu(null)}
          />
        )}
      </Show>

      <Show when={editorMenu()}>
        {(m) => (
          <ContextMenu
            x={m().x}
            y={m().y}
            items={editorMenuItems()}
            onDismiss={() => setEditorMenu(null)}
          />
        )}
      </Show>

      <Show when={aboutOpen()}>
        <About onClose={() => setAboutOpen(false)} />
      </Show>

      <Show when={menuOpen()}>
        <AppMenu entries={menuEntries()} onDismiss={() => setMenuOpen(false)} />
      </Show>

      <Show when={notice()}>
        {(n) => <Notice notice={n()} onDismiss={() => setNotice(null)} />}
      </Show>

      <div class="body">
        {/*
          The host holds editor DOM appended imperatively, so it must contain no
          JSX children whatsoever. Solid clears a parent's contents when its sole
          dynamic child is removed — which silently wiped every editor wrapper
          each time the selection toolbar hid itself, leaving a blank window with
          the document still safe in state. The toolbar is a sibling now, and the
          host is inert as far as the framework is concerned.
        */}
        <div
          class="editor-area"
          style={{ display: activeDoc()?.kind === 'settings' ? 'none' : 'block' }}
        >
          <div class="editor-host" ref={host} />
          <Show when={toolbar()}>
            {(t) => (
              <FormatToolbar x={t().x} y={t().y} below={t().below} actions={formatActions} />
            )}
          </Show>
        </div>

        <Show when={activeDoc()?.kind === 'settings'}>
          <Settings initial={settingsSection()} />
        </Show>

        <OutlinePanel
          open={settings.ui.outlineOpen}
          items={outline()}
          currentIndex={outlineIndex()}
          language={activeDoc()?.language ?? 'text'}
          onGo={goToPos}
          onClose={toggleOutline}
        />
      </div>

      <StatusBar
        doc={activeDoc()}
        line={line()}
        col={col()}
        selChars={selChars()}
        selCount={selCount()}
        words={words()}
        chars={chars()}
        readMinutes={words() / 225}
        countMode={countMode()}
        message={message()}
        messageKind={messageKind()}
        outlineOpen={settings.ui.outlineOpen}
        onCycleCount={() => setCountMode((m) => (m + 1) % 3)}
        onToggleOutline={toggleOutline}
        onGoToLine={goToLine}
        onCycleLineEnding={cycleLineEnding}
        onPickEncoding={pickEncoding}
      />

      <Show when={paletteOpen()}>
        <Palette commands={commands()} onDismiss={() => setPaletteOpen(false)} />
      </Show>

      <Show when={confirm()}>{(c) => <ConfirmDialog state={c()} />}</Show>
    </div>
  )
}

/**
 * A one-line preview for recovery and quit dialogs.
 *
 * The naive "first non-empty line" picks the `---` front-matter fence, which
 * tells the user nothing about which document they are being asked to keep.
 * Skip the front-matter block, then prefer the first line with actual prose.
 */
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
    // Strip leading Markdown syntax so the preview reads as text, not markup.
    const clean = line.replace(/^#{1,6}\s+/, '').replace(/^[-*+]\s+(\[[ xX]\]\s*)?/, '').replace(/^>\s*/, '')
    if (clean) return clean.slice(0, 60)
  }
  return 'empty'
}

function countWords(text: string): number {
  const scrubbed = text.replace(/['']/g, '').replace(/[^\w\d]+/g, ' ').trim()
  return scrubbed ? scrubbed.split(/\s+/).length : 0
}

const WELCOME = `---
title: Inkpen
status: draft 1
---

# Project Notes

A **minimalist**, *lightning-fast* editor for Markdown and common text
formats. Tabs, no clutter.

## Design principles

- Text is the interface. Chrome earns its pixels or it doesn't exist.
- Nothing appears until it's needed.
- ~~Never surprise~~, never block. No dialog that stops you typing.
- [ ] Instant, or it's broken
- [x] Restraint over decoration

> Raw characters always stay visible. They're de-emphasised, never removed.

## Durability

Every save is atomic — temp file, fsync, then \`ReplaceFileW\` so ACLs and
timestamps survive. A keystroke costs $t < 1\\,\\text{ms}$ inside a
$6.1\\,\\text{ms}$ frame.

$$
\\text{headroom} = 1 - \\frac{0.90}{6.10} \\approx 85\\%
$$

| Metric        | Target   |
| ------------- | -------- |
| Cold start    | < 400 ms |
| Keystroke     | < 16 ms  |
`
