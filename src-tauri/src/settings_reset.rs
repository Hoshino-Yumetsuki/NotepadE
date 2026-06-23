//! settings_reset — port of src/main/settings-reset.ts (task #3, owner:
//! worker-persist).
//!
//! To preserve: clearWallpaper() FIRST (wallpaper.rs lifecycle — never a
//! duplicated delete), then set verbatim defaults through the normal settings
//! set path (persist + broadcast).

use crate::contract::Settings;
use crate::result::NpResult;

/// Restore every persisted setting to its verbatim default and delete the
/// managed wallpaper file. Returns the authoritative merged defaults (identical
/// to what every window receives via EvtSettingsChanged).
///
/// Reset order:
///   1. clearWallpaper() — empties wallpaperFileName AND deletes the managed
///      file. Run FIRST so the file is gone even if defaults write fails.
///   2. settings_set({ ...DEFAULT_SETTINGS }) — a FULL patch of the verbatim
///      defaults through the normal settings path.
#[tauri::command]
pub async fn settings_reset_all(app: tauri::AppHandle) -> NpResult<Settings> {
    // 1) Clear wallpaper first: it owns both the setting flip and the
    //    managed-file deletion — never duplicate that lifecycle here.
    let cleared = crate::wallpaper::clear_wallpaper_internal(&app);
    if let Err(e) = cleared {
        return NpResult::Err(e);
    }

    // 2) Full-defaults patch through the normal settings path.
    //    Use serde_json::Value so all keys are present (deep_merge only
    //    considers keys in the patch).
    let defaults = serde_json::to_value(Settings::default()).unwrap_or(serde_json::json!({}));

    crate::settings::settings_set(app, defaults).await
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Verify that the defaults JSON value contains ALL Settings keys.
    #[test]
    fn defaults_value_has_all_keys() {
        let defaults = serde_json::to_value(Settings::default()).unwrap();
        let obj = defaults.as_object().unwrap();

        // Every key from the Settings struct should be present
        let expected_keys = &[
            "editorFontFamily",
            "editorFontSize",
            "textWrapping",
            "displayLineHighlighter",
            "displayLineNumbers",
            "tabIndents",
            "strictLineBreaks",
            "searchEngine",
            "customSearchUrl",
            "themeMode",
            "tintOpacity",
            "useWindowsAccentColor",
            "customAccentColor",
            "showStatusBar",
            "smartCopy",
            "alwaysOpenNewWindow",
            "exitWhenLastTabClosed",
            "appLanguage",
            "openWithContextMenu",
            "wallpaperFileName",
            "wallpaperEffect",
            "autoCheckUpdates",
        ];
        for key in expected_keys {
            assert!(obj.contains_key(*key), "Missing key: {key}");
        }
        assert_eq!(
            obj.len(),
            expected_keys.len(),
            "Unexpected extra keys in defaults"
        );
    }
}
