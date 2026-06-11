//! EOL detection + application — port of src/main/eol.ts (task #2).
//!
//! Port of UWP's LineEndingUtility. Detected ONCE from raw text on read;
//! re-applied only at save. Default = CRLF.

use crate::contract::EolId;
use crate::result::NpResult;

/// Detect the EOL style from raw decoded text.
///   contains "\r\n" -> crlf
///   else contains "\r" -> cr
///   else contains "\n" -> lf
///   else (no breaks)  -> crlf (UWP default)
pub fn detect_eol(text: &str) -> EolId {
    if text.contains("\r\n") {
        return EolId::Crlf;
    }
    if text.contains('\r') {
        return EolId::Cr;
    }
    if text.contains('\n') {
        return EolId::Lf;
    }
    EolId::Crlf
}

fn eol_string(eol: EolId) -> &'static str {
    match eol {
        EolId::Crlf => "\r\n",
        EolId::Cr => "\r",
        EolId::Lf => "\n",
    }
}

/// Normalize any mix of CRLF/CR/LF to single '\n' (the renderer's shadow-buffer
/// form). MAIN sends decodedText raw; the renderer normalizes — but apply_eol
/// assumes a '\n'-normalized input, so we normalize here defensively.
pub fn normalize_to_lf(text: &str) -> String {
    text.replace("\r\n", "\n").replace('\r', "\n")
}

/// Re-apply the target EOL to a '\n'-normalized text just before encoding.
pub fn apply_eol(lf_text: &str, eol: EolId) -> String {
    let normalized = normalize_to_lf(lf_text);
    if eol == EolId::Lf {
        return normalized;
    }
    normalized.replace('\n', eol_string(eol))
}

/// Parse the wire EolId label ('crlf' | 'cr' | 'lf').
pub fn parse_eol_id(s: &str) -> Option<EolId> {
    match s {
        "crlf" => Some(EolId::Crlf),
        "cr" => Some(EolId::Cr),
        "lf" => Some(EolId::Lf),
        _ => None,
    }
}

/// `encoding.convertEol(text, eolId)` — convert a '\n'-normalized text to the
/// target style (preview only; the renderer never re-derives EOL itself).
#[tauri::command]
pub fn encoding_convert_eol(text: String, eol_id: String) -> NpResult<String> {
    match parse_eol_id(&eol_id) {
        Some(eol) => NpResult::Ok(apply_eol(&text, eol)),
        None => NpResult::Err(format!("unknown eolId: {eol_id}")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // Port of the eol.ts behavior spec (LineEndingUtility parity).

    #[test]
    fn detect_crlf_wins_over_cr_and_lf() {
        assert_eq!(detect_eol("a\r\nb\rc\nd"), EolId::Crlf);
        assert_eq!(detect_eol("a\r\nb"), EolId::Crlf);
    }

    #[test]
    fn detect_cr_beats_lone_lf() {
        assert_eq!(detect_eol("a\rb\nc"), EolId::Cr);
        assert_eq!(detect_eol("a\rb"), EolId::Cr);
    }

    #[test]
    fn detect_lf() {
        assert_eq!(detect_eol("a\nb"), EolId::Lf);
    }

    #[test]
    fn detect_no_breaks_defaults_crlf() {
        assert_eq!(detect_eol("abc"), EolId::Crlf);
        assert_eq!(detect_eol(""), EolId::Crlf);
    }

    #[test]
    fn normalize_mixed_to_lf() {
        assert_eq!(normalize_to_lf("a\r\nb\rc\nd"), "a\nb\nc\nd");
        assert_eq!(normalize_to_lf("\r\n\r\n"), "\n\n");
        assert_eq!(normalize_to_lf("\r"), "\n");
    }

    #[test]
    fn apply_eol_crlf() {
        assert_eq!(apply_eol("a\nb\nc", EolId::Crlf), "a\r\nb\r\nc");
    }

    #[test]
    fn apply_eol_cr() {
        assert_eq!(apply_eol("a\nb", EolId::Cr), "a\rb");
    }

    #[test]
    fn apply_eol_lf_is_normalize() {
        assert_eq!(apply_eol("a\r\nb\rc", EolId::Lf), "a\nb\nc");
    }

    #[test]
    fn apply_eol_normalizes_defensively_first() {
        // Mixed input does not double-expand (\r\n -> \n first, then re-apply).
        assert_eq!(apply_eol("a\r\nb\rc\nd", EolId::Crlf), "a\r\nb\r\nc\r\nd");
    }

    #[test]
    fn convert_eol_command_envelope() {
        assert_eq!(
            encoding_convert_eol("a\nb".into(), "crlf".into()),
            NpResult::Ok("a\r\nb".to_string())
        );
        assert!(matches!(
            encoding_convert_eol("a".into(), "bogus".into()),
            NpResult::Err(_)
        ));
    }
}
