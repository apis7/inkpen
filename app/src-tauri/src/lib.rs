mod commands;
mod error;
mod journal;
mod model;
mod paths;
mod reap;

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            commands::fs::open_file,
            commands::fs::save_file,
            commands::fs::file_metadata,
            commands::fs::reveal_in_explorer,
            commands::clipboard::copy_plain,
            commands::clipboard::copy_rich,
            commands::settings::settings_load,
            commands::settings::settings_save,
            commands::settings::settings_path,
            commands::settings::themes_list,
            commands::settings::themes_dir,
            commands::settings::session_load,
            commands::settings::session_save,
            commands::recovery::journal_append,
            commands::recovery::journal_snapshot,
            commands::recovery::journal_list,
            commands::recovery::journal_release,
            commands::recovery::journal_sync,
            commands::recovery::journal_sweep,
            commands::watch::watch_path,
            commands::watch::unwatch,
            commands::export::render_html,
            commands::export::export_html,
            startup_args,
            startup_flags,
            startup_notes,
            perf_write,
            log_error,
            log_path,
        ])
        .setup(|app| {
            commands::watch::init(app.handle().clone());
            journal::spawn_flusher();

            // The window is created hidden and shown once the frontend has painted,
            // so the user never sees an empty white rectangle. See ARCHITECTURE §4.
            if let Some(w) = app.get_webview_window("main") {
                // Before showing anything: close any previous instance whose own
                // window was lost. Our window must already exist — the test reads
                // its class off it rather than hard-coding one. See `reap.rs`.
                #[cfg(windows)]
                if let Ok(hwnd) = w.hwnd() {
                    reap::reap_orphans(hwnd.0 as isize);
                }
                w.show().ok();
            }
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building Inkpen")
        .run(|_app, event| {
            // Last chance to get buffered journal writes onto the platter.
            if let tauri::RunEvent::ExitRequested { .. } | tauri::RunEvent::Exit = event {
                let _ = journal::sync_all();
            }
        });
}

/// File paths passed on the command line — `inkpen notes.md`, or a double-clicked
/// `.md` file arriving through the file association.
#[tauri::command]
fn startup_args() -> Vec<String> {
    std::env::args()
        .skip(1)
        .filter(|a| !a.starts_with('-'))
        .filter(|a| std::path::Path::new(a).is_file())
        .collect()
}

/// Appends a line to `%LOCALAPPDATA%\Inkpen\errors.log`.
///
/// Exists because a rendering failure left no trace anywhere: the editor state
/// was intact, the journal was complete, and the only evidence was a blank
/// window. Without a record of the exception there is nothing to diagnose from.
/// Above this the log is rotated to `errors.log.1`, keeping one generation.
/// Verbose logging can otherwise fill a disk over a long session.
const LOG_MAX_BYTES: u64 = 4 * 1024 * 1024;

#[tauri::command]
fn log_error(message: String) -> error::Result<()> {
    use std::io::Write;
    let dir = crate::paths::data_dir()?;
    let path = dir.join("errors.log");

    if std::fs::metadata(&path).map(|m| m.len()).unwrap_or(0) > LOG_MAX_BYTES {
        let _ = std::fs::rename(&path, dir.join("errors.log.1"));
    }

    let mut f = std::fs::OpenOptions::new().create(true).append(true).open(&path)?;
    writeln!(f, "{message}")?;
    // fsync per line: the failure this exists to catch may take the process with
    // it, and a buffered final line is exactly the one worth having.
    f.sync_all()?;
    Ok(())
}

#[tauri::command]
fn log_path() -> error::Result<String> {
    let dir = crate::paths::data_dir()?;
    Ok(dir.join("errors.log").display().to_string())
}

/// Anything startup did before the frontend existed and could log it for itself.
/// Drained once, at boot.
#[tauri::command]
fn startup_notes() -> Vec<String> {
    reap::take_notes()
}

/// Switches passed on the command line, e.g. `--benchmark`.
#[tauri::command]
fn startup_flags() -> Vec<String> {
    std::env::args().skip(1).filter(|a| a.starts_with("--")).collect()
}

/// Writes a benchmark result next to the settings. Used by `--benchmark`, which
/// measures against the shipped release binary without needing OS-level input
/// automation — the desktop's foreground rules make that unreliable, and a
/// synthetic driver is more repeatable regardless.
#[tauri::command]
fn perf_write(report: String) -> error::Result<String> {
    let dir = crate::paths::data_dir()?;
    let path = dir.join("perf-report.txt");
    std::fs::write(&path, report)?;
    Ok(path.display().to_string())
}
