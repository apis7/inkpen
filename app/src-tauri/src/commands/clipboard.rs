//! Terminal-safe clipboard.
//!
//! `Ctrl+C` writes `CF_UNICODETEXT` and nothing else — exactly what Notepad does,
//! and exactly why Notepad always pastes cleanly into a terminal while richer
//! editors often do not. Rich copy is a separate, explicit command that adds an
//! `CF_HTML` flavour *alongside* the plain one, so the default can never regress
//! into emitting markup.

use crate::error::{ErrorKind, InkpenError, Result};

#[cfg(windows)]
mod win {
    use super::*;
    use std::ffi::OsStr;
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Foundation::{GlobalFree, HANDLE};
    use windows_sys::Win32::System::DataExchange::{
        CloseClipboard, EmptyClipboard, OpenClipboard, RegisterClipboardFormatW, SetClipboardData,
    };
    use windows_sys::Win32::System::Memory::{GlobalAlloc, GlobalLock, GlobalUnlock, GMEM_MOVEABLE};

    const CF_UNICODETEXT: u32 = 13;

    /// Copies `bytes` into a moveable global block the clipboard can take ownership of.
    unsafe fn global_from(bytes: &[u8]) -> Result<HANDLE> {
        let h = GlobalAlloc(GMEM_MOVEABLE, bytes.len());
        if h.is_null() {
            return Err(InkpenError::new(ErrorKind::Io, "Could not allocate clipboard memory"));
        }
        let dst = GlobalLock(h);
        if dst.is_null() {
            GlobalFree(h);
            return Err(InkpenError::new(ErrorKind::Io, "Could not lock clipboard memory"));
        }
        std::ptr::copy_nonoverlapping(bytes.as_ptr(), dst as *mut u8, bytes.len());
        GlobalUnlock(h);
        Ok(h as HANDLE)
    }

    fn utf16_nul(text: &str) -> Vec<u8> {
        let units: Vec<u16> = OsStr::new(text).encode_wide().chain(std::iter::once(0)).collect();
        let mut out = Vec::with_capacity(units.len() * 2);
        for u in units {
            out.extend_from_slice(&u.to_le_bytes());
        }
        out
    }

    /// CF_HTML carries a fixed-width header of byte offsets into itself, so the
    /// offsets can only be filled in once the header's own length is known.
    fn cf_html(fragment: &str) -> Vec<u8> {
        const HEADER: &str = "Version:0.9\r\nStartHTML:{:09}\r\nEndHTML:{:09}\r\nStartFragment:{:09}\r\nEndFragment:{:09}\r\n";
        let prefix = "<html><body>\r\n<!--StartFragment-->";
        let suffix = "<!--EndFragment-->\r\n</body></html>";

        // The template renders to a constant width because every field is zero-padded to 9.
        let header_len = HEADER.replace("{:09}", "000000000").len();
        let start_html = header_len;
        let start_fragment = start_html + prefix.len();
        let end_fragment = start_fragment + fragment.len();
        let end_html = end_fragment + suffix.len();

        let header = format!(
            "Version:0.9\r\nStartHTML:{:09}\r\nEndHTML:{:09}\r\nStartFragment:{:09}\r\nEndFragment:{:09}\r\n",
            start_html, end_html, start_fragment, end_fragment
        );
        debug_assert_eq!(header.len(), header_len);

        format!("{header}{prefix}{fragment}{suffix}").into_bytes()
    }

    pub fn write(text: &str, html: Option<&str>) -> Result<()> {
        unsafe {
            if OpenClipboard(std::ptr::null_mut()) == 0 {
                return Err(InkpenError::new(ErrorKind::Locked, "Another program is holding the clipboard"));
            }
            // Everything past this point must reach CloseClipboard.
            let result = (|| -> Result<()> {
                if EmptyClipboard() == 0 {
                    return Err(InkpenError::new(ErrorKind::Io, "Could not clear the clipboard"));
                }

                let plain = global_from(&utf16_nul(text))?;
                if SetClipboardData(CF_UNICODETEXT, plain).is_null() {
                    GlobalFree(plain);
                    return Err(InkpenError::new(ErrorKind::Io, "Could not write text to the clipboard"));
                }

                if let Some(html) = html {
                    let fmt = RegisterClipboardFormatW(
                        OsStr::new("HTML Format")
                            .encode_wide()
                            .chain(std::iter::once(0))
                            .collect::<Vec<u16>>()
                            .as_ptr(),
                    );
                    if fmt != 0 {
                        let rich = global_from(&cf_html(html))?;
                        if SetClipboardData(fmt, rich).is_null() {
                            // Plain text is already on the clipboard; losing the rich
                            // flavour is not worth failing the whole copy over.
                            GlobalFree(rich);
                        }
                    }
                }
                Ok(())
            })();
            CloseClipboard();
            result
        }
    }
}

/// Plain UTF-8 text only. This is what `Ctrl+C` calls.
#[tauri::command]
pub fn copy_plain(text: String) -> Result<()> {
    #[cfg(windows)]
    {
        win::write(&text, None)
    }
    #[cfg(not(windows))]
    {
        let _ = text;
        Err(InkpenError::new(ErrorKind::Io, "Clipboard is only implemented on Windows"))
    }
}

/// Plain text *and* an HTML flavour. Word and Outlook take the rich one;
/// terminals take the plain one.
#[tauri::command]
pub fn copy_rich(text: String, html: String) -> Result<()> {
    #[cfg(windows)]
    {
        win::write(&text, Some(&html))
    }
    #[cfg(not(windows))]
    {
        let _ = (text, html);
        Err(InkpenError::new(ErrorKind::Io, "Clipboard is only implemented on Windows"))
    }
}
