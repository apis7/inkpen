/**
 * Crash and render-failure diagnostics.
 *
 * Written after a live session went blank with no trace: the document state was
 * intact, the recovery journal was complete, and the only evidence was an empty
 * window. Nothing recorded the exception, so there was nothing to diagnose from.
 *
 * Three jobs:
 *   1. Always record uncaught errors and rejections to `errors.log`.
 *   2. Optionally (verbose mode) record a running account of lifecycle events,
 *      so a fault that only shows up after hours has a history behind it.
 *   3. Watch for the specific failure seen — an editor whose state holds text
 *      but whose DOM is empty — and repair it rather than leaving a blank window.
 */

import type { EditorView } from '@codemirror/view'
import { invoke } from '@tauri-apps/api/core'

let installed = false
let verbose = false
let sessionStart = 0

/** Verbose logging is opt-in; errors are always recorded. */
export function setVerboseLogging(on: boolean) {
  if (on === verbose) return
  verbose = on
  void write(`${stamp()}  verbose  logging ${on ? 'enabled' : 'disabled'}`, true)
}

export function isVerbose() {
  return verbose
}

function stamp(): string {
  const now = new Date()
  const uptime = sessionStart ? `+${((now.getTime() - sessionStart) / 1000).toFixed(0)}s` : ''
  return `${now.toISOString()} ${uptime.padStart(8)}`
}

/**
 * `durable` asks Rust to fsync the line before returning.
 *
 * Worth it for the lines that exist to survive a crash, and not worth it for
 * the running commentary. Heartbeats and focus changes arrive every few
 * seconds, and fsyncing each one bought nothing but a steady trickle of
 * main-thread disk waits — those lines still reach the file, they just travel
 * through the page cache like any other write.
 */
async function write(line: string, durable: boolean) {
  try {
    await invoke('log_error', { message: line, durable })
  } catch {
    // Logging must never itself become a failure path.
  }
}

/** Always written, verbose or not, and always flushed. */
export function logEvent(kind: string, detail: string) {
  void write(`${stamp()}  ${kind.padEnd(10)} ${detail.replace(/\s+/g, ' ').slice(0, 2000)}`, true)
}

/** Written only when verbose logging is on. Not flushed; see `write`. */
export function logVerbose(kind: string, detail: string) {
  if (!verbose) return
  void write(`${stamp()}  ${kind.padEnd(10)} ${detail.replace(/\s+/g, ' ').slice(0, 2000)}`, false)
}

export function installDiagnostics() {
  if (installed) return
  installed = true
  sessionStart = Date.now()

  window.addEventListener('error', (e) => {
    logEvent('ERROR', `${e.message} @ ${e.filename}:${e.lineno}:${e.colno}\n${e.error?.stack ?? ''}`)
  })

  window.addEventListener('unhandledrejection', (e) => {
    const r = e.reason
    logEvent('REJECT', String(r?.stack ?? r?.message ?? r))
  })

  // A window that has been asleep for hours is the prime suspect for the blank
  // render, so focus and visibility transitions are worth a line each.
  window.addEventListener('focus', () => logVerbose('focus', 'window focused'))
  window.addEventListener('blur', () => logVerbose('focus', 'window blurred'))
  document.addEventListener('visibilitychange', () =>
    logVerbose('visible', `document.visibilityState = ${document.visibilityState}`),
  )
  window.addEventListener('resize', () =>
    logVerbose('resize', `${window.innerWidth}x${window.innerHeight} dpr=${devicePixelRatio}`),
  )

  logEvent('start', `Inkpen ${navigator.userAgent}`)
}

/**
 * Periodic heartbeat, verbose only.
 *
 * The blank-window fault appeared after a session had been running for two days.
 * A slow drip of state — memory, document sizes, whether the view is painting —
 * is the only way to see a gradual failure coming rather than finding the
 * aftermath.
 */
export function startHeartbeat(sample: () => string): () => void {
  const timer = window.setInterval(() => {
    if (!verbose) return
    const mem = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory
    const heap = mem ? ` heap=${(mem.usedJSHeapSize / 1048576).toFixed(1)}MB` : ''
    logVerbose('heartbeat', `${sample()}${heap}`)
  }, 60_000)
  return () => clearInterval(timer)
}

/**
 * Detects an editor that has content in state but nothing rendered, and rebuilds
 * its DOM from the existing state.
 *
 * CodeMirror keeps the document in `state` independently of the DOM, so a failed
 * update cycle leaves the text safe but invisible. Recreating the view from that
 * same state loses nothing — not the text, not the undo history.
 */
/** Geometry and content of an editor's DOM, for both diagnosis and detection. */
export function viewVitals(view: EditorView) {
  const content = view.contentDOM.getBoundingClientRect()
  const scroller = view.scrollDOM.getBoundingClientRect()
  const style = getComputedStyle(view.contentDOM)
  return {
    chars: view.state.doc.length,
    painted: view.contentDOM.textContent?.length ?? 0,
    children: view.contentDOM.childElementCount,
    // Detachment is the failure that has actually occurred: an element outside
    // the document reports zero geometry and *empty* computed styles, which is
    // what identified it. Check it directly rather than inferring.
    connected: view.contentDOM.isConnected,
    rootConnected: view.dom.isConnected,
    parentConnected: view.dom.parentElement?.isConnected ?? false,
    contentH: Math.round(content.height),
    contentW: Math.round(content.width),
    scrollerH: Math.round(scroller.height),
    scrollTop: Math.round(view.scrollDOM.scrollTop),
    fontSize: style.fontSize,
    opacity: style.opacity,
    visibility: style.visibility,
    display: style.display,
  }
}

export function vitalsLine(v: ReturnType<typeof viewVitals>): string {
  return (
    `chars=${v.chars} painted=${v.painted} kids=${v.children} ` +
    `connected=${v.connected} rootConn=${v.rootConnected} parentConn=${v.parentConnected} ` +
    `contentH=${v.contentH} contentW=${v.contentW} scrollerH=${v.scrollerH} ` +
    `scrollTop=${v.scrollTop} font=${v.fontSize || '(detached)'} opacity=${v.opacity} ` +
    `vis=${v.visibility} display=${v.display}`
  )
}

/**
 * Detects an editor that is not showing its content, and rebuilds it.
 *
 * The first version only asked whether `contentDOM` *had* text. That misses the
 * failure actually observed: the DOM held all 538 characters while the editor
 * area rendered nothing at all, so the check passed and the watcher stayed quiet
 * through a completely blank window. Presence is not visibility.
 *
 * It now also requires the content box to have real size and be visible. Text
 * that exists in a zero-height, transparent or hidden element is not on screen.
 */
export function watchForDeadView(
  view: EditorView,
  onDead: (view: EditorView) => void,
): () => void {
  let strikes = 0

  const check = () => {
    // An empty document legitimately renders nothing.
    if (view.state.doc.length === 0) {
      strikes = 0
      return
    }
    // A background tab is hidden by its wrapper, so it has zero geometry by
    // design. Without this the watcher treats every inactive tab as broken and
    // rebuilds it on a loop. `offsetParent` is null exactly when the element or
    // an ancestor is display:none.
    if (view.dom.offsetParent === null && getComputedStyle(view.dom).position !== 'fixed') {
      strikes = 0
      return
    }
    const v = viewVitals(view)

    const hasContent = v.painted > 0 || v.children > 0
    const hasSize = v.contentH >= 1 && v.contentW >= 1
    // A detached element has no computed style at all, so the visibility checks
    // below cannot be trusted — test attachment first and on its own.
    const attached = v.connected
    const isVisible =
      !attached ||
      (v.visibility !== 'hidden' && v.display !== 'none' && Number(v.opacity || '1') > 0.01)
    // A collapsed scroller means the editor has no room to paint into at all.
    const hasViewport = v.scrollerH >= 1

    if (attached && hasContent && hasSize && isVisible && hasViewport) {
      if (strikes > 0) logVerbose('view', `recovered on its own after ${strikes} strike(s)`)
      strikes = 0
      return
    }

    // Two consecutive misses, so a transient state mid-layout is not mistaken
    // for a dead view.
    if (++strikes >= 2) {
      strikes = 0
      logEvent('DEADVIEW', `not rendering — rebuilding. ${vitalsLine(v)}`)
      onDead(view)
    } else {
      logVerbose('view', `strike ${strikes}: ${vitalsLine(v)}`)
    }
  }

  const timer = window.setInterval(check, 2000)
  return () => clearInterval(timer)
}
