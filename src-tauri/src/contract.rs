//! Rust mirror of `src/shared/ipc-contract.ts` — THE frozen `window.notepads`
//! payload contract (PA-8). Field names serialize camelCase to match the TS
//! side byte-for-byte; the .ts file is the spec, this file follows it.
//!
//! FROZEN after scaffold (task #1). Workers consume these types; shape changes
//! go through team-lead.

#![allow(dead_code)] // stubs land first; tasks #2-#5 wire the consumers

use serde::{Deserialize, Serialize};

// ---------------------------------------------------------------------------
//  Shared primitives
// ---------------------------------------------------------------------------

/// Opaque encoding label, e.g. "UTF-8", "UTF-8-BOM", "UTF-16 LE BOM", "ANSI",
/// or an ANSI table label like "Western (windows-1252)".
pub type EncodingId = String;

/// End-of-line style label. Mirrors UWP's LineEnding enum {Crlf, Cr, Lf}.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum EolId {
    Crlf,
    Cr,
    Lf,
}

// ---------------------------------------------------------------------------
//  file
// ---------------------------------------------------------------------------

/// Authoritative file descriptor produced by the core after reading + decoding.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenedFile {
    pub decoded_text: String,
    pub encoding_id: EncodingId,
    pub eol_id: EolId,
    pub date_modified_ms: f64,
    pub file_path: Option<String>,
    pub has_bom: bool,
}

/// Arguments for `file.save`. shadowText is the renderer's '\n'-normalized doc.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveArgs {
    pub file_path: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub shadow_text: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub encoding_id: Option<EncodingId>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub eol_id: Option<EolId>,
}

/// `SaveArgs` minus filePath, plus dialog seeds (TS: SaveAsArgs).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveAsArgs {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub shadow_text: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub encoding_id: Option<EncodingId>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub eol_id: Option<EolId>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub suggested_name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub default_dir: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveResult {
    pub file_path: String,
    pub date_modified_ms: f64,
    pub encoding_id: EncodingId,
    pub eol_id: EolId,
}

/// `file.revalidatePath` payload.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RevalidateResult {
    pub exists: bool,
    pub date_modified_ms: f64,
}

// ---------------------------------------------------------------------------
//  recent
// ---------------------------------------------------------------------------

/// A single in-app recent-files entry (most-recent-first ordering).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecentEntry {
    pub path: String,
    pub display_name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub mtime_ms: Option<f64>,
}

// ---------------------------------------------------------------------------
//  encoding
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AnsiEncodingEntry {
    pub code_page: u32,
    pub label: String,
}

// ---------------------------------------------------------------------------
//  session
// ---------------------------------------------------------------------------

/// Per-tab view-mode flags (preview / diff).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ViewMode {
    pub preview: bool,
    pub diff: bool,
}

/// Per-tab session record. Stores ABSOLUTE PATHS (PA-4 FAL substitute).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionTab {
    pub editor_id: String,
    pub file_path: Option<String>,
    pub encoding_id: EncodingId,
    pub eol_id: EolId,
    pub is_modified: bool,
    pub selection_start: f64,
    pub selection_end: f64,
    pub scroll_top: f64,
    pub view_mode: ViewMode,
    /// True when filePath was set but missing at loadLast re-validation.
    /// Optional + defaults falsy (purely additive to the contract).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub unavailable: Option<bool>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionSnapshot {
    /// Always 1 (TS literal type `version: 1`).
    pub version: u32,
    pub tabs: Vec<SessionTab>,
    pub active_editor_id: Option<String>,
}

/// `session.snapshot` result payload.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SnapshotResult {
    pub written: bool,
}

// ---------------------------------------------------------------------------
//  settings — 24 fields, DEFAULT_SETTINGS verbatim (ipc-contract.ts)
// ---------------------------------------------------------------------------

/// The full persisted settings bag. Serde defaults mirror DEFAULT_SETTINGS so a
/// partially-present Settings.json deep-merges over defaults on deserialize.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    // --- Text & Editor ---
    pub editor_font_family: String,
    pub editor_font_size: f64,
    /// 'normal' | 'italic' | 'oblique'
    pub editor_font_style: String,
    /// OpenType weight (400 = Normal).
    pub editor_font_weight: f64,
    /// 'noWrap' | 'wrap'
    pub text_wrapping: String,
    pub display_line_highlighter: bool,
    pub display_line_numbers: bool,
    pub highlight_misspelled_words: bool,
    pub default_line_ending: EolId,
    pub default_encoding: EncodingId,
    /// 'auto' | 'utf-8' | 'ansi'
    pub default_decoding: String,
    /// -1 | 2 | 4 | 8 (-1 = real tab)
    pub tab_indents: i32,
    /// 'bing' | 'google' | 'duckDuckGo' | 'custom'
    pub search_engine: String,
    pub custom_search_url: String,
    // --- Personalization ---
    /// 'light' | 'dark' | 'system'
    pub theme_mode: String,
    /// Background tint opacity 0..1.
    pub tint_opacity: f64,
    pub use_windows_accent_color: bool,
    /// Custom accent as #RRGGBB; '' = follow the resolved app accent.
    pub custom_accent_color: String,
    // --- Advanced ---
    pub show_status_bar: bool,
    pub smart_copy: bool,
    pub session_snapshot: bool,
    pub always_open_new_window: bool,
    pub exit_when_last_tab_closed: bool,
    /// BCP-47 tag, or '' = follow the OS UI language.
    pub app_language: String,
    pub open_with_context_menu: bool,
    /// Managed wallpaper file name inside {userData}/wallpaper/, '' = none.
    pub wallpaper_file_name: String,
    /// 'blur' | 'opacity'
    pub wallpaper_effect: String,
}

impl Default for Settings {
    /// Verbatim DEFAULT_SETTINGS from ipc-contract.ts.
    fn default() -> Self {
        Settings {
            editor_font_family: "Consolas".into(),
            editor_font_size: 14.0,
            editor_font_style: "normal".into(),
            editor_font_weight: 400.0,
            text_wrapping: "noWrap".into(),
            display_line_highlighter: true,
            display_line_numbers: true,
            highlight_misspelled_words: false,
            default_line_ending: EolId::Crlf,
            default_encoding: "UTF-8".into(),
            default_decoding: "auto".into(),
            tab_indents: -1,
            search_engine: "bing".into(),
            custom_search_url: String::new(),
            theme_mode: "system".into(),
            tint_opacity: 0.5,
            use_windows_accent_color: true,
            custom_accent_color: String::new(),
            show_status_bar: true,
            smart_copy: false,
            session_snapshot: false,
            always_open_new_window: false,
            exit_when_last_tab_closed: false,
            app_language: String::new(),
            open_with_context_menu: false,
            wallpaper_file_name: String::new(),
            wallpaper_effect: "blur".into(),
        }
    }
}

// ---------------------------------------------------------------------------
//  window
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BrokerRequestArgs {
    pub paths: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub force_new_window: Option<bool>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FullScreenResult {
    pub is_full_screen: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CompactOverlayResult {
    pub is_compact_overlay: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MaximizedResult {
    pub is_maximized: bool,
}

// ---------------------------------------------------------------------------
//  dragOut / editor adopt-release
// ---------------------------------------------------------------------------

/// JSON envelope serialized for a cross-window tab transfer (no undo stack).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DragEnvelope {
    pub source_window_id: f64,
    pub editor_id: String,
    pub file_path: Option<String>,
    pub last_saved_text: String,
    /// Only present (non-null) when the tab is dirty.
    pub pending_text: Option<String>,
    pub encoding_id: EncodingId,
    pub eol_id: EolId,
    pub is_modified: bool,
    pub file_name_placeholder: String,
    pub date_modified_ms: f64,
    pub view_mode: ViewMode,
}

/// `dragOut.begin` result payload.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DragToken {
    pub token: String,
}

/// MAIN -> renderer push payload for `notepads:evt:editor:adopt`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AdoptPayload {
    pub editor_id: String,
    pub file: OpenedFile,
    pub pending_text: Option<String>,
    pub is_modified: bool,
    pub drop_index: f64,
    pub view_mode: ViewMode,
}

/// MAIN -> renderer push payload for `notepads:evt:editor:release`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReleasePayload {
    pub editor_id: String,
}

// ---------------------------------------------------------------------------
//  theme
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ThemeState {
    /// 'light' | 'dark'
    pub os_theme: String,
    /// Accent color as #RRGGBB.
    pub accent_color: String,
    pub high_contrast: bool,
}

// ---------------------------------------------------------------------------
//  app activation
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ActivationEvent {
    pub paths: Vec<String>,
    pub cwd: String,
    pub protocol_url: Option<String>,
}

// ---------------------------------------------------------------------------
//  shell
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShareArgs {
    pub title: String,
    pub text: String,
}

// ---------------------------------------------------------------------------
//  wallpaper
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WallpaperState {
    /// Managed file name inside {userData}/wallpaper/; '' when none is set.
    pub file_name: String,
    /// The image as a `data:<mime>;base64,...` URL, or null when none is set.
    pub data_url: Option<String>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn settings_defaults_serialize_camel_case_verbatim() {
        let json = serde_json::to_value(Settings::default()).unwrap();
        assert_eq!(
            json,
            serde_json::json!({
                "editorFontFamily": "Consolas",
                "editorFontSize": 14.0,
                "editorFontStyle": "normal",
                "editorFontWeight": 400.0,
                "textWrapping": "noWrap",
                "displayLineHighlighter": true,
                "displayLineNumbers": true,
                "highlightMisspelledWords": false,
                "defaultLineEnding": "crlf",
                "defaultEncoding": "UTF-8",
                "defaultDecoding": "auto",
                "tabIndents": -1,
                "searchEngine": "bing",
                "customSearchUrl": "",
                "themeMode": "system",
                "tintOpacity": 0.5,
                "useWindowsAccentColor": true,
                "customAccentColor": "",
                "showStatusBar": true,
                "smartCopy": false,
                "sessionSnapshot": false,
                "alwaysOpenNewWindow": false,
                "exitWhenLastTabClosed": false,
                "appLanguage": "",
                "openWithContextMenu": false,
                "wallpaperFileName": "",
                "wallpaperEffect": "blur"
            })
        );
    }

    #[test]
    fn settings_partial_json_merges_over_defaults() {
        let s: Settings = serde_json::from_str(r#"{"editorFontSize": 18}"#).unwrap();
        assert_eq!(s.editor_font_size, 18.0);
        assert_eq!(s.editor_font_family, "Consolas");
        assert_eq!(s.default_line_ending, EolId::Crlf);
    }

    #[test]
    fn eol_id_round_trips_lowercase() {
        assert_eq!(serde_json::to_string(&EolId::Crlf).unwrap(), r#""crlf""#);
        assert_eq!(serde_json::to_string(&EolId::Cr).unwrap(), r#""cr""#);
        assert_eq!(serde_json::to_string(&EolId::Lf).unwrap(), r#""lf""#);
        assert_eq!(serde_json::from_str::<EolId>(r#""lf""#).unwrap(), EolId::Lf);
    }

    #[test]
    fn opened_file_field_names_match_contract() {
        let f = OpenedFile {
            decoded_text: "hi".into(),
            encoding_id: "UTF-8".into(),
            eol_id: EolId::Lf,
            date_modified_ms: 1234.0,
            file_path: None,
            has_bom: false,
        };
        let json = serde_json::to_value(&f).unwrap();
        assert_eq!(
            json,
            serde_json::json!({
                "decodedText": "hi",
                "encodingId": "UTF-8",
                "eolId": "lf",
                "dateModifiedMs": 1234.0,
                "filePath": null,
                "hasBom": false
            })
        );
    }

    #[test]
    fn drag_envelope_round_trip() {
        // Integer numbers (as the JS side sends) must deserialize into the f64
        // fields; the re-serialized object is compared with float literals
        // because serde_json distinguishes Number(0) from Number(0.0) even
        // though the wire text is equivalent for JS.
        let raw = serde_json::json!({
            "sourceWindowId": 1,
            "editorId": "ed-1",
            "filePath": null,
            "lastSavedText": "",
            "pendingText": "dirty",
            "encodingId": "UTF-8",
            "eolId": "crlf",
            "isModified": true,
            "fileNamePlaceholder": "Untitled.txt",
            "dateModifiedMs": 0,
            "viewMode": { "preview": false, "diff": false }
        });
        let env: DragEnvelope = serde_json::from_value(raw.clone()).unwrap();
        assert_eq!(env.source_window_id, 1.0);
        assert_eq!(env.date_modified_ms, 0.0);
        // Full structural round-trip via a second deserialize.
        let env2: DragEnvelope =
            serde_json::from_value(serde_json::to_value(&env).unwrap()).unwrap();
        assert_eq!(env, env2);
    }

    #[test]
    fn session_tab_unavailable_is_additive() {
        // Old snapshots without `unavailable` must parse; falsy default.
        let raw = serde_json::json!({
            "editorId": "ed-1",
            "filePath": "C:/notes.txt",
            "encodingId": "UTF-8",
            "eolId": "crlf",
            "isModified": false,
            "selectionStart": 0,
            "selectionEnd": 0,
            "scrollTop": 0,
            "viewMode": { "preview": false, "diff": false }
        });
        let tab: SessionTab = serde_json::from_value(raw).unwrap();
        assert_eq!(tab.unavailable, None);
        // And it round-trips WITHOUT emitting the key (byte-compat persistence).
        let out = serde_json::to_value(&tab).unwrap();
        assert!(out.get("unavailable").is_none());
    }
}
