//! File IO — port of src/main/file-io.ts (task #2). Reads bytes, decodes via
//! the encoding engine, returns authoritative descriptors. On save, re-applies
//! EOL and encodes back to bytes. The renderer NEVER touches fs/path — all of
//! this lives behind the bridge (PA-8).

use std::collections::HashMap;
use std::io;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{Duration, UNIX_EPOCH};

use tauri_plugin_dialog::DialogExt;

use crate::contract::{
    EncodingId, EolId, OpenedFile, RevalidateResult, SaveArgs, SaveAsArgs, SaveResult,
};
use crate::encoding::{decode_bytes, decode_bytes_with, encode_text};
use crate::eol::{apply_eol, detect_eol, normalize_to_lf};
use crate::mru;
use crate::result::NpResult;

/// Cache of last-known encoding/EOL per path so save can reuse them.
static FILE_META: Mutex<Option<HashMap<String, (EncodingId, EolId)>>> = Mutex::new(None);

fn meta_set(path: &str, encoding_id: &str, eol_id: EolId) {
    let mut guard = FILE_META.lock().unwrap_or_else(|p| p.into_inner());
    guard
        .get_or_insert_with(HashMap::new)
        .insert(path.to_string(), (encoding_id.to_string(), eol_id));
}

fn meta_get(path: &str) -> Option<(EncodingId, EolId)> {
    let guard = FILE_META.lock().unwrap_or_else(|p| p.into_inner());
    guard.as_ref().and_then(|m| m.get(path).cloned())
}

fn mtime_ms(meta: &std::fs::Metadata) -> f64 {
    meta.modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_secs_f64() * 1000.0)
        .unwrap_or(0.0)
}

/// io::ErrorKind classes that are typically TRANSIENT (file locked by AV /
/// OneDrive sync / indexer) — the Rust equivalents of EBUSY/EPERM/EACCES/
/// EAGAIN in file-io.ts TRANSIENT_WRITE_CODES.
fn is_transient(e: &io::Error) -> bool {
    matches!(
        e.kind(),
        io::ErrorKind::PermissionDenied      // EPERM / EACCES
            | io::ErrorKind::ResourceBusy    // EBUSY
            | io::ErrorKind::WouldBlock      // EAGAIN
    ) || matches!(e.raw_os_error(), Some(32) | Some(33)) // win32 sharing violations
}

/// Write bytes with bounded retries on transient locking errors (3 attempts,
/// 80ms linear backoff). A non-transient error (e.g. NotFound) propagates
/// immediately. After the final attempt the last error propagates. `write_fn`
/// is injectable for unit tests; production uses std::fs::write.
pub fn write_file_with_retry<F>(
    path: &str,
    bytes: &[u8],
    attempts: u32,
    backoff_ms: u64,
    mut write_fn: F,
) -> io::Result<()>
where
    F: FnMut(&str, &[u8]) -> io::Result<()>,
{
    let mut last_err: Option<io::Error> = None;
    for i in 0..attempts {
        match write_fn(path, bytes) {
            Ok(()) => return Ok(()),
            Err(e) => {
                if !is_transient(&e) {
                    return Err(e); // not transient
                }
                let is_last = i + 1 >= attempts;
                last_err = Some(e);
                if !is_last {
                    std::thread::sleep(Duration::from_millis(backoff_ms * (i as u64 + 1)));
                }
            }
        }
    }
    Err(last_err.unwrap_or_else(|| io::Error::other("write failed")))
}

fn write_with_retry_default(path: &str, bytes: &[u8]) -> io::Result<()> {
    write_file_with_retry(path, bytes, 3, 80, |p, b| std::fs::write(p, b))
}

/// Open + decode core shared by file_open / file_reload_from_disk.
fn open_file_inner(app: Option<&tauri::AppHandle>, path: &str) -> Result<OpenedFile, String> {
    let bytes = std::fs::read(path).map_err(|e| e.to_string())?;
    let decoded = decode_bytes(&bytes);
    let eol_id = detect_eol(&decoded.decoded_text);
    let meta = std::fs::metadata(path).map_err(|e| e.to_string())?;
    meta_set(path, &decoded.encoding_id, eol_id);
    // Mirror into the in-app MRU (UWP MRUService). Best-effort: the recent
    // list is a nicety and must never delay/break the open. (OS jump-list
    // recents land with shell_integration — task #3.)
    if let Some(app) = app {
        if let Ok(root) = mru::user_data_root(app) {
            mru::add_recent(&root, path);
        }
    }
    Ok(OpenedFile {
        decoded_text: decoded.decoded_text,
        encoding_id: decoded.encoding_id,
        eol_id,
        date_modified_ms: mtime_ms(&meta),
        file_path: Some(path.to_string()),
        has_bom: decoded.has_bom,
    })
}

/// Re-read + decode under an EXPLICIT label (encoding.decodeWith). Bypasses
/// auto-detection; EOL is re-detected from the fresh text and the meta cache
/// is updated so the next save reuses the chosen encoding.
pub fn decode_with_encoding(path: &str, encoding_id: &str) -> Result<OpenedFile, String> {
    let bytes = std::fs::read(path).map_err(|e| e.to_string())?;
    let decoded = decode_bytes_with(&bytes, encoding_id);
    let eol_id = detect_eol(&decoded.decoded_text);
    let meta = std::fs::metadata(path).map_err(|e| e.to_string())?;
    meta_set(path, &decoded.encoding_id, eol_id);
    Ok(OpenedFile {
        decoded_text: decoded.decoded_text,
        encoding_id: decoded.encoding_id,
        eol_id,
        date_modified_ms: mtime_ms(&meta),
        file_path: Some(path.to_string()),
        has_bom: decoded.has_bom,
    })
}

/// Shared encode-and-write core for save / saveAs. Re-applies EOL to the
/// '\n'-normalized shadow text and encodes with the resolved label. The
/// renderer NEVER re-derives encoding/EOL.
fn write_shadow_to_path(
    app: Option<&tauri::AppHandle>,
    file_path: &str,
    shadow_text: Option<&str>,
    encoding_id: Option<&str>,
    eol_id: Option<EolId>,
) -> Result<SaveResult, String> {
    let known = meta_get(file_path);
    let encoding_id: EncodingId = encoding_id
        .map(str::to_string)
        .or_else(|| known.as_ref().map(|(e, _)| e.clone()))
        .unwrap_or_else(|| "UTF-8".to_string());
    let eol_id = eol_id.or(known.map(|(_, e)| e)).unwrap_or(EolId::Crlf);

    // shadowText is '\n'-normalized from the renderer. If absent, re-read disk
    // content as the baseline (no-op save guard).
    let lf_text = match shadow_text {
        Some(t) => t.to_string(),
        None => {
            let existing = std::fs::read(file_path).map_err(|e| e.to_string())?;
            normalize_to_lf(&decode_bytes(&existing).decoded_text)
        }
    };

    let with_eol = apply_eol(&lf_text, eol_id);
    let bytes = encode_text(&with_eol, &encoding_id)?;
    write_with_retry_default(file_path, &bytes).map_err(|e| e.to_string())?;

    let meta = std::fs::metadata(file_path).map_err(|e| e.to_string())?;
    meta_set(file_path, &encoding_id, eol_id);
    // Mirror the saved file into the in-app MRU list (UWP fed save too).
    if let Some(app) = app {
        if let Ok(root) = mru::user_data_root(app) {
            mru::add_recent(&root, file_path);
        }
    }
    Ok(SaveResult {
        file_path: file_path.to_string(),
        date_modified_ms: mtime_ms(&meta),
        encoding_id,
        eol_id,
    })
}

/// Compose the Save dialog's default directory + file name from suggestedName
/// + defaultDir (file-io.ts dialogDefaultPath). The composed path must anchor
/// untitled buffers to the Documents fallback (the "NotepadE" IFileSaveDialog
/// bug). Returns (directory, file_name) for the dialog builder.
pub fn dialog_default_parts(
    suggested_name: Option<&str>,
    default_dir: Option<&str>,
    fallback_dir: Option<&str>,
) -> (Option<PathBuf>, Option<String>) {
    let dir = default_dir.or(fallback_dir);
    (dir.map(PathBuf::from), suggested_name.map(str::to_string))
}

// ---------------------------------------------------------------------------
//  Commands
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn file_open(app: tauri::AppHandle, path: String) -> NpResult<OpenedFile> {
    open_file_inner(Some(&app), &path).into()
}

#[tauri::command]
pub async fn file_reload_from_disk(app: tauri::AppHandle, path: String) -> NpResult<OpenedFile> {
    open_file_inner(Some(&app), &path).into()
}

/// Native open dialog: multi-select, no filters (any file type). Cancel is a
/// normal success returning [] — the renderer treats it as a no-op.
#[tauri::command]
pub async fn file_open_dialog(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
) -> NpResult<Vec<String>> {
    let picked = tauri::async_runtime::spawn_blocking(move || {
        app.dialog()
            .file()
            .set_title("Open")
            .set_parent(&window)
            .blocking_pick_files()
    })
    .await;
    match picked {
        Ok(Some(files)) => NpResult::Ok(
            files
                .into_iter()
                .filter_map(|f| f.into_path().ok())
                .map(|p| p.to_string_lossy().into_owned())
                .collect(),
        ),
        Ok(None) => NpResult::Ok(Vec::new()), // cancel -> []
        Err(e) => NpResult::Err(e.to_string()),
    }
}

#[tauri::command]
pub async fn file_save(app: tauri::AppHandle, args: SaveArgs) -> NpResult<SaveResult> {
    write_shadow_to_path(
        Some(&app),
        &args.file_path,
        args.shadow_text.as_deref(),
        args.encoding_id.as_deref(),
        args.eol_id,
    )
    .into()
}

/// Native Save dialog (filter: 'Text Documents (*.txt)' only — product
/// decision), then the shared write path. Cancel surfaces as the error
/// 'Save canceled' (contract string — the renderer matches it).
#[tauri::command]
pub async fn file_save_as(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    args: SaveAsArgs,
) -> NpResult<SaveResult> {
    let documents = tauri::Manager::path(&app).document_dir().ok();
    let (dir, name) = dialog_default_parts(
        args.suggested_name.as_deref(),
        args.default_dir.as_deref(),
        documents.as_deref().map(Path::to_str).flatten(),
    );

    let dialog_app = app.clone();
    let picked = tauri::async_runtime::spawn_blocking(move || {
        let mut b = dialog_app
            .dialog()
            .file()
            .set_title("Save As")
            .add_filter("Text Documents (*.txt)", &["txt"])
            .set_parent(&window);
        if let Some(dir) = dir {
            b = b.set_directory(dir);
        }
        if let Some(name) = name {
            b = b.set_file_name(name);
        }
        b.blocking_save_file()
    })
    .await;

    let file_path = match picked {
        Ok(Some(fp)) => match fp.into_path() {
            Ok(p) => p.to_string_lossy().into_owned(),
            Err(e) => return NpResult::Err(e.to_string()),
        },
        Ok(None) => return NpResult::Err("Save canceled".into()),
        Err(e) => return NpResult::Err(e.to_string()),
    };

    write_shadow_to_path(
        Some(&app),
        &file_path,
        args.shadow_text.as_deref(),
        args.encoding_id.as_deref(),
        args.eol_id,
    )
    .into()
}

/// Re-validate a stored absolute path (session/FAL substitute). NEVER errors:
/// a failed stat is {exists:false, dateModifiedMs:0}.
#[tauri::command]
pub async fn file_revalidate_path(path: String) -> NpResult<RevalidateResult> {
    match std::fs::metadata(&path) {
        Ok(meta) => NpResult::Ok(RevalidateResult { exists: true, date_modified_ms: mtime_ms(&meta) }),
        Err(_) => NpResult::Ok(RevalidateResult { exists: false, date_modified_ms: 0.0 }),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::Cell;

    // Port of file-io.test.ts (writeFileWithRetry + dialogDefaultPath).

    fn fs_err(kind: io::ErrorKind) -> io::Error {
        io::Error::new(kind, format!("{kind:?}"))
    }

    #[test]
    fn retry_succeeds_first_attempt_when_clean() {
        let calls = Cell::new(0);
        write_file_with_retry("/x", b"hello", 3, 0, |_, _| {
            calls.set(calls.get() + 1);
            Ok(())
        })
        .unwrap();
        assert_eq!(calls.get(), 1);
    }

    #[test]
    fn retry_on_transient_busy_then_succeeds() {
        let calls = Cell::new(0);
        write_file_with_retry("/x", b"hello", 3, 0, |_, _| {
            calls.set(calls.get() + 1);
            if calls.get() == 1 {
                Err(fs_err(io::ErrorKind::ResourceBusy)) // EBUSY
            } else {
                Ok(())
            }
        })
        .unwrap();
        assert_eq!(calls.get(), 2);
    }

    #[test]
    fn retries_to_limit_then_returns_last_transient_error() {
        let calls = Cell::new(0);
        let err = write_file_with_retry("/x", b"hello", 3, 0, |_, _| {
            calls.set(calls.get() + 1);
            Err(fs_err(io::ErrorKind::PermissionDenied)) // EPERM/EACCES class
        })
        .unwrap_err();
        assert_eq!(calls.get(), 3);
        assert_eq!(err.kind(), io::ErrorKind::PermissionDenied);
    }

    #[test]
    fn non_transient_not_found_throws_immediately() {
        let calls = Cell::new(0);
        let err = write_file_with_retry("/x", b"hello", 3, 0, |_, _| {
            calls.set(calls.get() + 1);
            Err(fs_err(io::ErrorKind::NotFound)) // ENOENT
        })
        .unwrap_err();
        assert_eq!(calls.get(), 1);
        assert_eq!(err.kind(), io::ErrorKind::NotFound);
    }

    #[test]
    fn eagain_is_transient_and_retried() {
        let calls = Cell::new(0);
        let _ = write_file_with_retry("/x", b"hello", 2, 0, |_, _| {
            calls.set(calls.get() + 1);
            Err(fs_err(io::ErrorKind::WouldBlock)) // EAGAIN
        });
        assert_eq!(calls.get(), 2);
    }

    #[test]
    fn default_parts_joins_suggested_name_onto_explicit_dir() {
        let (dir, name) = dialog_default_parts(Some("notes.txt"), Some("C:\\docs"), None);
        assert_eq!(dir, Some(PathBuf::from("C:\\docs")));
        assert_eq!(name.as_deref(), Some("notes.txt"));
    }

    #[test]
    fn default_parts_anchors_untitled_to_documents_fallback() {
        // THE "NotepadE" bug: a bare relative name reaches IFileSaveDialog
        // unreliably; anchoring to the fallback dir keeps the name populated.
        let (dir, name) =
            dialog_default_parts(Some("Untitled 1"), None, Some("C:\\Users\\me\\Documents"));
        assert_eq!(dir, Some(PathBuf::from("C:\\Users\\me\\Documents")));
        assert_eq!(name.as_deref(), Some("Untitled 1"));
    }

    #[test]
    fn default_parts_prefers_explicit_dir_over_fallback() {
        let (dir, _) = dialog_default_parts(Some("a.txt"), Some("D:\\work"), Some("C:\\Documents"));
        assert_eq!(dir, Some(PathBuf::from("D:\\work")));
    }

    #[test]
    fn default_parts_bare_dir_when_no_name() {
        let (dir, name) = dialog_default_parts(None, Some("C:\\docs"), None);
        assert_eq!(dir, Some(PathBuf::from("C:\\docs")));
        assert_eq!(name, None);
        let (dir2, name2) = dialog_default_parts(None, None, Some("C:\\Documents"));
        assert_eq!(dir2, Some(PathBuf::from("C:\\Documents")));
        assert_eq!(name2, None);
    }

    #[test]
    fn default_parts_bare_name_when_no_dir_resolvable() {
        let (dir, name) = dialog_default_parts(Some("x.txt"), None, None);
        assert_eq!(dir, None);
        assert_eq!(name.as_deref(), Some("x.txt"));
        let (dir2, name2) = dialog_default_parts(None, None, None);
        assert_eq!(dir2, None);
        assert_eq!(name2, None);
    }

    #[test]
    fn save_reuses_cached_meta_and_open_roundtrips() {
        // End-to-end without dialogs: write a CRLF windows-1252 file, open it
        // (detect), save shadow text back (reuse cached encoding+eol), re-read.
        let dir = std::env::temp_dir().join(format!("np-fio-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let p = dir.join("roundtrip.txt");
        let original = crate::encoding::encode_text("caf\u{e9}\r\nfin", "Western (windows-1252)").unwrap();
        std::fs::write(&p, &original).unwrap();
        let path = p.to_string_lossy().into_owned();

        // open without an AppHandle (MRU skipped) via the inner core
        let opened = open_file_inner(None, &path).unwrap();
        assert_eq!(opened.encoding_id, "Western (windows-1252)");
        assert_eq!(opened.eol_id, EolId::Crlf);
        assert_eq!(opened.decoded_text, "caf\u{e9}\r\nfin");
        assert!(!opened.has_bom);

        // save '\n'-normalized shadow text; encoding+eol come from the cache
        let saved = write_shadow_to_path(None, &path, Some("caf\u{e9}\nfin"), None, None).unwrap();
        assert_eq!(saved.encoding_id, "Western (windows-1252)");
        assert_eq!(saved.eol_id, EolId::Crlf);
        assert_eq!(std::fs::read(&p).unwrap(), original);

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn save_without_shadow_text_rewrites_disk_baseline() {
        let dir = std::env::temp_dir().join(format!("np-fio2-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let p = dir.join("noop.txt");
        std::fs::write(&p, b"alpha\r\nbeta").unwrap();
        let path = p.to_string_lossy().into_owned();
        let _ = open_file_inner(None, &path).unwrap();

        let saved = write_shadow_to_path(None, &path, None, None, None).unwrap();
        assert_eq!(saved.eol_id, EolId::Crlf);
        assert_eq!(std::fs::read(&p).unwrap(), b"alpha\r\nbeta");

        let _ = std::fs::remove_dir_all(&dir);
    }
}
