//! wallpaper — port of src/main/wallpaper.ts (task #3, owner: worker-persist).
//!
//! To preserve: managed {userData}/wallpaper/ folder, wallpaper-<ms>.<ext>
//! names, raster-only png/jpg/jpeg/webp/gif/bmp/avif, 20MB cap, http(s) +
//! content-type-gated download (reqwest streaming), base64 `data:` URL serve,
//! name regex validation, write-new → flip-setting → delete-old order,
//! serialized mutations. pick() cancel resolves Ok(null).

use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;

use base64::Engine as _;
use tauri::Emitter;
use tauri::Manager;

use crate::contract::{Settings, WallpaperState};
use crate::result::NpResult;

/// Managed subfolder under userData holding the (single) active wallpaper.
const WALLPAPER_DIR_NAME: &str = "wallpaper";

/// Hard size cap for any wallpaper source (local stat / download stream).
const MAX_WALLPAPER_BYTES: u64 = 20 * 1024 * 1024; // 20 MB

/// Allowed raster image extensions.
const ALLOWED_EXTENSIONS: &[&str] = &["png", "jpg", "jpeg", "webp", "gif", "bmp", "avif"];

// ---------------------------------------------------------------------------
//  Pure helpers
// ---------------------------------------------------------------------------

/// MIME types mapped by canonical extension.
fn mime_for_extension(ext: &str) -> Option<&'static str> {
    match ext.to_lowercase().as_str() {
        "png" => Some("image/png"),
        "jpg" | "jpeg" => Some("image/jpeg"),
        "webp" => Some("image/webp"),
        "gif" => Some("image/gif"),
        "bmp" => Some("image/bmp"),
        "avif" => Some("image/avif"),
        _ => None,
    }
}

/// Map a Content-Type to the canonical extension, or None when not allowed.
fn extension_for_content_type(content_type: &str) -> Option<&'static str> {
    let mime = content_type.split(';').next()?.trim().to_lowercase();
    match mime.as_str() {
        "image/png" => Some("png"),
        "image/jpeg" => Some("jpg"),
        "image/webp" => Some("webp"),
        "image/gif" => Some("gif"),
        "image/bmp" => Some("bmp"),
        "image/avif" => Some("avif"),
        _ => None,
    }
}

/// Lower-cased extension (no dot) of a path/name, "" when absent.
fn image_extension_of(path_or_name: &str) -> String {
    std::path::Path::new(path_or_name)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase()
}

/// True when ext (no dot, any case) is an allowed raster image extension.
fn is_allowed_image_extension(ext: &str) -> bool {
    ALLOWED_EXTENSIONS.contains(&ext.to_lowercase().as_str())
}

/// Compose a managed file name: `wallpaper-<ms>.<ext>`.
fn build_wallpaper_file_name(ext: &str, now_ms: u128) -> String {
    format!("wallpaper-{now_ms}.{}", ext.to_lowercase())
}

/// Validate a PERSISTED wallpaper file name. Must match `wallpaper-<digits>.<allowed_ext>`.
fn is_safe_wallpaper_file_name(name: &str) -> bool {
    let parts: Vec<&str> = name.splitn(2, '.').collect();
    if parts.len() != 2 {
        return false;
    }
    let stem = parts[0];
    let ext = parts[1];

    if !stem.starts_with("wallpaper-") || stem.len() <= "wallpaper-".len() {
        return false;
    }
    let num_part = &stem["wallpaper-".len()..];
    if num_part.is_empty() || !num_part.chars().all(|c| c.is_ascii_digit()) {
        return false;
    }
    is_allowed_image_extension(ext)
}

// ---------------------------------------------------------------------------
//  Path helpers
// ---------------------------------------------------------------------------

fn app_data_dir(app: &tauri::AppHandle) -> PathBuf {
    if let Ok(ov) = std::env::var("NOTEPADS_E2E_USERDATA") {
        if !ov.is_empty() {
            return PathBuf::from(ov);
        }
    }
    app.path()
        .app_data_dir()
        .expect("app_data_dir should exist")
}

fn wallpaper_dir(app: &tauri::AppHandle) -> PathBuf {
    app_data_dir(app).join(WALLPAPER_DIR_NAME)
}

fn settings_file_path(app: &tauri::AppHandle) -> PathBuf {
    app_data_dir(app).join("Settings.json")
}

/// Read the current wallpaper file name from settings.
fn current_file_name(app: &tauri::AppHandle) -> String {
    crate::settings::settings_get_internal(app)
        .map(|s| s.wallpaper_file_name)
        .unwrap_or_default()
}

// ---------------------------------------------------------------------------
//  Mutation serializer
// ---------------------------------------------------------------------------

/// Mutex that serializes wallpaper mutations (set/clear) to prevent orphan
/// races. Only the read→persist→delete critical section is serialized;
/// slow downloads/copies happen outside.
static WALLPAPER_MUTEX: Mutex<()> = Mutex::new(());

/// Persist settings atomically and broadcast the change.
fn persist_settings(app: &tauri::AppHandle, settings: &Settings) -> Result<(), String> {
    let serialized = serde_json::to_string_pretty(settings)
        .map_err(|e| format!("Failed to serialize settings: {e}"))?;

    let target_path = settings_file_path(app);
    let pid = std::process::id();
    let tmp_path = target_path.with_file_name(format!("Settings.json.{pid}.tmp"));

    if let Some(parent) = tmp_path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("Failed to create dir: {e}"))?;
    }

    fs::write(&tmp_path, &serialized).map_err(|e| format!("Failed to write tmp: {e}"))?;
    fs::rename(&tmp_path, &target_path).map_err(|e| {
        let _ = fs::remove_file(&tmp_path);
        format!("Failed to rename: {e}")
    })?;

    if let Err(e) = app.emit("notepads:evt:settings:changed", settings) {
        log::warn!("Failed to broadcast settings changed: {e}");
    }

    Ok(())
}

// ---------------------------------------------------------------------------
//  Managed-file operations
// ---------------------------------------------------------------------------

fn write_managed_file(
    dir: &std::path::Path,
    file_name: &str,
    bytes: &[u8],
) -> Result<PathBuf, String> {
    fs::create_dir_all(dir).map_err(|e| format!("Failed to create dir: {e}"))?;
    let target = dir.join(file_name);
    fs::write(&target, bytes).map_err(|e| format!("Failed to write file: {e}"))?;
    Ok(target)
}

fn delete_managed_file(dir: &std::path::Path, file_name: &str) {
    if file_name.is_empty() || !is_safe_wallpaper_file_name(file_name) {
        return;
    }
    let _ = fs::remove_file(dir.join(file_name));
}

/// Read wallpaper state: file name + base64 data URL.
fn read_wallpaper_state(app: &tauri::AppHandle) -> Result<WallpaperState, String> {
    let file_name = current_file_name(app);
    if file_name.is_empty() || !is_safe_wallpaper_file_name(&file_name) {
        return Ok(WallpaperState {
            file_name: String::new(),
            data_url: None,
        });
    }

    let ext = image_extension_of(&file_name);
    let mime = match mime_for_extension(&ext) {
        Some(m) => m,
        None => {
            return Ok(WallpaperState {
                file_name: String::new(),
                data_url: None,
            })
        }
    };

    let path = wallpaper_dir(app).join(&file_name);
    let bytes = match fs::read(&path) {
        Ok(b) => b,
        Err(_) => {
            return Ok(WallpaperState {
                file_name: String::new(),
                data_url: None,
            });
        }
    };

    let b64 = base64::engine::general_purpose::STANDARD.encode(&bytes);
    Ok(WallpaperState {
        file_name,
        data_url: Some(format!("data:{mime};base64,{b64}")),
    })
}

/// Activate a new wallpaper: persist in settings, then delete previous file.
fn activate(app: &tauri::AppHandle, file_name: &str) -> Result<WallpaperState, String> {
    let previous = {
        let _guard = WALLPAPER_MUTEX.lock().unwrap_or_else(|p| p.into_inner());
        let prev = current_file_name(app);

        let mut settings = crate::settings::settings_get_internal(app)?;
        settings.wallpaper_file_name = file_name.to_string();
        persist_settings(app, &settings)?;

        prev
    };

    if !previous.is_empty() && previous != file_name {
        delete_managed_file(&wallpaper_dir(app), &previous);
    }

    read_wallpaper_state(app)
}

// ---------------------------------------------------------------------------
//  Inner impls (return Result<T, String> for ? operator use)
// ---------------------------------------------------------------------------

fn set_from_path_impl(app: &tauri::AppHandle, path: &str) -> Result<WallpaperState, String> {
    let ext = image_extension_of(path);
    if !is_allowed_image_extension(&ext) {
        let label = if ext.is_empty() { "(none)" } else { &ext };
        return Err(format!("Unsupported image type: .{label}"));
    }

    let meta = fs::metadata(path).map_err(|e| format!("Failed to stat file: {e}"))?;
    if !meta.is_file() {
        return Err("Not a file".into());
    }
    if meta.len() > MAX_WALLPAPER_BYTES {
        let mb = MAX_WALLPAPER_BYTES / (1024 * 1024);
        return Err(format!("Image exceeds the {mb}MB limit"));
    }

    let now_ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    let file_name = build_wallpaper_file_name(&ext, now_ms);
    let dir = wallpaper_dir(app);

    let bytes = fs::read(path).map_err(|e| format!("Failed to read image: {e}"))?;
    write_managed_file(&dir, &file_name, &bytes)?;

    activate(app, &file_name)
}

async fn set_from_url_impl(app: &tauri::AppHandle, url: &str) -> Result<WallpaperState, String> {
    let parsed = url::Url::parse(url).map_err(|_| "Invalid URL".to_string())?;
    if parsed.scheme() != "http" && parsed.scheme() != "https" {
        return Err("Only http(s) URLs are supported".into());
    }

    let client = reqwest::Client::builder()
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {e}"))?;

    let response = client
        .get(url.to_string())
        .send()
        .await
        .map_err(|e| format!("Download failed: {e}"))?;

    let status = response.status();
    if !status.is_success() {
        return Err(format!("Download failed (HTTP {})", status.as_u16()));
    }

    let content_type = response
        .headers()
        .get("content-type")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");
    let ext = extension_for_content_type(content_type)
        .ok_or_else(|| "URL did not return a supported image type".to_string())?;

    if let Some(len) = response.content_length() {
        if len > MAX_WALLPAPER_BYTES {
            let mb = MAX_WALLPAPER_BYTES / (1024 * 1024);
            return Err(format!("Image exceeds the {mb}MB limit"));
        }
    }

    let bytes = response
        .bytes()
        .await
        .map_err(|e| format!("Download stream error: {e}"))?;

    if bytes.is_empty() {
        return Err("Empty response body".into());
    }
    if bytes.len() as u64 > MAX_WALLPAPER_BYTES {
        let mb = MAX_WALLPAPER_BYTES / (1024 * 1024);
        return Err(format!("Image exceeds the {mb}MB limit"));
    }

    let now_ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    let file_name = build_wallpaper_file_name(ext, now_ms);
    let dir = wallpaper_dir(app);
    write_managed_file(&dir, &file_name, &bytes)?;

    activate(app, &file_name)
}

// ---------------------------------------------------------------------------
//  Tauri commands
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn wallpaper_get(app: tauri::AppHandle) -> NpResult<WallpaperState> {
    NpResult::from_result(read_wallpaper_state(&app))
}

#[tauri::command]
pub async fn wallpaper_set_from_path(
    app: tauri::AppHandle,
    path: String,
) -> NpResult<WallpaperState> {
    NpResult::from_result(set_from_path_impl(&app, &path))
}

#[tauri::command]
pub async fn wallpaper_set_from_url(
    app: tauri::AppHandle,
    url: String,
) -> NpResult<WallpaperState> {
    NpResult::from_result(set_from_url_impl(&app, &url).await)
}

#[tauri::command]
pub async fn wallpaper_pick(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
) -> NpResult<Option<WallpaperState>> {
    use tauri_plugin_dialog::DialogExt;

    let result = app
        .dialog()
        .file()
        .set_parent(&window)
        .add_filter("Images", ALLOWED_EXTENSIONS)
        .blocking_pick_file();

    match result {
        Some(file_path) => {
            let path = file_path.to_string();
            match wallpaper_set_from_path(app, path).await {
                NpResult::Ok(state) => NpResult::Ok(Some(state)),
                NpResult::Err(e) => NpResult::Err(e),
            }
        }
        None => NpResult::Ok(None),
    }
}

#[tauri::command]
pub async fn wallpaper_clear(app: tauri::AppHandle) -> NpResult<()> {
    NpResult::from_result(clear_wallpaper_internal(&app))
}

/// Internal clear for settings_reset.rs.
pub fn clear_wallpaper_internal(app: &tauri::AppHandle) -> Result<(), String> {
    let previous = {
        let _guard = WALLPAPER_MUTEX.lock().unwrap_or_else(|p| p.into_inner());
        let prev = current_file_name(app);

        let mut settings = crate::settings::settings_get_internal(app)?;
        settings.wallpaper_file_name = String::new();
        persist_settings(app, &settings)?;

        prev
    };

    if !previous.is_empty() {
        delete_managed_file(&wallpaper_dir(app), &previous);
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_image_extension_of() {
        assert_eq!(image_extension_of("C:/pics/photo.PNG"), "png");
        assert_eq!(image_extension_of("/home/u/a.jpeg"), "jpeg");
        assert_eq!(image_extension_of("noext"), "");
    }

    #[test]
    fn test_is_allowed_image_extension() {
        for ext in ["png", "jpg", "jpeg", "webp", "gif", "bmp", "avif", "PNG"] {
            assert!(is_allowed_image_extension(ext), "should allow {ext}");
        }
        for ext in ["svg", "exe", "html", "js", ""] {
            assert!(!is_allowed_image_extension(ext), "should reject {ext}");
        }
    }

    #[test]
    fn test_mime_for_extension() {
        assert_eq!(mime_for_extension("png"), Some("image/png"));
        assert_eq!(mime_for_extension("jpg"), Some("image/jpeg"));
        assert_eq!(mime_for_extension("svg"), None);
    }

    #[test]
    fn test_extension_for_content_type() {
        assert_eq!(extension_for_content_type("image/png"), Some("png"));
        assert_eq!(extension_for_content_type("image/jpeg"), Some("jpg"));
        assert_eq!(extension_for_content_type("IMAGE/WebP"), Some("webp"));
        assert_eq!(
            extension_for_content_type("image/png; charset=binary"),
            Some("png")
        );
        assert_eq!(extension_for_content_type("text/html"), None);
        assert_eq!(extension_for_content_type("image/svg+xml"), None);
        assert_eq!(extension_for_content_type(""), None);
    }

    #[test]
    fn test_build_wallpaper_file_name() {
        let name = build_wallpaper_file_name("PNG", 1234567890);
        assert_eq!(name, "wallpaper-1234567890.png");
        assert!(is_safe_wallpaper_file_name(&name));
    }

    #[test]
    fn test_successive_names_differ() {
        assert_ne!(
            build_wallpaper_file_name("png", 1),
            build_wallpaper_file_name("png", 2)
        );
    }

    #[test]
    fn test_is_safe_wallpaper_file_name_rejects_bad_names() {
        assert!(!is_safe_wallpaper_file_name("../Settings.json"));
        assert!(!is_safe_wallpaper_file_name("wallpaper-1/..\\x.png"));
        assert!(!is_safe_wallpaper_file_name("wallpaper-1.svg"));
        assert!(!is_safe_wallpaper_file_name("wallpaper-1.exe"));
        assert!(!is_safe_wallpaper_file_name("other-1.png"));
        assert!(!is_safe_wallpaper_file_name(""));
    }

    #[test]
    fn test_max_wallpaper_bytes() {
        assert_eq!(MAX_WALLPAPER_BYTES, 20 * 1024 * 1024);
    }
}
