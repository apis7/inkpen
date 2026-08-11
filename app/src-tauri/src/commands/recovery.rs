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
