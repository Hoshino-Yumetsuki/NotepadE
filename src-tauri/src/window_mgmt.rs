//! window_mgmt — port of src/main/window.ts + window-factory.ts (task #4,
//! owner: worker-window).
//!
//! Close-reminder protocol: every native close attempt (X / Alt+F4 / OS) on a
//! window NOT in the confirmed-close set (and while the app is not quitting)
//! is intercepted (`api.prevent_close()`) and forwarded to that window's
//! renderer as `notepads:evt:window:closeRequested` so it can run the
//! unsaved-changes flow; `window_confirm_close` marks the window confirmed and
//! closes it for real (UWP deferral.Complete()).
//!
//! Maximize push events: `notepads:window:maximizeChanged` (bool) is emitted
//! to a window whenever its maximized flag flips by ANY path (button,
//! double-click, Aero Snap, Win+Up) — Tauri has no discrete maximize event, so
//! the flag is diffed on every Resized.
//!
//! `setup_window` is the window-factory equivalent: acrylic (spawned windows),
//! hooks, bounds restore BEFORE show, bounds tracking, then show. The frozen
//! lib.rs setup hook calls it for "main"; broker spawns call it for win-N.

use std::collections::{HashMap, HashSet};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, OnceLock};

use crate::contract::{FullScreenResult, MaximizedResult};
use crate::result::NpResult;

/// `notepads:window:maximizeChanged` (bool payload, window-scoped).
const EVT_MAXIMIZE_CHANGED: &str = "notepads:window:maximizeChanged";
/// `notepads:evt:window:closeRequested` (no payload, window-scoped).
const EVT_CLOSE_REQUESTED: &str = "notepads:evt:window:closeRequested";

// ---------------------------------------------------------------------------
//  Close-guard state (window.ts: confirmedClose WeakSet + appQuitting flag)
// ---------------------------------------------------------------------------

/// Labels of windows whose close has been confirmed by the renderer's
/// close-reminder flow. A window NOT present is intercepted; present closes.
fn confirmed_close() -> &'static Mutex<HashSet<String>> {
    static SET: OnceLock<Mutex<HashSet<String>>> = OnceLock::new();
    SET.get_or_init(|| Mutex::new(HashSet::new()))
}

/// Global "the app is quitting" flag — set by `window_quit` so the close
/// guard stops intercepting (the renderer's quit path already ran the
/// unsaved-changes flow before calling window.quit()).
static APP_QUITTING: AtomicBool = AtomicBool::new(false);

fn is_close_confirmed(label: &str) -> bool {
    confirmed_close().lock().map(|s| s.contains(label)).unwrap_or(false)
}

// ---------------------------------------------------------------------------
//  Maximize-change diffing (no discrete maximize event in Tauri)
// ---------------------------------------------------------------------------

/// Last-seen maximized flag per window label.
fn last_maximized() -> &'static Mutex<HashMap<String, bool>> {
    static MAP: OnceLock<Mutex<HashMap<String, bool>>> = OnceLock::new();
    MAP.get_or_init(|| Mutex::new(HashMap::new()))
}

// ---------------------------------------------------------------------------
//  Window factory wiring (window-factory.ts)
// ---------------------------------------------------------------------------

/// Install the close guard + maximize push events + focus tracking + state
/// cleanup on a window. Call once per window (factory parity).
pub fn install_window_hooks(window: &tauri::WebviewWindow) {
    use tauri::Emitter;
    let win = window.clone();
    let label = window.label().to_string();
    // Seed the maximize diff so the first Resized doesn't emit a phantom event.
    if let Ok(mut m) = last_maximized().lock() {
        m.insert(label.clone(), window.is_maximized().unwrap_or(false));
    }
    window.on_window_event(move |event| match event {
        tauri::WindowEvent::CloseRequested { api, .. } => {
            if APP_QUITTING.load(Ordering::SeqCst) {
                return; // app-level quit — never block.
            }
            if is_close_confirmed(&label) {
                return; // confirmed — let it close.
            }
            api.prevent_close();
            let _ = win.emit_to(label.as_str(), EVT_CLOSE_REQUESTED, ());
        }
        tauri::WindowEvent::Resized(_) => {
            // Diff the maximized flag — covers our button, drag-region
            // double-click, Aero Snap, Win+Up (window-factory sendMaxState).
            let now = win.is_maximized().unwrap_or(false);
            let changed = match last_maximized().lock() {
                Ok(mut m) => {
                    let prev = m.insert(label.clone(), now);
                    prev != Some(now)
                }
                Err(_) => false,
            };
            if changed {
                let _ = win.emit_to(label.as_str(), EVT_MAXIMIZE_CHANGED, now);
            }
        }
        tauri::WindowEvent::Focused(true) => {
            crate::broker::note_focus(&label);
        }
        tauri::WindowEvent::Destroyed => {
            if let Ok(mut s) = confirmed_close().lock() {
                s.remove(&label);
            }
            if let Ok(mut m) = last_maximized().lock() {
                m.remove(&label);
            }
            crate::compact_overlay::forget_window(&label);
            crate::broker::forget_window(&label);
        }
        _ => {}
    });
}

/// Complete a freshly-created (still hidden) window the way the Electron
/// window factory did: acrylic (when not already applied by the frozen lib.rs
/// setup), hooks, persisted-bounds restore BEFORE show, bounds tracking, then
/// show. `apply_acrylic` is false for "main" (lib.rs already applied it).
pub fn setup_window(app: &tauri::AppHandle, window: &tauri::WebviewWindow, apply_acrylic: bool) {
    if apply_acrylic {
        // Material unification: Windows acrylic is the single target; other
        // platforms get the renderer's CSS acrylic layer only.
        #[cfg(target_os = "windows")]
        {
            if let Err(e) = window_vibrancy::apply_acrylic(window, None) {
                log::warn!("apply_acrylic failed (pre-Win10 1809?): {e}");
            }
        }
        #[cfg(not(target_os = "windows"))]
        let _ = window;
    }
    install_window_hooks(window);
    // Restore the last session's bounds + maximized state before first paint;
    // no-op under e2e / first run so the default-sized window stays identical.
    crate::window_bounds::restore_bounds(app, window);
    crate::window_bounds::track_bounds(app, window);
    let _ = window.show();
}

// ---------------------------------------------------------------------------
//  Commands — each acts on the CALLING window (PA-8: no windowId from JS)
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn window_set_full_screen(
    window: tauri::WebviewWindow,
    enabled: bool,
) -> NpResult<FullScreenResult> {
    if let Err(e) = window.set_fullscreen(enabled) {
        return NpResult::Err(e.to_string());
    }
    NpResult::Ok(FullScreenResult { is_full_screen: window.is_fullscreen().unwrap_or(enabled) })
}

#[tauri::command]
pub async fn window_minimize(window: tauri::WebviewWindow) -> NpResult<()> {
    window.minimize().into()
}

/// Toggle maximize/restore; resolves with the resulting maximized flag.
#[tauri::command]
pub async fn window_toggle_maximize(window: tauri::WebviewWindow) -> NpResult<MaximizedResult> {
    let res = if window.is_maximized().unwrap_or(false) {
        window.unmaximize()
    } else {
        window.maximize()
    };
    if let Err(e) = res {
        return NpResult::Err(e.to_string());
    }
    NpResult::Ok(MaximizedResult { is_maximized: window.is_maximized().unwrap_or(false) })
}

#[tauri::command]
pub async fn window_close(window: tauri::WebviewWindow) -> NpResult<()> {
    // Goes through CloseRequested, so the close guard still applies (Electron
    // win.close() parity).
    window.close().into()
}

/// Current maximized flag — seeds the renderer's restore glyph on mount.
#[tauri::command]
pub async fn window_is_maximized(window: tauri::WebviewWindow) -> NpResult<MaximizedResult> {
    NpResult::Ok(MaximizedResult { is_maximized: window.is_maximized().unwrap_or(false) })
}

/// Quit the whole application (UWP ExitApp). The renderer's quit path already
/// ran the unsaved-changes flow, so the close guard is disarmed first; closing
/// every window then lets Tauri's default all-windows-closed exit run (the
/// bounds tracker still sees each CloseRequested for a final persist).
#[tauri::command]
pub async fn window_quit(app: tauri::AppHandle) -> NpResult<()> {
    use tauri::Manager;
    APP_QUITTING.store(true, Ordering::SeqCst);
    let windows: Vec<tauri::WebviewWindow> = app.webview_windows().values().cloned().collect();
    if windows.is_empty() {
        app.exit(0);
        return NpResult::Ok(());
    }
    for w in windows {
        let _ = w.close();
    }
    NpResult::Ok(())
}

/// The renderer finished its unsaved-changes flow and the window may now
/// close: mark it confirmed (the guard lets it through) and trigger the real
/// close. 1:1 with UWP `deferral.Complete()` after the close dialog.
#[tauri::command]
pub async fn window_confirm_close(window: tauri::WebviewWindow) -> NpResult<()> {
    match confirmed_close().lock() {
        Ok(mut s) => {
            s.insert(window.label().to_string());
        }
        Err(e) => return NpResult::Err(e.to_string()),
    }
    window.close().into()
}
