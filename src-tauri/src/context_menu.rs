//! context_menu — port of src/main/contextMenu.ts (task #3, owner:
//! worker-persist).
//!
//! To preserve: win32 HKCU\Software\Classes\*\shell\NotepadE add/remove
//! (winreg crate), toggled by the openWithContextMenu setting (settings.rs
//! side effect). No renderer-callable command — internal helper only. No-op
//! on non-Windows platforms.

/// Add or remove the Explorer "Open with NotepadE" context-menu entry.
///
/// Writes or removes HKCU\Software\Classes\*\shell\NotepadE. HKCU means no
/// elevation is needed. No-op on non-Windows platforms.
///
/// On enable, adds:
///   - (Default) = "Open with NotepadE"
///   - Icon = "\"exe\",0"
///   - command\ (Default) = "\"exe\" \"%1\""
/// On disable, removes the entire NotepadE key.
pub fn set_context_menu_enabled(enabled: bool) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        use std::env;
        use winreg::enums::*;
        use winreg::RegKey;

        let hkcu = RegKey::predef(HKEY_CURRENT_USER);
        let classes = hkcu
            .open_subkey_with_flags(r"Software\Classes\*\shell", KEY_READ | KEY_WRITE)
            .map_err(|e| format!("Failed to open shell registry key: {e}"))?;

        if enabled {
            let exe = env::current_exe().map_err(|e| format!("Failed to get exe path: {e}"))?;
            let exe_str = exe.to_string_lossy();

            // Add the NotepadE key
            let (notepade_key, _) = classes
                .create_subkey_with_flags("NotepadE", KEY_WRITE)
                .map_err(|e| format!("Failed to create NotepadE key: {e}"))?;
            notepade_key
                .set_value("", &"Open with NotepadE")
                .map_err(|e| format!("Failed to set default: {e}"))?;
            notepade_key
                .set_value("Icon", &format!("\"{exe_str}\",0"))
                .map_err(|e| format!("Failed to set Icon: {e}"))?;

            // Add the command subkey
            let (cmd_key, _) = notepade_key
                .create_subkey_with_flags("command", KEY_WRITE)
                .map_err(|e| format!("Failed to create command key: {e}"))?;
            cmd_key
                .set_value("", &format!("\"{exe_str}\" \"%1\""))
                .map_err(|e| format!("Failed to set command default: {e}"))?;
        } else {
            // Remove the entire NotepadE key (best-effort; ignore if absent)
            classes.delete_subkey_all("NotepadE").ok(); // ignore errors — key might not exist
        }
    }
    // No-op on non-Windows platforms.
    let _ = enabled;
    Ok(())
}
