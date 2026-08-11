import { For, Show, onCleanup, onMount } from 'solid-js'

export interface MenuEntry {
  label: string
  key?: string
  run?: () => void
  group?: string
  separator?: boolean
  disabled?: boolean
}

interface Props {
  entries: MenuEntry[]
  onDismiss: () => void
}

export function AppMenu(props: Props) {
  let root: HTMLDivElement | undefined

  const onDocMouseDown = (e: MouseEvent) => {
    if (root && !root.contains(e.target as Node)) props.onDismiss()
  }
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') props.onDismiss()
  }

  onMount(() => {
    document.addEventListener('mousedown', onDocMouseDown)
    document.addEventListener('keydown', onKey)
  })
  onCleanup(() => {
    document.removeEventListener('mousedown', onDocMouseDown)
    document.removeEventListener('keydown', onKey)
  })

  return (
    <div class="menu-pop" ref={root}>
      <For each={props.entries}>
        {(entry) => (
          <Show
            when={!entry.separator}
            fallback={<div class="menu-sep" />}
          >
            <Show when={entry.group} fallback={null}>
              <div class="menu-group">{entry.group}</div>
            </Show>
            <Show when={!entry.group}>
              <div
                class="menu-item"
                data-disabled={entry.disabled ? 'true' : 'false'}
                onClick={() => {
                  entry.run?.()
                  props.onDismiss()
                }}
              >
                <span>{entry.label}</span>
                <Show when={entry.key}>
                  <span class="menu-key">{entry.key}</span>
                </Show>
              </div>
            </Show>
          </Show>
        )}
      </For>
    </div>
  )
}
