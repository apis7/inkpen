//! Settings live in `%APPDATA%\Inkpen\settings.toml` (configuration, roams).
//! Session lives in `%LOCALAPPDATA%\Inkpen\session.json` (cache, does not roam).

use serde_json::Value;
use std::fs;

use crate::error::{ErrorKind, InkpenError, Result};

use crate::paths::{config_dir, data_dir};

#[tauri::command]
pub fn settings_path() -> Result<String> {
    Ok(config_dir()?.join("settings.toml").display().to_string())
}

/// Returns the settings as JSON. Unknown keys survive the round trip, so
/// hand-editing the TOML never loses content.
#[tauri::command]
pub fn settings_load() -> Result<Value> {
    let path = config_dir()?.join("settings.toml");
    if !path.exists() {
        return Ok(Value::Object(Default::default()));
    }
    let text = fs::read_to_string(&path)?;
    let parsed: toml::Value = toml::from_str(&text).map_err(|e| {
        InkpenError::new(ErrorKind::Io, format!("settings.toml is not valid TOML: {e}"))
    })?;
    serde_json::to_value(parsed)
        .map_err(|e| InkpenError::new(ErrorKind::Io, format!("Could not read settings: {e}")))
}

#[tauri::command]
pub fn settings_save(settings: Value) -> Result<()> {
    let path = config_dir()?.join("settings.toml");
    let as_toml: toml::Value = serde_json::from_value(settings)
        .map_err(|e| InkpenError::new(ErrorKind::Io, format!("Could not convert settings: {e}")))?;
    let text = toml::to_string_pretty(&as_toml)
        .map_err(|e| InkpenError::new(ErrorKind::Io, format!("Could not write settings: {e}")))?;
    fs::write(&path, text)?;
    Ok(())
}

/// Every `.toml` in `%APPDATA%\Inkpen\themes\`, parsed to JSON. Validation and
/// token filtering happen on the frontend, which owns the token vocabulary.
#[tauri::command]
pub fn themes_list() -> Result<Vec<Value>> {
    let dir = config_dir()?.join("themes");
    if !dir.exists() {
        fs::create_dir_all(&dir).ok();
        return Ok(Vec::new());
    }
    let mut out = Vec::new();
    for entry in fs::read_dir(&dir)? {
        let Ok(entry) = entry else { continue };
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("toml") {
            continue;
        }
        // A malformed theme is skipped, never fatal — one bad file must not
        // stop the others loading.
        let Ok(text) = fs::read_to_string(&path) else { continue };
        let Ok(parsed) = toml::from_str::<toml::Value>(&text) else { continue };
        if let Ok(mut json) = serde_json::to_value(parsed) {
            if json.get("name").is_none() {
                if let Some(stem) = path.file_stem().and_then(|s| s.to_str()) {
                    if let Some(obj) = json.as_object_mut() {
                        obj.insert("name".into(), Value::String(stem.to_string()));
                    }
                }
            }
            out.push(json);
        }
    }
    Ok(out)
}

#[tauri::command]
pub fn themes_dir() -> Result<String> {
    let dir = config_dir()?.join("themes");
    fs::create_dir_all(&dir).ok();
    Ok(dir.display().to_string())
}

#[tauri::command]
pub fn session_load() -> Result<Value> {
    let path = data_dir()?.join("session.json");
    if !path.exists() {
        return Ok(Value::Null);
    }
    let text = fs::read_to_string(&path)?;
    // A corrupt session is a cache miss, never an error the user has to see.
    Ok(serde_json::from_str(&text).unwrap_or(Value::Null))
}

#[tauri::command]
pub fn session_save(session: Value) -> Result<()> {
    let path = data_dir()?.join("session.json");
    let text = serde_json::to_string(&session)
        .map_err(|e| InkpenError::new(ErrorKind::Io, format!("Could not write session: {e}")))?;
    fs::write(&path, text)?;
    Ok(())
}
