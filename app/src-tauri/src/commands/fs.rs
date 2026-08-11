use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

use crate::error::{ErrorKind, InkpenError, Result};
use crate::model::{language_for, Encoding, FileMeta, FileOpen, LineEnding, SaveResult};

/// Anything above this opens without a syntax tree. See ARCHITECTURE §9.
const FAST_MODE_BYTES: u64 = 10 * 1024 * 1024;
/// Detection only ever inspects the head of a file; a 2GB log must not be sniffed whole.
const SNIFF_BYTES: usize = 64 * 1024;

// ---------------------------------------------------------------- encoding --

fn detect_encoding(bytes: &[u8]) -> Encoding {
    if bytes.starts_with(&[0xEF, 0xBB, 0xBF]) {
        return Encoding::Utf8Bom;
    }
    if bytes.starts_with(&[0xFF, 0xFE]) {
        return Encoding::Utf16Le;
    }
    if bytes.starts_with(&[0xFE, 0xFF]) {
        return Encoding::Utf16Be;
    }
    if std::str::from_utf8(&bytes[..bytes.len().min(SNIFF_BYTES)]).is_ok() {
        return Encoding::Utf8;
    }

    // Not valid UTF-8 — let chardetng vote, but only between the encodings we support.
    let mut det = chardetng::EncodingDetector::new();
    det.feed(&bytes[..bytes.len().min(SNIFF_BYTES)], true);
    match det.guess(None, true).name() {
        "UTF-8" => Encoding::Utf8,
        _ => Encoding::Windows1252,
    }
}

fn decode(bytes: &[u8], enc: Encoding) -> Result<String> {
    let text = match enc {
        Encoding::Utf8 => String::from_utf8_lossy(bytes).into_owned(),
        Encoding::Utf8Bom => String::from_utf8_lossy(bytes.get(3..).unwrap_or(&[])).into_owned(),
        Encoding::Utf16Le => {
            let (s, _, _) = encoding_rs::UTF_16LE.decode(bytes.get(2..).unwrap_or(&[]));
            s.into_owned()
        }
        Encoding::Utf16Be => {
            let (s, _, _) = encoding_rs::UTF_16BE.decode(bytes.get(2..).unwrap_or(&[]));
            s.into_owned()
        }
        Encoding::Windows1252 => {
            let (s, _, had_errors) = encoding_rs::WINDOWS_1252.decode(bytes);
            if had_errors {
                return Err(InkpenError::new(
                    ErrorKind::InvalidEncoding,
                    "File could not be decoded as Windows-1252",
                ));
            }
            s.into_owned()
        }
    };
    Ok(text)
}

fn encode(text: &str, enc: Encoding) -> Vec<u8> {
    match enc {
        Encoding::Utf8 => text.as_bytes().to_vec(),
        Encoding::Utf8Bom => {
            let mut out = vec![0xEF, 0xBB, 0xBF];
            out.extend_from_slice(text.as_bytes());
            out
        }
        Encoding::Utf16Le => {
            let mut out = vec![0xFF, 0xFE];
            for u in text.encode_utf16() {
                out.extend_from_slice(&u.to_le_bytes());
            }
            out
        }
        Encoding::Utf16Be => {
            let mut out = vec![0xFE, 0xFF];
            for u in text.encode_utf16() {
                out.extend_from_slice(&u.to_be_bytes());
            }
            out
        }
        Encoding::Windows1252 => {
            let (bytes, _, _) = encoding_rs::WINDOWS_1252.encode(text);
            bytes.into_owned()
        }
    }
}

// ------------------------------------------------------------ line endings --

fn detect_line_ending(text: &str) -> LineEnding {
    let head = &text[..text.len().min(SNIFF_BYTES)];
    let crlf = head.matches("\r\n").count();
    let lf = head.matches('\n').count() - crlf;

    match (crlf, lf) {
        (0, 0) => LineEnding::Crlf, // no newlines at all — Windows default
        (c, 0) if c > 0 => LineEnding::Crlf,
        (0, _) => LineEnding::Lf,
        // Both present. A handful of strays is not "mixed"; a real split is.
        (c, l) => {
            let minority = c.min(l) as f64;
            let total = (c + l) as f64;
            if minority / total > 0.05 {
                LineEnding::Mixed
            } else if c > l {
                LineEnding::Crlf
            } else {
                LineEnding::Lf
            }
        }
    }
}

/// The editor only ever sees LF. Conversion happens at the disk boundary, which
/// removes an entire class of column-arithmetic bugs.
fn to_lf(text: &str) -> String {
    if text.contains('\r') {
        text.replace("\r\n", "\n").replace('\r', "\n")
    } else {
        text.to_string()
    }
}

fn from_lf(text: &str, ending: LineEnding) -> String {
    match ending {
        LineEnding::Lf => text.to_string(),
        _ => text.replace('\n', ending.sequence()),
    }
}

// ------------------------------------------------------------------ helpers --

fn mtime_millis(meta: &fs::Metadata) -> i64 {
    meta.modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

fn file_name(path: &Path) -> String {
    path.file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("Untitled")
        .to_string()
}

// ----------------------------------------------------------------- commands --

#[tauri::command]
pub fn open_file(path: String) -> Result<FileOpen> {
    let p = PathBuf::from(&path);
    let meta = fs::metadata(&p).map_err(|e| InkpenError::from(e).with_path(path.clone()))?;

    if meta.is_dir() {
        return Err(InkpenError::new(ErrorKind::Io, "That is a folder, not a file")
            .with_path(path.clone()));
    }

    let bytes = fs::read(&p).map_err(|e| InkpenError::from(e).with_path(path.clone()))?;
    let encoding = detect_encoding(&bytes);
    let raw = decode(&bytes, encoding)?;
    let line_ending = detect_line_ending(&raw);
    let content = to_lf(&raw);

    Ok(FileOpen {
        name: file_name(&p),
        content,
        encoding,
        line_ending,
        size: meta.len(),
        mtime: mtime_millis(&meta),
        read_only: meta.permissions().readonly(),
        fast_mode: meta.len() > FAST_MODE_BYTES,
        language: language_for(&path),
        path,
    })
}

#[tauri::command]
pub fn file_metadata(path: String) -> Result<FileMeta> {
    let meta = fs::metadata(&path).map_err(|e| InkpenError::from(e).with_path(path.clone()))?;
    Ok(FileMeta {
        mtime: mtime_millis(&meta),
        size: meta.len(),
        read_only: meta.permissions().readonly(),
    })
}

/// Atomic save. Temp file in the same directory, fsync, then swap.
///
/// `expected_mtime` is the staleness guard: pass the mtime the frontend last saw,
/// or `None` for a brand-new file. A mismatch aborts rather than clobbering an
/// edit made by another program.
#[tauri::command]
pub fn save_file(
    path: String,
    content: String,
    encoding: Encoding,
    line_ending: LineEnding,
    expected_mtime: Option<i64>,
) -> Result<SaveResult> {
    let target = PathBuf::from(&path);

    let existing = fs::metadata(&target).ok();
    if let (Some(expected), Some(meta)) = (expected_mtime, existing.as_ref()) {
        let actual = mtime_millis(meta);
        // A one-second slop absorbs filesystems with coarse timestamps.
        if (actual - expected).abs() > 1000 {
            return Err(InkpenError::stale("This file changed on disk since you opened it")
                .with_path(path.clone()));
        }
    }

    if let Some(meta) = existing.as_ref() {
        if meta.permissions().readonly() {
            return Err(InkpenError::new(
                ErrorKind::PermissionDenied,
                "This file is read-only",
            )
            .with_path(path.clone()));
        }
    }

    let dir = target.parent().ok_or_else(|| {
        InkpenError::new(ErrorKind::Io, "Cannot determine the containing folder")
    })?;
    fs::create_dir_all(dir).ok();

    let bytes = encode(&from_lf(&content, line_ending), encoding);

    // Temp lives beside the target so the swap stays on one volume and stays atomic.
    let tmp = dir.join(format!(".{}.inkpen-tmp", file_name(&target)));
    {
        let mut f = fs::File::create(&tmp)
            .map_err(|e| InkpenError::from(e).with_path(tmp.display().to_string()))?;
        f.write_all(&bytes).map_err(|e| {
            let _ = fs::remove_file(&tmp);
            InkpenError::from(e).with_path(tmp.display().to_string())
        })?;
        // The bytes must be durable before anything is swapped.
        f.sync_all().map_err(|e| {
            let _ = fs::remove_file(&tmp);
            InkpenError::from(e).with_path(tmp.display().to_string())
        })?;
    }

    if let Err(e) = swap_into_place(&tmp, &target, existing.is_some()) {
        let _ = fs::remove_file(&tmp);
        return Err(e.with_path(path.clone()));
    }

    // Register before returning, so the watch event our own write is about to
    // produce is recognised as ours and never reaches the frontend.
    super::watch::note_self_write(&target);

    let meta = fs::metadata(&target)?;
    Ok(SaveResult {
        name: file_name(&target),
        mtime: mtime_millis(&meta),
        size: meta.len(),
        path,
    })
}

/// `ReplaceFileW` rather than a plain rename: a rename replaces the file *object*,
/// discarding the original's ACLs, alternate data streams, compression flag and
/// creation time. Users notice when a file silently loses its permissions.
#[cfg(windows)]
fn swap_into_place(tmp: &Path, target: &Path, target_exists: bool) -> Result<()> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Storage::FileSystem::ReplaceFileW;

    if !target_exists {
        // Nothing to preserve; a rename is correct and cheaper.
        fs::rename(tmp, target)?;
        return Ok(());
    }

    fn wide(p: &Path) -> Vec<u16> {
        p.as_os_str().encode_wide().chain(std::iter::once(0)).collect()
    }

    let replaced = wide(target);
    let replacement = wide(tmp);

    // SAFETY: both pointers are NUL-terminated wide strings that outlive the call.
    let ok = unsafe {
        ReplaceFileW(
            replaced.as_ptr(),
            replacement.as_ptr(),
            std::ptr::null(),
            0,
            std::ptr::null(),
            std::ptr::null(),
        )
    };

    if ok == 0 {
        // Fall back to a rename so a ReplaceFileW refusal never costs the user data.
        fs::rename(tmp, target)?;
    }
    Ok(())
}

#[cfg(not(windows))]
fn swap_into_place(tmp: &Path, target: &Path, _target_exists: bool) -> Result<()> {
    fs::rename(tmp, target)?;
    Ok(())
}

#[tauri::command]
pub fn reveal_in_explorer(path: String) -> Result<()> {
    #[cfg(windows)]
    {
        std::process::Command::new("explorer")
            .arg(format!("/select,{}", path))
            .spawn()
            .map_err(InkpenError::from)?;
    }
    #[cfg(not(windows))]
    let _ = path;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A file opened and saved with no edits must be byte-identical.
    #[test]
    fn round_trips_every_encoding() {
        // Non-ASCII throughout: ASCII-only bytes are identical in UTF-8 and
        // Windows-1252, so they cannot distinguish the two by construction.
        let text = "café — naïve\nrésumé\n";
        for enc in [
            Encoding::Utf8,
            Encoding::Utf8Bom,
            Encoding::Utf16Le,
            Encoding::Utf16Be,
            Encoding::Windows1252,
        ] {
            let bytes = encode(text, enc);
            assert_eq!(detect_encoding(&bytes), enc, "detect {:?}", enc);
            assert_eq!(decode(&bytes, enc).unwrap(), text, "decode {:?}", enc);
            assert_eq!(encode(&decode(&bytes, enc).unwrap(), enc), bytes, "round trip {:?}", enc);
        }
    }

    /// Pure ASCII is genuinely ambiguous. UTF-8 is the correct answer, and
    /// saving it back must not corrupt anything.
    #[test]
    fn ascii_is_detected_as_utf8() {
        let bytes = b"plain ascii\n".to_vec();
        assert_eq!(detect_encoding(&bytes), Encoding::Utf8);
        assert_eq!(encode(&decode(&bytes, Encoding::Windows1252).unwrap(), Encoding::Windows1252), bytes);
    }

    #[test]
    fn empty_file_does_not_panic() {
        for enc in [Encoding::Utf8, Encoding::Utf8Bom, Encoding::Utf16Le, Encoding::Utf16Be] {
            assert_eq!(decode(&[], enc).unwrap(), "");
        }
    }

    #[test]
    fn detects_line_endings() {
        assert_eq!(detect_line_ending("a\r\nb\r\n"), LineEnding::Crlf);
        assert_eq!(detect_line_ending("a\nb\n"), LineEnding::Lf);
        assert_eq!(detect_line_ending("no newline"), LineEnding::Crlf);
        assert_eq!(detect_line_ending("a\r\nb\nc\nd\ne\n"), LineEnding::Mixed);
    }

    #[test]
    fn a_stray_crlf_is_not_mixed() {
        let mut s = String::from("a\r\n");
        for _ in 0..100 {
            s.push_str("b\n");
        }
        assert_eq!(detect_line_ending(&s), LineEnding::Lf);
    }

    #[test]
    fn lf_conversion_round_trips() {
        let original = "a\r\nb\r\nc";
        let lf = to_lf(original);
        assert_eq!(lf, "a\nb\nc");
        assert_eq!(from_lf(&lf, LineEnding::Crlf), original);
    }
}
