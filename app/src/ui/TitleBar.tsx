import { For, Show, createSignal } from 'solid-js'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { documents, moveTab } from '../state/documents'
import type { Doc } from '../state/documents'

interface Props {
  onMenu: () => void
  menuOpen: boolean
  onSelect: (id: string) => void
  onClose: (id: string) => void
  onNew: () => void
  onContextMenu: (id: string, x: number, y: number) => void
}

export function TitleBar(props: Props) {
  const [dragIndex, setDragIndex] = createSignal<number | null>(null)
  const [dropIndex, setDropIndex] = createSignal<number | null>(null)
  const [hovered, setHovered] = createSignal<string | null>(null)
  const [overflowOpen, setOverflowOpen] = createSignal(false)

  const win = getCurrentWindow()

  const startDrag = async (e: MouseEvent) => {
    // Only a plain left-press on empty chrome should move the window.
    if (e.button !== 0) return
    await win.startDragging()
  }

  return (
    <div class="titlebar">
      <div
        class="menu-btn"
        data-open={props.menuOpen}
        title="Menu  (Alt)"
        onClick={props.onMenu}
      >
        ☰
      </div>

      <div class="tabstrip">
        <For each={documents.docs}>
          {(doc: Doc, index) => (
            <div
              class="tab"
              data-active={doc.id === documents.activeId}
              data-dragging={dragIndex() === index()}
              data-drop={dropIndex() === index()}
              title={doc.path ?? doc.title}
              draggable="true"
              onMouseEnter={() => setHovered(doc.id)}
              onMouseLeave={() => setHovered(null)}
              onMouseDown={(e) => {
                if (e.button === 1) {
                  e.preventDefault()
                  props.onClose(doc.id)
                } else if (e.button === 0) {
                  props.onSelect(doc.id)
                }
              }}
              onContextMenu={(e) => {
                e.preventDefault()
                // Right-clicking a background tab targets that tab, without
                // switching to it.
                props.onContextMenu(doc.id, e.clientX, e.clientY)
              }}
              onDragStart={() => setDragIndex(index())}
              onDragOver={(e) => {
                e.preventDefault()
                setDropIndex(index())
              }}
              onDragEnd={() => {
                const from = dragIndex()
                const to = dropIndex()
                if (from !== null && to !== null && from !== to) moveTab(from, to)
                setDragIndex(null)
                setDropIndex(null)
              }}
            >
              <Show when={doc.pinned}>
                <span class="tab-pin" title="Pinned">📌</span>
              </Show>
              <span class="tab-name">{doc.title}</span>
              <span
                class="tab-mark"
                title={hovered() === doc.id ? 'Close  (Ctrl+W)' : undefined}
                onMouseDown={(e) => {
                  if (e.button !== 0) return
                  e.stopPropagation()
                  props.onClose(doc.id)
                }}
              >
                <Show
                  when={hovered() === doc.id}
                  fallback={
                    <span
                      class="tab-dot"
                      style={{
                        opacity: doc.dirty ? 1 : 0,
                        transform: doc.dirty ? 'scale(1)' : 'scale(0.4)',
                      }}
                    />
                  }
                >
                  ✕
                </Show>
              </span>
            </div>
          )}
        </For>

        <div class="tab-new" title="New tab  (Ctrl+N)" onClick={props.onNew}>
          +
        </div>
        <div class="drag-region" onMouseDown={startDrag} onDblClick={() => void win.toggleMaximize()} />
      </div>

      {/* With many tabs the strip scrolls, which makes off-screen tabs hard to
          reach. This lists every one regardless of scroll position. */}
      <Show when={documents.docs.length > 3}>
        <div
          class="tab-overflow"
          title="All open tabs"
          data-open={overflowOpen()}
          onClick={() => setOverflowOpen((v) => !v)}
        >
          ⌄
          <Show when={overflowOpen()}>
            <div class="tab-overflow-menu">
              <For each={documents.docs}>
                {(doc) => (
                  <div
                    class="tab-overflow-item"
                    data-active={doc.id === documents.activeId}
                    title={doc.path ?? doc.title}
                    onClick={(e) => {
                      e.stopPropagation()
                      setOverflowOpen(false)
                      props.onSelect(doc.id)
                    }}
                  >
                    <span class="tab-overflow-name">{doc.title}</span>
                    <Show when={doc.dirty}>
                      <span class="tab-dot" />
                    </Show>
                  </div>
                )}
              </For>
            </div>
          </Show>
        </div>
      </Show>

      <div class="wincontrols">
        <div class="wincontrol" title="Minimize" onClick={() => void win.minimize()}>
          ─
        </div>
        <div class="wincontrol" title="Maximize" onClick={() => void win.toggleMaximize()}>
          □
        </div>
        <div class="wincontrol" data-close="true" title="Close" onClick={() => void win.close()}>
          ✕
        </div>
      </div>
    </div>
  )
}
