//! shell_integration — port of src/main/shell.ts (task #3, owner:
//! worker-persist).
//!
//! To preserve: reveal-in-folder (tauri-plugin-opener), clipboard copyPath +
//! share as "title\n\ntext" (tauri-plugin-clipboard-manager), webSearch via
//! the settings engine (search_url.rs), print → renderer-side window.print()
//! (shim handles it; shell_print stays for contract parity), OS recent
//! documents, win32 Jump List "New window" task → notepads://newinstance.

use crate::contract::ShareArgs;
use crate::result::NpResult;
use crate::search_url;
use serde::Deserialize;

/// Args for the web-search IPC command (renderer-driven, fully symmetric).
#[derive(Debug, Clone, Deserialize)]
pub struct WebSearchArgs {
    pub query: String,
    pub search_engine: String,
    pub custom_search_url: String,
}

#[tauri::command]
pub async fn shell_open_containing_folder(
    _app: tauri::AppHandle,
    path: String,
) -> NpResult<()> {
    if path.is_empty() {
        return NpResult::Err("No file path".into());
    }

    #[cfg(target_os = "windows")]
    {
        // Windows: explorer /select,"path"
        let status = std::process::Command::new("explorer")
            .args(["/select,", &path])
            .status();
        match status {
            Ok(s) if s.success() => NpResult::Ok(()),
            Ok(s) => NpResult::Err(format!("explorer exited with code: {}", s.code().unwrap_or(-1))),
            Err(e) => NpResult::Err(format!("Failed to open containing folder: {e}")),
        }
    }

    #[cfg(target_os = "macos")]
    {
        let status = std::process::Command::new("open")
            .args(["-R", &path])
            .status();
        match status {
            Ok(s) if s.success() => NpResult::Ok(()),
            Ok(s) => NpResult::Err(format!("open exited with code: {}", s.code().unwrap_or(-1))),
            Err(e) => NpResult::Err(format!("Failed to open containing folder: {e}")),
        }
    }

    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    {
        // Linux: open the parent directory
        let parent = std::path::Path::new(&path)
            .parent()
            .unwrap_or(std::path::Path::new("."));
        let status = std::process::Command::new("xdg-open")
            .arg(parent)
            .status();
        match status {
            Ok(s) if s.success() => NpResult::Ok(()),
            Ok(s) => NpResult::Err(format!("xdg-open exited with code: {}", s.code().unwrap_or(-1))),
            Err(e) => NpResult::Err(format!("Failed to open containing folder: {e}")),
        }
    }
}

#[tauri::command]
pub async fn shell_copy_path(
    app: tauri::AppHandle,
    path: String,
) -> NpResult<()> {
    if path.is_empty() {
        return NpResult::Err("No file path".into());
    }
    use tauri_plugin_clipboard_manager::ClipboardExt;
    app.clipboard()
        .write_text(path)
        .map(|_| NpResult::Ok(()))
        .unwrap_or_else(|e| NpResult::Err(format!("Failed to copy path: {e}")))
}

#[tauri::command]
pub async fn shell_web_search(
    app: tauri::AppHandle,
    args: WebSearchArgs,
) -> NpResult<()> {
    let url = search_url::build_search_url(&args.query, &args.search_engine, &args.custom_search_url);
    match url {
        Some(url) => {
            // Use tauri-plugin-opener to open the URL in the default browser.
            use tauri_plugin_opener::OpenerExt;
            app.opener()
                .open_url(url, None::<&str>)
                .map(|_| NpResult::Ok(()))
                .unwrap_or_else(|e| NpResult::Err(format!("Failed to open URL: {e}")))
        }
        None => NpResult::Ok(()), // Silent no-op (mirrors UWP swallow)
    }
}

#[tauri::command]
pub async fn shell_print(_window: tauri::WebviewWindow) -> NpResult<()> {
    // Print is handled by the renderer-side bridge (window.print()).
    // Return Ok as a no-op — the bridge shim calls window.print() directly.
    NpResult::Ok(())
}

#[tauri::command]
pub async fn shell_share(
    app: tauri::AppHandle,
    args: ShareArgs,
) -> NpResult<()> {
    let title = args.title.as_str();
    let text = args.text.as_str();
    let payload = if !title.is_empty() {
        format!("{title}\n\n{text}")
    } else {
        text.to_string()
    };
    use tauri_plugin_clipboard_manager::ClipboardExt;
    app.clipboard()
        .write_text(payload)
        .map(|_| NpResult::Ok(()))
        .unwrap_or_else(|e| NpResult::Err(format!("Failed to share: {e}")))
}
