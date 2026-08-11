use serde::Serialize;
use std::fmt;

/// Machine-readable failure classes. The frontend switches on `kind`; `message`
/// is what the notice bar shows the user.
///
/// The full set is part of the IPC contract mirrored in `src/ipc/types.ts`, so
/// variants stay declared even before a call site raises them.
#[allow(dead_code)]
#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ErrorKind {
    NotFound,
    PermissionDenied,
    Locked,
    DiskFull,
    InvalidEncoding,
    TooLarge,
    Stale,
    Cancelled,
    Io,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InkpenError {
    pub kind: ErrorKind,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
}

impl InkpenError {
    pub fn new(kind: ErrorKind, message: impl Into<String>) -> Self {
        Self { kind, message: message.into(), path: None }
    }

    pub fn with_path(mut self, path: impl Into<String>) -> Self {
        self.path = Some(path.into());
        self
    }

    pub fn stale(message: impl Into<String>) -> Self {
        Self::new(ErrorKind::Stale, message)
    }
}

impl fmt::Display for InkpenError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", self.message)
    }
}

impl std::error::Error for InkpenError {}

impl From<std::io::Error> for InkpenError {
    fn from(e: std::io::Error) -> Self {
        use std::io::ErrorKind as K;
        let kind = match e.kind() {
            K::NotFound => ErrorKind::NotFound,
            K::PermissionDenied => ErrorKind::PermissionDenied,
            // Windows surfaces sharing violations as `Other`; the raw code disambiguates.
            _ => match e.raw_os_error() {
                Some(32) | Some(33) => ErrorKind::Locked,
                Some(39) | Some(112) => ErrorKind::DiskFull,
                _ => ErrorKind::Io,
            },
        };
        Self::new(kind, e.to_string())
    }
}

pub type Result<T> = std::result::Result<T, InkpenError>;
