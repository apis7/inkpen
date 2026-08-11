import { For, Show, createSignal, onCleanup, onMount } from 'solid-js'
import { DEFAULT_BINDINGS, buildLookup, chordOf, resolveBindings } from '../state/keymap'
import { DEFAULTS, availableThemes, settings, updateSettings } from '../state/settings'
import * as ipc from '../ipc'

async function openThemesFolder() {
  try {
    await ipc.revealInExplorer(await ipc.themesDir())
  } catch {
    /* nothing useful to say if Explorer will not open */
  }
}

async function openLog() {
  try {
    await ipc.revealInExplorer(await ipc.logPath())
  } catch {
    /* nothing useful to say if Explorer will not open */
  }
}

type Section = 'editor' | 'appearance' | 'files' | 'keyboard' | 'updates' | 'about'

const SECTIONS: { id: Section; label: string }[] = [
  { id: 'editor', label: 'Editor' },
  { id: 'appearance', label: 'Appearance' },
  { id: 'files', label: 'Files' },
  { id: 'keyboard', label: 'Keyboard' },
  { id: 'updates', label: 'Updates' },
  { id: 'about', label: 'About' },
]

interface RowProps {
  label: string
  hint?: string
  children: unknown
}

function Row(props: RowProps) {
  return (
    <div class="set-row">
      <div class="set-label">
        <div>{props.label}</div>
        <Show when={props.hint}>
          <div class="set-hint">{props.hint}</div>
        </Show>
      </div>
      <div class="set-control">{props.children as never}</div>
    </div>
  )
}

function Toggle(props: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      class="set-toggle"
      role="switch"
      aria-checked={props.value}
      data-on={props.value}
      onClick={() => props.onChange(!props.value)}
    >
      <span class="set-knob" />
    </button>
  )
}

function Num(props: {
  value: number
  min: number
  max: number
  step?: number
  onChange: (v: number) => void
}) {
  return (
    <input
      class="set-input"
      type="number"
      value={props.value}
      min={props.min}
      max={props.max}
      step={props.step ?? 1}
      onChange={(e) => {
        const v = Number(e.currentTarget.value)
        if (!Number.isNaN(v)) props.onChange(Math.min(props.max, Math.max(props.min, v)))
      }}
    />
  )
}

const SECTION_IDS = SECTIONS.map((s) => s.id)

export function isSection(value: string): value is Section {
  return (SECTION_IDS as string[]).includes(value)
}

export function Settings(props: { initial?: Section }) {
  const [section, setSection] = createSignal<Section>(props.initial ?? 'editor')
  const [recording, setRecording] = createSignal<string | null>(null)
  const [tomlPath, setTomlPath] = createSignal('')

  onMount(async () => {
    try {
      setTomlPath(await ipc.settingsPath())
    } catch {
      /* path is informational only */
    }
  })

  const bindings = () => resolveBindings(settings.keymap)
  const conflicts = () => new Set(buildLookup(bindings()).conflicts)

  // While recording, the next chord is captured instead of running its command.
  const onRecordKey = (e: KeyboardEvent) => {
    const id = recording()
    if (!id) return
    e.preventDefault()
    e.stopPropagation()

    if (e.key === 'Escape') {
      setRecording(null)
      return
    }
    if (e.key === 'Backspace' || e.key === 'Delete') {
      updateSettings((s) => { s.keymap[id] = '' })
      setRecording(null)
      return
    }
    const chord = chordOf(e)
    if (!chord) return
    updateSettings((s) => { s.keymap[id] = chord })
    setRecording(null)
  }

  onMount(() => document.addEventListener('keydown', onRecordKey, true))
  onCleanup(() => document.removeEventListener('keydown', onRecordKey, true))

  return (
    <div class="settings">
      <div class="set-rail">
        <For each={SECTIONS}>
          {(s) => (
            <div
              class="set-rail-item"
              data-active={section() === s.id}
              onClick={() => setSection(s.id)}
            >
              {s.label}
            </div>
          )}
        </For>
      </div>

      <div class="set-body">
        <Show when={section() === 'editor'}>
          <h2>Editor</h2>
          <Row label="Font size" hint="Editor text, in pixels.">
            <Num
              value={settings.editor.fontSize}
              min={8}
              max={48}
              onChange={(v) => updateSettings((s) => { s.editor.fontSize = v })}
            />
          </Row>
          <Row label="Line height" hint="Multiplier of the font size.">
            <Num
              value={settings.editor.lineHeight}
              min={1.2}
              max={2.2}
              step={0.05}
              onChange={(v) => updateSettings((s) => { s.editor.lineHeight = v })}
            />
          </Row>
          <Row label="Line numbers">
            <Toggle
              value={settings.editor.lineNumbers}
              onChange={(v) => updateSettings((s) => { s.editor.lineNumbers = v })}
            />
          </Row>
          <Row label="Word wrap" hint="Wrap long lines to the window width.">
            <Toggle
              value={settings.editor.wordWrap}
              onChange={(v) => updateSettings((s) => { s.editor.wordWrap = v })}
            />
          </Row>
          <Row label="Show whitespace" hint="Render spaces and tabs as faint marks.">
            <Toggle
              value={settings.editor.showWhitespace}
              onChange={(v) => updateSettings((s) => { s.editor.showWhitespace = v })}
            />
          </Row>
          <Row label="Indent size">
            <Num
              value={settings.editor.indentSize}
              min={1}
              max={8}
              onChange={(v) => updateSettings((s) => { s.editor.indentSize = v })}
            />
          </Row>
          <Row label="Indent with tabs">
            <Toggle
              value={settings.editor.indentWithTabs}
              onChange={(v) => updateSettings((s) => { s.editor.indentWithTabs = v })}
            />
          </Row>
          <Row label="Trim trailing whitespace" hint="Strip end-of-line spaces on save.">
            <Toggle
              value={settings.editor.trimTrailingWhitespace}
              onChange={(v) => updateSettings((s) => { s.editor.trimTrailingWhitespace = v })}
            />
          </Row>
          <Row label="Spellcheck" hint="Uses the Windows dictionary.">
            <Toggle
              value={settings.editor.spellcheck}
              onChange={(v) => updateSettings((s) => { s.editor.spellcheck = v })}
            />
          </Row>
          <Row
            label="Typewriter scrolling"
            hint="Keep the line you are editing at the middle of the window. Only reacts to typing and cursor moves, so scrolling by hand still works normally."
          >
            <Toggle
              value={settings.editor.typewriter}
              onChange={(v) => updateSettings((s) => { s.editor.typewriter = v })}
            />
          </Row>
          <Row label="Vim mode" hint="Loaded on demand; costs nothing while off.">
            <Toggle
              value={settings.editor.vimMode}
              onChange={(v) => updateSettings((s) => { s.editor.vimMode = v })}
            />
          </Row>
        </Show>

        <Show when={section() === 'appearance'}>
          <h2>Appearance</h2>
          <Row label="Theme" hint="Auto follows the Windows setting.">
            <div class="set-segmented">
              <For each={availableThemes()}>
                {(t) => (
                  <button
                    data-on={settings.appearance.theme === t}
                    onClick={() => updateSettings((s) => { s.appearance.theme = t })}
                  >
                    {t}
                  </button>
                )}
              </For>
            </div>
          </Row>
          <Row
            label="Custom themes"
            hint="A .toml file overriding any subset of the design tokens. Dropped in, picked up on next launch — no restart of anything else."
          >
            <button class="btn" onClick={() => void openThemesFolder()}>
              Open themes folder
            </button>
          </Row>
          <Row label="Zoom" hint="Scales all text and chrome.">
            <Num
              value={Math.round(settings.appearance.zoom * 100) / 100}
              min={0.6}
              max={2.5}
              step={0.1}
              onChange={(v) => updateSettings((s) => { s.appearance.zoom = v })}
            />
          </Row>
          <Row
            label="Tapping Alt opens the menu"
            hint="Only a bare Alt press and release. Alt+Tab and other Alt shortcuts never open it. Turn this off to reach the menu only by the ☰ button."
          >
            <Toggle
              value={settings.ui.altOpensMenu}
              onChange={(v) => updateSettings((s) => { s.ui.altOpensMenu = v })}
            />
          </Row>
        </Show>

        <Show when={section() === 'files'}>
          <h2>Files</h2>
          <Row
            label="Autosave"
            hint="Named files only. Untitled buffers are held in the recovery journal until you save them."
          >
            <div class="set-segmented">
              <For each={['off', 'afterDelay', 'onFocusChange'] as const}>
                {(m) => (
                  <button
                    data-on={settings.files.autosave === m}
                    onClick={() => updateSettings((s) => { s.files.autosave = m })}
                  >
                    {m === 'afterDelay' ? 'after delay' : m === 'onFocusChange' ? 'on focus loss' : 'off'}
                  </button>
                )}
              </For>
            </div>
          </Row>
          <Row label="Autosave delay" hint="Milliseconds after the last keystroke.">
            <Num
              value={settings.files.autosaveDelayMs}
              min={200}
              max={60000}
              step={100}
              onChange={(v) => updateSettings((s) => { s.files.autosaveDelayMs = v })}
            />
          </Row>
          <Row
            label="Fast mode threshold"
            hint="Megabytes. Larger files open without styling or folding so they open instantly."
          >
            <Num
              value={settings.files.fastModeThresholdMb}
              min={1}
              max={2000}
              onChange={(v) => updateSettings((s) => { s.files.fastModeThresholdMb = v })}
            />
          </Row>
          <Row
            label="Reload unmodified files"
            hint="When a file changes on disk and you have no unsaved edits, reload it silently."
          >
            <Toggle
              value={settings.files.reloadUnmodified}
              onChange={(v) => updateSettings((s) => { s.files.reloadUnmodified = v })}
            />
          </Row>
        </Show>

        <Show when={section() === 'keyboard'}>
          <h2>Keyboard</h2>
          <p class="set-note">
            Click a shortcut to record a new one. <b>Esc</b> cancels, <b>Backspace</b> unbinds.
            Editing shortcuts owned by the editor itself — undo, find, multi-cursor — are not
            listed, because rebinding them here would fight the editor's own keymap.
          </p>
          <For each={bindings()}>
            {(b) => (
              <div class="set-row set-keyrow">
                <div class="set-label">{b.label}</div>
                <div class="set-control">
                  <button
                    class="set-chord"
                    data-recording={recording() === b.id}
                    data-conflict={!!b.key && conflicts().has(b.key)}
                    onClick={() => setRecording(recording() === b.id ? null : b.id)}
                  >
                    {recording() === b.id ? 'Press keys…' : b.key || 'Unbound'}
                  </button>
                </div>
              </div>
            )}
          </For>
          <div class="set-actions">
            <button class="btn" onClick={() => updateSettings((s) => { s.keymap = {} })}>
              Reset all to defaults
            </button>
          </div>
        </Show>

        <Show when={section() === 'updates'}>
          <h2>Updates</h2>
          <p class="set-note">
            Inkpen never downloads or installs on its own. A check makes one request on
            launch, at most once per interval, and tells you if something newer exists —
            nothing more. Between checks there is no network activity at all.
          </p>
          <Row label="Check for updates" hint="One request on launch, off the critical path.">
            <Toggle
              value={settings.updates.enabled}
              onChange={(v) => updateSettings((s) => { s.updates.enabled = v })}
            />
          </Row>
          <Row label="Check interval" hint="Days between automatic checks.">
            <Num
              value={settings.updates.intervalDays}
              min={1}
              max={365}
              onChange={(v) => updateSettings((s) => { s.updates.intervalDays = v })}
            />
          </Row>
          <Row
            label="Release manifest URL"
            hint="A JSON document with version, notes and url. Empty means updates are off — no server is configured by default, so nothing is contacted."
          >
            <input
              class="set-input"
              style={{ width: '280px', 'text-align': 'left' }}
              type="text"
              placeholder="https://…/latest.json"
              value={settings.updates.endpoint}
              onChange={(e) =>
                updateSettings((s) => { s.updates.endpoint = e.currentTarget.value.trim() })
              }
            />
          </Row>
          <Row
            label="Unsigned installer"
            hint="Inkpen is not code-signed, so each install shows a Windows SmartScreen warning you have to click through. That is why updates are never automatic."
          >
            <span class="set-static">acknowledged</span>
          </Row>
        </Show>

        <Show when={section() === 'about'}>
          <h2>About</h2>
          <Row label="Inkpen" hint="A minimalist, lightning-fast editor for Markdown and text.">
            <span class="set-static">version 0.1.0</span>
          </Row>
          <Row label="Settings file" hint="Edit by hand if you prefer; changes are picked up live.">
            <button class="btn" onClick={() => void ipc.revealInExplorer(tomlPath())}>
              Show settings.toml
            </button>
          </Row>
          <Row label="Telemetry" hint="There is none. Nothing leaves this machine, ever.">
            <span class="set-static">disabled</span>
          </Row>
          <Row
            label="Verbose logging"
            hint="Records a running account of what the app is doing — view lifecycle, focus changes, settings reconfiguration, a heartbeat every minute. Off by default. Uncaught errors are recorded either way. Written to a local file; nothing is transmitted."
          >
            <Toggle
              value={settings.diagnostics.verboseLogging}
              onChange={(v) => updateSettings((s) => { s.diagnostics.verboseLogging = v })}
            />
          </Row>
          <Row label="Log file" hint="Rotates at 4 MB, keeping one previous generation.">
            <button class="btn" onClick={() => void openLog()}>
              Show log
            </button>
          </Row>
          <Row label="Reset" hint="Restores every setting to its default.">
            <button
              class="btn"
              data-danger="true"
              onClick={() => updateSettings((s) => Object.assign(s, structuredClone(DEFAULTS)))}
            >
              Reset all settings
            </button>
          </Row>
        </Show>
      </div>
    </div>
  )
}

export { DEFAULT_BINDINGS }
