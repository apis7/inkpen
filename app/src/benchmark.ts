/**
 * Self-benchmark, run with `inkpen --benchmark`.
 *
 * Drives real transactions through the real editor in the shipped release binary
 * and writes a report to `%LOCALAPPDATA%\Inkpen\perf-report.txt`.
 *
 * Why not automate the UI instead: Windows' foreground rules make synthetic
 * keyboard input unreliable from a background process, and a synthetic driver is
 * more repeatable anyway — same document, same edit sequence, every run.
 */

import type { EditorView } from '@codemirror/view'
import * as perf from './perf'
import { BUDGETS, formatReport, report } from './perf'

/** A document with enough structure to exercise every decoration path. */
function corpus(sections: number): string {
  const block = (n: number) => `
## Section ${n}

Prose with **bold**, *italic*, ~~struck~~ and \`inline code\` plus a
[link](https://example.com/${n}) to follow.

- bullet one
- [ ] task item ${n}
- [x] done item ${n}

Math: $E_${n} = mc^2$ inline.

$$
\\sum_{i=1}^{${n}} i = \\frac{${n}(${n}+1)}{2}
$$

> A quotation in section ${n}.

\`\`\`ts
const value${n} = compute(${n})
\`\`\`

| Column | Value |
| ------ | ----- |
| ${n}   | ${n * 2} |
`
  return (
    '---\ntitle: Benchmark\n---\n\n# Benchmark corpus\n' +
    Array.from({ length: sections }, (_, i) => block(i + 1)).join('\n')
  )
}

function stat(name: string) {
  return report().find((r) => r.name === name)
}

/**
 * Smallest non-zero gap `performance.now()` will report.
 *
 * Chromium coarsens the clock as a side-channel mitigation, so a measurement of
 * "0.00 ms" means *below this floor*, not zero. Reporting it without the floor
 * alongside would overstate the precision of everything else here.
 */
/** Median gap between animation frames — the display's actual refresh interval. */
async function frameInterval(): Promise<number> {
  const stamps: number[] = []
  await new Promise<void>((resolve) => {
    let n = 0
    const tick = () => {
      stamps.push(performance.now())
      if (++n < 30) requestAnimationFrame(tick)
      else resolve()
    }
    requestAnimationFrame(tick)
  })
  const gaps = stamps.slice(1).map((t, i) => t - stamps[i]).sort((a, b) => a - b)
  return gaps[Math.floor(gaps.length / 2)] ?? 16.67
}

function timerResolution(): number {
  let smallest = Infinity
  for (let i = 0; i < 20000; i++) {
    const a = performance.now()
    let b = performance.now()
    while (b === a) b = performance.now()
    smallest = Math.min(smallest, b - a)
  }
  return smallest
}

export async function runBenchmark(view: EditorView): Promise<string> {
  const lines: string[] = []
  const doc = corpus(40)

  // 1. Load — full reparse plus a decoration build over the viewport.
  const t0 = performance.now()
  view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: doc } })
  const loadMs = performance.now() - t0
  lines.push(`corpus            ${doc.length.toLocaleString()} chars, ${view.state.doc.lines} lines`)
  lines.push(`load + first pass ${loadMs.toFixed(2)} ms`)

  // 2. Typing — single-character inserts mid-document, which is the worst
  //    realistic case: every one dirties the tree and rebuilds the viewport.
  const mid = Math.floor(view.state.doc.length / 2)
  for (let i = 0; i < 300; i++) {
    const pos = mid + i
    view.dispatch({ changes: { from: pos, insert: 'x' } })
    // Yield periodically so layout and paint actually happen rather than
    // batching into one frame at the end.
    if (i % 25 === 0) await new Promise((r) => requestAnimationFrame(() => r(null)))
  }

  // Two measurements, because one of them has a floor that hides the answer.
  //
  //   edit.dispatch — the synchronous cost of a transaction: state update,
  //                   decoration rebuild, DOM mutation. This is the work the
  //                   application actually does, and the number that regresses.
  //
  //   edit.paint    — dispatch through to after the pixels land. Bounded below
  //                   by two display frames because of the double rAF, so on a
  //                   fast panel it reports the refresh rate, not our latency.
  //                   Kept because it proves the work fits inside a frame at all.
  for (let i = 0; i < 60; i++) {
    const pos = mid + 300 + i
    await new Promise<void>((resolve) => {
      const t = performance.now()
      view.dispatch({ changes: { from: pos, insert: 'y' } })
      perf.sample('edit.dispatch', performance.now() - t)
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          perf.sample('edit.paint', performance.now() - t)
          resolve()
        }),
      )
    })
  }

  // 3. Scrolling — forces viewport changes, the other decoration trigger.
  for (let i = 0; i < 40; i++) {
    const line = Math.min(view.state.doc.lines, 1 + i * 12)
    view.dispatch({ selection: { anchor: view.state.doc.line(line).from }, scrollIntoView: true })
    if (i % 10 === 0) await new Promise((r) => requestAnimationFrame(() => r(null)))
  }

  // 4. A 1 MB document — the spec's open-time budget, previously unmeasured.
  //    Measured as replace-whole-document rather than disk read, so it isolates
  //    the editor from filesystem caching.
  const big = corpus(40).repeat(Math.ceil(1_048_576 / corpus(40).length))
  const bigStart = performance.now()
  view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: big } })
  await new Promise((r) => requestAnimationFrame(() => r(null)))
  const bigMs = performance.now() - bigStart
  perf.sample('file.open', bigMs)
  lines.push(
    `1 MB document     ${bigMs.toFixed(1)} ms to load and lay out ` +
      `(${big.length.toLocaleString()} chars, ${view.state.doc.lines.toLocaleString()} lines)`,
  )

  // Long enough for the lazy KaTeX chunk to arrive before reporting on it.
  await new Promise((r) => setTimeout(r, 1500))

  const math = await import('./editor/math')
  const frameMs = await frameInterval()
  lines.push('')
  lines.push(
    `katex             ${math.katexStatus}${math.katexError ? ` — ${math.katexError}` : ''}`,
  )
  lines.push(
    `math widgets      ${document.querySelectorAll('.ink-math').length} placed, ` +
      `${document.querySelectorAll('.katex').length} typeset`,
  )
  lines.push('')
  lines.push(
    'NOTE  n=1 rows (boot.firstPaint, editor.mount, file.open) are single samples and',
    '      swing widely with machine load — observed spreads of 291-609 ms on boot.',
    '      Judge them across repeated runs, never from one report.',
  )
  lines.push('')
  lines.push(`timer resolution  ${timerResolution().toFixed(3)} ms (Chromium coarsens performance.now)`)
  lines.push(`frame interval    ${frameMs.toFixed(2)} ms (~${Math.round(1000 / frameMs)} Hz)`)
  lines.push(`edit.paint floor  ${(frameMs * 2).toFixed(2)} ms (double rAF; readings at this value mean "within one frame")`)
  lines.push('')
  lines.push(formatReport())
  lines.push('')

  // Explicit verdicts so the report is readable without cross-referencing.
  for (const [name, label] of [
    ['decorations.rebuild', 'decoration rebuild'],
    ['edit.dispatch', 'edit dispatch (work)'],
    ['edit.paint', 'edit to paint'],
  ] as const) {
    const s = stat(name)
    if (!s) continue
    const budget = BUDGETS[name]
    const verdict = budget == null ? '' : s.p95 <= budget ? 'PASS' : 'OVER at p95'
    let note = ''
    if (name === 'edit.paint' && s.median <= frameMs * 2 + 1) {
      note = '  [at the double-rAF floor: work fits inside one frame]'
    }
    lines.push(
      `VERDICT ${label.padEnd(20)} median ${s.median.toFixed(2)}ms  p95 ${s.p95.toFixed(2)}ms  ` +
        `max ${s.max.toFixed(2)}ms  vs ${budget}ms -> ${verdict}${note}`,
    )
  }
  const mount = stat('editor.mount')
  if (mount) lines.push(`editor.mount median ${mount.median.toFixed(2)}ms`)

  const text = lines.join('\n')
  perf.sample('benchmark.total', performance.now() - t0)
  return text
}
