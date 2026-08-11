/**
 * Performance instrumentation (ARCHITECTURE §14).
 *
 * A bounded ring buffer of samples per metric. Recording is a `performance.now()`
 * pair plus an array write into a preallocated slot — tens of nanoseconds, which
 * is why this stays enabled in release rather than being compiled out: a budget
 * you cannot measure on the binary you ship is a budget you are not enforcing.
 *
 * Nothing leaves the machine. There is no telemetry.
 */

const CAPACITY = 256

interface Ring {
  values: Float64Array
  count: number
  next: number
}

const rings = new Map<string, Ring>()

function ring(name: string): Ring {
  let r = rings.get(name)
  if (!r) {
    r = { values: new Float64Array(CAPACITY), count: 0, next: 0 }
    rings.set(name, r)
  }
  return r
}

export function sample(name: string, ms: number) {
  const r = ring(name)
  r.values[r.next] = ms
  r.next = (r.next + 1) % CAPACITY
  if (r.count < CAPACITY) r.count++
}

/** Times a synchronous function and records the result. */
export function time<T>(name: string, fn: () => T): T {
  const t0 = performance.now()
  try {
    return fn()
  } finally {
    sample(name, performance.now() - t0)
  }
}

/** Marks a one-shot milestone measured from navigation start. */
export function milestone(name: string) {
  sample(name, performance.now())
}

export interface Stats {
  name: string
  count: number
  min: number
  median: number
  p95: number
  max: number
}

function stats(name: string, r: Ring): Stats {
  const values = Array.from(r.values.slice(0, r.count)).sort((a, b) => a - b)
  const at = (q: number) => values[Math.min(values.length - 1, Math.floor(values.length * q))]
  return {
    name,
    count: r.count,
    min: values[0] ?? 0,
    median: at(0.5) ?? 0,
    p95: at(0.95) ?? 0,
    max: values[values.length - 1] ?? 0,
  }
}

export function report(): Stats[] {
  return [...rings.entries()]
    .map(([name, r]) => stats(name, r))
    .sort((a, b) => a.name.localeCompare(b.name))
}

/** Budgets from TECH_STACK §8, so the report says pass/fail rather than numbers. */
export const BUDGETS: Record<string, number> = {
  'boot.firstPaint': 400,
  'editor.mount': 120,
  'decorations.rebuild': 4,
  'keystroke.paint': 16,
  'edit.paint': 16,
  // One frame at 165 Hz is 6.06 ms, so the synchronous work must fit well inside
  // that. Budgeted tighter than the 16 ms spec figure, which assumed 60 Hz.
  'edit.dispatch': 4,
  'file.open': 100,
}

export function formatReport(): string {
  const rows = report()
  if (!rows.length) return 'No samples recorded yet.'

  const lines = rows.map((s) => {
    const budget = BUDGETS[s.name]
    const verdict =
      budget == null ? '' : s.median <= budget ? `  OK (<= ${budget}ms)` : `  OVER ${budget}ms`
    return (
      `${s.name.padEnd(22)} n=${String(s.count).padStart(4)}  ` +
      `min ${s.min.toFixed(2)}  med ${s.median.toFixed(2)}  ` +
      `p95 ${s.p95.toFixed(2)}  max ${s.max.toFixed(2)}${verdict}`
    )
  })
  return lines.join('\n')
}

/**
 * Keystroke latency: from keydown to the next paint after it.
 *
 * `requestAnimationFrame` fires before paint, so a second nested frame is needed
 * to land after the pixels are on screen. Only sampled for printable keys, since
 * modifiers and navigation do not exercise the render path.
 */
export function installKeystrokeProbe(el: HTMLElement) {
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.ctrlKey || e.altKey || e.metaKey || e.key.length !== 1) return
    const t0 = performance.now()
    requestAnimationFrame(() => {
      requestAnimationFrame(() => sample('keystroke.paint', performance.now() - t0))
    })
  }
  el.addEventListener('keydown', onKeyDown, true)
  return () => el.removeEventListener('keydown', onKeyDown, true)
}
