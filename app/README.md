# Inkpen — application

A minimalist, lightning-fast Windows editor for Markdown and common text formats.

All code here is original. The specification lives in `../md_files/` and `../ui_mockup/`;
the mockup was used as a visual blueprint only — none of its code is present.

## Requirements

Already installed on this machine: Rust (MSVC), Visual Studio Build Tools 2022, WebView2,
Node 24, pnpm.

## Commands

```sh
pnpm install          # once
pnpm app:dev          # run the app with hot reload
pnpm app:build        # produce the NSIS installer + MSI
pnpm typecheck        # tsc --noEmit
pnpm build            # frontend bundle only

cd src-tauri && cargo test --lib     # encoding / line-ending round-trip tests
```

## Layout

```
src/
├── main.tsx                     mount
├── app.tsx                      orchestration: editor lifecycle, autosave, commands
├── editor/
│   ├── create.ts                CodeMirror factory, extension assembly, compartments
│   ├── markdown-decorations.ts  the live-styling layer
│   ├── list-continuation.ts     smart Enter in lists
│   ├── outline.ts               heading / key extraction from the syntax tree
│   ├── commands.ts              formatting, line ops, case, tables, clipboard
│   └── theme.ts                 CodeMirror theme bound to the CSS tokens
├── ui/                          TitleBar, StatusBar, OutlinePanel, FormatToolbar,
│                                AppMenu, Palette, Notice
├── state/                       documents store, settings store
├── ipc/                         typed wrappers over the Rust commands
└── styles/                      tokens.css, app.css, editor.css

src-tauri/src/
├── lib.rs                       command registry, window setup
├── model.rs                     structs shared across the IPC boundary
├── error.rs                     one error type, serialised to the frontend
└── commands/
    ├── fs.rs                    open, atomic save, encoding, line endings
    ├── clipboard.rs             CF_UNICODETEXT-only copy, opt-in CF_HTML
    └── settings.rs              settings.toml and session.json
```

## Two invariants worth not breaking

**The frontend never touches the filesystem.** There is no `plugin-fs` import in `src/`.
Every read and write goes through a typed command in `src/ipc/index.ts`, which keeps the
durability guarantees in one auditable place.

**`Ctrl+C` writes `CF_UNICODETEXT` and nothing else.** `src/editor/commands.ts` intercepts
`copy` and `cut` and calls into Rust. Left alone, WebView2 volunteers an HTML flavour of its
own — which is exactly what makes pasting into a terminal unreliable in other editors.
Rich copy is a separate, explicit command.

## Benchmark

```sh
inkpen --benchmark
```

Loads an 805-line corpus, performs 300 mid-document inserts and 40 scroll jumps against
the real editor, writes `%LOCALAPPDATA%\Inkpen\perf-report.txt`, and exits.

It measures the display's frame interval and the `performance.now()` resolution at runtime
and prints both, because two of the metrics are floor-bound and would otherwise read as far
more precise than they are:

- `decorations.rebuild` sits at the 0.1 ms clock floor (Chromium coarsens the timer).
- `edit.paint` is bounded below by two display frames, since it waits on a double
  `requestAnimationFrame`. **`edit.dispatch` is the real latency number** — the synchronous
  transaction, decoration rebuild and DOM mutation.

Measured on this machine: `edit.dispatch` 0.90 ms median / 1.20 ms p95, inside a 6.10 ms frame.

## Not yet implemented

- KaTeX math rendering.
- Export to HTML / PDF, and Print.
- Settings UI (the TOML file is read and written; there is no editor for it yet).
- Remappable keybindings.
- Auto-updater.
