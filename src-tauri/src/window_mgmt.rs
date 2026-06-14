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

use crate::contract::MaximizedResult;
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
            // macOS restores the standard window buttons after a fullscreen
            // enter/exit (both fire Resized) — re-hide so the renderer's own
            // caption controls stay the only set.
            #[cfg(target_os = "macos")]
            hide_traffic_lights(&win);
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
        // Native window material per platform; mirrors the frozen lib.rs setup
        // hook (Windows acrylic / macOS vibrancy). Linux gets the renderer's
        // CSS layer only.
        #[cfg(target_os = "windows")]
        {
            if let Err(e) = window_vibrancy::apply_acrylic(window, None) {
                log::warn!("apply_acrylic failed (pre-Win10 1809?): {e}");
            }
        }
        #[cfg(target_os = "macos")]
        {
            // window-vibrancy's apply_vibrancy asserts the main thread
            // (MainThreadMarker::new); broker spawns run setup_window off the
            // Tauri async runtime, so hop to the main thread first.
            let win = window.clone();
            let _ = window.run_on_main_thread(move || {
                use window_vibrancy::{NSVisualEffectMaterial, NSVisualEffectState};
                if let Err(e) = window_vibrancy::apply_vibrancy(
                    &win,
                    NSVisualEffectMaterial::UnderWindowBackground,
                    Some(NSVisualEffectState::Active),
                    None,
                ) {
                    log::warn!("apply_vibrancy failed: {e}");
                }
            });
        }
        #[cfg(not(any(target_os = "windows", target_os = "macos")))]
        let _ = window;
    }
    install_window_hooks(window);
    apply_window_icon(window);
    #[cfg(target_os = "macos")]
    hide_traffic_lights(window);
    // Restore the last session's bounds + maximized state before first paint;
    // no-op under e2e / first run so the default-sized window stays identical.
    crate::window_bounds::restore_bounds(app, window);
    crate::window_bounds::track_bounds(app, window);
    let _ = window.show();
}

/// Hide the three native macOS traffic-light buttons (close / minimize / zoom)
/// while keeping native decorations (rounded corners + native shadow). The
/// window uses titleBarStyle Overlay so the buttons would otherwise show; the
/// renderer draws its OWN caption controls (CaptionButtons.tsx), so the native
/// trio is hidden to avoid a double set — the Electron build did the same by
/// pushing them off-screen. ns_window() hands back an autoreleased NSWindow
/// pointer (Tauri retains+autoreleases it); we borrow it for this synchronous
/// AppKit call only and never free it.
#[cfg(target_os = "macos")]
pub fn hide_traffic_lights(window: &tauri::WebviewWindow) {
    use objc2_app_kit::{NSWindow, NSWindowButton};
    // standardWindowButton/setHidden are AppKit calls (main-thread-only); both
    // callers (setup_window off the broker async runtime, the Resized event
    // handler) can run off-main, so marshal the whole AppKit block to the main
    // thread — calling it off-main aborts the process on macOS.
    let win = window.clone();
    let _ = window.run_on_main_thread(move || {
        let ptr = match win.ns_window() {
            Ok(p) => p as *const NSWindow,
            Err(e) => {
                log::warn!("ns_window() failed; cannot hide traffic lights: {e}");
                return;
            }
        };
        if ptr.is_null() {
            return;
        }
        // Safety: ptr is a live NSWindow for the lifetime of this call (the
        // webview window owns it); we read it only on the main thread (this
        // closure) and issue setHidden:.
        let ns_window: &NSWindow = unsafe { &*ptr };
        for button in [
            NSWindowButton::CloseButton,
            NSWindowButton::MiniaturizeButton,
            NSWindowButton::ZoomButton,
        ] {
            if let Some(b) = ns_window.standardWindowButton(button) {
                b.setHidden(true);
            }
        }
    });
}

/// Set the runtime window icon from the embedded 128x128 PNG. tauri-build does
/// not inject a default-window-icon here (the "icon" feature is off), so the
/// bundle icon never reaches the live window; this applies it explicitly so the
/// taskbar (Windows) / app window + taskbar (Linux) show the real icon. On
/// macOS the dock uses the bundled .icns; set_icon is a harmless no-op-ish call
/// for the window itself. The PNG is embedded at compile time (include_bytes!),
/// so a missing file is a build error, never a runtime path lookup.
pub fn apply_window_icon(window: &tauri::WebviewWindow) {
    const ICON_PNG: &[u8] = include_bytes!("../icons/128x128.png");
    match tauri::image::Image::from_bytes(ICON_PNG) {
        Ok(icon) => {
            if let Err(e) = window.set_icon(icon) {
                log::warn!("set_icon failed: {e}");
            }
        }
        Err(e) => log::warn!("decode embedded window icon failed: {e}"),
    }
}

// ---------------------------------------------------------------------------
//  Commands — each acts on the CALLING window (PA-8: no windowId from JS)
// ---------------------------------------------------------------------------

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
