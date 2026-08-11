# Inkpen

A minimalist, lightning-fast Windows editor for Markdown and common text formats.
Tabs, no clutter. No AI, no terminal, no git integration, no language servers, no
plugin marketplace, no cloud, no telemetry.

Built with [Tauri 2](https://tauri.app), [CodeMirror 6](https://codemirror.net) and
[SolidJS](https://solidjs.com). The installer is under 4 MB and needs no administrator.

## What it does

**Editing** — hybrid Markdown rendering that styles text in place while leaving the raw
characters visible, GitHub Flavored Markdown, syntax highlighting for ~130 languages in
code blocks, multi-cursor, rectangular selection, code folding, find and replace, vim
mode, and spellcheck through the Windows dictionary.

**Markdown** — inline image previews, KaTeX math, clickable task checkboxes, smart list
continuation, table auto-formatting, front matter, and an outline panel that also works
for JSON, YAML, TOML and INI.

**Files** — encoding detection and byte-identical round trips (UTF-8, UTF-8 BOM,
UTF-16 LE/BE, Windows-1252), CRLF/LF handling, atomic saves via `ReplaceFileW` so ACLs
and timestamps survive, autosave, external-change detection, and a recovery journal that
keeps unsaved work through a crash.

**Interface** — tabs with drag-reorder, command palette, floating format toolbar,
session restore, custom themes, remappable keybindings, and export to HTML, PDF and print.

## Two details worth knowing

**`Ctrl+C` writes `CF_UNICODETEXT` and nothing else** — exactly what Notepad does, and
why pasting into a terminal works reliably. Rich text is a separate, explicit command.
WebView2 will volunteer an HTML clipboard flavour if you let it; the editor intercepts
copy and cut to make sure it does not.

**The frontend never touches the filesystem.** There is no filesystem plugin in the
webview and none in its capability list. Every read and write goes through a typed Rust
command, which keeps the durability guarantees in one auditable place.

## Building

Needs Rust (MSVC toolchain), Node and pnpm.

```sh
cd app
pnpm install
pnpm app:dev          # run with hot reload
pnpm app:build        # NSIS installer + MSI
pnpm exec vitest run  # frontend tests
cd src-tauri && cargo test --lib
```

Icons are generated from the masters in `icons/`:

```sh
python icons/build_icons.py
```

It uses two artworks deliberately — below 32px the detailed page-and-rules collapses
into a grey smudge, so a splat-forward version is used at small sizes. Alpha is
premultiplied before resampling; without that, Lanczos averages transparent black into
every antialiased edge and paints a dark fringe around the mark.

## Diagnostics

`inkpen --benchmark` drives the real editor through a scripted workload and writes a
performance report. `--settings=<section>` opens straight to a preferences page.
Verbose logging can be enabled in Settings → About; it writes to a local file and
nothing is ever transmitted.

## Licence

MIT.
