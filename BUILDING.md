# Building Inkpen

You'll need Rust with the MSVC toolchain, Node, and pnpm.

```sh
cd app
pnpm install
pnpm app:dev          # run with hot reload
pnpm app:build        # produce the installer
```

## Use `pnpm app:build` for a real build

`cargo build --release` on its own produces a **dev** binary. Tauri decides
dev-versus-production from the `custom-protocol` feature, not from the cargo
profile, so a release build without it still points at the dev server and shows
"can't reach this page" once installed — with nothing else to indicate why.

If you need cargo directly, pass `--features custom-protocol`. A dev build
announces itself in the first line of its log.

## Tests

```sh
pnpm exec vitest run             # frontend
cd src-tauri && cargo test --lib # backend
```

## Icons

Regenerated from the artwork in `icons/` with `python icons/build_icons.py`.

## Diagnostics

Inkpen writes to `%APPDATA%\Inkpen\errors.log`; the About dialog links to it.
Errors are always recorded. Verbose logging — a heartbeat of editor state, focus
changes, and a trace of the window-close path — is a setting, and is what to
turn on before trying to reproduce something intermittent.

`%APPDATA%\Inkpen` also holds `settings.toml`, `session.json`, and the
`recovery/` journals that back crash recovery.
