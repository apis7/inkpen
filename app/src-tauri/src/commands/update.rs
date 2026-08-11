//! Update checking.
//!
//! Rust owns the throttle so the policy cannot be bypassed by frontend logic:
//! at most one check per `interval_days`, on launch, off the critical path.
//! Between checks there is no network activity at all.
//!
//! There is deliberately no auto-download and no silent install. Inkpen is not
//! code-signed (a decision recorded in the spec), so every install triggers a
//! SmartScreen prompt — pushing that at someone without asking would be worse
//! than making them click Download.

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

use crate::error::{ErrorKind, InkpenError, Result};

const CURRENT_VERSION: &str = env!("CARGO_PKG_VERSION");

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct UpdateState {
    last_check: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateCheck {
    /// False when the throttle window has not elapsed — no request was made.
    pub checked: bool,
    pub current: String,
    pub available: Option<String>,
    pub notes: Option<String>,
    pub url: Option<String>,
    pub next_check_in_days: i64,
}

#[derive(Debug, Deserialize)]
struct Manifest {
    version: String,
    #[serde(default)]
    notes: Option<String>,
    #[serde(default)]
    url: Option<String>,
}

fn state_path() -> Result<PathBuf> {
    let dir = crate::paths::data_dir()?;
    Ok(dir.join("update.json"))
}

fn now_secs() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

/// Semantic-ish comparison: numeric, component by component, shortest padded.
/// A plain string compare would rank "0.10.0" below "0.9.0".
pub fn is_newer(candidate: &str, current: &str) -> bool {
    fn parts(v: &str) -> Vec<u64> {
        v.trim_start_matches('v')
            .split(['.', '-', '+'])
            .map(|p| p.parse::<u64>().unwrap_or(0))
            .collect()
    }
    let (a, b) = (parts(candidate), parts(current));
    for i in 0..a.len().max(b.len()) {
        let x = a.get(i).copied().unwrap_or(0);
        let y = b.get(i).copied().unwrap_or(0);
        if x != y {
            return x > y;
        }
    }
    false
}

/// `force` skips the throttle for an explicit "Check for Updates".
/// `endpoint` empty means updates are disabled — the shipped default, since no
/// release server exists yet. Nothing is requested in that case.
#[tauri::command]
pub async fn check_update(
    force: bool,
    endpoint: String,
    interval_days: i64,
) -> Result<UpdateCheck> {
    let path = state_path()?;
    let mut state: UpdateState = fs::read_to_string(&path)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default();

    let interval = interval_days.max(1) * 24 * 60 * 60;
    let elapsed = now_secs() - state.last_check;
    let base = UpdateCheck {
        checked: false,
        current: CURRENT_VERSION.to_string(),
        available: None,
        notes: None,
        url: None,
        next_check_in_days: ((interval - elapsed).max(0)) / (24 * 60 * 60),
    };

    if endpoint.trim().is_empty() {
        return Ok(base);
    }
    if !force && elapsed < interval {
        return Ok(base);
    }

    // Record the attempt before the request, so a server that is down cannot
    // turn into a check on every single launch.
    state.last_check = now_secs();
    let _ = fs::write(&path, serde_json::to_string(&state).unwrap_or_default());

    let body = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(8))
        .build()
        .map_err(|e| InkpenError::new(ErrorKind::Io, e.to_string()))?
        .get(&endpoint)
        .send()
        .await
        .map_err(|e| InkpenError::new(ErrorKind::Io, format!("Update check failed: {e}")))?
        .text()
        .await
        .map_err(|e| InkpenError::new(ErrorKind::Io, format!("Update check failed: {e}")))?;

    let manifest: Manifest = serde_json::from_str(&body)
        .map_err(|e| InkpenError::new(ErrorKind::Io, format!("Bad update manifest: {e}")))?;

    let newer = is_newer(&manifest.version, CURRENT_VERSION);
    Ok(UpdateCheck {
        checked: true,
        current: CURRENT_VERSION.to_string(),
        available: newer.then(|| manifest.version.clone()),
        notes: newer.then(|| manifest.notes.clone()).flatten(),
        url: newer.then(|| manifest.url.clone()).flatten(),
        next_check_in_days: interval_days,
    })
}

#[cfg(test)]
mod tests {
    use super::is_newer;

    #[test]
    fn compares_numerically_not_lexically() {
        // The case a string compare gets wrong.
        assert!(is_newer("0.10.0", "0.9.0"));
        assert!(!is_newer("0.9.0", "0.10.0"));
    }

    #[test]
    fn detects_newer_versions() {
        assert!(is_newer("1.0.0", "0.9.9"));
        assert!(is_newer("0.1.1", "0.1.0"));
        assert!(is_newer("0.2.0", "0.1.99"));
    }

    #[test]
    fn rejects_same_or_older() {
        assert!(!is_newer("0.1.0", "0.1.0"));
        assert!(!is_newer("0.0.9", "0.1.0"));
    }

    #[test]
    fn tolerates_a_v_prefix_and_short_versions() {
        assert!(is_newer("v0.2.0", "0.1.0"));
        assert!(is_newer("2", "1.9.9"));
        assert!(!is_newer("1", "1.0.0"));
    }

    #[test]
    fn garbage_components_do_not_panic() {
        assert!(!is_newer("not.a.version", "0.1.0"));
        assert!(is_newer("0.2.0-beta", "0.1.0"));
    }
}
