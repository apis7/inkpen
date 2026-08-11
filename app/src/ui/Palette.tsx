import { For, Show, createMemo, createSignal, onCleanup, onMount } from 'solid-js'

export interface Command {
  id: string
  label: string
  key?: string
  run: () => void
}

interface Props {
  commands: Command[]
  onDismiss: () => void
}

interface Scored {
  cmd: Command
  score: number
  hits: number[]
}

/** Subsequence match with a bonus for consecutive runs and word starts. */
function fuzzy(query: string, text: string): { score: number; hits: number[] } | null {
  if (!query) return { score: 0, hits: [] }
  const lower = text.toLowerCase()
  const q = query.toLowerCase()
  const hits: number[] = []
  let score = 0
  let pos = 0
  let streak = 0

  for (const ch of q) {
    const found = lower.indexOf(ch, pos)
    if (found < 0) return null
    hits.push(found)
    streak = found === pos && pos > 0 ? streak + 1 : 0
    score += 10 + streak * 5
    if (found === 0 || /[\s\-_/.]/.test(text[found - 1] ?? '')) score += 8
    pos = found + 1
  }
  // Shorter labels win ties, so exact-ish matches float up.
  return { score: score - text.length * 0.1, hits }
}

export function Palette(props: Props) {
  const [query, setQuery] = createSignal('')
  const [selected, setSelected] = createSignal(0)
  let input: HTMLInputElement | undefined

  const results = createMemo<Scored[]>(() => {
    const q = query().trim()
    const scored: Scored[] = []
    for (const cmd of props.commands) {
      const m = fuzzy(q, cmd.label)
      if (m) scored.push({ cmd, score: m.score, hits: m.hits })
    }
    scored.sort((a, b) => b.score - a.score)
    return scored.slice(0, 60)
  })

  const clampSelection = () => {
    if (selected() >= results().length) setSelected(Math.max(0, results().length - 1))
  }

  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      props.onDismiss()
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSelected((i) => Math.min(results().length - 1, i + 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSelected((i) => Math.max(0, i - 1))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const pick = results()[selected()]
      if (pick) {
        props.onDismiss()
        pick.cmd.run()
      }
    }
  }

  onMount(() => {
    input?.focus()
    document.addEventListener('keydown', onKey, true)
  })
  onCleanup(() => document.removeEventListener('keydown', onKey, true))

  const highlight = (label: string, hits: number[]) => {
    if (!hits.length) return label
    const set = new Set(hits)
    return (
      <>
        <For each={[...label]}>
          {(ch, i) => (set.has(i()) ? <span class="hit">{ch}</span> : ch)}
        </For>
      </>
    )
  }

  return (
    <>
      {/* No dim and no blur — the document stays fully readable behind it. */}
      <div class="palette-scrim" onMouseDown={props.onDismiss} />
      <div class="palette">
        <input
          ref={input}
          placeholder="Type a command…"
          value={query()}
          onInput={(e) => {
            setQuery(e.currentTarget.value)
            setSelected(0)
            clampSelection()
          }}
        />
        <div class="palette-list">
          <Show
            when={results().length}
            fallback={<div class="palette-empty">No matching commands</div>}
          >
            <For each={results()}>
              {(row, i) => (
                <div
                  class="palette-row"
                  data-sel={i() === selected()}
                  onMouseEnter={() => setSelected(i())}
                  onMouseDown={(e) => {
                    e.preventDefault()
                    props.onDismiss()
                    row.cmd.run()
                  }}
                >
                  <span>{highlight(row.cmd.label, row.hits)}</span>
                  <Show when={row.cmd.key}>
                    <span class="menu-key">{row.cmd.key}</span>
                  </Show>
                </div>
              )}
            </For>
          </Show>
        </div>
      </div>
    </>
  )
}
