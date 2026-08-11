import { For, Show } from 'solid-js'

export interface NoticeAction {
  label: string
  run: () => void
}

export interface NoticeState {
  kind: 'warn' | 'error'
  message: string
  actions: NoticeAction[]
}

/**
 * Non-blocking. It sits above the editor and you can keep typing while it's
 * there — no modal, no spinner, no interruption.
 */
export function Notice(props: { notice: NoticeState; onDismiss: () => void }) {
  return (
    <div class="notice" data-kind={props.notice.kind}>
      <span class="notice-msg">{props.notice.message}</span>
      <For each={props.notice.actions}>
        {(action) => (
          <button class="notice-btn" onClick={action.run}>
            {action.label}
          </button>
        )}
      </For>
      <button class="notice-btn" title="Dismiss" onClick={props.onDismiss}>
        ✕
      </button>
    </div>
  )
}

export interface ConfirmState {
  title: string
  body?: string
  list?: string[]
  actions: { label: string; primary?: boolean; danger?: boolean; run: () => void }[]
}

export function ConfirmDialog(props: { state: ConfirmState }) {
  return (
    <div class="scrim">
      <div class="dialog">
        <h2>{props.state.title}</h2>
        <Show when={props.state.body}>
          <p>{props.state.body}</p>
        </Show>
        <Show when={props.state.list?.length}>
          <div class="dialog-list">
            <For each={props.state.list}>{(row) => <div class="dialog-row">{row}</div>}</For>
          </div>
        </Show>
        <div class="dialog-actions">
          <For each={props.state.actions}>
            {(action) => (
              <button
                class="btn"
                data-primary={action.primary ? 'true' : 'false'}
                data-danger={action.danger ? 'true' : 'false'}
                onClick={action.run}
              >
                {action.label}
              </button>
            )}
          </For>
        </div>
      </div>
    </div>
  )
}
