/**
 * The dead-view watcher is a safety net for a failure that has now happened
 * twice in normal use, so it has to be verified in isolation — if it is wrong,
 * it either sleeps through the emergency or destroys a healthy editor.
 *
 * The first version only asked whether the DOM *contained* text. The real fault
 * had all 538 characters present while the editor area rendered nothing, so the
 * check passed and the watcher stayed silent. These tests pin down the geometry
 * cases that mistake missed.
 *
 * @vitest-environment jsdom
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { watchForDeadView } from './diagnostics'

vi.mock('@tauri-apps/api/core', () => ({ invoke: () => Promise.resolve() }))

interface Vitals {
  docLength?: number
  painted?: string
  children?: number
  contentH?: number
  contentW?: number
  scrollerH?: number
  visibility?: string
  display?: string
  opacity?: string
  /** Outside the document entirely — the failure seen in the field. */
  detached?: boolean
  /** Hidden by an ancestor, as a background tab is. */
  hidden?: boolean
}

/**
 * jsdom has no layout, so element boxes and computed styles are stubbed
 * explicitly — which is what lets these tests describe a visually broken editor.
 */
function fakeView(v: Vitals = {}) {
  const {
    docLength = 500,
    painted = 'the document text',
    children = 4,
    contentH = 300,
    contentW = 800,
    scrollerH = 600,
    visibility = 'visible',
    display = 'block',
    opacity = '1',
  } = v

  const contentDOM = document.createElement('div')
  contentDOM.textContent = painted
  for (let i = 0; i < children; i++) contentDOM.appendChild(document.createElement('div'))
  contentDOM.getBoundingClientRect = () =>
    ({ height: contentH, width: contentW }) as DOMRect
  Object.assign(contentDOM.style, { visibility, display, opacity, fontSize: '15px' })

  const scrollDOM = document.createElement('div')
  scrollDOM.getBoundingClientRect = () => ({ height: scrollerH, width: 800 }) as DOMRect

  const dom = document.createElement('div')
  dom.appendChild(scrollDOM)
  scrollDOM.appendChild(contentDOM)
  // jsdom always reports offsetParent as null, so it is defined explicitly:
  // null means "hidden by an ancestor", which is how a background tab looks.
  Object.defineProperty(dom, 'offsetParent', {
    get: () => (v.hidden === true ? null : document.body),
    configurable: true,
  })
  // Attached by default; `detached` puts it outside the document, which is the
  // real-world failure.
  if (v.detached !== true) document.body.appendChild(dom)

  return { state: { doc: { length: docLength } }, contentDOM, scrollDOM, dom }
}

const asView = (v: ReturnType<typeof fakeView>) =>
  v as unknown as import('@codemirror/view').EditorView

/** Runs the watcher long enough for two strikes. */
function settle(view: ReturnType<typeof fakeView>) {
  const onDead = vi.fn()
  watchForDeadView(asView(view), onDead)
  vi.advanceTimersByTime(4100)
  return onDead
}

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('a healthy editor is left alone', () => {
  it('does not fire on a normal view', () => {
    expect(settle(fakeView())).not.toHaveBeenCalled()
  })

  it('does not fire on an empty document', () => {
    // An empty buffer paints nothing, which is correct, not a fault.
    expect(settle(fakeView({ docLength: 0, painted: '', children: 0, contentH: 0 })))
      .not.toHaveBeenCalled()
  })

  it('treats widget-only content as alive', () => {
    // An image or rendered formula has no text of its own.
    expect(settle(fakeView({ painted: '', children: 3 }))).not.toHaveBeenCalled()
  })

  it('ignores a hidden background tab', () => {
    // Inactive tabs are display:none, so zero geometry is correct for them.
    // Without this the watcher rebuilt every background tab every few seconds.
    expect(settle(fakeView({ hidden: true, contentH: 0, contentW: 0, scrollerH: 0 })))
      .not.toHaveBeenCalled()
  })

  it('still checks a tab once it becomes visible', () => {
    const view = fakeView({ hidden: true, contentH: 0, contentW: 0, scrollerH: 0 })
    const onDead = vi.fn()
    watchForDeadView(asView(view), onDead)
    vi.advanceTimersByTime(10_000)
    expect(onDead).not.toHaveBeenCalled()

    Object.defineProperty(view.dom, 'offsetParent', { get: () => document.body, configurable: true })
    vi.advanceTimersByTime(4100)
    expect(onDead).toHaveBeenCalledTimes(1)
  })
})

describe('the failure that was actually observed', () => {
  it('fires when the editor has been detached from the document', () => {
    // The logged failure exactly: text present, all geometry zero, and computed
    // styles empty because the element was outside the document.
    const onDead = settle(
      fakeView({ detached: true, contentH: 0, contentW: 0, scrollerH: 0 }),
    )
    expect(onDead).toHaveBeenCalledTimes(1)
  })

  it('fires when text is present but the content box has no height', () => {
    // 538 chars in the DOM, nothing on screen.
    expect(settle(fakeView({ contentH: 0 }))).toHaveBeenCalledTimes(1)
  })

  it('fires when the content box has no width', () => {
    expect(settle(fakeView({ contentW: 0 }))).toHaveBeenCalledTimes(1)
  })

  it('fires when the scroller has collapsed', () => {
    expect(settle(fakeView({ scrollerH: 0 }))).toHaveBeenCalledTimes(1)
  })
})

describe('invisible but present', () => {
  it('fires when visibility is hidden', () => {
    expect(settle(fakeView({ visibility: 'hidden' }))).toHaveBeenCalledTimes(1)
  })

  it('fires when display is none', () => {
    expect(settle(fakeView({ display: 'none' }))).toHaveBeenCalledTimes(1)
  })

  it('fires when opacity is zero', () => {
    expect(settle(fakeView({ opacity: '0' }))).toHaveBeenCalledTimes(1)
  })

  it('tolerates a nearly-opaque view', () => {
    expect(settle(fakeView({ opacity: '0.9' }))).not.toHaveBeenCalled()
  })
})

describe('empty DOM', () => {
  it('fires when nothing is painted at all', () => {
    expect(settle(fakeView({ painted: '', children: 0 }))).toHaveBeenCalledTimes(1)
  })
})

describe('timing', () => {
  it('needs two consecutive strikes', () => {
    const onDead = vi.fn()
    watchForDeadView(asView(fakeView({ contentH: 0 })), onDead)
    vi.advanceTimersByTime(2000)
    expect(onDead).not.toHaveBeenCalled()
    vi.advanceTimersByTime(2000)
    expect(onDead).toHaveBeenCalledTimes(1)
  })

  it('resets its count when rendering resumes', () => {
    const view = fakeView({ contentH: 0 })
    const onDead = vi.fn()
    watchForDeadView(asView(view), onDead)
    vi.advanceTimersByTime(2000)                                  // strike one
    view.contentDOM.getBoundingClientRect = () => ({ height: 300, width: 800 }) as DOMRect
    vi.advanceTimersByTime(2000)                                  // recovered
    view.contentDOM.getBoundingClientRect = () => ({ height: 0, width: 800 }) as DOMRect
    vi.advanceTimersByTime(2000)                                  // strike one again
    expect(onDead).not.toHaveBeenCalled()
  })

  it('does not fire repeatedly for one fault', () => {
    const onDead = vi.fn()
    watchForDeadView(asView(fakeView({ contentH: 0 })), onDead)
    vi.advanceTimersByTime(4100)
    expect(onDead).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(2000)
    expect(onDead).toHaveBeenCalledTimes(1)
  })

  it('stops watching once disposed', () => {
    const onDead = vi.fn()
    const stop = watchForDeadView(asView(fakeView({ contentH: 0 })), onDead)
    stop()
    vi.advanceTimersByTime(60_000)
    expect(onDead).not.toHaveBeenCalled()
  })
})
