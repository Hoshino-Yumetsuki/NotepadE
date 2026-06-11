//! session — port of src/main/session.ts (task #3, owner: worker-persist).
//!
//! To preserve: NotepadsSessionData.json v1 + BackupFiles/{id}-LastSaved /
//! -Pending (extensionless); dirty-check vs last JSON (case-insensitive);
//! corrupt → rename *-Corrupted.txt + delete JSON; loadLast re-stats paths →
//! unavailable:true; clearRecovered keeps Corrupted files.

use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::Manager;

use crate::contract::{SessionSnapshot, SessionTab, SnapshotResult};
use crate::result::NpResult;

const SESSION_FILE_NAME: &str = "NotepadsSessionData.json";
const BACKUP_FOLDER_NAME: &str = "BackupFiles";

// ---------------------------------------------------------------------------
//  Internal types
// ---------------------------------------------------------------------------

/// Per-tab backup content kept ONLY in main; never serialized into the JSON.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub(crate) struct TabBackupData {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    last_saved: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pending: Option<String>,
}

/// Ordered session JSON shape (version first, matching UWP serialization).
#[derive(Serialize)]
struct SessionFileFormat<'a> {
    version: u32,
    tabs: &'a [SessionTab],
    #[serde(skip_serializing_if = "Option::is_none")]
    active_editor_id: &'a Option<String>,
}

// ---------------------------------------------------------------------------
//  Path helpers
// ---------------------------------------------------------------------------

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

fn session_file_path(app: &tauri::AppHandle) -> PathBuf {
    app_data_dir(app).join(SESSION_FILE_NAME)
}

fn backup_folder_path(app: &tauri::AppHandle) -> PathBuf {
    app_data_dir(app).join(BACKUP_FOLDER_NAME)
}

fn last_saved_backup_name(editor_id: &str) -> String {
    format!("{editor_id}-LastSaved")
}

fn pending_backup_name(editor_id: &str) -> String {
    format!("{editor_id}-Pending")
}

// ---------------------------------------------------------------------------
//  In-memory dirty-check cache (mirrors UWP _lastSessionJsonStr)
// ---------------------------------------------------------------------------

/// Last serialized session JSON string, used for dirty-check.
static LAST_SESSION_JSON: Mutex<Option<String>> = Mutex::new(None);

fn last_json_str() -> Option<String> {
    LAST_SESSION_JSON.lock().unwrap_or_else(|p| p.into_inner()).clone()
}

fn set_last_json_str(s: Option<String>) {
    *LAST_SESSION_JSON.lock().unwrap_or_else(|p| p.into_inner()) = s;
}

// ---------------------------------------------------------------------------
//  Serialization
// ---------------------------------------------------------------------------

/// Serialize a snapshot to the on-disk JSON string. Only the contract surface
/// is written (version, tabs, activeEditorId). The `_backups` sidecar is
/// excluded — it goes into per-tab backup files.
fn serialize_for_disk(data: &SessionSnapshot) -> String {
    let ordered = SessionFileFormat {
        version: 1,
        tabs: &data.tabs,
        active_editor_id: &data.active_editor_id,
    };
    serde_json::to_string_pretty(&ordered).unwrap_or_default()
}

/// Check if two session JSON strings are equal (case-insensitive, matching
/// UWP `StringComparison.OrdinalIgnoreCase`).
fn session_json_equals(a: &str, b: &str) -> bool {
    a.to_lowercase() == b.to_lowercase()
}

// ---------------------------------------------------------------------------
//  Backup file operations
// ---------------------------------------------------------------------------

/// Write per-tab backup files. LastSaved is written whenever provided.
/// Pending is written only when the tab is dirty and pending text exists.
/// If the tab is clean, any stale pending backup is removed.
fn write_backups(
    folder: &std::path::Path,
    tabs: &[SessionTab],
    backups: &HashMap<String, TabBackupData>,
) -> Result<(), String> {
    fs::create_dir_all(folder).map_err(|e| format!("Failed to create backup dir: {e}"))?;

    // Build a lookup of editorId → isModified
    let modified: HashMap<&str, bool> = tabs.iter().map(|t| (t.editor_id.as_str(), t.is_modified)).collect();

    for (editor_id, backup) in backups {
        if let Some(last_saved) = &backup.last_saved {
            let path = folder.join(last_saved_backup_name(editor_id));
            fs::write(&path, last_saved)
                .map_err(|e| format!("Failed to write backup {path:?}: {e}"))?;
        }

        let pending_path = folder.join(pending_backup_name(editor_id));
        let is_dirty = modified.get(editor_id.as_str()).copied().unwrap_or(false);
        if is_dirty {
            if let Some(pending) = &backup.pending {
                fs::write(&pending_path, pending)
                    .map_err(|e| format!("Failed to write pending backup: {e}"))?;
            } else {
                // Dirty but no pending text → remove stale pending file
                let _ = fs::remove_file(&pending_path);
            }
        } else {
            // Clean tab → remove any stale pending backup
            let _ = fs::remove_file(&pending_path);
        }
    }
    Ok(())
}

/// Delete extension-less backup files whose editorId is no longer in the
/// live session. Files WITH an extension (e.g. *-Corrupted.txt) are skipped.
fn delete_orphaned_backups(folder: &std::path::Path, tabs: &[SessionTab]) {
    let live_names: std::collections::HashSet<String> = tabs
        .iter()
        .flat_map(|t| {
            vec![
                last_saved_backup_name(&t.editor_id),
                pending_backup_name(&t.editor_id),
            ]
        })
        .collect();

    let entries = match fs::read_dir(folder) {
        Ok(iter) => iter,
        Err(_) => return, // folder absent → nothing to prune
    };

    for entry in entries.flatten() {
        let name = entry.file_name();
        let name_str = name.to_string_lossy();
        // Skip files with extension (e.g. *-Corrupted.txt)
        if name_str.contains('.') {
            continue;
        }
        // Skip known-live backups
        if live_names.contains(name_str.as_ref()) {
            continue;
        }
        let _ = fs::remove_file(entry.path());
    }
}

// ---------------------------------------------------------------------------
//  Corruption recovery
// ---------------------------------------------------------------------------

/// Rename every extension-less file in the backup folder to
/// `{name}-Corrupted.txt` and remove the corrupt session JSON.
fn rename_corrupted_backups(app: &tauri::AppHandle) {
    let folder = backup_folder_path(app);
    let entries = match fs::read_dir(&folder) {
        Ok(iter) => iter,
        Err(_) => {
            // No backup folder — just delete the JSON
            let _ = fs::remove_file(session_file_path(app));
            set_last_json_str(None);
            return;
        }
    };

    for entry in entries.flatten() {
        let name = entry.file_name();
        let name_str = name.to_string_lossy();
        // Skip files that already have an extension (e.g. *-Corrupted.txt)
        if name_str.contains('.') {
            continue;
        }
        let corrupted_name = folder.join(format!("{name_str}-Corrupted.txt"));
        let _ = fs::rename(entry.path(), &corrupted_name);
    }

    let _ = fs::remove_file(session_file_path(app));
    set_last_json_str(None);
}

// ---------------------------------------------------------------------------
//  Tauri commands
// ---------------------------------------------------------------------------

/// Persist a session snapshot. Dirty-checked against the last written JSON
/// (case-insensitive). On write: (1) write versioned JSON, (2) write per-tab
/// backups, (3) delete orphaned backups for editors no longer in the session.
///
/// The `backups` parameter is a map from editorId to {lastSaved?, pending?}.
/// Only Pending text is written when the tab is dirty.
#[tauri::command]
pub async fn session_snapshot(
    app: tauri::AppHandle,
    data: SessionSnapshot,
    #[allow(unused_mut)] backups: Option<HashMap<String, TabBackupData>>,
) -> NpResult<SnapshotResult> {
    let session_json_str = serialize_for_disk(&data);

    // Dirty check
    if let Some(ref last) = last_json_str() {
        if session_json_equals(last, &session_json_str) {
            return NpResult::Ok(SnapshotResult { written: false });
        }
    }

    let folder = backup_folder_path(&app);

    // Write session JSON atomically
    let session_path = session_file_path(&app);
    let pid = std::process::id();
    let tmp_path = session_path.with_file_name(format!("{SESSION_FILE_NAME}.{pid}.tmp"));

    if let Some(parent) = tmp_path.parent() {
        if let Err(e) = fs::create_dir_all(parent) {
            return NpResult::Err(format!("Failed to create session dir: {e}"));
        }
    }

    if let Err(e) = fs::write(&tmp_path, &session_json_str) {
        return NpResult::Err(format!("Failed to write session: {e}"));
    }
    if let Err(e) = fs::rename(&tmp_path, &session_path) {
        let _ = fs::remove_file(&tmp_path);
        return NpResult::Err(format!("Failed to persist session: {e}"));
    }

    // Write per-tab backups
    if let Some(ref backups) = backups {
        if let Err(e) = write_backups(&folder, &data.tabs, backups) {
            return NpResult::Err(e);
        }
    }

    // Prune orphaned backups
    delete_orphaned_backups(&folder, &data.tabs);

    set_last_json_str(Some(session_json_str));
    NpResult::Ok(SnapshotResult { written: true })
}

/// Load the last persisted session.
///
/// Returns null when: no session file exists, or the JSON is corrupt (in
/// which case backups are renamed to *-Corrupted.txt and the session file
/// is deleted).
///
/// Each tab's filePath is re-validated via fs::metadata; a missing file
/// sets `unavailable: true` with the path preserved.
#[tauri::command]
pub async fn session_load_last(app: tauri::AppHandle) -> NpResult<Option<SessionSnapshot>> {
    let session_path = session_file_path(&app);

    let raw = match fs::read_to_string(&session_path) {
        Ok(r) => r,
        Err(_) => return NpResult::Ok(None), // No file → fresh start
    };

    // Parse and validate
    let parsed: serde_json::Value = match serde_json::from_str(&raw) {
        Ok(v) => v,
        Err(_) => {
            rename_corrupted_backups(&app);
            return NpResult::Ok(None);
        }
    };

    // Validate version & tabs field
    let version = parsed.get("version").and_then(|v| v.as_u64()).unwrap_or(0);
    let has_tabs = parsed.get("tabs").map(|v| v.is_array()).unwrap_or(false);
    if version != 1 || !has_tabs {
        rename_corrupted_backups(&app);
        return NpResult::Ok(None);
    }

    // Deserialize into SessionSnapshot
    let snapshot: SessionSnapshot = match serde_json::from_value(parsed) {
        Ok(s) => s,
        Err(_) => {
            rename_corrupted_backups(&app);
            return NpResult::Ok(None);
        }
    };

    // Re-validate tab paths
    let mut tabs: Vec<SessionTab> = Vec::new();
    for tab in snapshot.tabs {
        tabs.push(revalidate_tab(tab));
    }

    let result = SessionSnapshot {
        version: 1,
        tabs,
        active_editor_id: snapshot.active_editor_id,
    };

    // Cache the serialized form for dirty-check
    set_last_json_str(Some(serialize_for_disk(&result)));

    NpResult::Ok(Some(result))
}

/// Re-validate a single tab's filePath. Untitled buffers (no path) pass
/// through. Missing files are marked unavailable with path preserved.
fn revalidate_tab(tab: SessionTab) -> SessionTab {
    let Some(ref file_path) = tab.file_path else {
        // Untitled buffer — no path to revalidate
        let mut t = tab;
        t.unavailable = None;
        return t;
    };

    let exists = std::path::Path::new(file_path).exists();

    if exists {
        let mut t = tab;
        t.unavailable = None;
        t
    } else {
        SessionTab {
            unavailable: Some(true),
            ..tab
        }
    }
}

/// Clear recovered backup files. Removes the session JSON and every
/// extension-less backup. `{name}-Corrupted.txt` dumps are preserved
/// for user inspection.
#[tauri::command]
pub async fn session_clear_recovered(app: tauri::AppHandle) -> NpResult<()> {
    // Remove session JSON
    let _ = fs::remove_file(session_file_path(&app));

    let folder = backup_folder_path(&app);
    let entries = match fs::read_dir(&folder) {
        Ok(iter) => iter,
        Err(_) => {
            set_last_json_str(None);
            return NpResult::Ok(());
        }
    };

    for entry in entries.flatten() {
        let name = entry.file_name();
        let name_str = name.to_string_lossy();
        // Preserve files with extension (Corrupted recovery dumps)
        if name_str.contains('.') {
            continue;
        }
        let _ = fs::remove_file(entry.path());
    }

    set_last_json_str(None);
    NpResult::Ok(())
}

/// Test seam: reset the in-memory dirty-check cache.
#[cfg(test)]
pub fn __reset_session_dirty_cache() {
    set_last_json_str(None);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_serialize_for_disk_excludes_backups() {
        let snapshot = SessionSnapshot {
            version: 1,
            tabs: vec![SessionTab {
                editor_id: "ed-1".into(),
                file_path: Some("C:/notes.txt".into()),
                encoding_id: "UTF-8".into(),
                eol_id: crate::contract::EolId::Crlf,
                is_modified: false,
                selection_start: 0.0,
                selection_end: 0.0,
                scroll_top: 0.0,
                view_mode: crate::contract::ViewMode { preview: false, diff: false },
                unavailable: None,
            }],
            active_editor_id: Some("ed-1".into()),
        };

        let json = serialize_for_disk(&snapshot);
        let parsed: serde_json::Value = serde_json::from_str(&json).unwrap();

        assert_eq!(parsed["version"], serde_json::json!(1));
        assert!(parsed["tabs"].is_array());
        // Backups must NOT be present in the persisted JSON
        assert!(parsed.get("backups").is_none());
        assert!(parsed.get("_backups").is_none());
    }

    #[test]
    fn test_session_json_equals_case_insensitive() {
        let a = r#"{"version":1,"tabs":[],"activeEditorId":null}"#;
        let b = r#"{"VERSION":1,"TABS":[],"ACTIVEEDITORID":null}"#;
        assert!(session_json_equals(a, b));
    }

    #[test]
    fn test_revalidate_tab_untitled() {
        let tab = SessionTab {
            editor_id: "ed-1".into(),
            file_path: None,
            encoding_id: "UTF-8".into(),
            eol_id: crate::contract::EolId::Crlf,
            is_modified: false,
            selection_start: 0.0,
            selection_end: 0.0,
            scroll_top: 0.0,
            view_mode: crate::contract::ViewMode { preview: false, diff: false },
            unavailable: None,
        };
        let result = revalidate_tab(tab);
        assert_eq!(result.unavailable, None);
        assert_eq!(result.file_path, None);
    }

    #[test]
    fn test_revalidate_tab_missing_file() {
        let tab = SessionTab {
            editor_id: "ed-1".into(),
            file_path: Some("Z:/nonexistent/file.txt".into()),
            encoding_id: "UTF-8".into(),
            eol_id: crate::contract::EolId::Crlf,
            is_modified: false,
            selection_start: 0.0,
            selection_end: 0.0,
            scroll_top: 0.0,
            view_mode: crate::contract::ViewMode { preview: false, diff: false },
            unavailable: None,
        };
        let result = revalidate_tab(tab);
        assert_eq!(result.unavailable, Some(true));
        assert_eq!(result.file_path, Some("Z:/nonexistent/file.txt".into()));
    }

    #[test]
    fn test_last_saved_backup_name() {
        assert_eq!(last_saved_backup_name("editor-123"), "editor-123-LastSaved");
    }

    #[test]
    fn test_pending_backup_name() {
        assert_eq!(pending_backup_name("editor-456"), "editor-456-Pending");
    }
}
