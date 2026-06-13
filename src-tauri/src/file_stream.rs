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
    let bytes = match std::fs::read(&path) {
        Ok(b) => b,
        Err(e) => return NpResult::Err(e.to_string()),
    };
    let decoded = decode_bytes(&bytes);
    let eol_id = detect_eol(&decoded.decoded_text);
    let normalized = normalize_to_lf(&decoded.decoded_text);
    let bl_hash = hash_text(&normalized);
    let bl_length = crate::hash::utf16_len(&normalized);
    let meta = match std::fs::metadata(&path) {
        Ok(m) => m,
        Err(e) => return NpResult::Err(e.to_string()),
    };

    if let Ok(root) = mru::user_data_root(&app) {
        mru::add_recent(&root, &path);
    }

    let chunks = split_chunks(&normalized, CHUNK_SIZE);
    let chunk_count = chunks.len() as u32;

    let header = StreamedFileHeader {
        encoding_id: decoded.encoding_id,
        eol_id,
        date_modified_ms: mtime_ms(&meta),
        file_path: path,
        has_bom: decoded.has_bom,
        baseline_hash: bl_hash,
        baseline_length: bl_length,
        chunk_count,
        total_bytes: normalized.len() as u64,
    };

    // Emit chunks asynchronously so the renderer can process them progressively.
    let owned_chunks: Vec<String> = chunks.into_iter().map(|s| s.to_string()).collect();
    let window_clone = window.clone();
    tauri::async_runtime::spawn(async move {
        for (i, text) in owned_chunks.into_iter().enumerate() {
            let is_last = i as u32 == chunk_count - 1;
            let _ = window_clone.emit("notepads:evt:file:chunk", FileChunk {
                index: i as u32,
                text,
                is_last,
            });
            tauri::async_runtime::spawn(async {});
            // Small yield between chunks
            std::thread::yield_now();
        }
    });

    NpResult::Ok(header)
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
