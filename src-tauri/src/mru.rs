//! In-app Most-Recently-Used (MRU) recent-files list — port of src/main/mru.ts
//! (task #2).
//!
//! Persists `RecentFiles.json` (a plain array of absolute paths,
//! most-recent-first) in the app data root. Behavior (mirrors UWP MRUService):
//!   - add inserts most-recent-first, de-duplicating by path (case-insensitive
//!     on win32, ordinal-uppercase) and capping at 10.
//!   - list prunes entries whose file no longer exists and writes the trimmed
//!     list back; survivors get a fresh mtimeMs + basename displayName.
//!   - clear empties the list.
//! All store mutations are serialized through one Mutex so concurrent
//! opens/saves across windows can't lose updates. Atomic tmp+rename writes.

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::UNIX_EPOCH;

use crate::contract::RecentEntry;
use crate::result::NpResult;

/// Single persisted recent-files file (UWP used the OS MRU access list).
const MRU_FILE_NAME: &str = "RecentFiles.json";

/// Max entries retained, matching UWP `GetMostRecentlyUsedListAsync(top=10)`.
const MRU_CAP: usize = 10;

/// Serialization lock for store mutations (mru.ts `enqueue` promise chain).
static STORE_LOCK: Mutex<()> = Mutex::new(());

/// Resolve the app data root. Honors the e2e override (`NOTEPADS_E2E_USERDATA`)
/// BEFORE the Tauri app-data dir, exactly as settings.ts/session.ts/mru.ts did.
pub fn user_data_root(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    if let Ok(override_dir) = std::env::var("NOTEPADS_E2E_USERDATA") {
        if !override_dir.is_empty() {
            return Ok(PathBuf::from(override_dir));
        }
    }
    tauri::Manager::path(app)
        .app_data_dir()
        .map_err(|e| e.to_string())
}

/// Case-insensitive on win32 (NTFS), case-sensitive elsewhere. Ordinal
/// uppercase rather than locale folding (Turkish dotless-I), matching win32.
fn same_path(a: &str, b: &str) -> bool {
    if cfg!(windows) {
        a.to_uppercase() == b.to_uppercase()
    } else {
        a == b
    }
}

fn mru_file_path(root: &Path) -> PathBuf {
    root.join(MRU_FILE_NAME)
}

/// Read the raw stored path list. Missing file (first run) or corrupt/foreign
/// JSON resolve to empty — the recent list is a nicety and must never throw.
/// Non-string / empty members are dropped defensively.
fn read_stored(root: &Path) -> Vec<String> {
    let raw = match fs::read_to_string(mru_file_path(root)) {
        Ok(s) => s,
        Err(_) => return Vec::new(),
    };
    match serde_json::from_str::<serde_json::Value>(&raw) {
        Ok(serde_json::Value::Array(items)) => items
            .into_iter()
            .filter_map(|v| match v {
                serde_json::Value::String(s) if !s.is_empty() => Some(s),
                _ => None,
            })
            .collect(),
        _ => Vec::new(),
    }
}

/// Atomic write: serialize to a sibling tmp file then rename over the target,
/// so a crash mid-write can never leave a truncated RecentFiles.json. The tmp
/// name carries pid + timestamp + counter (defense in depth alongside the
/// store lock). Best-effort tmp cleanup on a failed rename.
fn write_stored(root: &Path, paths: &[String]) -> Result<(), String> {
    let target = mru_file_path(root);
    static SEQ: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
    let nonce = SEQ.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    let millis = std::time::SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    let tmp = root.join(format!(
        "{MRU_FILE_NAME}.{}.{millis}-{nonce}.tmp",
        std::process::id()
    ));
    let json = serde_json::to_string_pretty(paths).map_err(|e| e.to_string())?;
    fs::write(&tmp, json).map_err(|e| e.to_string())?;
    if let Err(e) = fs::rename(&tmp, &target) {
        let _ = fs::remove_file(&tmp);
        return Err(e.to_string());
    }
    Ok(())
}

fn mtime_ms(meta: &fs::Metadata) -> f64 {
    meta.modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_secs_f64() * 1000.0)
        .unwrap_or(0.0)
}

/// Insert `path` at the front, de-duplicating and capping at MRU_CAP. Called
/// from the file-open / save / saveAs success paths. Best-effort: a failure to
/// persist must never break the open/save itself (UWP TryAdd swallow) — the
/// caller ignores the result.
pub fn add_recent(root: &Path, path: &str) {
    if path.is_empty() {
        return;
    }
    let _guard = STORE_LOCK.lock().unwrap_or_else(|p| p.into_inner());
    let stored = read_stored(root);
    let mut deduped: Vec<String> = Vec::with_capacity(stored.len() + 1);
    deduped.push(path.to_string());
    deduped.extend(stored.into_iter().filter(|p| !same_path(p, path)));
    deduped.truncate(MRU_CAP);
    let _ = write_stored(root, &deduped);
}

/// List recent files most-recent-first, PRUNING entries whose stat fails
/// (renamed/deleted — UWP GetItemAsync silent skip). Survivors carry a fresh
/// mtimeMs + basename displayName. When pruning changed the list it is written
/// back so stale paths don't accumulate. Never errors: failures yield [].
pub fn list_recent(root: &Path) -> Vec<RecentEntry> {
    let _guard = STORE_LOCK.lock().unwrap_or_else(|p| p.into_inner());
    let stored = read_stored(root);
    let mut entries: Vec<RecentEntry> = Vec::new();
    let mut survivors: Vec<String> = Vec::new();

    for path in &stored {
        if entries.len() >= MRU_CAP {
            break;
        }
        match fs::metadata(path) {
            Ok(meta) => {
                let display_name = Path::new(path)
                    .file_name()
                    .map(|n| n.to_string_lossy().into_owned())
                    .unwrap_or_else(|| path.clone());
                entries.push(RecentEntry {
                    path: path.clone(),
                    display_name,
                    mtime_ms: Some(mtime_ms(&meta)),
                });
                survivors.push(path.clone());
            }
            Err(_) => {
                // File renamed/deleted — drop it.
            }
        }
    }

    if survivors.len() != stored.len() {
        let _ = write_stored(root, &survivors);
    }
    entries
}

/// Clear the entire in-app recent list (UWP MRUService.ClearAll).
pub fn clear_recent(root: &Path) -> Result<(), String> {
    let _guard = STORE_LOCK.lock().unwrap_or_else(|p| p.into_inner());
    write_stored(root, &[])
}

#[tauri::command]
pub async fn recent_list(app: tauri::AppHandle) -> NpResult<Vec<RecentEntry>> {
    match user_data_root(&app) {
        Ok(root) => NpResult::Ok(list_recent(&root)),
        // listRecent never throws in the Electron port — empty list on failure.
        Err(_) => NpResult::Ok(Vec::new()),
    }
}

#[tauri::command]
pub async fn recent_clear(app: tauri::AppHandle) -> NpResult<()> {
    match user_data_root(&app).and_then(|root| clear_recent(&root)) {
        Ok(()) => NpResult::Ok(()),
        Err(e) => NpResult::Err(e),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // Port of mru.test.ts (real files on disk so prune-missing is exercised
    // for real). Each test uses its own temp root, so no env juggling needed.

    struct TempDir(PathBuf);
    impl TempDir {
        fn new(tag: &str) -> Self {
            let dir = std::env::temp_dir().join(format!(
                "np-mru-{tag}-{}-{}",
                std::process::id(),
                std::time::SystemTime::now()
                    .duration_since(UNIX_EPOCH)
                    .unwrap()
                    .as_nanos()
            ));
            fs::create_dir_all(&dir).unwrap();
            TempDir(dir)
        }
        fn path(&self) -> &Path {
            &self.0
        }
        fn make_file(&self, name: &str) -> String {
            let p = self.0.join(name);
            fs::write(&p, "x").unwrap();
            p.to_string_lossy().into_owned()
        }
        fn read_store(&self) -> Vec<String> {
            read_stored(&self.0)
        }
    }
    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn persists_single_path_and_lists_it() {
        let t = TempDir::new("single");
        let a = t.make_file("a.txt");
        add_recent(t.path(), &a);
        let list = list_recent(t.path());
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].path, a);
        assert_eq!(list[0].display_name, "a.txt");
        assert!(list[0].mtime_ms.is_some());
    }

    #[test]
    fn orders_most_recent_first() {
        let t = TempDir::new("order");
        let a = t.make_file("a.txt");
        let b = t.make_file("b.txt");
        let c = t.make_file("c.txt");
        add_recent(t.path(), &a);
        add_recent(t.path(), &b);
        add_recent(t.path(), &c);
        let paths: Vec<_> = list_recent(t.path()).into_iter().map(|e| e.path).collect();
        assert_eq!(paths, vec![c, b, a]);
    }

    #[test]
    fn dedupes_moving_readded_to_front() {
        let t = TempDir::new("dedupe");
        let a = t.make_file("a.txt");
        let b = t.make_file("b.txt");
        add_recent(t.path(), &a);
        add_recent(t.path(), &b);
        add_recent(t.path(), &a); // re-open a
        let paths: Vec<_> = list_recent(t.path()).into_iter().map(|e| e.path).collect();
        assert_eq!(paths, vec![a, b]);
    }

    #[cfg(windows)]
    #[test]
    fn dedupe_is_case_insensitive_on_windows() {
        let t = TempDir::new("case");
        let a = t.make_file("Mixed.txt");
        add_recent(t.path(), &a);
        add_recent(t.path(), &a.to_uppercase());
        assert_eq!(list_recent(t.path()).len(), 1);
    }

    #[test]
    fn caps_at_10_dropping_oldest() {
        let t = TempDir::new("cap");
        let mut paths = Vec::new();
        for i in 0..13 {
            let p = t.make_file(&format!("f{i}.txt"));
            add_recent(t.path(), &p);
            paths.push(p);
        }
        let list = list_recent(t.path());
        assert_eq!(list.len(), 10);
        assert_eq!(list[0].path, paths[12]);
        assert_eq!(list[9].path, paths[3]);
        assert!(!list.iter().any(|e| e.path == paths[0]));
    }

    #[test]
    fn ignores_empty_paths() {
        let t = TempDir::new("empty");
        add_recent(t.path(), "");
        assert!(list_recent(t.path()).is_empty());
    }

    #[test]
    fn prunes_missing_and_writes_back() {
        let t = TempDir::new("prune");
        let a = t.make_file("a.txt");
        let b = t.make_file("b.txt");
        let c = t.make_file("c.txt");
        add_recent(t.path(), &a);
        add_recent(t.path(), &b);
        add_recent(t.path(), &c);

        fs::remove_file(&b).unwrap();

        let paths: Vec<_> = list_recent(t.path()).into_iter().map(|e| e.path).collect();
        assert_eq!(paths, vec![c.clone(), a.clone()]);
        // Pruned entry must be written back so it doesn't re-surface.
        assert_eq!(t.read_store(), vec![c, a]);
    }

    #[test]
    fn empty_list_when_no_store_exists() {
        let t = TempDir::new("nostore");
        assert!(list_recent(t.path()).is_empty());
    }

    #[test]
    fn clear_empties_persisted_list() {
        let t = TempDir::new("clear");
        let a = t.make_file("a.txt");
        add_recent(t.path(), &a);
        assert_eq!(list_recent(t.path()).len(), 1);

        clear_recent(t.path()).unwrap();
        assert!(list_recent(t.path()).is_empty());
        assert!(t.read_store().is_empty());
    }

    #[test]
    fn corrupt_store_treated_as_empty_never_panics() {
        let t = TempDir::new("corrupt");
        fs::write(t.path().join(MRU_FILE_NAME), "{ not json").unwrap();
        assert!(list_recent(t.path()).is_empty());
        // A subsequent add still works (overwrites the garbage).
        let a = t.make_file("a.txt");
        add_recent(t.path(), &a);
        let paths: Vec<_> = list_recent(t.path()).into_iter().map(|e| e.path).collect();
        assert_eq!(paths, vec![a]);
    }

    #[test]
    fn concurrent_adds_lose_no_updates() {
        let t = TempDir::new("conc");
        let paths: Vec<String> = (0..8).map(|i| t.make_file(&format!("c{i}.txt"))).collect();
        let root = t.path().to_path_buf();
        let handles: Vec<_> = paths
            .iter()
            .cloned()
            .map(|p| {
                let root = root.clone();
                std::thread::spawn(move || add_recent(&root, &p))
            })
            .collect();
        for h in handles {
            h.join().unwrap();
        }
        let list = list_recent(t.path());
        assert_eq!(list.len(), paths.len());
        let got: std::collections::HashSet<_> = list.into_iter().map(|e| e.path).collect();
        let want: std::collections::HashSet<_> = paths.into_iter().collect();
        assert_eq!(got, want);
    }
}
