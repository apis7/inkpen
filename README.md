<p align="center">
  <img src="docs/mark-160.png" width="120" height="120" alt="">
</p>

<h1 align="center">Inkpen</h1>

<p align="center"><b><i>Less is more.</i></b></p>

<p align="center">
  A Markdown editor that opens instantly, stays out of your way,<br>
  and never loses what you typed.
</p>

<p align="center">
  <b>No telemetry. No accounts. Inkpen never contacts a server.</b><br>
  <sub>Not usage counts, not crash reports, not even a version check &mdash;
  there is no HTTP client compiled into the program at all.
  <a href="#about-that-no-telemetry-claim">One honest exception.</a></sub>
</p>

<p align="center">
  Windows &middot; 1.9 MB installer &middot; no administrator needed
</p>

<p align="center">
  <a href="https://github.com/apis7/inkpen/releases">Download</a> &middot;
  <a href="#what-its-like-to-use">What it's like</a> &middot;
  <a href="#everything-it-does">Features</a> &middot;
  <a href="#tell-me-what-to-take-out">What to take out</a> &middot;
  <a href="#a-note-on-how-this-was-built">How it was built</a>
</p>

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/screenshot-dark.png">
    <img src="docs/screenshot-light.png" alt="Inkpen editing a Markdown document" width="100%">
  </picture>
</p>

---

## Why this exists

Most editors want to be your whole workspace. They bring an AI assistant, a
terminal, source control, a plugin marketplace and a language server, and they
take a few seconds and several hundred megabytes to tell you so.

Sometimes you just want to write something down.

Inkpen is the small end of that trade. It opens in about a quarter of a second,
it holds tabs, it understands Markdown properly, and it does nothing else. The
whole installer is smaller than a phone photo.

## What it's like to use

**Your Markdown stays readable while you write it.** Headings look like
headings and bold text looks bold, but the `#` and the `**` stay right where
you typed them. Nothing jumps around under your cursor, and what you see is
what's actually in the file. Tick a checkbox in a task list and the file
updates.

**It won't lose your work.** Every keystroke is written to a small recovery
log as you type. Pull the power cord and the text is still there when you come
back. Saving is done in a way that keeps the original file's permissions and
timestamps intact, so nothing downstream gets confused about what changed.

**It handles the messy files.** Legacy encodings, mixed line endings, that
document someone emailed you from 2004 — it detects what it's looking at,
shows you in the status bar, and writes it back byte-for-byte the way it found
it unless you ask otherwise.

**Copy actually works.** Copy from Inkpen and paste into a terminal, a chat
box or a form, and you get plain text — not a wall of invisible formatting.
Rich text is there when you want it, as a separate command.

**It fits into Windows.** Double-click a `.md` file and it opens. Right-click
in a folder and there's a "Markdown Document" under New. Drag a file onto the
window. Your tabs come back where you left them.

## Everything it does

| | |
| --- | --- |
| **Writing** | Live Markdown styling, tabs with drag-to-reorder, find and replace, multiple cursors, code folding, spellcheck, word count, typewriter mode, and a command palette for everything else |
| **Markdown** | GitHub-flavoured tables, task lists, front matter, inline image previews, an outline panel, and automatic list and table tidying |
| **Also opens** | Plain text, JSON, YAML, TOML, INI, CSV, logs, and source code — eighteen languages highlight inside fenced blocks |
| **Files** | Autosave, crash recovery, encoding detection, notice when a file changes on disk, and large files opened without the editor bogging down |
| **Sharing** | Export to HTML or PDF, print, and copy a selection as rich text |
| **Yours** | Light and dark themes, custom themes, remappable keys, adjustable font and spacing |

And a short list of what it deliberately does not do: no AI, no terminal, no
git integration, no language servers, no plugin store, no sign-in, no update
checker, no telemetry of any kind.

### About that no-telemetry claim

It's structural rather than a promise. Inkpen originally had an update checker,
which meant it carried an HTTP client. Both were removed, and with them went the
only code in the project capable of making a network request — 507 lines of
dependency tree. You don't have to take my word for it: `app/src-tauri/Cargo.toml`
lists twelve direct dependencies and not one of them speaks HTTP.

**The honest exception:** if a document you open contains a remote image, such
as `![](https://example.com/chart.png)`, the preview loads it, and that is a
request to `example.com` which reveals your IP address to whoever runs it. The
document initiates it, not Inkpen, and it's the same thing any Markdown preview
does — but it is real network traffic and you should know about it. Local image
paths are never loaded at all. If you'd rather previews stayed entirely offline,
[say so in an issue](https://github.com/apis7/inkpen/issues) and it becomes a
setting.

## Tell me what to take out

Bug reports are welcome. So is the opposite kind of report: **suggestions for
features to remove.**

Everything in that table costs something. A millisecond at startup, a line in
a menu, one more thing to learn, one more thing that can break. If some part
of Inkpen feels like clutter, or you've had it installed for a month and never
touched a particular feature, that is worth
[an issue](https://github.com/apis7/inkpen/issues). "Get rid of the outline
panel" is as useful to me as "the outline panel is broken" — arguably more.

Yes, removing a feature means one less feature. It also means less to load,
less to render, less to maintain and less in your way. That trade is the whole
point of this editor, and it only holds if things come out as readily as they
go in.

Less is more.

## Getting it

Grab the installer from [Releases](https://github.com/apis7/inkpen/releases)
and run it. It installs for your user account only, so it doesn't need an
administrator password.

It isn't code-signed, so Windows SmartScreen will show a warning the first
time. Choose **More info**, then **Run anyway**. Code-signing certificates
cost real money and this is a free project.

## How fast, concretely

Measured on an ordinary laptop, not a benchmark rig:

| | |
| --- | --- |
| Opening the app | 242 ms to a blinking cursor |
| Cost of a keystroke | 1.1 ms, in a frame with 6 ms to spare |
| Opening a 1 MB document | 57 ms |
| Installer | 1.9 MB |

## A note on how this was built

Inkpen was written by Claude, Anthropic's coding agent, working from a
specification and steady feedback from one person. Every feature here was
tested by hand, and the code carries 184 automated tests. But it's worth
being straightforward about it: this is agent-written software, it's version
0.1, and it hasn't yet been through the kind of use that shakes out the
last bugs.

Your files are treated carefully — atomic saves, a recovery journal, nothing
reported anywhere — but keep backups of anything you'd hate to lose, the
same as you would with any new tool. If something goes wrong,
[open an issue](https://github.com/apis7/inkpen/issues) — the About dialog
links to a diagnostic log that makes reports much easier to act on. And as
above, issues proposing that something be *taken out* are just as welcome as
bug reports.

## Building it yourself

You'll need Rust with the MSVC toolchain, Node, and pnpm.

```sh
cd app
pnpm install
pnpm app:dev          # run with hot reload
pnpm app:build        # produce the installer
```

Use `pnpm app:build` for a real build. `cargo build --release` on its own
produces a **dev** binary — Tauri decides that from the `custom-protocol`
feature, not from the profile — which loads the frontend from the dev server
and shows "can't reach this page" once installed. If you need cargo directly,
pass `--features custom-protocol`. A dev build says so in its first log line.

Tests:

```sh
pnpm exec vitest run             # frontend
cd src-tauri && cargo test --lib # backend
```

Icons are regenerated from the artwork in `icons/` with
`python icons/build_icons.py`.

Built on [Tauri](https://tauri.app), [CodeMirror](https://codemirror.net) and
[SolidJS](https://solidjs.com), which deserve most of the credit for the speed.

## Licence

MIT. Do what you like with it.
