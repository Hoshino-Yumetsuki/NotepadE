use serde::Serialize;
use tauri::Emitter;

use crate::contract::{EncodingId, EolId};
use crate::encoding::decode_bytes;
use crate::eol::{detect_eol, normalize_to_lf};
use crate::hash::hash_text;
use crate::mru;
use crate::result::NpResult;

const CHUNK_SIZE: usize = 512 * 1024; // 512KB per chunk

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StreamedFileHeader {
    pub encoding_id: EncodingId,
    pub eol_id: EolId,
    pub date_modified_ms: f64,
    pub file_path: String,
    pub has_bom: bool,
    pub baseline_hash: u64,
    pub baseline_length: u64,
    pub chunk_count: u32,
    pub total_bytes: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileChunk {
    pub index: u32,
    pub text: String,
    pub is_last: bool,
}

fn mtime_ms(meta: &std::fs::Metadata) -> f64 {
    meta.modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_secs_f64() * 1000.0)
        .unwrap_or(0.0)
}

/// Split a string into chunks at valid UTF-8 char boundaries.
fn split_chunks(text: &str, chunk_size: usize) -> Vec<&str> {
    let mut chunks = Vec::new();
    let mut start = 0;
    while start < text.len() {
        let end = (start + chunk_size).min(text.len());
        // Find a valid char boundary at or before `end`
        let end = if end >= text.len() {
            text.len()
        } else {
            let mut e = end;
            while !text.is_char_boundary(e) {
                e -= 1;
            }
            e
        };
        chunks.push(&text[start..end]);
        start = end;
    }
    chunks
}

/// Get file size without reading it (used by renderer to decide streaming vs direct).
#[tauri::command]
pub async fn file_get_size(path: String) -> NpResult<u64> {
    match std::fs::metadata(&path) {
        Ok(meta) => NpResult::Ok(meta.len()),
        Err(e) => NpResult::Err(e.to_string()),
    }
}

/// Open a file using streamed delivery. Returns the header immediately, then emits
/// chunks via Tauri events. The renderer listens for `notepads:evt:file:chunk` events.
#[tauri::command]
pub async fn file_open_streamed(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    path: String,
) -> NpResult<StreamedFileHeader> {
    // The whole read + encoding-detect/decode + LF-normalize is CPU/IO-bound and
    // must NOT run on the Tauri async runtime thread (it would stall every other
    // command — including the renderer's own IPC — until the entire file is
    // processed, which is the "long up-front spinner"). Hand it to a blocking
    // worker so the runtime stays responsive; we only await its handle.
    let read_path = path.clone();
    let prepared = tauri::async_runtime::spawn_blocking(move || -> Result<Prepared, String> {
        let bytes = std::fs::read(&read_path).map_err(|e| e.to_string())?;
        let meta = std::fs::metadata(&read_path).map_err(|e| e.to_string())?;
        let decoded = decode_bytes(&bytes);
        let eol_id = detect_eol(&decoded.decoded_text);
        let normalized = normalize_to_lf(&decoded.decoded_text);
        let bl_hash = hash_text(&normalized);
        let bl_length = crate::hash::utf16_len(&normalized);
        Ok(Prepared {
            encoding_id: decoded.encoding_id,
            has_bom: decoded.has_bom,
            eol_id,
            normalized,
            bl_hash,
            bl_length,
            mtime_ms: mtime_ms(&meta),
        })
    })
    .await;

    let prepared = match prepared {
        Ok(Ok(p)) => p,
        Ok(Err(e)) => return NpResult::Err(e),
        Err(e) => return NpResult::Err(format!("file read task failed: {e}")),
    };

    if let Ok(root) = mru::user_data_root(&app) {
        mru::add_recent(&root, &path);
    }

    let owned_chunks: Vec<String> = split_chunks(&prepared.normalized, CHUNK_SIZE)
        .into_iter()
        .map(|s| s.to_string())
        .collect();
    let chunk_count = owned_chunks.len() as u32;

    let header = StreamedFileHeader {
        encoding_id: prepared.encoding_id,
        eol_id: prepared.eol_id,
        date_modified_ms: prepared.mtime_ms,
        file_path: path,
        has_bom: prepared.has_bom,
        baseline_hash: prepared.bl_hash,
        baseline_length: prepared.bl_length,
        chunk_count,
        total_bytes: prepared.normalized.len() as u64,
    };

    // Emit chunks from a spawned task, yielding the async executor between each
    // so the renderer paints progressively instead of receiving the whole burst
    // at once. `tokio::task::yield_now` actually returns control to the runtime
    // (std::thread::yield_now does not yield the async executor).
    let window_clone = window.clone();
    tauri::async_runtime::spawn(async move {
        for (i, text) in owned_chunks.into_iter().enumerate() {
            let is_last = i as u32 == chunk_count - 1;
            let _ = window_clone.emit(
                "notepads:evt:file:chunk",
                FileChunk {
                    index: i as u32,
                    text,
                    is_last,
                },
            );
            tokio::task::yield_now().await;
        }
    });

    NpResult::Ok(header)
}

/// Result of the blocking read+decode+normalize step (see `file_open_streamed`).
struct Prepared {
    encoding_id: EncodingId,
    has_bom: bool,
    eol_id: EolId,
    normalized: String,
    bl_hash: u64,
    bl_length: u64,
    mtime_ms: f64,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn split_chunks_basic() {
        let text = "abcdefghij";
        let chunks = split_chunks(text, 3);
        assert_eq!(chunks, vec!["abc", "def", "ghi", "j"]);
    }

    #[test]
    fn split_chunks_exact() {
        let text = "abcdef";
        let chunks = split_chunks(text, 3);
        assert_eq!(chunks, vec!["abc", "def"]);
    }

    #[test]
    fn split_chunks_respects_char_boundary() {
        let text = "a\u{00e9}"; // "aé" — é is 2 bytes
        let chunks = split_chunks(text, 2);
        assert_eq!(chunks, vec!["a", "\u{00e9}"]);
    }

    #[test]
    fn split_chunks_cjk() {
        let text = "\u{4f60}\u{597d}\u{4e16}\u{754c}"; // "你好世界" — 3 bytes each
        let chunks = split_chunks(text, 4);
        assert_eq!(chunks[0], "\u{4f60}");
        assert_eq!(chunks.len(), 4);
    }

    #[test]
    fn split_chunks_empty() {
        let chunks = split_chunks("", 512);
        assert!(chunks.is_empty());
    }
}
