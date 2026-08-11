import { Show } from 'solid-js'
import { ENCODING_LABEL, LANGUAGE_LABEL, LINE_ENDING_LABEL } from '../ipc/types'
import type { Doc } from '../state/documents'
import { settings } from '../state/settings'

interface Props {
  doc: Doc | null
  line: number
  col: number
  selChars: number
  selCount: number
  words: number
  chars: number
  readMinutes: number
  countMode: number
  message: string
  messageKind: 'info' | 'warn'
  outlineOpen: boolean
  onCycleCount: () => void
  onToggleOutline: () => void
  onGoToLine: () => void
  onCycleLineEnding: () => void
  onPickEncoding: () => void
}

export function StatusBar(props: Props) {
  /** The settings tab has no caret, encoding or word count — showing stale
   *  values from whichever document happened to be open before is worse than
   *  showing nothing. */
  const isDocument = () => props.doc?.kind === 'text'

  const countText = () => {
    if (props.countMode === 1) return `${props.chars.toLocaleString()} chars`
    if (props.countMode === 2) {
      const m = props.readMinutes
      return m < 1 ? `${Math.round(m * 60)}s read` : `${Math.round(m)}m read`
    }
    return `${props.words.toLocaleString()} words`
  }

  return (
    <div class="statusbar">
      <div class="status-left">
        <Show when={isDocument()}>
          <span class="seg" title="Go to line" onClick={props.onGoToLine}>
            Ln {props.line}, Col {props.col}
          </span>
        </Show>

        <Show when={isDocument() && props.selChars > 0}>
          <span class="seg" data-static="true">
            Sel {props.selChars.toLocaleString()}
            {props.selCount > 1 ? ` (${props.selCount})` : ''}
          </span>
        </Show>

        <Show when={props.message}>
          <span
            class="status-msg"
            classList={{ 'status-warn': props.messageKind === 'warn' }}
          >
            {props.message}
          </span>
        </Show>

        <Show when={props.doc?.fastMode}>
          <span class="seg status-warn" data-static="true" title="File is large — styling is off">
            Fast mode
          </span>
        </Show>

        <Show when={isDocument() && props.doc?.readOnly}>
          <span class="seg" data-static="true">Read-only</span>
        </Show>
      </div>

      <div class="status-right">
        <Show when={isDocument() ? props.doc : null}>
          {(doc) => (
            <>
              <span class="seg" title="Encoding" onClick={props.onPickEncoding}>
                {ENCODING_LABEL[doc().encoding]}
              </span>
              <span
                class="seg"
                classList={{ 'status-warn': doc().lineEnding === 'mixed' }}
                title="Line endings — click to convert"
                onClick={props.onCycleLineEnding}
              >
                {LINE_ENDING_LABEL[doc().lineEnding]}
              </span>
              <span class="seg" data-static="true">
                {LANGUAGE_LABEL[doc().language] ?? doc().language}
              </span>
            </>
          )}
        </Show>

        <Show when={isDocument()}>
          <span class="seg" data-static="true">
            {settings.editor.indentWithTabs ? 'Tabs' : `Spaces: ${settings.editor.indentSize}`}
          </span>

          <span class="seg status-count" title="Click to cycle" onClick={props.onCycleCount}>
            {countText()}
          </span>
        </Show>

        <span
          class="status-outline"
          title="Toggle outline  (Ctrl+Shift+O)"
          style={{ color: props.outlineOpen ? 'var(--accent)' : 'inherit' }}
          onClick={props.onToggleOutline}
        >
          ⌗
        </span>
      </div>
    </div>
  )
}
