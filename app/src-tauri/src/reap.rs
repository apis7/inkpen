//! Closes orphaned Inkpen processes left behind by a lost window.
//!
//! The blank-window fault can end with the process still alive and its editor
//! window gone entirely. One such orphan ran for five days holding a WebView2
//! host and a directory watcher for a window the user could neither see nor
//! close. Nothing reclaims those on its own, and the next launch is the only
//! thing positioned to notice.
//!
//! **The test is whether the editor window still exists, not whether it is
//! visible.** Visibility is the wrong signal in both directions:
//!
//! * Every Inkpen process also owns a 15x15 `Tao Thread Event Target` helper
//!   window, and that one reports `IsWindowVisible = true` even in an orphan.
//!   A process with "a visible window" therefore says nothing at all.
//! * A window minimised for weeks keeps `WS_VISIBLE` set — minimised is not
//!   hidden on Windows — so a visibility test would reap a session the user
//!   deliberately left running.
//!
//! Matching on the editor window's *class* separates the two cleanly, and is
//! the whole safety argument: a process is closed only when the window it
//! exists to serve is gone, which is exactly the state no user can recover from.
//!
//! The class name is read back from our own window rather than written down
//! here, so a future tao release that renames it degrades into reaping nothing
//! rather than into terminating every healthy instance.
//!
//! Terminating costs no work. Journal appends are ordinary buffered writes and
//! the OS page cache owns them, so they outlive the process that made them (see
//! `journal.rs`); whatever the orphan had unsaved is offered back as a recovery
//! on the next start.

use std::sync::Mutex;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

/// Young processes are never touched. A starting instance has not created its
/// window yet, and would otherwise be indistinguishable from an orphan by the
/// only test we have.
const MIN_AGE: Duration = Duration::from_secs(10 * 60);

/// Lines for the frontend to write to `errors.log` once it is up. Reaping
/// happens before there is a frontend to log through, and routing it back keeps
/// one timestamped log format instead of two.
static NOTES: Mutex<Vec<String>> = Mutex::new(Vec::new());

fn note(line: String) {
    if let Ok(mut n) = NOTES.lock() {
        n.push(line);
    }
}

/// Drains the startup notes. Called once, by the frontend, at boot.
pub fn take_notes() -> Vec<String> {
    NOTES.lock().map(|mut n| std::mem::take(&mut *n)).unwrap_or_default()
}

#[cfg(not(windows))]
pub fn reap_orphans(_main_hwnd: isize) {}

#[cfg(windows)]
pub fn reap_orphans(main_hwnd: isize) {
    use windows_sys::Win32::Foundation::{CloseHandle, FILETIME, INVALID_HANDLE_VALUE};
    use windows_sys::Win32::System::Diagnostics::ToolHelp::{
        CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W,
        TH32CS_SNAPPROCESS,
    };
    use windows_sys::Win32::System::Threading::{
        GetCurrentProcessId, GetProcessTimes, OpenProcess, QueryFullProcessImageNameW,
        TerminateProcess, PROCESS_QUERY_LIMITED_INFORMATION, PROCESS_TERMINATE,
    };

    // Without our own class there is no test to apply, and guessing one would
    // put every running instance at risk. Doing nothing is the correct failure.
    let Some(class) = window_class(main_hwnd) else {
        return;
    };
    if class.is_empty() {
        return;
    }

    let Ok(exe) = std::env::current_exe() else { return };
    let Some(exe_name) = exe.file_name().and_then(|n| n.to_str()).map(str::to_owned) else {
        return;
    };
    let exe_path = exe.to_string_lossy().to_lowercase();

    let alive = pids_owning_class(&class);
    let me = unsafe { GetCurrentProcessId() };

    // Candidates by image name first: opening every process on the machine to
    // ask its path would be both slower and noisier in the security log.
    let mut candidates = Vec::new();
    unsafe {
        let snap = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
        if snap == INVALID_HANDLE_VALUE {
            return;
        }
        let mut entry: PROCESSENTRY32W = std::mem::zeroed();
        entry.dwSize = std::mem::size_of::<PROCESSENTRY32W>() as u32;
        if Process32FirstW(snap, &mut entry) != 0 {
            loop {
                if wide_to_string(&entry.szExeFile).eq_ignore_ascii_case(&exe_name)
                    && entry.th32ProcessID != me
                {
                    candidates.push(entry.th32ProcessID);
                }
                if Process32NextW(snap, &mut entry) == 0 {
                    break;
                }
            }
        }
        CloseHandle(snap);
    }

    let now_ticks = filetime_now();

    for pid in candidates {
        if alive.contains(&pid) {
            continue;
        }

        unsafe {
            let handle = OpenProcess(
                PROCESS_QUERY_LIMITED_INFORMATION | PROCESS_TERMINATE,
                0,
                pid,
            );
            if handle.is_null() {
                continue;
            }

            // Same name is not the same program. Another Inkpen build, or an
            // unrelated `inkpen.exe`, is none of our business.
            let mut buf = vec![0u16; 1024];
            let mut len = buf.len() as u32;
            let got = QueryFullProcessImageNameW(handle, 0, buf.as_mut_ptr(), &mut len);
            let same_exe = got != 0
                && String::from_utf16_lossy(&buf[..len as usize]).to_lowercase() == exe_path;

            let age = process_age(handle, now_ticks);

            if same_exe && age.map_or(false, |a| a >= MIN_AGE) {
                if TerminateProcess(handle, 0) != 0 {
                    let hours = age.unwrap_or_default().as_secs_f64() / 3600.0;
                    note(format!(
                        "closed an orphaned instance — pid={pid} had no editor window \
                         and had been running {hours:.1}h"
                    ));
                }
            }

            CloseHandle(handle);
        }
    }

    #[cfg(windows)]
    unsafe fn process_age(handle: windows_sys::Win32::Foundation::HANDLE, now: u64) -> Option<Duration> {
        let mut created = FILETIME { dwLowDateTime: 0, dwHighDateTime: 0 };
        let mut exited = created;
        let mut kernel = created;
        let mut user = created;
        if GetProcessTimes(handle, &mut created, &mut exited, &mut kernel, &mut user) == 0 {
            return None;
        }
        let started = ((created.dwHighDateTime as u64) << 32) | created.dwLowDateTime as u64;
        Some(Duration::from_secs(now.saturating_sub(started) / 10_000_000))
    }
}

/// The current time as a FILETIME tick count — 100ns intervals since 1601.
#[cfg(windows)]
fn filetime_now() -> u64 {
    const EPOCH_DIFF_SECS: u64 = 11_644_473_600;
    let unix = SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default();
    (unix.as_secs() + EPOCH_DIFF_SECS) * 10_000_000 + (unix.subsec_nanos() as u64 / 100)
}

#[cfg(windows)]
fn wide_to_string(buf: &[u16]) -> String {
    let end = buf.iter().position(|&c| c == 0).unwrap_or(buf.len());
    String::from_utf16_lossy(&buf[..end])
}

#[cfg(windows)]
fn window_class(hwnd: isize) -> Option<String> {
    use windows_sys::Win32::UI::WindowsAndMessaging::GetClassNameW;

    let mut buf = [0u16; 256];
    let n = unsafe { GetClassNameW(hwnd as _, buf.as_mut_ptr(), buf.len() as i32) };
    if n <= 0 {
        return None;
    }
    Some(String::from_utf16_lossy(&buf[..n as usize]))
}

/// Every process that still owns a top-level window of the given class.
#[cfg(windows)]
fn pids_owning_class(class: &str) -> Vec<u32> {
    use windows_sys::Win32::Foundation::{HWND, LPARAM};
    use windows_sys::Win32::UI::WindowsAndMessaging::{EnumWindows, GetWindowThreadProcessId};

    struct Scan {
        class: String,
        pids: Vec<u32>,
    }

    unsafe extern "system" fn visit(hwnd: HWND, param: LPARAM) -> i32 {
        let scan = &mut *(param as *mut Scan);
        if window_class(hwnd as isize).as_deref() == Some(scan.class.as_str()) {
            let mut pid = 0u32;
            GetWindowThreadProcessId(hwnd, &mut pid);
            if pid != 0 && !scan.pids.contains(&pid) {
                scan.pids.push(pid);
            }
        }
        1 // keep enumerating
    }

    let mut scan = Scan { class: class.to_string(), pids: Vec::new() };
    unsafe { EnumWindows(Some(visit), &mut scan as *mut Scan as LPARAM) };
    scan.pids
}
