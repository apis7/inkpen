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
            let _ = STARTED.set(std::time::Instant::now());
            commands::watch::init(app.handle().clone());
            journal::spawn_flusher();

            // A dev-mode binary loads the frontend from the dev server, so an
            // installed one shows "can't reach this page" and nothing else. The
            // build that produces it looks entirely normal — `cargo build
            // --release` without `custom-protocol` is enough, because Tauri
            // derives `dev` from the *absence* of that feature. Say so here, so
            // the log answers the question in one line. See README, Building.
            #[cfg(dev)]
            log_line("build", "DEV BUILD — frontend loads from the dev server, not the bundle");

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
            // A close that never completes has happened: a 27-hour-old instance
            // acknowledged WM_CLOSE and stayed open, with nothing in the log
            // either way. Every branch of the frontend's close handler is
            // try-caught, so it did not throw — which leaves "the event never
            // reached it" as the remaining explanation, and that is precisely
            // what this line settles. A `close` here with no `close` from the
            // frontend means Rust to webview delivery has died; both means the
            // handler ran and stalled somewhere inside itself.
            if let tauri::RunEvent::WindowEvent {
                label,
                event: tauri::WindowEvent::CloseRequested { .. },
                ..
            } = &event
            {
                log_line("close", &format!("close requested by the OS for \"{label}\""));
            }

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

/// `durable` decides whether the line is fsynced before returning.
///
/// Errors and lifecycle events are: the failure this log exists to catch may
/// take the process with it, and a buffered final line is exactly the one worth
/// having. Verbose traffic is not. Heartbeats and focus changes arrive every few
/// seconds, and an fsync each is a steady trickle of main-thread disk waits paid
/// for lines nobody reads after a crash — the page cache carries those through
/// anything short of a power cut.
#[tauri::command]
fn log_error(message: String, durable: bool) -> error::Result<()> {
    append_log(&message, durable)
}

fn append_log(message: &str, durable: bool) -> error::Result<()> {
    use std::io::Write;
    let dir = crate::paths::data_dir()?;
    let path = dir.join("errors.log");

    if std::fs::metadata(&path).map(|m| m.len()).unwrap_or(0) > LOG_MAX_BYTES {
        let _ = std::fs::rename(&path, dir.join("errors.log.1"));
    }

    let mut f = std::fs::OpenOptions::new().create(true).append(true).open(&path)?;
    writeln!(f, "{message}")?;
    if durable {
        f.sync_all()?;
    }
    Ok(())
}

/// Wall-clock start of this process, for the uptime column.
static STARTED: std::sync::OnceLock<std::time::Instant> = std::sync::OnceLock::new();

/// Writes a log line from Rust, in the same format the frontend uses.
///
/// Reserved for the places where routing through the frontend would defeat the
/// purpose. The close-request trace is exactly that: the fault it exists to
/// catch is the frontend never receiving the event, so a diagnostic that
/// depended on the frontend would fall silent at the one moment it matters.
pub(crate) fn log_line(kind: &str, detail: &str) {
    let uptime = STARTED
        .get()
        .map(|t| format!("+{}s", t.elapsed().as_secs()))
        .unwrap_or_default();
    // One space then an 8-wide uptime column, exactly as `stamp()` builds it
    // in diagnostics.ts — the two sides interleave in one file and must line up.
    let _ = append_log(&format!("{} {uptime:>8}  {kind:<10} {detail}", iso_now()), true);
}

/// UTC in the same shape as JavaScript's `toISOString`, so lines written from
/// either side sort and read as one log.
fn iso_now() -> String {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default();
    let (secs, ms) = (now.as_secs(), now.subsec_millis());
    let (y, mo, d) = civil_from_days((secs / 86_400) as i64);
    let tod = secs % 86_400;
    format!(
        "{y:04}-{mo:02}-{d:02}T{:02}:{:02}:{:02}.{ms:03}Z",
        tod / 3600,
        (tod % 3600) / 60,
        tod % 60,
    )
}

/// Days since the Unix epoch to a civil date. Howard Hinnant's algorithm — the
/// alternative is a date crate for one log line.
fn civil_from_days(z: i64) -> (i64, u32, u32) {
    let z = z + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = (z - era * 146_097) as i64;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    (if m <= 2 { yoe + era * 400 + 1 } else { yoe + era * 400 }, m, d)
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

#[cfg(test)]
mod tests {
    use super::civil_from_days;

    /// Days are counted from the Unix epoch, so day zero pins the offset.
    #[test]
    fn day_zero_is_the_epoch() {
        assert_eq!(civil_from_days(0), (1970, 1, 1));
    }

    /// Leap-year handling is the whole risk in this algorithm: 2000 was a leap
    /// year and 1900 was not, and the era arithmetic is what decides that.
    #[test]
    fn handles_leap_days_and_century_rules() {
        assert_eq!(civil_from_days(59), (1970, 3, 1)); // 1970 is not a leap year
        assert_eq!(civil_from_days(10_957), (2000, 1, 1));
        assert_eq!(civil_from_days(11_016), (2000, 2, 29)); // 2000 *is* a leap year
        assert_eq!(civil_from_days(11_017), (2000, 3, 1));
    }

    /// A date past the log's own era, to catch overflow in the era division.
    #[test]
    fn handles_dates_well_past_now() {
        assert_eq!(civil_from_days(20_684), (2026, 8, 19));
        assert_eq!(civil_from_days(36_525), (2070, 1, 1));
    }
}
