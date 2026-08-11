import { For, Show, createSignal } from 'solid-js'
import type { OutlineItem } from '../editor/outline'
import { OUTLINE_LANGUAGES } from '../editor/outline'
import { settings, updateSettings } from '../state/settings'

interface Props {
  open: boolean
  items: OutlineItem[]
  currentIndex: number
  language: string
  onGo: (pos: number) => void
  onClose: () => void
}

export function OutlinePanel(props: Props) {
  const [resizing, setResizing] = createSignal(false)

  const startResize = (e: MouseEvent) => {
    e.preventDefault()
    setResizing(true)
    const startX = e.clientX
    const startW = settings.ui.outlineWidth

    const move = (ev: MouseEvent) => {
      const next = Math.min(420, Math.max(180, startW + (startX - ev.clientX)))
      updateSettings((s) => {
        s.ui.outlineWidth = next
      })
    }
    const up = () => {
      setResizing(false)
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }

  const supported = () => OUTLINE_LANGUAGES.has(props.language)

  return (
    <>
      <Show when={props.open}>
        <div class="outline-grip" onMouseDown={startResize} data-resizing={resizing()} />
      </Show>
      <div
        class="outline"
        style={{
          width: props.open ? `${settings.ui.outlineWidth}px` : '0px',
          opacity: props.open ? 1 : 0,
        }}
      >
        <div class="outline-inner" style={{ width: `${settings.ui.outlineWidth}px` }}>
          <div class="outline-head">
            <span class="outline-title">Outline</span>
            <span class="outline-close" title="Close" onClick={props.onClose}>
              ✕
            </span>
          </div>

          <Show
            when={supported() && props.items.length > 0}
            fallback={
              <div class="outline-empty">
                {supported() ? 'No headings yet' : 'No outline for this file type'}
              </div>
            }
          >
            <For each={props.items}>
              {(item, i) => (
                <div
                  class="outline-row"
                  style={{
                    'padding-left': `${12 + (item.level - 1) * 12}px`,
                    opacity: item.truncated ? 0.5 : Math.max(0.6, 1 - (item.level - 1) * 0.1),
                  }}
                  title={item.text}
                  onClick={() => !item.truncated && props.onGo(item.pos)}
                >
                  <span>{item.text}</span>
                  <span class="outline-cur" style={{ opacity: i() === props.currentIndex ? 1 : 0 }}>
                    ◀
                  </span>
                </div>
              )}
            </For>
          </Show>
        </div>
      </div>
    </>
  )
}
