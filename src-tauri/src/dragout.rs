//! dragout — port of src/main/dragout.ts (task #4, owner: worker-window).
//!
//! Cross-window tab transfer registry. The renderer drag carries ONLY an
//! opaque token; the editor content travels through this registry as a JSON
//! envelope, never over the drag itself.
//!
//!   1. Source renderer calls `drag_out_begin(envelope)`. The envelope's
//!      `sourceWindowId` is re-stamped AUTHORITATIVELY from the calling
//!      window's label (a renderer can never spoof another window — PA-8);
//!      the entry is stored under a minted token `xfer-<ts36>-<seq>-<rand>`.
//!   2. Target renderer, on drop, calls `drag_out_complete(token, dropIndex)`.
//!      The filePath is re-stat'ed (missing → mtime 0, path kept), an
//!      authoritative AdoptPayload is built (hasBom always false), then
//!      `notepads:evt:editor:adopt` is pushed to the TARGET (calling) window
//!      FIRST and `notepads:evt:editor:release` ({editorId}) to the source.
//!      The undo stack is never carried.
//!
//! Stale entries expire after 60s (sweep on begin) so a crashed drag
//! self-heals.

use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Mutex, OnceLock};
use std::time::{SystemTime, UNIX_EPOCH};

use tauri::{Emitter, Manager};

use crate::contract::{AdoptPayload, DragEnvelope, DragToken, OpenedFile, ReleasePayload};
use crate::result::NpResult;

/// `notepads:evt:editor:adopt` (AdoptPayload, window-scoped).
const EVT_ADOPT: &str = "notepads:evt:editor:adopt";
/// `notepads:evt:editor:release` ({editorId}, window-scoped).
const EVT_RELEASE: &str = "notepads:evt:editor:release";

/// A stale transfer (no complete within this window) is garbage-collected.
const TOKEN_TTL_MS: u64 = 60_000;

/// A pending transfer keyed by token: the envelope + the authoritative source.
struct PendingTransfer {
    envelope: DragEnvelope,
    /// The source window's LABEL (Tauri windows are label-addressed; the
    /// Electron numeric window id has no equivalent).
    source_label: String,
    created_at_ms: u64,
}

/// Token -> pending transfer. A drag lives here between begin and complete.
fn registry() -> &'static Mutex<HashMap<String, PendingTransfer>> {
    static REG: OnceLock<Mutex<HashMap<String, PendingTransfer>>> = OnceLock::new();
    REG.get_or_init(|| Mutex::new(HashMap::new()))
}

static TOKEN_SEQ: AtomicU64 = AtomicU64::new(0);

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// Lowercase base-36 rendering (JS `Number.toString(36)` parity).
fn to_base36(mut n: u64) -> String {
    const DIGITS: &[u8] = b"0123456789abcdefghijklmnopqrstuvwxyz";
    if n == 0 {
        return "0".into();
    }
    let mut out = Vec::new();
    while n > 0 {
        out.push(DIGITS[(n % 36) as usize]);
        n /= 36;
    }
    out.reverse();
    String::from_utf8(out).expect("base36 digits are ascii")
}

/// Mint a process-unique, unguessable-enough transfer token:
/// `xfer-<ts36>-<seq>-<rand>` (8 base-36 chars of randomness).
fn next_token(now: u64) -> String {
    let seq = TOKEN_SEQ.fetch_add(1, Ordering::SeqCst) + 1;
    // Random suffix without an extra dependency: hash address-space +
    // time-derived entropy through a splitmix64 step.
    let mut x = now ^ (seq.wrapping_mul(0x9E37_79B9_7F4A_7C15)) ^ (&TOKEN_SEQ as *const _ as u64);
    x ^= x >> 30;
    x = x.wrapping_mul(0xBF58_476D_1CE4_E5B9);
    x ^= x >> 27;
    x = x.wrapping_mul(0x94D0_49BB_1331_11EB);
    x ^= x >> 31;
    let rand = to_base36(x);
    let rand8 = &rand[..rand.len().min(8)];
    format!("xfer-{}-{}-{}", to_base36(now), seq, rand8)
}

/// Drop transfers older than the TTL (a crashed/abandoned drag self-heals).
fn sweep_expired(reg: &mut HashMap<String, PendingTransfer>, now: u64) {
    reg.retain(|_, t| now.saturating_sub(t.created_at_ms) <= TOKEN_TTL_MS);
}

/// Build the authoritative OpenedFile the target adopts. The file path is
/// re-validated via stat: a present file yields its real mtime; a missing/
/// renamed file keeps the path but reports mtime 0. An untitled buffer
/// (filePath null) is adopted verbatim. hasBom is always false (Electron
/// parity — the dragged text is already decoded).
fn build_adopted_file(envelope: &DragEnvelope) -> OpenedFile {
    let mut date_modified_ms = envelope.date_modified_ms;
    if let Some(path) = &envelope.file_path {
        date_modified_ms = match std::fs::metadata(path).and_then(|m| m.modified()) {
            Ok(mtime) => mtime
                .duration_since(UNIX_EPOCH)
                .map(|d| d.as_millis() as f64)
                .unwrap_or(0.0),
            // Missing at drop time — keep the path, report mtime 0.
            Err(_) => 0.0,
        };
    }
    OpenedFile {
        decoded_text: envelope.last_saved_text.clone(),
        encoding_id: envelope.encoding_id.clone(),
        eol_id: envelope.eol_id,
        date_modified_ms,
        file_path: envelope.file_path.clone(),
        has_bom: false,
        baseline_hash: crate::hash::hash_text(&envelope.last_saved_text),
        baseline_length: crate::hash::utf16_len(&envelope.last_saved_text),
    }
}

/// Begin a transfer. The `sourceWindowId` on the incoming envelope is IGNORED
/// and re-stamped from the calling window; the label is what routing uses.
#[tauri::command]
pub async fn drag_out_begin(
    window: tauri::WebviewWindow,
    envelope: DragEnvelope,
) -> NpResult<DragToken> {
    let source_label = window.label().to_string();
    let now = now_ms();
    let mut reg = match registry().lock() {
        Ok(g) => g,
        Err(e) => return NpResult::Err(e.to_string()),
    };
    sweep_expired(&mut reg, now);
    let token = next_token(now);
    // Re-stamp: the renderer-supplied id is never trusted. Labels are strings
    // in Tauri; the numeric contract field is stamped 0 and the authoritative
    // identity is the stored label.
    let envelope = DragEnvelope {
        source_window_id: 0.0,
        ..envelope
    };
    reg.insert(
        token.clone(),
        PendingTransfer {
            envelope,
            source_label,
            created_at_ms: now,
        },
    );
    NpResult::Ok(DragToken { token })
}

/// Complete a transfer at `dropIndex` in the TARGET window (the caller).
/// Pushes adopt to the target FIRST so the tab exists before the source drops
/// it, then release to the source.
#[tauri::command]
pub async fn drag_out_complete(
    window: tauri::WebviewWindow,
    token: String,
    drop_index: f64,
) -> NpResult<()> {
    let pending = match registry().lock() {
        Ok(mut reg) => reg.remove(&token),
        Err(e) => return NpResult::Err(e.to_string()),
    };
    let Some(pending) = pending else {
        return NpResult::Err("Unknown or expired transfer token".into());
    };

    let file = build_adopted_file(&pending.envelope);
    let envelope = &pending.envelope;
    let adopt = AdoptPayload {
        editor_id: envelope.editor_id.clone(),
        file,
        pending_text: if envelope.is_modified {
            envelope.pending_text.clone()
        } else {
            None
        },
        is_modified: envelope.is_modified,
        drop_index,
        view_mode: envelope.view_mode,
    };

    // Push adopt to the target FIRST so the tab exists before the source drops it.
    if let Err(e) = window.emit_to(window.label(), EVT_ADOPT, &adopt) {
        return NpResult::Err(e.to_string());
    }

    if let Some(source) = window
        .app_handle()
        .get_webview_window(&pending.source_label)
    {
        let _ = source.emit_to(
            source.label(),
            EVT_RELEASE,
            &ReleasePayload {
                editor_id: envelope.editor_id.clone(),
            },
        );
    }

    NpResult::Ok(())
}

// ---------------------------------------------------------------------------
//  Tests — token format, TTL sweep, adopt-payload shaping
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use crate::contract::{EolId, ViewMode};

    fn envelope(file_path: Option<&str>, is_modified: bool) -> DragEnvelope {
        DragEnvelope {
            source_window_id: 42.0, // renderer-supplied; must be ignored
            editor_id: "ed-1".into(),
            file_path: file_path.map(|s| s.to_string()),
            last_saved_text: "saved".into(),
            pending_text: Some("dirty".into()),
            encoding_id: "UTF-8".into(),
            eol_id: EolId::Crlf,
            is_modified,
            file_name_placeholder: "Untitled.txt".into(),
            date_modified_ms: 777.0,
            view_mode: ViewMode {
                preview: false,
                diff: false,
            },
        }
    }

    #[test]
    fn token_has_xfer_ts36_seq_rand_shape() {
        let t1 = next_token(1_700_000_000_000);
        let t2 = next_token(1_700_000_000_000);
        assert_ne!(t1, t2, "tokens must be unique");
        let parts: Vec<&str> = t1.splitn(4, '-').collect();
        assert_eq!(parts.len(), 4);
        assert_eq!(parts[0], "xfer");
        // ts36: base-36 of the ms timestamp.
        assert_eq!(parts[1], to_base36(1_700_000_000_000));
        // seq: monotonically increasing decimal.
        let s1: u64 = parts[2].parse().expect("seq is decimal");
        let s2: u64 = t2.splitn(4, '-').nth(2).unwrap().parse::<u64>().unwrap();
        assert_eq!(s2, s1 + 1);
        // rand: 1..=8 lowercase base-36 chars.
        assert!(!parts[3].is_empty() && parts[3].len() <= 8);
        assert!(parts[3]
            .chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit()));
    }

    #[test]
    fn base36_matches_js_to_string_36() {
        assert_eq!(to_base36(0), "0");
        assert_eq!(to_base36(35), "z");
        assert_eq!(to_base36(36), "10");
        // (1700000000000).toString(36) === 'loyw3v28'  (verified against node)
        assert_eq!(to_base36(1_700_000_000_000), "loyw3v28");
    }

    #[test]
    fn sweep_drops_only_entries_older_than_ttl() {
        let mut reg: HashMap<String, PendingTransfer> = HashMap::new();
        let now = 1_000_000u64;
        reg.insert(
            "fresh".into(),
            PendingTransfer {
                envelope: envelope(None, false),
                source_label: "main".into(),
                created_at_ms: now - TOKEN_TTL_MS, // exactly at TTL — kept
            },
        );
        reg.insert(
            "stale".into(),
            PendingTransfer {
                envelope: envelope(None, false),
                source_label: "main".into(),
                created_at_ms: now - TOKEN_TTL_MS - 1,
            },
        );
        sweep_expired(&mut reg, now);
        assert!(reg.contains_key("fresh"));
        assert!(!reg.contains_key("stale"));
    }

    #[test]
    fn adopted_file_for_untitled_buffer_is_verbatim_with_has_bom_false() {
        let env = envelope(None, true);
        let file = build_adopted_file(&env);
        assert_eq!(file.decoded_text, "saved");
        assert_eq!(file.encoding_id, "UTF-8");
        assert_eq!(file.eol_id, EolId::Crlf);
        assert_eq!(file.date_modified_ms, 777.0); // untitled: dragged mtime kept
        assert_eq!(file.file_path, None);
        assert!(!file.has_bom);
    }

    #[test]
    fn adopted_file_for_missing_path_keeps_path_and_reports_mtime_zero() {
        let env = envelope(Some("Z:/definitely/not/here/nope.txt"), false);
        let file = build_adopted_file(&env);
        assert_eq!(
            file.file_path.as_deref(),
            Some("Z:/definitely/not/here/nope.txt")
        );
        assert_eq!(file.date_modified_ms, 0.0);
    }

    #[test]
    fn adopted_file_for_live_path_re_stats_real_mtime() {
        let dir = std::env::temp_dir();
        let path = dir.join(format!("notepade-dragout-test-{}.txt", std::process::id()));
        std::fs::write(&path, "x").unwrap();
        let env = envelope(Some(path.to_string_lossy().as_ref()), false);
        let file = build_adopted_file(&env);
        assert!(
            file.date_modified_ms > 0.0,
            "live file must report a real mtime"
        );
        assert_ne!(file.date_modified_ms, 777.0);
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn pending_text_carried_only_when_modified() {
        // Mirrors the AdoptPayload shaping in drag_out_complete.
        let clean = envelope(None, false);
        let carried = if clean.is_modified {
            clean.pending_text.clone()
        } else {
            None
        };
        assert_eq!(carried, None);
        let dirty = envelope(None, true);
        let carried = if dirty.is_modified {
            dirty.pending_text.clone()
        } else {
            None
        };
        assert_eq!(carried.as_deref(), Some("dirty"));
    }
}
