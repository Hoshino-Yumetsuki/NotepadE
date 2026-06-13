use crate::result::NpResult;
use xxhash_rust::xxh3::xxh3_64;

pub fn hash_text(text: &str) -> u64 {
    xxh3_64(text.as_bytes())
}

/// UTF-16 code-unit count — matches JavaScript `string.length` / CodeMirror `doc.length`.
pub fn utf16_len(text: &str) -> u64 {
    text.encode_utf16().count() as u64
}

#[tauri::command]
pub async fn compute_text_hash(text: String) -> NpResult<u64> {
    NpResult::Ok(hash_text(&text))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn deterministic_hash() {
        let a = hash_text("hello world");
        let b = hash_text("hello world");
        assert_eq!(a, b);
    }

    #[test]
    fn different_text_different_hash() {
        assert_ne!(hash_text("abc"), hash_text("abd"));
    }

    #[test]
    fn empty_string_is_stable() {
        let h = hash_text("");
        assert_eq!(h, hash_text(""));
        assert_ne!(h, 0);
    }
}
