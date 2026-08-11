//! Where Inkpen keeps its files.
//!
//! Everything lives under `%APPDATA%\Inkpen` — settings, themes, recovery
//! journals, session and logs.
//!
//! This is deliberate, and it is the third location tried. Both earlier choices
//! were destroyed by uninstalling:
//!
//!   `%LOCALAPPDATA%\Inkpen`            is where the per-user NSIS installer puts
//!                                      the application, so data sat beside
//!                                      `inkpen.exe` and went with it.
//!   `%LOCALAPPDATA%\dev.inkpen.editor` is the WebView2 profile directory, which
//!                                      the uninstaller clears as app data.
//!
//! `%APPDATA%\Inkpen` was observed to survive an uninstall intact, which is why
//! it is used rather than another plausible-looking guess. Recovery journals hold
//! work the user has never saved anywhere else; keeping them somewhere an
//! uninstall can reach is not a trade worth making, and a session file that
//! roams is a trivial price.

use std::fs;
use std::path::PathBuf;

use crate::error::{ErrorKind, InkpenError, Result};

/// Roaming configuration and data: `%APPDATA%\Inkpen`.
pub fn config_dir() -> Result<PathBuf> {
    let dir = dirs::config_dir()
        .ok_or_else(|| InkpenError::new(ErrorKind::Io, "Could not locate the config folder"))?
        .join("Inkpen");
    fs::create_dir_all(&dir)?;
    Ok(dir)
}

/// Journals, session and logs. Same root as the settings, for the reasons above.
pub fn data_dir() -> Result<PathBuf> {
    let dir = config_dir()?;
    if let Some(local) = dirs::data_local_dir() {
        migrate_from_legacy(&local.join("Inkpen"), &dir);
        migrate_from_legacy(&local.join("dev.inkpen.editor"), &dir);
    }
    Ok(dir)
}

/// Moves data written by an earlier build to the current location.
///
/// Only the files Inkpen owns are touched — never `inkpen.exe`, the uninstaller,
/// or the WebView2 profile. Failures are ignored: a missed migration costs a
/// session, whereas refusing to start costs the whole app.
fn migrate_from_legacy(legacy: &PathBuf, target: &PathBuf) {
    if !legacy.exists() || legacy == target {
        return;
    }
    const OWNED: [&str; 5] = ["session.json", "update.json", "errors.log", "errors.log.1", "perf-report.txt"];

    for name in OWNED {
        let from = legacy.join(name);
        let to = target.join(name);
        if from.exists() && !to.exists() {
            let _ = fs::rename(&from, &to);
        }
    }

    // The recovery directory carries unsaved work, so it matters most.
    let from = legacy.join("recovery");
    let to = target.join("recovery");
    if from.is_dir() {
        let _ = fs::create_dir_all(&to);
        if let Ok(entries) = fs::read_dir(&from) {
            for entry in entries.flatten() {
                let dest = to.join(entry.file_name());
                if !dest.exists() {
                    let _ = fs::rename(entry.path(), dest);
                }
            }
        }
        let _ = fs::remove_dir(&from);
    }
}

pub fn recovery_dir() -> Result<PathBuf> {
    let dir = data_dir()?.join("recovery");
    fs::create_dir_all(&dir)?;
    Ok(dir)
}
