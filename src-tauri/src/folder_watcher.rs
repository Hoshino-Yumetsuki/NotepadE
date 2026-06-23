//! Folder filesystem watcher — real-time change detection (Issue #13).
//!
//! Watches an opened folder recursively via the `notify` crate. Structural
//! changes (create / delete / rename) emit `notepads:evt:folder:changed` with
//! the parent directory path so the renderer can refresh that subtree. Content
//! modifications are intentionally excluded — they don't affect the tree.

use notify::event::ModifyKind;
use notify::{recommended_watcher, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager};

use crate::result::NpResult;

pub struct FolderWatcherState {
    watchers: HashMap<String, RecommendedWatcher>,
}

pub fn init(app: &AppHandle) {
    app.manage(Mutex::new(FolderWatcherState {
        watchers: HashMap::new(),
    }));
}

#[tauri::command]
pub fn folder_start_watch(app: AppHandle, path: String) -> NpResult<()> {
    let state = app.state::<Mutex<FolderWatcherState>>();
    let mut guard = match state.lock() {
        Ok(g) => g,
        Err(e) => return NpResult::Err(e.to_string()),
    };

    if guard.watchers.contains_key(&path) {
        return NpResult::Ok(());
    }

    let app_handle = app.clone();

    let mut watcher = match recommended_watcher(move |res: Result<notify::Event, notify::Error>| {
        if let Ok(event) = res {
            match event.kind {
                EventKind::Create(_)
                | EventKind::Remove(_)
                | EventKind::Modify(ModifyKind::Name(_)) => {
                    for changed_path in &event.paths {
                        let parent = changed_path
                            .parent()
                            .unwrap_or(changed_path)
                            .to_string_lossy()
                            .into_owned();
                        let _ = app_handle.emit("notepads:evt:folder:changed", &parent);
                    }
                }
                _ => {}
            }
        }
    }) {
        Ok(w) => w,
        Err(e) => return NpResult::Err(e.to_string()),
    };

    match watcher.watch(&PathBuf::from(&path), RecursiveMode::Recursive) {
        Ok(_) => {}
        Err(e) => return NpResult::Err(e.to_string()),
    }

    guard.watchers.insert(path, watcher);
    NpResult::Ok(())
}

#[tauri::command]
pub fn folder_stop_watch(app: AppHandle, path: String) -> NpResult<()> {
    let state = app.state::<Mutex<FolderWatcherState>>();
    let mut guard = match state.lock() {
        Ok(g) => g,
        Err(e) => return NpResult::Err(e.to_string()),
    };
    guard.watchers.remove(&path);
    NpResult::Ok(())
}
