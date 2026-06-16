//! Folder support — open dialog + directory listing (Issue #10).

use std::time::UNIX_EPOCH;

use tauri_plugin_dialog::DialogExt;

use crate::contract::FolderEntry;
use crate::result::NpResult;

fn mtime_ms(meta: &std::fs::Metadata) -> f64 {
    meta.modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_secs_f64() * 1000.0)
        .unwrap_or(0.0)
}

/// Native folder-picker dialog. Returns `Ok(Some(path))` when the user picks a
/// folder, or `Ok(None)` when they cancel — cancel is a normal success, NOT an
/// error (same convention as `file_open_dialog`).
#[tauri::command]
pub async fn folder_open_dialog(app: tauri::AppHandle) -> NpResult<Option<String>> {
    let picked = tauri::async_runtime::spawn_blocking(move || {
        app.dialog()
            .file()
            .set_title("Open Folder")
            .blocking_pick_folder()
    })
    .await;
    match picked {
        Ok(Some(fp)) => match fp.into_path() {
            Ok(p) => NpResult::Ok(Some(p.to_string_lossy().into_owned())),
            Err(e) => NpResult::Err(e.to_string()),
        },
        Ok(None) => NpResult::Ok(None), // cancel
        Err(e) => NpResult::Err(e.to_string()),
    }
}

/// List the immediate children of `path`. Sorts directories first, then files,
/// both groups alphabetically (case-insensitive). Hidden entries (names starting
/// with `.`) are skipped. Never errors on a single unreadable entry — it is
/// silently skipped.
#[tauri::command]
pub fn folder_list(path: String) -> NpResult<Vec<FolderEntry>> {
    let entries = match std::fs::read_dir(&path) {
        Ok(e) => e,
        Err(e) => return NpResult::Err(e.to_string()),
    };

    let mut items: Vec<FolderEntry> = entries
        .filter_map(|res| {
            let entry = res.ok()?;
            let name = entry.file_name().to_string_lossy().into_owned();
            // Skip hidden files/folders
            if name.starts_with('.') {
                return None;
            }
            let meta = entry.metadata().ok()?;
            let is_dir = meta.is_dir();
            let size = if is_dir { None } else { Some(meta.len()) };
            let date_modified_ms = mtime_ms(&meta);
            let full_path = entry.path().to_string_lossy().into_owned();
            Some(FolderEntry {
                name,
                path: full_path,
                is_dir,
                size,
                date_modified_ms,
            })
        })
        .collect();

    // Sort: dirs first, then files; each group alphabetically case-insensitive.
    items.sort_by(|a, b| {
        match (a.is_dir, b.is_dir) {
            (true, false) => std::cmp::Ordering::Less,
            (false, true) => std::cmp::Ordering::Greater,
            _ => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
        }
    });

    NpResult::Ok(items)
}
