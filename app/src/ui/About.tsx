import { For, Show, createSignal, onMount } from 'solid-js'
import * as ipc from '../ipc'
import iconUrl from '../../src-tauri/icons/128x128.png'

const REPO = 'https://github.com/apis7/inkpen'

interface Fact {
  label: string
  value: string
}

/** Measured on the development machine; see md_files/TECH_STACK.md §8. */
const FACTS: Fact[] = [
  { label: 'Cold start', value: '~330 ms to a live cursor' },
  { label: 'Keystroke cost', value: '~1.6 ms inside a 6 ms frame' },
  { label: 'Installer', value: '1.9 MB, no admin required' },
  { label: 'Telemetry', value: 'none, ever' },
]

export function About(props: { onClose: () => void }) {
  const [logPath, setLogPath] = createSignal('')
  const [settingsFile, setSettingsFile] = createSignal('')

  onMount(async () => {
    try {
      setLogPath(await ipc.logPath())
      setSettingsFile(await ipc.settingsPath())
    } catch {
      /* paths are informational */
    }
  })

  return (
    <div class="scrim" onClick={(e) => e.target === e.currentTarget && props.onClose()}>
      <div class="about">
        <div class="about-head">
          <img class="about-icon" src={iconUrl} alt="" width="72" height="72" />
          <div>
            <h2>Inkpen</h2>
            <div class="about-tagline">Less is more.</div>
            <div class="about-version">version 0.1.0</div>
          </div>
        </div>

        <p class="about-blurb">
          A minimalist, lightning-fast editor for Markdown and common text formats. Tabs,
          no clutter. No AI, no terminal, no git, no language servers, no plugins, no cloud,
          no update checker — just text, and getting out of the way of it.
        </p>

        <div class="about-facts">
          <For each={FACTS}>
            {(f) => (
              <div class="about-fact">
                <span class="about-fact-label">{f.label}</span>
                <span class="about-fact-value">{f.value}</span>
              </div>
            )}
          </For>
        </div>

        <div class="about-links">
          <a href={REPO} target="_blank" rel="noreferrer">
            Source on GitHub
          </a>
          <Show when={settingsFile()}>
            <button class="about-link" onClick={() => void ipc.revealInExplorer(settingsFile())}>
              settings.toml
            </button>
          </Show>
          <Show when={logPath()}>
            <button class="about-link" onClick={() => void ipc.revealInExplorer(logPath())}>
              Diagnostic log
            </button>
          </Show>
        </div>

        <p class="about-credit">
          Built on CodeMirror 6, SolidJS and Tauri. Not code-signed, so Windows will warn on
          first run.
        </p>

        <div class="dialog-actions">
          <button class="btn" data-primary="true" onClick={props.onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  )
}
