//! Journal commands stay **synchronous on purpose.**
//!
//! The frontend fires appends without awaiting them, so their order on the wire
//! is the order they must land in — replay applies records in file order, and a
//! change record that overtakes the snapshot it depends on reconstructs the
//! wrong document. A blocking command is dispatched in call order; moving these
//! to the thread pool would let two appends interleave.
//!
//! They can afford it. Every one of them writes to the recovery folder beside
//! the settings, always on local disk, and `append` — the only one on the
//! keystroke path — does not fsync. The commands that had to move off the main
//! thread are the ones that can reach a network share; none of these can.

use crate::error::Result;
use crate::journal::{self, RecoveredJournal};

/// Fire-and-forget from the frontend — nothing awaits this on the keystroke path.
#[tauri::command]
pub fn journal_append(doc_id: String, record: String) -> Result<()> {
    journal::append(&doc_id, &record)
}

/// Compaction checkpoint: rewrites the journal as header + snapshot and fsyncs.
#[tauri::command]
pub fn journal_snapshot(doc_id: String, records: Vec<String>) -> Result<()> {
    journal::snapshot(&doc_id, &records)
}

#[tauri::command]
pub fn journal_list() -> Result<Vec<RecoveredJournal>> {
    journal::list()
}

#[tauri::command]
pub fn journal_release(doc_id: String) -> Result<()> {
    journal::release(&doc_id)
}

/// Called on window blur and before shutdown.
#[tauri::command]
pub fn journal_sync() -> Result<()> {
    journal::sync_all()
}

#[tauri::command]
pub fn journal_sweep(days: u64) -> Result<usize> {
    journal::sweep_orphans(days)
}
