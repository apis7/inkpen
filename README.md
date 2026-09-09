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
  <b>No telemetry. No accounts. No sign-in. Inkpen never contacts a server.</b>
</p>

<p align="center">
  Windows &middot; 1.9 MB installer &middot; no administrator needed<br>
  <a href="https://github.com/apis7/inkpen/releases"><b>Download</b></a>
</p>

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/screenshot-dark.png">
    <img src="docs/screenshot-light.png" alt="Inkpen editing a Markdown document" width="100%">
  </picture>
</p>

---

## Why it exists

Most editors want to be your whole workspace. They bring an AI assistant, a
terminal, source control, a plugin marketplace and a language server, and they
take a few seconds and several hundred megabytes to tell you so.

Sometimes you just want to write something down.

Inkpen is the small end of that trade. It opens before you've settled into the
chair, it holds tabs, it understands Markdown properly, and it does nothing
else. The whole installer is smaller than a photo from your phone.

## What it's like to use

**Your Markdown stays readable while you write it.** Headings look like
headings and bold text looks bold, but the `#` and the `**` stay right where
you typed them. Nothing jumps around under your cursor, and what you see is
what's actually in the file. Tick a checkbox in a task list and the file
updates.

**It won't lose your work.** Every keystroke goes into a small recovery log as
you type. Pull the power cord and the text is still there when you come back.
Saves are atomic, and they preserve the original file's permissions and
timestamps, so nothing downstream gets confused about what changed.

**It handles the messy files.** Legacy encodings, mixed line endings, that
document someone emailed you from 2004 — Inkpen works out what it's looking
at, tells you in the status bar, and writes it back exactly the way it found
it unless you ask otherwise.

**Copy actually works.** Copy from Inkpen and paste into a terminal, a chat box
or a web form, and you get plain text — not a wall of invisible formatting.
Rich text is still there when you want it, as its own command.

**It fits into Windows.** Double-click a `.md` file and it opens. Right-click
in a folder and there's a "Markdown Document" under New. Drag a file onto the
window. Your tabs come back where you left them.

## What it does

| | |
| --- | --- |
| **Writing** | Live Markdown styling, tabs with drag-to-reorder, find and replace, multiple cursors, code folding, spellcheck, word count, typewriter mode, and a command palette for everything else |
| **Markdown** | GitHub-flavoured tables, task lists, front matter, inline image previews, an outline panel, and automatic list and table tidying |
| **Also opens** | Plain text, JSON, YAML, TOML, INI, CSV, logs, and source code — eighteen languages highlight inside fenced blocks |
| **Files** | Autosave, crash recovery, encoding detection, a notice when a file changes on disk, and large files opened without the editor bogging down |
| **Sharing** | Export to HTML or PDF, print, and copy a selection as rich text |
| **Yours** | Light and dark themes, custom themes, remappable keys, adjustable font and spacing |

## What it doesn't do

No AI. No terminal. No git integration. No language servers. No plugin store.
No sign-in. No update checker. No telemetry of any kind.

The last one is structural rather than a promise. Inkpen once had an update
checker, which meant it carried an HTTP client; both were removed, and with
them went the only code in the program capable of making a network request.
There is nothing left to switch off.

**One honest exception.** If a document you open contains a remote image — say
`![](https://example.com/chart.png)` — the preview loads it, and that request
reveals your IP address to whoever runs that server. The document starts it,
not Inkpen, and every Markdown preview behaves this way, but it is real network
traffic and you should know about it. Local images are never fetched. If you'd
rather previews stayed entirely offline,
[say so](https://github.com/apis7/inkpen/issues) and it becomes a setting.

## How fast

Measured on an ordinary laptop, not a benchmark rig:

| | |
| --- | --- |
| Opening the app | roughly a third of a second to a blinking cursor |
| Opening a 1 MB document | under a tenth of a second |
| Typing | never costs a frame, even in a long document |
| Installer | 1.9 MB |

## Getting it

Download the installer from
[Releases](https://github.com/apis7/inkpen/releases) and run it. It installs
for your account only, so it never asks for an administrator password.

It isn't code-signed, so Windows SmartScreen will warn you the first time.
Choose **More info**, then **Run anyway**. Signing certificates cost real
money and this is a free program.

## It is version 0.1

Inkpen was written by Claude, Anthropic's coding agent, working from a
specification and steady feedback from one person. Every feature was tested by
hand and the code carries 196 automated tests — but it's a young program that
hasn't yet had the kind of use that shakes out the last bugs.

Your files are handled carefully, and nothing is reported anywhere. Still, keep
backups of anything you'd hate to lose, the same as you would with any new
tool. If something goes wrong,
[open an issue](https://github.com/apis7/inkpen/issues); the About dialog links
to a diagnostic log that makes reports much easier to act on.

## Tell me what to take out

Bug reports are welcome. So is the opposite: **tell me which features to
remove.**

Everything in that table costs something — a millisecond at startup, a line in
a menu, one more thing to learn, one more thing that can break. If some part of
Inkpen feels like clutter, or you've had it installed a month and never touched
it, that's worth [an issue](https://github.com/apis7/inkpen/issues). "Get rid
of the outline panel" is as useful to me as "the outline panel is broken."

Less is more, and that only holds if things come out as readily as they go in.

## Building it yourself

See [BUILDING.md](BUILDING.md). Built on [Tauri](https://tauri.app),
[CodeMirror](https://codemirror.net) and [SolidJS](https://solidjs.com), which
deserve most of the credit for the speed.

## Licence

MIT. Do what you like with it.
