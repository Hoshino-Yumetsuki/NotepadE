//! theme — port of src/main/theme.ts (task #3, owner: worker-persist).
//!
//! To preserve: dark/highContrast detection, accent RRGGBBAA→#RRGGBB fallback
//! #0078D4, push `notepads:evt:theme:osChanged` / `:accentChanged` to ALL
//! windows on OS change.

use crate::contract::ThemeState;
use crate::result::NpResult;

/// Normalize an accent color to `#RRGGBB`. Takes an `RRGGBBAA` string (the
/// Windows UISettings format) and drops any alpha, prefixing '#'. Falls back
/// to `#0078D4` (Windows default accent) for empty/invalid values.
#[allow(dead_code)]
fn normalize_accent(raw: &str) -> String {
    let hex = raw.trim_start_matches('#');
    if hex.len() >= 6 {
        format!("#{}", &hex[..6].to_uppercase())
    } else {
        "#0078D4".to_string()
    }
}

/// Read the Windows accent color via UISettings (WinRT). Returns #0078D4
/// on any failure.
#[cfg(target_os = "windows")]
fn read_accent_color_windows() -> String {
    use windows::UI::ViewManagement::UISettings;
    use windows::UI::ViewManagement::UIColorType;

    let settings = match UISettings::new() {
        Ok(s) => s,
        Err(_) => return "#0078D4".to_string(),
    };
    let color = match settings.GetColorValue(UIColorType::Accent) {
        Ok(c) => c,
        Err(_) => return "#0078D4".to_string(),
    };
    format!("#{:02X}{:02X}{:02X}", color.R, color.G, color.B)
}

/// Read high-contrast status via AccessibilitySettings (WinRT).
#[cfg(target_os = "windows")]
fn read_high_contrast_windows() -> bool {
    use windows::UI::ViewManagement::AccessibilitySettings;

    match AccessibilitySettings::new() {
        Ok(settings) => settings.HighContrast().unwrap_or(false),
        Err(_) => false,
    }
}

/// Read dark/light mode on Windows via the registry (AppsUseLightTheme).
#[cfg(target_os = "windows")]
fn read_os_dark_mode_windows() -> bool {
    use winreg::enums::*;
    use winreg::RegKey;

    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let key = hkcu.open_subkey(
        r"Software\Microsoft\Windows\CurrentVersion\Themes\Personalize",
    );
    match key {
        Ok(k) => {
            let light: u32 = k.get_value("AppsUseLightTheme").unwrap_or(1);
            light == 0
        }
        Err(_) => false,
    }
}

/// Fallback dark-mode detection for non-Windows platforms via the Tauri
/// window theme.
#[allow(dead_code)]
fn read_os_dark_mode_fallback(window: &tauri::WebviewWindow) -> bool {
    window
        .theme()
        .map(|t| matches!(t, tauri::Theme::Dark))
        .unwrap_or(false)
}

/// Fallback accent color for non-Windows platforms.
#[allow(dead_code)]
fn read_accent_color_fallback() -> String {
    "#0078D4".to_string()
}

/// Fallback high-contrast for non-Windows: always false.
#[allow(dead_code)]
fn read_high_contrast_fallback() -> bool {
    false
}

#[tauri::command]
pub async fn theme_get(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
) -> NpResult<ThemeState> {
    #[cfg(target_os = "windows")]
    let (is_dark, accent, high_contrast) = {
        let _ = app;
        let _ = window;
        let dark = read_os_dark_mode_windows();
        let accent_color = read_accent_color_windows();
        let hc = read_high_contrast_windows();
        (dark, accent_color, hc)
    };

    #[cfg(not(target_os = "windows"))]
    let (is_dark, accent, high_contrast) = {
        let _ = app;
        let dark = read_os_dark_mode_fallback(&window);
        let accent_color = read_accent_color_fallback();
        let hc = read_high_contrast_fallback();
        (dark, accent_color, hc)
    };

    NpResult::Ok(ThemeState {
        os_theme: if is_dark {
            "dark".into()
        } else {
            "light".into()
        },
        accent_color: accent,
        high_contrast,
    })
}
