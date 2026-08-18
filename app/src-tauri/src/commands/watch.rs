//! File watching with self-write suppression.
//!
//! Two things make this subtler than it looks:
//!
//! 1. **We watch the parent directory, not the file.** Saving uses `ReplaceFileW`,
//!    which swaps the file object. A watch on the file itself would go deaf after
//!    the first save.
//!
//! 2. **Self-write suppression is mandatory, not defensive.** With autosave on a
//!    2-second delay, Inkpen writes the files it is watching every few seconds.
//!    Without suppression the watcher fires on our own save and the user gets an
//!    "changed on disk" notice every time they pause typing. Suppression lives
//!    here in Rust — the frontend must never receive an event caused by its own
//!    save.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

use notify_debouncer_full::notify::RecursiveMode;
use notify_debouncer_full::{new_debouncer, DebounceEventResult, Debouncer, RecommendedCache};
use notify_debouncer_full::notify::RecommendedWatcher;
use serde::Serialize;
use tauri::{AppHandle, Emitter};

const DEBOUNCE: Duration = Duration::from_millis(400);
const SUPPRESS_WINDOW: Duration = Duration::from_secs(2);

type Deb = Debouncer<RecommendedWatcher, RecommendedCache>;

static APP: OnceLock<AppHandle> = OnceLock::new();
static WATCHER: OnceLock<Mutex<Option<Deb>>> = OnceLock::new();
/// Absolute file path -> document id.
static WATCHED: OnceLock<Mutex<HashMap<PathBuf, String>>> = OnceLock::new();
/// Directories currently under watch, with a refcount so unwatching one file
/// does not go deaf on its siblings.
static DIRS: OnceLock<Mutex<HashMap<PathBuf, usize>>> = OnceLock::new();
static SELF_WRITES: OnceLock<Mutex<Vec<(PathBuf, Instant)>>> = OnceLock::new();

fn watched() -> &'static Mutex<HashMap<PathBuf, String>> {
    WATCHED.get_or_init(|| Mutex::new(HashMap::new()))
}
fn dirs_map() -> &'static Mutex<HashMap<PathBuf, usize>> {
    DIRS.get_or_init(|| Mutex::new(HashMap::new()))
}
fn self_writes() -> &'static Mutex<Vec<(PathBuf, Instant)>> {
    SELF_WRITES.get_or_init(|| Mutex::new(Vec::new()))
}

pub fn init(app: AppHandle) {
    let _ = APP.set(app);
}

/// Resolves a path to its canonical form. On a network share this is a round
/// trip to the server, which is why every command that reaches it runs off the
/// main thread.
fn normalise(p: &Path) -> PathBuf {
    std::fs::canonicalize(p).unwrap_or_else(|_| p.to_path_buf())
}

/// Called by the save path immediately after writing, so the resulting watch
/// event can be recognised as ours and dropped.
pub fn note_self_write(path: &Path) {
    let mut writes = self_writes().lock().unwrap();
    writes.retain(|(_, at)| at.elapsed() < SUPPRESS_WINDOW);
    writes.push((normalise(path), Instant::now()));
}

fn is_self_write(path: &Path) -> bool {
    let mut writes = self_writes().lock().unwrap();
    writes.retain(|(_, at)| at.elapsed() < SUPPRESS_WINDOW);
    let target = normalise(path);
    writes.iter().any(|(p, _)| p == &target)
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct FileChanged {
    doc_id: String,
    kind: &'static str,
    path: String,
}

fn on_events(result: DebounceEventResult) {
    let events = match result {
        Ok(events) => events,
        Err(_) => return,
    };
    let Some(app) = APP.get() else { return };

    for event in events {
        for path in &event.paths {
            let doc_id = {
                let map = watched().lock().unwrap();
                match map.get(&normalise(path)) {
                    Some(id) => id.clone(),
                    None => continue,
                }
            };

            if is_self_write(path) {
                continue;
            }

            let kind = if path.exists() { "modified" } else { "removed" };
            let _ = app.emit(
                "file-changed",
                FileChanged { doc_id, kind, path: path.display().to_string() },
            );
        }
    }
}

fn ensure_watcher() -> &'static Mutex<Option<Deb>> {
    WATCHER.get_or_init(|| {
        let deb = new_debouncer(DEBOUNCE, None, on_events).ok();
        Mutex::new(deb)
    })
}

#[tauri::command(async)]
pub fn watch_path(doc_id: String, path: String) -> crate::error::Result<()> {
    let file = normalise(Path::new(&path));
    let Some(dir) = file.parent().map(|p| p.to_path_buf()) else {
        return Ok(());
    };

    watched().lock().unwrap().insert(file, doc_id);

    let mut dirs = dirs_map().lock().unwrap();
    let count = dirs.entry(dir.clone()).or_insert(0);
    *count += 1;
    if *count == 1 {
        if let Some(deb) = ensure_watcher().lock().unwrap().as_mut() {
            // A directory that cannot be watched is not fatal — the user simply
            // does not get external-change notices for it.
            let _ = deb.watch(&dir, RecursiveMode::NonRecursive);
        }
    }
    Ok(())
}

#[tauri::command(async)]
pub fn unwatch(doc_id: String) -> crate::error::Result<()> {
    let mut map = watched().lock().unwrap();
    let removed: Vec<PathBuf> = map
        .iter()
        .filter(|(_, id)| **id == doc_id)
        .map(|(p, _)| p.clone())
        .collect();
    for path in &removed {
        map.remove(path);
    }
    drop(map);

    let mut dirs = dirs_map().lock().unwrap();
    for path in removed {
        let Some(dir) = path.parent().map(|p| p.to_path_buf()) else { continue };
        if let Some(count) = dirs.get_mut(&dir) {
            *count = count.saturating_sub(1);
            if *count == 0 {
                dirs.remove(&dir);
                if let Some(deb) = ensure_watcher().lock().unwrap().as_mut() {
                    let _ = deb.unwatch(&dir);
                }
            }
        }
    }
    Ok(())
}
