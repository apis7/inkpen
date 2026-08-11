import { Show, createSignal } from 'solid-js'

export interface FormatActions {
  bold: () => void
  italic: () => void
  strike: () => void
  heading: (level: number) => void
  quote: () => void
  code: () => void
  link: () => void
}

interface Props {
  x: number
  y: number
  below: boolean
  actions: FormatActions
}

/**
 * Floating toolbar. Appears only on a non-empty selection in a Markdown file,
 * after a 180ms dwell so it cannot flicker during a drag-select.
 */
export function FormatToolbar(props: Props) {
  const [headingOpen, setHeadingOpen] = createSignal(false)

  return (
    <div
      class="fmtbar"
      style={{
        left: `${props.x}px`,
        top: `${props.y}px`,
        transform: `translate(-50%, ${props.below ? '8px' : 'calc(-100% - 8px)'})`,
      }}
      // Keep focus in the editor so the selection survives the click.
      onMouseDown={(e) => e.preventDefault()}
    >
      <div class="fmt-btn" style={{ 'font-weight': 700 }} title="Bold  Ctrl+B" onClick={props.actions.bold}>
        B
      </div>
      <div class="fmt-btn" style={{ 'font-style': 'italic' }} title="Italic  Ctrl+I" onClick={props.actions.italic}>
        I
      </div>
      <div
        class="fmt-btn"
        style={{ 'text-decoration': 'line-through' }}
        title="Strikethrough"
        onClick={props.actions.strike}
      >
        S
      </div>

      <div class="fmt-sep" />

      <div style={{ position: 'relative' }}>
        <div
          class="fmt-btn"
          style={{ 'font-weight': 640 }}
          title="Heading"
          onClick={() => setHeadingOpen((v) => !v)}
        >
          H⌄
        </div>
        <Show when={headingOpen()}>
          <div
            class="fmtbar"
            style={{ left: '50%', top: '100%', transform: 'translate(-50%, 6px)' }}
          >
            {[1, 2, 3, 4, 5, 6].map((level) => (
              <div
                class="fmt-btn"
                title={`Heading ${level}`}
                onClick={() => {
                  props.actions.heading(level)
                  setHeadingOpen(false)
                }}
              >
                H{level}
              </div>
            ))}
          </div>
        </Show>
      </div>

      <div class="fmt-sep" />

      <div class="fmt-btn" title="Quote" onClick={props.actions.quote}>
        ❝
      </div>
      <div
        class="fmt-btn"
        style={{ 'font-family': 'var(--mono)', 'font-size': '11px' }}
        title="Inline code"
        onClick={props.actions.code}
      >
        &lt;&gt;
      </div>

      <div class="fmt-sep" />

      <div class="fmt-btn" title="Link  Ctrl+K" onClick={props.actions.link}>
        ⧉
      </div>
    </div>
  )
}
