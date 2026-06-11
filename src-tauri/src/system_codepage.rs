//! System ANSI code page resolver — port of src/main/system-codepage.ts
//! (task #2).
//!
//! UWP's encoding ladder uses `Encoding.GetEncoding(0)` (the OS ANSI code
//! page, ACP) as a fallback when detection is ambiguous. The Electron port
//! shelled out to `reg query`; here we call GetACP() directly via the windows
//! crate (the team-plan upgrade). Resolved ONCE and cached; every failure
//! path falls back to 1252 so this can never break the encoding engine.
//! Non-Windows is always 1252.

use std::sync::OnceLock;

static CACHED_ACP: OnceLock<u32> = OnceLock::new();

#[cfg(windows)]
fn resolve_acp() -> u32 {
    // GetACP() cannot fail (returns the current ANSI code page identifier),
    // but guard the degenerate 0 anyway — fallback 1252.
    let cp = unsafe { windows::Win32::Globalization::GetACP() };
    if cp > 0 { cp } else { 1252 }
}

#[cfg(not(windows))]
fn resolve_acp() -> u32 {
    1252
}

/// Return the OS ANSI code page number (e.g. 1252, 932, 936). Resolved lazily
/// and cached. Falls back to 1252 off Windows or on failure.
pub fn system_ansi_codepage() -> u32 {
    *CACHED_ACP.get_or_init(resolve_acp)
}

#[cfg(test)]
mod tests {
    use super::*;

    // Port of system-codepage.test.ts: the resolver returns a positive code
    // page, is stable across calls (cached), and the fallback is 1252.

    #[test]
    fn returns_positive_codepage() {
        let cp = system_ansi_codepage();
        assert!(cp > 0, "ACP must be positive, got {cp}");
    }

    #[test]
    fn is_cached_and_stable() {
        assert_eq!(system_ansi_codepage(), system_ansi_codepage());
    }

    #[cfg(not(windows))]
    #[test]
    fn non_windows_is_1252() {
        assert_eq!(system_ansi_codepage(), 1252);
    }
}
