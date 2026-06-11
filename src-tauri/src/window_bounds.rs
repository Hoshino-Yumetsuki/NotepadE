//! window_bounds — port of src/main/window-bounds.ts (task #4, owner:
//! worker-window).
//!
//! Persists the last window bounds + maximized flag to `WindowBounds.json` in
//! the app data dir and restores them on the next launch (clamped to a
//! currently-connected monitor work area so a window saved on a disconnected
//! monitor never opens off-screen). Atomic write (tmp + rename),
//! NOTEPADS_E2E_USERDATA override aware. FULLY DISABLED under NOTEPADS_E2E=1
//! (deterministic fixed-size e2e specs). Debounced persist (400ms) on
//! move/resize; immediate on maximize/unmaximize/close; persists the NORMAL
//! (unmaximized) bounds when maximized/fullscreen.

use std::path::PathBuf;
use std::sync::mpsc;
use std::time::Duration;

use serde::{Deserialize, Serialize};

/// Persisted shape — byte-compatible with the Electron WindowBounds.json.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PersistedBounds {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
    #[serde(default)]
    pub is_maximized: bool,
}

/// Default window size (the historical hardcoded values from window-factory;
/// declared in tauri.conf.json — kept here for the test pinning the contract).
#[cfg_attr(not(test), allow(dead_code))]
pub const DEFAULT_BOUNDS: (f64, f64) = (1100.0, 720.0);
const MIN_WIDTH: f64 = 480.0;
const MIN_HEIGHT: f64 = 320.0;

const BOUNDS_FILE_NAME: &str = "WindowBounds.json";

fn is_e2e() -> bool {
    std::env::var("NOTEPADS_E2E").map(|v| v == "1").unwrap_or(false)
}

/// App data root: NOTEPADS_E2E_USERDATA override first, else app_data_dir
/// (identifier com.notepade.app) — Electron userData parity.
fn user_data_root(app: &tauri::AppHandle) -> Option<PathBuf> {
    use tauri::Manager;
    if let Ok(over) = std::env::var("NOTEPADS_E2E_USERDATA") {
        if !over.is_empty() {
            return Some(PathBuf::from(over));
        }
    }
    app.path().app_data_dir().ok()
}

fn bounds_file_path(app: &tauri::AppHandle) -> Option<PathBuf> {
    user_data_root(app).map(|p| p.join(BOUNDS_FILE_NAME))
}

// ---------------------------------------------------------------------------
//  Pure geometry helpers (unit-tested without Tauri)
// ---------------------------------------------------------------------------

/// A rectangle of a display work area, for the clamp computation.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct WorkArea {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

/// A partially-parsed saved record (any field may be missing/non-finite).
#[derive(Debug, Clone, Copy, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct SavedBounds {
    pub x: Option<f64>,
    pub y: Option<f64>,
    pub width: Option<f64>,
    pub height: Option<f64>,
    pub is_maximized: Option<bool>,
}

/// The resolved open-with decision. `position` is None when the saved spot is
/// fully off-screen (stale monitor) — keep the size, center the window
/// (Electron used NaN x/y as that sentinel).
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct ResolvedBounds {
    pub position: Option<(f64, f64)>,
    pub width: f64,
    pub height: f64,
    pub is_maximized: bool,
}

fn finite(v: Option<f64>) -> Option<f64> {
    v.filter(|n| n.is_finite())
}

/// Decide the bounds to open with, given the saved record and the available
/// display work areas. Returns None (→ caller keeps the centered default)
/// when there is no usable saved record. Otherwise clamps the size to >= the
/// minimums and ensures the window's top-left sits inside SOME work area.
pub fn resolve_bounds(saved: Option<&SavedBounds>, work_areas: &[WorkArea]) -> Option<ResolvedBounds> {
    let saved = saved?;
    let x = finite(saved.x)?.floor();
    let y = finite(saved.y)?.floor();
    let width = finite(saved.width)?.floor().max(MIN_WIDTH);
    let height = finite(saved.height)?.floor().max(MIN_HEIGHT);
    let is_maximized = saved.is_maximized == Some(true);

    // On-screen test: the top-left corner must lie within some display's work area.
    let on_screen = work_areas
        .iter()
        .any(|wa| x >= wa.x && x < wa.x + wa.width && y >= wa.y && y < wa.y + wa.height);
    if on_screen || work_areas.is_empty() {
        return Some(ResolvedBounds { position: Some((x, y)), width, height, is_maximized });
    }
    // Off-screen: drop the stale position, keep the size (caller centers it).
    Some(ResolvedBounds { position: None, width, height, is_maximized })
}

/// Serialize bounds to the on-disk JSON form (2-space pretty, Electron parity).
pub fn serialize_bounds(b: &PersistedBounds) -> String {
    serde_json::to_string_pretty(b).unwrap_or_default()
}

// ---------------------------------------------------------------------------
//  Disk IO + window wiring
// ---------------------------------------------------------------------------

/// Read the saved bounds (None on missing/corrupt/unreadable). Never errors.
fn read_saved_bounds(app: &tauri::AppHandle) -> Option<SavedBounds> {
    let path = bounds_file_path(app)?;
    let raw = std::fs::read_to_string(path).ok()?;
    serde_json::from_str::<SavedBounds>(&raw).ok()
}

/// Current display work areas in PHYSICAL pixels (Tauri monitor API).
fn current_work_areas(app: &tauri::AppHandle) -> Vec<WorkArea> {
    match app.available_monitors() {
        Ok(monitors) => monitors
            .iter()
            .map(|m| {
                let wa = m.work_area();
                WorkArea {
                    x: wa.position.x as f64,
                    y: wa.position.y as f64,
                    width: wa.size.width as f64,
                    height: wa.size.height as f64,
                }
            })
            .collect(),
        Err(_) => Vec::new(),
    }
}

fn write_atomic(target: &std::path::Path, contents: &str) -> std::io::Result<()> {
    if let Some(parent) = target.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let tmp = target.with_extension(format!("json.{}.tmp", std::process::id()));
    std::fs::write(&tmp, contents)?;
    match std::fs::rename(&tmp, target) {
        Ok(()) => Ok(()),
        Err(e) => {
            // Windows rename-over-existing can fail; replace then retry once.
            let _ = std::fs::remove_file(target);
            match std::fs::rename(&tmp, target) {
                Ok(()) => Ok(()),
                Err(_) => {
                    let _ = std::fs::remove_file(&tmp);
                    Err(e)
                }
            }
        }
    }
}

/// Restore persisted bounds onto a window BEFORE it is shown. Returns the
/// maximized flag to re-apply (the caller maximizes after positioning). Under
/// e2e or with no usable record this is a no-op (the window keeps its
/// conf-default 1100×720 centered look — visual-golden parity).
pub fn restore_bounds(app: &tauri::AppHandle, window: &tauri::WebviewWindow) {
    if is_e2e() {
        return;
    }
    let Some(resolved) = resolve_bounds(read_saved_bounds(app).as_ref(), &current_work_areas(app))
    else {
        return;
    };
    // Saved values are physical pixels (outer_position/outer_size are physical).
    let _ = window.set_size(tauri::PhysicalSize::new(resolved.width as u32, resolved.height as u32));
    match resolved.position {
        Some((x, y)) => {
            let _ = window.set_position(tauri::PhysicalPosition::new(x as i32, y as i32));
        }
        None => {
            // Stale off-screen position dropped: size only, center it.
            let _ = window.center();
        }
    }
    if resolved.is_maximized {
        let _ = window.maximize();
    }
}

/// Snapshot a window's current persistable bounds. When maximized/fullscreen
/// the NORMAL bounds are not directly readable in Tauri, so the tracker keeps
/// the last-known normal rect (see `track_bounds`) and this returns None to
/// signal "use the tracked normal rect".
fn current_bounds(window: &tauri::WebviewWindow) -> Option<(f64, f64, f64, f64)> {
    let pos = window.outer_position().ok()?;
    let size = window.outer_size().ok()?;
    Some((pos.x as f64, pos.y as f64, size.width as f64, size.height as f64))
}

/// Persist a snapshot. Best-effort; never surfaces failures.
fn persist(app: &tauri::AppHandle, bounds: (f64, f64, f64, f64), is_maximized: bool) {
    if is_e2e() {
        return;
    }
    let Some(path) = bounds_file_path(app) else { return };
    let record = PersistedBounds {
        x: bounds.0,
        y: bounds.1,
        width: bounds.2,
        height: bounds.3,
        is_maximized,
    };
    let _ = write_atomic(&path, &serialize_bounds(&record));
}

/// Messages from window-event callbacks to the per-window persist worker.
enum TrackMsg {
    /// Debounced (move/resize) — wait 400ms of quiet before persisting.
    Debounced,
    /// Immediate (maximize/unmaximize/close).
    Immediate,
}

const DEBOUNCE: Duration = Duration::from_millis(400);

/// Attach the bounds-persist listeners to a window: debounced 400ms on
/// move/resize, immediate on maximize/unmaximize and close-requested. When the
/// window is maximized/fullscreen (or in compact overlay), the last-known
/// NORMAL rect is persisted instead of the live rect (getNormalBounds parity).
/// No-op under e2e. Call once per window AFTER restoring bounds.
pub fn track_bounds(app: &tauri::AppHandle, window: &tauri::WebviewWindow) {
    if is_e2e() {
        return;
    }

    let (tx, rx) = mpsc::channel::<TrackMsg>();

    // Persist worker: owns the debounce timer + the last-known normal rect.
    {
        let app = app.clone();
        let window = window.clone();
        let label = window.label().to_string();
        std::thread::spawn(move || {
            // Seed the normal rect from the current (post-restore) bounds.
            let mut normal_rect = current_bounds(&window);
            let mut pending_deadline: Option<std::time::Instant> = None;

            let snapshot = |normal_rect: &mut Option<(f64, f64, f64, f64)>| {
                let maximized = window.is_maximized().unwrap_or(false);
                let fullscreen = window.is_fullscreen().unwrap_or(false);
                let compact = crate::compact_overlay::is_compact(&label);
                if !(maximized || fullscreen || compact) {
                    if let Some(b) = current_bounds(&window) {
                        *normal_rect = Some(b);
                    }
                }
                (*normal_rect, maximized)
            };

            loop {
                let msg = match pending_deadline {
                    Some(deadline) => {
                        let now = std::time::Instant::now();
                        if deadline <= now {
                            pending_deadline = None;
                            let (rect, maximized) = snapshot(&mut normal_rect);
                            if let Some(rect) = rect {
                                persist(&app, rect, maximized);
                            }
                            continue;
                        }
                        match rx.recv_timeout(deadline - now) {
                            Ok(m) => m,
                            Err(mpsc::RecvTimeoutError::Timeout) => continue,
                            Err(mpsc::RecvTimeoutError::Disconnected) => break,
                        }
                    }
                    None => match rx.recv() {
                        Ok(m) => m,
                        Err(_) => break,
                    },
                };
                match msg {
                    TrackMsg::Debounced => {
                        pending_deadline = Some(std::time::Instant::now() + DEBOUNCE);
                    }
                    TrackMsg::Immediate => {
                        pending_deadline = None;
                        let (rect, maximized) = snapshot(&mut normal_rect);
                        if let Some(rect) = rect {
                            persist(&app, rect, maximized);
                        }
                    }
                }
            }
        });
    }

    // Window-event hook: classify events into debounced vs immediate persists.
    {
        let tx = tx.clone();
        let win = window.clone();
        window.on_window_event(move |event| match event {
            tauri::WindowEvent::Resized(_) => {
                // Tauri has no discrete maximize/unmaximize event; Resized
                // fires for both. Persist immediately when the maximized flag
                // is involved would need state — debounce covers correctness
                // (the flag is read at persist time).
                let _ = if win.is_maximized().unwrap_or(false) {
                    tx.send(TrackMsg::Immediate)
                } else {
                    tx.send(TrackMsg::Debounced)
                };
            }
            tauri::WindowEvent::Moved(_) => {
                let _ = tx.send(TrackMsg::Debounced);
            }
            tauri::WindowEvent::CloseRequested { .. } | tauri::WindowEvent::Destroyed => {
                let _ = tx.send(TrackMsg::Immediate);
            }
            _ => {}
        });
    }
}

// ---------------------------------------------------------------------------
//  Tests — port of window-bounds.test.ts (resolve/clamp + serialize)
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    const PRIMARY: WorkArea = WorkArea { x: 0.0, y: 0.0, width: 1920.0, height: 1040.0 };

    fn saved(x: f64, y: f64, width: f64, height: f64, is_maximized: bool) -> SavedBounds {
        SavedBounds {
            x: Some(x),
            y: Some(y),
            width: Some(width),
            height: Some(height),
            is_maximized: Some(is_maximized),
        }
    }

    #[test]
    fn returns_none_for_missing_or_empty_record() {
        assert_eq!(resolve_bounds(None, &[PRIMARY]), None);
        assert_eq!(resolve_bounds(Some(&SavedBounds::default()), &[PRIMARY]), None);
    }

    #[test]
    fn returns_none_when_any_coordinate_is_non_finite() {
        let s = SavedBounds {
            x: Some(10.0),
            y: Some(10.0),
            width: Some(f64::NAN),
            height: Some(600.0),
            is_maximized: None,
        };
        assert_eq!(resolve_bounds(Some(&s), &[PRIMARY]), None);
    }

    #[test]
    fn passes_through_on_screen_record_flooring_and_clamping_to_minimums() {
        // width 200 is below MIN_WIDTH 480.
        let r = resolve_bounds(Some(&saved(100.7, 50.2, 200.0, 1000.9, false)), &[PRIMARY]);
        assert_eq!(
            r,
            Some(ResolvedBounds {
                position: Some((100.0, 50.0)),
                width: 480.0,
                height: 1000.0,
                is_maximized: false
            })
        );
    }

    #[test]
    fn preserves_the_maximized_flag() {
        let r = resolve_bounds(Some(&saved(10.0, 10.0, 800.0, 600.0, true)), &[PRIMARY]);
        assert_eq!(r.unwrap().is_maximized, true);
    }

    #[test]
    fn drops_stale_off_screen_position_but_keeps_size() {
        // Saved on a now-disconnected monitor at x=3000; only the primary remains.
        let r = resolve_bounds(Some(&saved(3000.0, 200.0, 900.0, 700.0, false)), &[PRIMARY])
            .unwrap();
        assert_eq!(r.position, None);
        assert_eq!(r.width, 900.0);
        assert_eq!(r.height, 700.0);
    }

    #[test]
    fn accepts_a_position_on_a_secondary_display_work_area() {
        let secondary = WorkArea { x: 1920.0, y: 0.0, width: 1920.0, height: 1040.0 };
        let r = resolve_bounds(
            Some(&saved(2000.0, 100.0, 900.0, 700.0, false)),
            &[PRIMARY, secondary],
        )
        .unwrap();
        assert_eq!(r.position, Some((2000.0, 100.0)));
    }

    #[test]
    fn keeps_the_position_when_no_work_areas_are_known() {
        let r = resolve_bounds(Some(&saved(50.0, 60.0, 800.0, 600.0, false)), &[]).unwrap();
        assert_eq!(r.position, Some((50.0, 60.0)));
    }

    #[test]
    fn serialize_round_trips_through_json() {
        let b = PersistedBounds { x: 1.0, y: 2.0, width: 800.0, height: 600.0, is_maximized: true };
        let parsed: PersistedBounds = serde_json::from_str(&serialize_bounds(&b)).unwrap();
        assert_eq!(parsed, b);
        // camelCase key parity with the Electron file.
        let v: serde_json::Value = serde_json::from_str(&serialize_bounds(&b)).unwrap();
        assert!(v.get("isMaximized").is_some());
    }

    #[test]
    fn default_bounds_match_historical_window_size() {
        assert_eq!(DEFAULT_BOUNDS, (1100.0, 720.0));
    }

    #[test]
    fn partial_or_corrupt_saved_json_is_tolerated() {
        let s: SavedBounds = serde_json::from_str(r#"{"x": 5}"#).unwrap();
        assert_eq!(resolve_bounds(Some(&s), &[PRIMARY]), None);
        assert!(serde_json::from_str::<SavedBounds>("not json").is_err());
    }
}
