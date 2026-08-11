import { For, Show, onCleanup, onMount } from 'solid-js'

export interface ContextItem {
  label?: string
  key?: string
  run?: () => void
  disabled?: boolean
  separator?: boolean
  danger?: boolean
}

interface Props {
  x: number
  y: number
  items: ContextItem[]
  onDismiss: () => void
}

/** Anchored popup that keeps itself inside the window. */
export function ContextMenu(props: Props) {
  let root: HTMLDivElement | undefined

  const onDocDown = (e: MouseEvent) => {
    if (root && !root.contains(e.target as Node)) props.onDismiss()
  }
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation()
      props.onDismiss()
    }
  }

  onMount(() => {
    document.addEventListener('mousedown', onDocDown, true)
    document.addEventListener('keydown', onKey, true)
    // Nudge back on screen if the click was near an edge.
    if (root) {
      const box = root.getBoundingClientRect()
      if (box.right > innerWidth) root.style.left = `${Math.max(0, innerWidth - box.width - 4)}px`
      if (box.bottom > innerHeight) root.style.top = `${Math.max(0, innerHeight - box.height - 4)}px`
    }
  })
  onCleanup(() => {
    document.removeEventListener('mousedown', onDocDown, true)
    document.removeEventListener('keydown', onKey, true)
  })

  return (
    <div class="ctx-menu" ref={root} style={{ left: `${props.x}px`, top: `${props.y}px` }}>
      <For each={props.items}>
        {(item) => (
          <Show when={!item.separator} fallback={<div class="menu-sep" />}>
            <div
              class="menu-item"
              data-disabled={item.disabled ? 'true' : 'false'}
              data-danger={item.danger ? 'true' : 'false'}
              onClick={() => {
                if (item.disabled) return
                props.onDismiss()
                item.run?.()
              }}
            >
              <span>{item.label}</span>
              <Show when={item.key}>
                <span class="menu-key">{item.key}</span>
              </Show>
            </div>
          </Show>
        )}
      </For>
    </div>
  )
}
