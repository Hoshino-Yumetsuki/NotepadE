use serde::Serialize;
use std::collections::HashMap;
use std::fs::{self, File, OpenOptions};
use std::io::{Read, Seek, SeekFrom, Write};
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Condvar, LazyLock, Mutex};

use crate::contract::{EncodingId, EolId, SaveResult};
use crate::encoding::{decode_bytes, decode_bytes_with, encode_text};
use crate::eol::{apply_eol, detect_eol, normalize_to_lf};
use crate::mru;
use crate::result::NpResult;
use tauri::ipc::Channel;

const CHUNK_SIZE: usize = 512 * 1024;
const DETECTION_SAMPLE_SIZE: usize = 1024 * 1024;
const STREAM_WINDOW: usize = 4;
static STREAM_SEQ: AtomicU64 = AtomicU64::new(0);

struct StreamState {
    permits: usize,
    canceled: bool,
}

struct StreamControl {
    state: Mutex<StreamState>,
    wake: Condvar,
}

static STREAM_CONTROLS: LazyLock<Mutex<HashMap<String, Arc<StreamControl>>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

fn register_stream(stream_id: &str) -> Arc<StreamControl> {
    let control = Arc::new(StreamControl {
        state: Mutex::new(StreamState {
            permits: STREAM_WINDOW,
            canceled: false,
        }),
        wake: Condvar::new(),
    });
    if let Ok(mut controls) = STREAM_CONTROLS.lock() {
        controls.insert(stream_id.to_owned(), Arc::clone(&control));
    }
    control
}

fn remove_stream(stream_id: &str) {
    if let Ok(mut controls) = STREAM_CONTROLS.lock() {
        controls.remove(stream_id);
    }
}

fn update_stream_state(
    stream_id: &str,
    update: impl FnOnce(&mut StreamState),
) -> Result<(), String> {
    let control = STREAM_CONTROLS
        .lock()
        .map_err(|_| "Stream control lock poisoned".to_owned())?
        .get(stream_id)
        .cloned()
        .ok_or_else(|| "Unknown large-file stream".to_owned())?;
    let mut state = control
        .state
        .lock()
        .map_err(|_| "Stream state lock poisoned".to_owned())?;
    update(&mut state);
    control.wake.notify_all();
    Ok(())
}

fn wait_for_stream_permit(control: &StreamControl) -> Result<(), String> {
    let mut state = control
        .state
        .lock()
        .map_err(|_| "Stream state lock poisoned".to_owned())?;
    while state.permits == 0 && !state.canceled {
        state = control
            .wake
            .wait(state)
            .map_err(|_| "Stream state lock poisoned".to_owned())?;
    }
    if state.canceled {
        return Err("Large-file stream canceled".into());
    }
    state.permits -= 1;
    Ok(())
}
fn is_utf8_continuation(byte: u8) -> bool {
    (byte & 0b1100_0000) == 0b1000_0000
}

fn utf8_width(byte: u8) -> usize {
    match byte {
        0x00..=0x7f => 1,
        0xc2..=0xdf => 2,
        0xe0..=0xef => 3,
        0xf0..=0xf4 => 4,
        _ => 0,
    }
}

/// Keep a page boundary from splitting a decoded character or CRLF pair.
/// Bytes after the returned length have not been consumed; the next request
/// starts there. This avoids replacement characters and duplicate blank lines
/// when a fixed byte window happens to end inside UTF-8/UTF-16/UTF-32 text.
fn safe_chunk_len(bytes: &[u8], encoding_id: &str) -> usize {
    let mut len = bytes.len();
    if len == 0 {
        return 0;
    }

    if encoding_id.starts_with("UTF-8") {
        let mut start = len - 1;
        while start > 0 && is_utf8_continuation(bytes[start]) {
            start -= 1;
        }
        let width = utf8_width(bytes[start]);
        if width > len - start {
            len = start;
        }
        if len > 0 && bytes[len - 1] == b'\r' {
            len -= 1;
        }
    } else if encoding_id.starts_with("UTF-16") {
        len -= len % 2;
        if len >= 2 {
            let unit = if encoding_id.contains("BE") {
                u16::from_be_bytes([bytes[len - 2], bytes[len - 1]])
            } else {
                u16::from_le_bytes([bytes[len - 2], bytes[len - 1]])
            };
            if (0xd800..=0xdbff).contains(&unit) || unit == 0x000d {
                len -= 2;
            }
        }
    } else if encoding_id.starts_with("UTF-32") {
        len -= len % 4;
        if len >= 4 {
            let unit = if encoding_id.contains("BE") {
                u32::from_be_bytes(bytes[len - 4..len].try_into().unwrap())
            } else {
                u32::from_le_bytes(bytes[len - 4..len].try_into().unwrap())
            };
            if unit == 0x000d {
                len -= 4;
            }
        }
    } else if bytes[len - 1] == b'\r' {
        len -= 1;
    }

    // A malformed/truncated encoding must still make progress.
    if len == 0 {
        1.min(bytes.len())
    } else {
        len
    }
}

fn next_stream_id() -> String {
    STREAM_SEQ.fetch_add(1, Ordering::Relaxed).to_string()
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StreamedFileHeader {
    pub stream_id: String,
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
pub struct StreamedFileChunk {
    pub stream_id: String,
    pub offset: u64,
    pub next_offset: u64,
    pub text: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LargeFileSaveSession {
    pub session_id: String,
}

fn mtime_ms(meta: &std::fs::Metadata) -> f64 {
    meta.modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_secs_f64() * 1000.0)
        .unwrap_or(0.0)
}

fn read_head(path: &str) -> Result<Vec<u8>, String> {
    let mut file = File::open(path).map_err(|e| e.to_string())?;
    let mut bytes = Vec::with_capacity(DETECTION_SAMPLE_SIZE);
    std::io::Read::by_ref(&mut file)
        .take(DETECTION_SAMPLE_SIZE as u64)
        .read_to_end(&mut bytes)
        .map_err(|e| e.to_string())?;
    Ok(bytes)
}

fn read_chunk_from_file(
    file: &mut File,
    offset: u64,
    encoding_id: &str,
) -> Result<StreamedFileChunk, String> {
    file.seek(SeekFrom::Start(offset))
        .map_err(|e| e.to_string())?;
    let mut bytes = Vec::with_capacity(CHUNK_SIZE);
    std::io::Read::by_ref(file)
        .take(CHUNK_SIZE as u64)
        .read_to_end(&mut bytes)
        .map_err(|e| e.to_string())?;
    if bytes.is_empty() {
        return Err("Unexpected end of file while streaming".into());
    }
    let consumed = safe_chunk_len(&bytes, encoding_id);
    let decoded = decode_bytes_with(&bytes[..consumed], encoding_id);
    Ok(StreamedFileChunk {
        stream_id: String::new(),
        offset,
        next_offset: offset + consumed as u64,
        text: normalize_to_lf(&decoded.decoded_text),
    })
}

fn stream_chunks_with<F>(
    path: &str,
    encoding_id: &str,
    stream_id: String,
    mut send: F,
) -> Result<(), String>
where
    F: FnMut(StreamedFileChunk) -> Result<(), String>,
{
    let total_bytes = fs::metadata(path).map_err(|e| e.to_string())?.len();
    let mut file = File::open(path).map_err(|e| e.to_string())?;
    let mut offset = 0;
    while offset < total_bytes {
        let mut chunk = read_chunk_from_file(&mut file, offset, encoding_id)?;
        if chunk.next_offset <= offset || chunk.next_offset > total_bytes {
            return Err("Invalid streamed chunk boundary".into());
        }
        chunk.stream_id = stream_id.clone();
        offset = chunk.next_offset;
        send(chunk)?;
    }
    Ok(())
}

fn stream_chunks_inner(
    path: &str,
    encoding_id: &str,
    stream_id: String,
    on_chunk: Channel<StreamedFileChunk>,
) -> Result<(), String> {
    let control = register_stream(&stream_id);
    let result = stream_chunks_with(path, encoding_id, stream_id.clone(), |chunk| {
        wait_for_stream_permit(&control)?;
        on_chunk
            .send(chunk)
            .map_err(|error| format!("stream channel closed: {error}"))
    });
    remove_stream(&stream_id);
    result
}

fn session_path(session_id: &str) -> Result<PathBuf, String> {
    let path = PathBuf::from(session_id);
    let root = std::env::temp_dir();
    if !path.starts_with(&root) {
        return Err("Invalid large-file edit session".into());
    }
    Ok(path)
}

fn new_session_path() -> PathBuf {
    std::env::temp_dir().join(format!("notepade-large-{}.tmp", next_stream_id()))
}

/// Read only a small header sample. The old implementation decoded and cloned the
/// entire file before returning, which exhausted WebView2 on multi-GB text files.
#[tauri::command]
pub async fn file_open_streamed(
    app: tauri::AppHandle,
    _window: tauri::WebviewWindow,
    path: String,
    stream_id: Option<String>,
) -> NpResult<StreamedFileHeader> {
    let read_path = path.clone();
    let prepared = tauri::async_runtime::spawn_blocking(move || {
        let meta = fs::metadata(&read_path).map_err(|e| e.to_string())?;
        let sample = read_head(&read_path)?;
        let decoded = decode_bytes(&sample);
        Ok::<_, String>((meta, decoded))
    })
    .await;
    let (meta, decoded) = match prepared {
        Ok(Ok(value)) => value,
        Ok(Err(error)) => return NpResult::Err(error),
        Err(error) => return NpResult::Err(format!("file read task failed: {error}")),
    };
    if let Ok(root) = mru::user_data_root(&app) {
        mru::add_recent(&root, &path);
    }
    let total_bytes = meta.len();
    let chunk_count = total_bytes.div_ceil(CHUNK_SIZE as u64) as u32;
    NpResult::Ok(StreamedFileHeader {
        stream_id: stream_id.unwrap_or_else(next_stream_id),
        encoding_id: decoded.encoding_id,
        eol_id: detect_eol(&decoded.decoded_text),
        date_modified_ms: mtime_ms(&meta),
        file_path: path,
        has_bom: decoded.has_bom,
        baseline_hash: 0,
        baseline_length: 0,
        chunk_count,
        total_bytes,
    })
}

/// Stream one opened file through a single native read and a Tauri Channel.
#[tauri::command]
pub async fn file_stream_chunks(
    path: String,
    encoding_id: String,
    stream_id: String,
    on_chunk: Channel<StreamedFileChunk>,
) -> NpResult<()> {
    tauri::async_runtime::spawn_blocking(move || {
        stream_chunks_inner(&path, &encoding_id, stream_id, on_chunk)
    })
    .await
    .map_or_else(
        |error| NpResult::Err(format!("file stream task failed: {error}")),
        NpResult::from,
    )
}
#[tauri::command]
pub fn file_stream_ack(stream_id: String, count: u32) -> NpResult<()> {
    NpResult::from(update_stream_state(&stream_id, |state| {
        state.permits = state.permits.saturating_add(count as usize);
    }))
}

#[tauri::command]
pub fn file_stream_cancel(stream_id: String) -> NpResult<()> {
    NpResult::from(update_stream_state(&stream_id, |state| {
        state.canceled = true;
    }))
}

fn bom_len(encoding_id: &str) -> usize {
    match encoding_id {
        "UTF-8-BOM" => 3,
        "UTF-16 LE BOM" | "UTF-16 BE BOM" => 2,
        "UTF-32 LE BOM" | "UTF-32 BE BOM" => 4,
        _ => 0,
    }
}

fn encode_snapshot_chunk(
    text: &str,
    encoding_id: &str,
    eol_id: EolId,
    first: bool,
) -> Result<Vec<u8>, String> {
    let mut bytes = encode_text(&apply_eol(text, eol_id), encoding_id)?;
    if !first {
        let prefix = bom_len(encoding_id).min(bytes.len());
        bytes.drain(..prefix);
    }
    Ok(bytes)
}

#[tauri::command]
pub async fn file_save_large_start() -> NpResult<LargeFileSaveSession> {
    tauri::async_runtime::spawn_blocking(|| {
        let path = new_session_path();
        File::create(&path).map_err(|e| e.to_string())?;
        Ok::<_, String>(LargeFileSaveSession {
            session_id: path.to_string_lossy().into_owned(),
        })
    })
    .await
    .map_or_else(
        |error| NpResult::Err(format!("large-file save start failed: {error}")),
        NpResult::from,
    )
}

#[tauri::command]
pub async fn file_save_large_chunk(
    session_id: String,
    text: String,
    first: bool,
    encoding_id: String,
    eol_id: EolId,
) -> NpResult<()> {
    tauri::async_runtime::spawn_blocking(move || {
        let path = session_path(&session_id)?;
        let bytes = encode_snapshot_chunk(&text, &encoding_id, eol_id, first)?;
        let mut file = OpenOptions::new()
            .append(true)
            .open(path)
            .map_err(|e| e.to_string())?;
        file.write_all(&bytes).map_err(|e| e.to_string())
    })
    .await
    .map_or_else(
        |error| NpResult::Err(format!("large-file save chunk failed: {error}")),
        NpResult::from,
    )
}

#[tauri::command]
pub async fn file_save_large_finish(
    session_id: String,
    file_path: String,
    encoding_id: String,
    eol_id: EolId,
) -> NpResult<SaveResult> {
    tauri::async_runtime::spawn_blocking(move || {
        let session = session_path(&session_id)?;
        let target_tmp = PathBuf::from(format!("{file_path}.notepade-save-tmp"));
        fs::copy(&session, &target_tmp).map_err(|e| e.to_string())?;
        fs::remove_file(&file_path).map_err(|e| e.to_string())?;
        fs::rename(&target_tmp, &file_path).map_err(|e| e.to_string())?;
        let meta = fs::metadata(&file_path).map_err(|e| e.to_string())?;
        fs::remove_file(session).map_err(|e| e.to_string())?;
        Ok::<_, String>(SaveResult {
            file_path,
            date_modified_ms: mtime_ms(&meta),
            encoding_id,
            eol_id,
            baseline_hash: 0,
            baseline_length: 0,
        })
    })
    .await
    .map_or_else(
        |error| NpResult::Err(format!("large-file save finish failed: {error}")),
        NpResult::from,
    )
}

#[tauri::command]
pub async fn file_discard_large(session_id: String) -> NpResult<()> {
    tauri::async_runtime::spawn_blocking(move || {
        let path = session_path(&session_id)?;
        fs::remove_file(path).map_err(|e| e.to_string())
    })
    .await
    .map_or_else(
        |error| NpResult::Err(format!("large-file discard task failed: {error}")),
        NpResult::from,
    )
}

/// Get file size without reading it (used by the renderer to select the viewer).
#[tauri::command]
pub async fn file_get_size(path: String) -> NpResult<u64> {
    match fs::metadata(&path) {
        Ok(meta) => NpResult::Ok(meta.len()),
        Err(e) => NpResult::Err(e.to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn safe_chunk_len_preserves_utf8_and_crlf_boundaries() {
        assert_eq!(safe_chunk_len(&[b'a', 0xe4], "UTF-8"), 1);
        assert_eq!(safe_chunk_len(&[b'a', 0xe4, 0xbd, 0xa0], "UTF-8"), 4);
        assert_eq!(safe_chunk_len(b"abc\r", "UTF-8"), 3);
    }

    #[test]
    fn read_chunk_does_not_split_crlf_at_page_boundary() {
        let path =
            std::env::temp_dir().join(format!("notepade-large-file-{}.txt", next_stream_id()));
        let mut bytes = vec![b'a'; CHUNK_SIZE - 1];
        bytes.extend_from_slice(b"\r\n");
        fs::write(&path, &bytes).unwrap();

        let mut file = File::open(&path).unwrap();
        let first = read_chunk_from_file(&mut file, 0, "UTF-8").unwrap();
        let second = read_chunk_from_file(&mut file, first.next_offset, "UTF-8").unwrap();
        fs::remove_file(path).unwrap();

        assert_eq!(first.next_offset, (CHUNK_SIZE - 1) as u64);
        assert!(!first.text.ends_with('\n'));
        assert_eq!(second.text, "\n");
        assert_eq!(second.next_offset - second.offset, 2);
    }

    #[test]
    fn stream_ids_are_distinct() {
        assert_ne!(next_stream_id(), next_stream_id());
    }
    #[test]
    fn stream_chunks_delivers_ordered_normalized_content() {
        let path =
            std::env::temp_dir().join(format!("notepade-large-file-{}.txt", next_stream_id()));
        let source = "支付宝 large-file 测试行\r\n".repeat(100_000);
        fs::write(&path, source.as_bytes()).unwrap();

        let mut chunks = Vec::new();
        stream_chunks_with(
            &path.to_string_lossy(),
            "UTF-8",
            "test-stream".into(),
            |chunk| {
                chunks.push(chunk);
                Ok(())
            },
        )
        .unwrap();
        fs::remove_file(path).unwrap();

        let mut expected_offset = 0;
        let mut decoded = String::new();
        for chunk in &chunks {
            assert_eq!(chunk.stream_id, "test-stream");
            assert_eq!(chunk.offset, expected_offset);
            assert!(chunk.next_offset > chunk.offset);
            expected_offset = chunk.next_offset;
            decoded.push_str(&chunk.text);
        }
        assert_eq!(expected_offset, source.len() as u64);
        assert_eq!(decoded, source.replace("\r\n", "\n"));
    }

    #[test]
    fn read_chunk_is_bounded_and_normalizes_eol() {
        let path =
            std::env::temp_dir().join(format!("notepade-large-file-{}.txt", next_stream_id()));
        let mut file = fs::File::create(&path).unwrap();
        file.write_all(b"one\r\ntwo\r\n").unwrap();
        drop(file);
        let mut file = File::open(&path).unwrap();
        let chunk = read_chunk_from_file(&mut file, 0, "UTF-8").unwrap();
        fs::remove_file(path).unwrap();
        assert_eq!(chunk.text, "one\ntwo\n");
        assert_eq!(chunk.next_offset, 10);
    }
}
