//! Recovery journal — the "never loses work" guarantee.
//!
//! Append-only, newline-delimited JSON, one file per document in
//! `%LOCALAPPDATA%\Inkpen\recovery\<doc_id>.journal`.
//!
//! **Rust owns durability; the frontend owns replay.** Records are stored and
//! returned verbatim. CodeMirror positions are UTF-16 code-unit offsets into a
//! JavaScript string, so replaying them in Rust would mean reimplementing
//! JavaScript string indexing — a whole class of off-by-one corruption bugs for
//! no benefit. The frontend replays in the coordinate system that produced them.
//!
//! **Fsync policy:** appends do not fsync. One fsync per keystroke would destroy
//! the latency budget. A background thread flushes every 5 seconds, and the
//! frontend forces a flush on window blur and shutdown. Worst case is a few
//! seconds of typing lost to a hard power cut, and *nothing* lost to a process
//! crash — the OS still owns the page cache.

use std::collections::HashMap;
use std::fs::{self, File, OpenOptions};
use std::io::{BufRead, BufReader, Write};
use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};
use std::time::Duration;

use serde::Serialize;

use crate::error::{ErrorKind, InkpenError, Result};

struct Handle {
    file: File,
    dirty: bool,
}

static JOURNALS: OnceLock<Mutex<HashMap<String, Handle>>> = OnceLock::new();

fn journals() -> &'static Mutex<HashMap<String, Handle>> {
    JOURNALS.get_or_init(|| Mutex::new(HashMap::new()))
}

pub use crate::paths::recovery_dir;

/// Rejects anything that could escape the recovery directory. Document ids are
/// generated UUIDs, but this is a trust boundary and gets treated as one.
fn journal_path(doc_id: &str) -> Result<PathBuf> {
    let safe = !doc_id.is_empty()
        && doc_id.len() <= 64
        && doc_id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_');
    if !safe {
        return Err(InkpenError::new(ErrorKind::Io, "Invalid document id"));
    }
    Ok(recovery_dir()?.join(format!("{doc_id}.journal")))
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecoveredJournal {
    pub doc_id: String,
    pub records: Vec<String>,
}

/// Appends one NDJSON record. Deliberately cheap: no fsync, no parsing, no
/// allocation beyond the newline.
pub fn append(doc_id: &str, record: &str) -> Result<()> {
    let path = journal_path(doc_id)?;
    let mut map = journals().lock().unwrap();

    let handle = match map.get_mut(doc_id) {
        Some(h) => h,
        None => {
            let file = OpenOptions::new().create(true).append(true).open(&path)?;
            map.insert(doc_id.to_string(), Handle { file, dirty: false });
            map.get_mut(doc_id).unwrap()
        }
    };

    handle.file.write_all(record.as_bytes())?;
    handle.file.write_all(b"\n")?;
    handle.dirty = true;
    Ok(())
}

/// Compaction. Rewrites the journal as header + a single snapshot, discarding
/// every change record before it, then fsyncs. Keeps journals small and replay
/// fast no matter how long a session runs.
pub fn snapshot(doc_id: &str, records: &[String]) -> Result<()> {
    let path = journal_path(doc_id)?;
    let mut map = journals().lock().unwrap();
    map.remove(doc_id);

    let tmp = path.with_extension("journal-tmp");
    {
        let mut f = File::create(&tmp)?;
        for record in records {
            f.write_all(record.as_bytes())?;
            f.write_all(b"\n")?;
        }
        f.sync_all()?;
    }
    fs::rename(&tmp, &path)?;
    Ok(())
}

/// Every journal on disk, records verbatim, for the frontend to replay.
pub fn list() -> Result<Vec<RecoveredJournal>> {
    let dir = recovery_dir()?;
    let mut out = Vec::new();

    for entry in fs::read_dir(&dir)? {
        let entry = entry?;
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("journal") {
            continue;
        }
        let doc_id = match path.file_stem().and_then(|s| s.to_str()) {
            Some(s) => s.to_string(),
            None => continue,
        };

        let file = match File::open(&path) {
            Ok(f) => f,
            Err(_) => continue,
        };
        // A truncated final line from a hard crash is expected; take the lines
        // that parsed and drop the rest rather than failing the whole recovery.
        let records: Vec<String> = BufReader::new(file)
            .lines()
            .map_while(|l| l.ok())
            .filter(|l| !l.trim().is_empty() && serde_json::from_str::<serde_json::Value>(l).is_ok())
            .collect();

        if !records.is_empty() {
            out.push(RecoveredJournal { doc_id, records });
        } else {
            let _ = fs::remove_file(&path);
        }
    }
    Ok(out)
}

/// Called after a successful save, or when the user discards a buffer.
pub fn release(doc_id: &str) -> Result<()> {
    journals().lock().unwrap().remove(doc_id);
    let path = journal_path(doc_id)?;
    if path.exists() {
        fs::remove_file(&path)?;
    }
    Ok(())
}

/// Forces every dirty handle to disk. Called on window blur and shutdown.
///
/// The fsyncs happen *outside* the lock, deliberately. Holding it across them
/// makes every concurrent `append` — including one on the main thread, on the
/// keystroke path — wait for a disk flush it has no stake in. That was already
/// true of the background flusher every five seconds, before any of this ran on
/// a pool thread.
///
/// Note this is why `journal_sync` is not an async command: moving it to the
/// pool would not take the wait off the main thread, it would only move it from
/// the fsync to the mutex behind it. Narrowing the lock is the fix; relocating
/// the caller is not.
pub fn sync_all() -> Result<()> {
    let pending: Vec<File> = {
        let mut map = journals().lock().unwrap();
        map.values_mut()
            .filter(|h| h.dirty)
            .filter_map(|h| {
                // Cleared before the flush, not after: an append landing during
                // it marks the handle dirty again and is caught by the next
                // pass, which is correct. The reverse would clear a flag set by
                // a write this flush never covered.
                h.dirty = false;
                h.file.try_clone().ok()
            })
            .collect()
    };

    for file in pending {
        file.sync_all()?;
    }
    Ok(())
}

/// Sweeps journals older than 30 days that no live document claimed.
pub fn sweep_orphans(days: u64) -> Result<usize> {
    let dir = recovery_dir()?;
    let cutoff = Duration::from_secs(days * 24 * 60 * 60);
    let mut removed = 0;

    for entry in fs::read_dir(&dir)? {
        let entry = entry?;
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("journal") {
            continue;
        }
        let stale = entry
            .metadata()
            .ok()
            .and_then(|m| m.modified().ok())
            .and_then(|t| t.elapsed().ok())
            .map(|age| age > cutoff)
            .unwrap_or(false);
        if stale && fs::remove_file(&path).is_ok() {
            removed += 1;
        }
    }
    Ok(removed)
}

/// Background flusher. Started once at app setup.
pub fn spawn_flusher() {
    std::thread::spawn(|| loop {
        std::thread::sleep(Duration::from_secs(5));
        let _ = sync_all();
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_traversal_in_doc_id() {
        for bad in ["../evil", "a/b", "a\\b", "", "con:", "x".repeat(65).as_str()] {
            assert!(journal_path(bad).is_err(), "should reject {bad:?}");
        }
    }

    #[test]
    fn accepts_uuid_shaped_ids() {
        assert!(journal_path("3f2b1c4d-5e6f-7a8b-9c0d-1e2f3a4b5c6d").is_ok());
    }
}
