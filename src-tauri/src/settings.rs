//! settings — port of src/main/settings.ts (task #3, owner: worker-persist).
//!
//! To preserve: Settings.json deep-merge over defaults, per-key type check,
//! clamps (tintOpacity 0..1, tabIndents ∈ {-1,2,4,8}, editorFontSize>0,
//! wallpaperEffect enum), atomic write, broadcast
//! `notepads:evt:settings:changed` to ALL windows, openWithContextMenu side
//! effect (context_menu.rs).
//!
//! Exposes `settings_get_internal()` for cross-module use (wallpaper, shell
//! etc.) without the event broadcast overhead.

use std::fs;
use std::path::PathBuf;

use tauri::Emitter;
use tauri::Manager;

use crate::contract::Settings;
use crate::context_menu;
use crate::result::NpResult;

const SETTINGS_FILE_NAME: &str = "Settings.json";

/// Resolve the userData root. Honors NOTEPADS_E2E_USERDATA override.
fn app_data_dir(app: &tauri::AppHandle) -> PathBuf {
    if let Ok(ov) = std::env::var("NOTEPADS_E2E_USERDATA") {
        if !ov.is_empty() {
            return PathBuf::from(ov);
        }
    }
    app.path()
        .app_data_dir()
        .expect("app_data_dir should exist")
}

fn settings_file_path(app: &tauri::AppHandle) -> PathBuf {
    app_data_dir(app).join(SETTINGS_FILE_NAME)
}

/// Deep-merge a (possibly partial / untrusted) JSON Value over a base
/// Settings-serialized Value. Only keys present in `base` are considered,
/// so unknown keys from an old/foreign file are dropped and the merged
/// result always conforms to `Settings`. Nested plain objects are merged
/// recursively; everything else is taken from `patch` when present (and
/// of the same JSON type) else from `base`.
fn deep_merge(base: &mut serde_json::Value, patch: &serde_json::Value) {
    if !patch.is_object() || !base.is_object() {
        return;
    }
    let base_obj = base.as_object_mut().unwrap();
    let patch_obj = patch.as_object().unwrap();

    for (key, base_val) in base_obj.iter_mut() {
        let Some(patch_val) = patch_obj.get(key) else {
            continue;
        };
        // If both are objects (not arrays), recurse
        if base_val.is_object()
            && !matches!(base_val, serde_json::Value::Array(_))
            && patch_val.is_object()
            && !matches!(patch_val, serde_json::Value::Array(_))
        {
            deep_merge(base_val, patch_val);
        } else if same_json_type(base_val, patch_val) && !patch_val.is_null() {
            *base_val = patch_val.clone();
        }
    }
}

/// Check that two JSON values have the same variant (type check, not value check).
fn same_json_type(a: &serde_json::Value, b: &serde_json::Value) -> bool {
    use serde_json::Value;
    matches!(
        (a, b),
        (Value::Null, Value::Null)
            | (Value::Bool(_), Value::Bool(_))
            | (Value::Number(_), Value::Number(_))
            | (Value::String(_), Value::String(_))
            | (Value::Array(_), Value::Array(_))
            | (Value::Object(_), Value::Object(_))
    )
}

/// Defensive clamping of the obviously-bounded fields.
fn clamp_settings(s: Settings) -> Settings {
    let tint_opacity = if f64::is_finite(s.tint_opacity) {
        s.tint_opacity.clamp(0.0, 1.0)
    } else {
        Settings::default().tint_opacity
    };
    let editor_font_size = if f64::is_finite(s.editor_font_size) && s.editor_font_size > 0.0 {
        s.editor_font_size
    } else {
        Settings::default().editor_font_size
    };
    let tab_indents = if matches!(s.tab_indents, -1 | 2 | 4 | 8) {
        s.tab_indents
    } else {
        Settings::default().tab_indents
    };
    let wallpaper_effect = if matches!(s.wallpaper_effect.as_str(), "blur" | "opacity") {
        s.wallpaper_effect
    } else {
        Settings::default().wallpaper_effect
    };

    Settings {
        tint_opacity,
        editor_font_size,
        tab_indents,
        wallpaper_effect,
        ..s
    }
}

/// Read the persisted settings from disk and deep-merge over defaults.
/// Corrupt/missing file → return defaults (never errors).
fn read_settings_from_disk(app: &tauri::AppHandle) -> Settings {
    let path = settings_file_path(app);
    let raw = match fs::read_to_string(&path) {
        Ok(r) => r,
        Err(_) => return Settings::default(),
    };

    let parsed: serde_json::Value = match serde_json::from_str(&raw) {
        Ok(v) => v,
        Err(_) => return Settings::default(),
    };

    // Start with defaults serialized as JSON, then deep-merge the parsed file over it.
    let mut base = serde_json::to_value(Settings::default())
        .unwrap_or(serde_json::json!({}));
    if parsed.is_object() {
        deep_merge(&mut base, &parsed);
    }

    let merged: Settings = match serde_json::from_value(base) {
        Ok(s) => s,
        Err(_) => return Settings::default(),
    };

    clamp_settings(merged)
}

/// Atomic write: serialize to a sibling tmp file then rename over the target, so
/// a crash mid-write can never leave a truncated Settings.json.
fn write_atomic(target_path: &std::path::Path, contents: &str) -> Result<(), String> {
    let pid = std::process::id();
    let tmp_path = target_path.with_file_name(format!(
        "Settings.json.{pid}.tmp"
    ));

    // Ensure parent directory exists
    if let Some(parent) = tmp_path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("Failed to create dir: {e}"))?;
    }

    // Write to tmp file
    fs::write(&tmp_path, contents).map_err(|e| format!("Failed to write tmp settings: {e}"))?;

    // Atomic rename
    fs::rename(&tmp_path, target_path).map_err(|e| {
        // Best-effort cleanup of tmp file on failed rename
        let _ = fs::remove_file(&tmp_path);
        format!("Failed to rename settings: {e}")
    })
}

/// Broadcast the merged settings to every window via `notepads:evt:settings:changed`.
fn broadcast_settings_changed(app: &tauri::AppHandle, settings: &Settings) {
    if let Err(e) = app.emit("notepads:evt:settings:changed", settings) {
        log::warn!("Failed to broadcast settings changed: {e}");
    }
}

// ---------------------------------------------------------------------------
//  Public API
// ---------------------------------------------------------------------------

/// Internal (non-command) read for cross-module use (wallpaper, shell, etc.).
/// Always returns the merged+clamped settings; never errors (returns defaults
/// on failure).
pub fn settings_get_internal(app: &tauri::AppHandle) -> Result<Settings, String> {
    Ok(read_settings_from_disk(app))
}

/// Tauri command: read the full persisted settings.
#[tauri::command]
pub async fn settings_get(app: tauri::AppHandle) -> NpResult<Settings> {
    NpResult::Ok(read_settings_from_disk(&app))
}

/// Tauri command: merge `patch` over the current settings, persist atomically,
/// then broadcast the merged settings to every window. The returned value is
/// the authoritative merged-and-clamped Settings.
#[tauri::command]
pub async fn settings_set(
    app: tauri::AppHandle,
    patch: serde_json::Value,
) -> NpResult<Settings> {
    NpResult::from_result(settings_set_impl(&app, patch))
}

fn settings_set_impl(app: &tauri::AppHandle, patch: serde_json::Value) -> Result<Settings, String> {
    // Read current settings
    let current = read_settings_from_disk(app);

    // Convert current to JSON, deep-merge the patch
    let mut base = serde_json::to_value(&current)
        .map_err(|e| format!("Failed to serialize current settings: {e}"))?;
    deep_merge(&mut base, &patch);

    // Deserialize back to Settings (unknown keys are dropped, types checked)
    let merged: Settings = serde_json::from_value(base)
        .map_err(|e| format!("Invalid settings patch: {e}"))?;

    // Clamp
    let clamped = clamp_settings(merged);

    // Serialize for persistence (pretty-printed)
    let serialized = serde_json::to_string_pretty(&clamped)
        .map_err(|e| format!("Failed to serialize settings: {e}"))?;

    // Atomic write
    write_atomic(&settings_file_path(app), &serialized)
        .map_err(|e| format!("Failed to persist settings: {e}"))?;

    // Broadcast to all windows
    broadcast_settings_changed(app, &clamped);

    // Side effect: apply context menu if the patch touched openWithContextMenu
    if patch.get("openWithContextMenu").is_some() {
        let _ = context_menu::set_context_menu_enabled(clamped.open_with_context_menu);
    }

    Ok(clamped)
}
