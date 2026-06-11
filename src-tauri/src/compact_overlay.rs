//! compact_overlay — port of src/main/compact-overlay.ts + the thin command
//! shell from src/main/window.ts (task #4, owner: worker-window).
//!
//! PURE planner (state machine) + verbatim test port. The tricky part is
//! RESTORE correctness: a window can be maximized or fullscreen when compact
//! is requested, and naively resizing fights the OS window state — so enter
//! clears fullscreen FIRST, then unmaximize, then always-on-top + shrink;
//! leave restores in inverse order. Idempotent by the snapshot guard.

use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};

use crate::contract::CompactOverlayResult;
use crate::result::NpResult;

/// UWP CompactOverlay default view size (logical/DIP, Electron `setSize` parity).
pub const COMPACT_WIDTH: f64 = 500.0;
pub const COMPACT_HEIGHT: f64 = 360.0;

/// A window rectangle in PHYSICAL pixels (snapshot/restore round-trips the
/// exact same values, so the unit only has to be self-consistent).
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct WindowRect {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
}

/// The live window flags the enter-planner snapshots + normalizes from.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct WindowFlags {
    pub bounds: WindowRect,
    pub always_on_top: bool,
    pub maximized: bool,
    pub full_screen: bool,
}

/// The pre-compact snapshot, held per-window while compact, so leaving
/// restores the window EXACTLY — including a maximized/fullscreen state that
/// had to be cleared in order to shrink.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct CompactSnapshot {
    pub bounds: WindowRect,
    pub always_on_top: bool,
    pub was_maximized: bool,
    pub was_full_screen: bool,
}

/// Declarative actions the shell applies to the window, in order. Keeping
/// these as data (not direct window calls) is what makes the planner pure +
/// testable; order matters (e.g. exit fullscreen BEFORE resizing).
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum WindowAction {
    SetFullScreen(bool),
    Unmaximize,
    Maximize,
    SetAlwaysOnTop(bool),
    /// Logical (DIP) size — the compact 500×360.
    SetSize { width: f64, height: f64 },
    SetBounds(WindowRect),
}

pub struct CompactEnterPlan {
    pub snapshot: CompactSnapshot,
    pub actions: Vec<WindowAction>,
}

/// Plan entering compact overlay from the current window flags. Snapshot the
/// maximized/fullscreen state too, then CLEAR them (fullscreen first, then
/// unmaximize) before going always-on-top + shrinking.
pub fn plan_compact_enter(current: &WindowFlags) -> CompactEnterPlan {
    let snapshot = CompactSnapshot {
        bounds: current.bounds,
        always_on_top: current.always_on_top,
        was_maximized: current.maximized,
        was_full_screen: current.full_screen,
    };
    let mut actions: Vec<WindowAction> = Vec::new();
    // Clear fullscreen FIRST — resizing a fullscreen window is a no-op on Windows.
    if current.full_screen {
        actions.push(WindowAction::SetFullScreen(false));
    }
    if current.maximized {
        actions.push(WindowAction::Unmaximize);
    }
    actions.push(WindowAction::SetAlwaysOnTop(true));
    actions.push(WindowAction::SetSize { width: COMPACT_WIDTH, height: COMPACT_HEIGHT });
    CompactEnterPlan { snapshot, actions }
}

/// Plan leaving compact overlay back to a snapshot. Restore order is the
/// inverse: drop always-on-top, restore the bounds, then re-apply
/// maximize/fullscreen if the window had them.
pub fn plan_compact_leave(snapshot: &CompactSnapshot) -> Vec<WindowAction> {
    let mut actions: Vec<WindowAction> = Vec::new();
    actions.push(WindowAction::SetAlwaysOnTop(snapshot.always_on_top));
    actions.push(WindowAction::SetBounds(snapshot.bounds));
    if snapshot.was_maximized {
        actions.push(WindowAction::Maximize);
    }
    if snapshot.was_full_screen {
        actions.push(WindowAction::SetFullScreen(true));
    }
    actions
}

/// The window operations the stateful toggle driver needs, abstracted so the
/// driver (and its idempotent guard) is unit-testable without a real window.
pub trait CompactWindowPort {
    fn read_flags(&self) -> WindowFlags;
    fn apply(&mut self, actions: &[WindowAction]);
}

/// Per-window compact state: the pre-compact snapshot while compact, else None.
#[derive(Debug, Default, Clone, Copy)]
pub struct CompactState {
    pub snapshot: Option<CompactSnapshot>,
}

/// Fresh state for a window that has never entered compact.
#[cfg_attr(not(test), allow(dead_code))]
pub fn create_compact_state() -> CompactState {
    CompactState { snapshot: None }
}

/// Drive a compact-overlay toggle against a window port, mutating `state`.
/// Idempotent by the `state.snapshot` guard: entering when already compact, or
/// leaving when already normal, applies NOTHING and preserves the original
/// snapshot. Returns the resolved compact flag.
pub fn toggle_compact(
    port: &mut dyn CompactWindowPort,
    state: &mut CompactState,
    enabled: bool,
) -> bool {
    let is_compact = state.snapshot.is_some();
    if enabled && !is_compact {
        let plan = plan_compact_enter(&port.read_flags());
        state.snapshot = Some(plan.snapshot);
        port.apply(&plan.actions);
        return true;
    }
    if !enabled && is_compact {
        let snapshot = state.snapshot.take().expect("guarded by is_compact");
        port.apply(&plan_compact_leave(&snapshot));
        return false;
    }
    // Already in the requested state — no-op.
    enabled
}

// ---------------------------------------------------------------------------
//  Tauri shell — adapts a real WebviewWindow to the pure driver
// ---------------------------------------------------------------------------

/// Per-window compact state, keyed by window label (Electron used a WeakMap
/// keyed by BrowserWindow).
fn compact_states() -> &'static Mutex<HashMap<String, CompactState>> {
    static STATES: OnceLock<Mutex<HashMap<String, CompactState>>> = OnceLock::new();
    STATES.get_or_init(|| Mutex::new(HashMap::new()))
}

/// True when the labeled window is currently in the compact-overlay state.
/// Used by window_bounds so a compact window's shrunken rect is not persisted
/// as the user's chosen size.
pub fn is_compact(label: &str) -> bool {
    compact_states()
        .lock()
        .map(|m| m.get(label).map(|s| s.snapshot.is_some()).unwrap_or(false))
        .unwrap_or(false)
}

/// Drop the per-window state when a window is destroyed (label may be reused).
pub fn forget_window(label: &str) {
    if let Ok(mut m) = compact_states().lock() {
        m.remove(label);
    }
}

struct TauriCompactPort<'a> {
    window: &'a tauri::WebviewWindow,
}

impl CompactWindowPort for TauriCompactPort<'_> {
    fn read_flags(&self) -> WindowFlags {
        let pos = self.window.outer_position().unwrap_or(tauri::PhysicalPosition::new(0, 0));
        let size = self.window.outer_size().unwrap_or(tauri::PhysicalSize::new(0, 0));
        WindowFlags {
            bounds: WindowRect { x: pos.x, y: pos.y, width: size.width, height: size.height },
            always_on_top: self.window.is_always_on_top().unwrap_or(false),
            maximized: self.window.is_maximized().unwrap_or(false),
            full_screen: self.window.is_fullscreen().unwrap_or(false),
        }
    }

    fn apply(&mut self, actions: &[WindowAction]) {
        for a in actions {
            // Best-effort like the Electron shell — individual failures are
            // logged, the rest of the plan still applies.
            let res: tauri::Result<()> = match *a {
                WindowAction::SetFullScreen(v) => self.window.set_fullscreen(v),
                WindowAction::Unmaximize => self.window.unmaximize(),
                WindowAction::Maximize => self.window.maximize(),
                WindowAction::SetAlwaysOnTop(v) => self.window.set_always_on_top(v),
                WindowAction::SetSize { width, height } => {
                    self.window.set_size(tauri::LogicalSize::new(width, height))
                }
                WindowAction::SetBounds(b) => self
                    .window
                    .set_size(tauri::PhysicalSize::new(b.width, b.height))
                    .and_then(|_| {
                        self.window.set_position(tauri::PhysicalPosition::new(b.x, b.y))
                    }),
            };
            if let Err(e) = res {
                log::warn!("compact-overlay action failed: {e}");
            }
        }
    }
}

#[tauri::command]
pub async fn window_set_compact_overlay(
    window: tauri::WebviewWindow,
    enabled: bool,
) -> NpResult<CompactOverlayResult> {
    let label = window.label().to_string();
    let mut states = match compact_states().lock() {
        Ok(g) => g,
        Err(e) => return NpResult::Err(e.to_string()),
    };
    let state = states.entry(label).or_default();
    let mut port = TauriCompactPort { window: &window };
    let is_compact_overlay = toggle_compact(&mut port, state, enabled);
    NpResult::Ok(CompactOverlayResult { is_compact_overlay })
}

// ---------------------------------------------------------------------------
//  Tests — port of compact-overlay.test.ts + the toggle half of window.test.ts
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    const RECT: WindowRect = WindowRect { x: 100, y: 80, width: 1100, height: 720 };

    fn flags(always_on_top: bool, maximized: bool, full_screen: bool) -> WindowFlags {
        WindowFlags { bounds: RECT, always_on_top, maximized, full_screen }
    }

    // -- planCompactEnter ----------------------------------------------------

    #[test]
    fn enter_snapshots_all_four_flags() {
        let plan = plan_compact_enter(&flags(true, true, false));
        assert_eq!(
            plan.snapshot,
            CompactSnapshot {
                bounds: RECT,
                always_on_top: true,
                was_maximized: true,
                was_full_screen: false
            }
        );
    }

    #[test]
    fn enter_from_normal_window_is_aot_then_shrink() {
        let plan = plan_compact_enter(&flags(false, false, false));
        assert_eq!(
            plan.actions,
            vec![
                WindowAction::SetAlwaysOnTop(true),
                WindowAction::SetSize { width: COMPACT_WIDTH, height: COMPACT_HEIGHT }
            ]
        );
    }

    #[test]
    fn enter_clears_fullscreen_first_then_unmaximize_before_shrinking() {
        let plan = plan_compact_enter(&flags(false, true, true));
        assert_eq!(
            plan.actions,
            vec![
                WindowAction::SetFullScreen(false),
                WindowAction::Unmaximize,
                WindowAction::SetAlwaysOnTop(true),
                WindowAction::SetSize { width: COMPACT_WIDTH, height: COMPACT_HEIGHT }
            ]
        );
    }

    #[test]
    fn enter_unmaximizes_a_maximized_window_before_shrinking() {
        let plan = plan_compact_enter(&flags(false, true, false));
        let kinds: Vec<&str> = plan
            .actions
            .iter()
            .map(|a| match a {
                WindowAction::Unmaximize => "unmaximize",
                WindowAction::SetAlwaysOnTop(_) => "setAlwaysOnTop",
                WindowAction::SetSize { .. } => "setSize",
                _ => "other",
            })
            .collect();
        assert_eq!(kinds, vec!["unmaximize", "setAlwaysOnTop", "setSize"]);
    }

    // -- planCompactLeave ----------------------------------------------------

    fn base_snapshot() -> CompactSnapshot {
        CompactSnapshot {
            bounds: RECT,
            always_on_top: false,
            was_maximized: false,
            was_full_screen: false,
        }
    }

    #[test]
    fn leave_restores_aot_then_bounds_for_plain_window() {
        assert_eq!(
            plan_compact_leave(&base_snapshot()),
            vec![WindowAction::SetAlwaysOnTop(false), WindowAction::SetBounds(RECT)]
        );
    }

    #[test]
    fn leave_re_maximizes_after_restoring_bounds() {
        let out = plan_compact_leave(&CompactSnapshot { was_maximized: true, ..base_snapshot() });
        assert_eq!(
            out,
            vec![
                WindowAction::SetAlwaysOnTop(false),
                WindowAction::SetBounds(RECT),
                WindowAction::Maximize
            ]
        );
    }

    #[test]
    fn leave_re_enters_fullscreen_last() {
        let out = plan_compact_leave(&CompactSnapshot {
            was_maximized: true,
            was_full_screen: true,
            ..base_snapshot()
        });
        assert_eq!(
            out,
            vec![
                WindowAction::SetAlwaysOnTop(false),
                WindowAction::SetBounds(RECT),
                WindowAction::Maximize,
                WindowAction::SetFullScreen(true)
            ]
        );
    }

    #[test]
    fn round_trip_preserves_pre_existing_always_on_top() {
        let plan = plan_compact_enter(&flags(true, false, false));
        let leave = plan_compact_leave(&plan.snapshot);
        assert_eq!(leave[0], WindowAction::SetAlwaysOnTop(true));
    }

    // -- toggleCompact (fake-port driver, window.test.ts) ---------------------

    /// A fake window port: records every applied action and reflects the flags
    /// back the way a real window would, so a second read after enter sees the
    /// compact state — proving the guard, not the port, makes re-entry a no-op.
    struct FakeWindow {
        bounds: WindowRect,
        always_on_top: bool,
        maximized: bool,
        full_screen: bool,
        calls: Vec<String>,
    }

    impl FakeWindow {
        fn new(maximized: bool, full_screen: bool) -> Self {
            FakeWindow {
                bounds: RECT,
                always_on_top: false,
                maximized,
                full_screen,
                calls: Vec::new(),
            }
        }
    }

    impl CompactWindowPort for FakeWindow {
        fn read_flags(&self) -> WindowFlags {
            WindowFlags {
                bounds: self.bounds,
                always_on_top: self.always_on_top,
                maximized: self.maximized,
                full_screen: self.full_screen,
            }
        }
        fn apply(&mut self, actions: &[WindowAction]) {
            for a in actions {
                match *a {
                    WindowAction::SetFullScreen(v) => {
                        self.full_screen = v;
                        self.calls.push(format!("setFullScreen:{v}"));
                    }
                    WindowAction::Unmaximize => {
                        self.maximized = false;
                        self.calls.push("unmaximize".into());
                    }
                    WindowAction::Maximize => {
                        self.maximized = true;
                        self.calls.push("maximize".into());
                    }
                    WindowAction::SetAlwaysOnTop(v) => {
                        self.always_on_top = v;
                        self.calls.push(format!("setAlwaysOnTop:{v}"));
                    }
                    WindowAction::SetSize { width, height } => {
                        self.bounds.width = width as u32;
                        self.bounds.height = height as u32;
                        self.calls.push(format!("setSize:{width}x{height}"));
                    }
                    WindowAction::SetBounds(b) => {
                        self.bounds = b;
                        self.calls.push(format!("setBounds:{}x{}", b.width, b.height));
                    }
                }
            }
        }
    }

    #[test]
    fn toggle_enters_compact_from_normal_window() {
        let mut win = FakeWindow::new(false, false);
        let mut state = create_compact_state();
        let res = toggle_compact(&mut win, &mut state, true);
        assert!(res);
        assert_eq!(
            win.calls,
            vec![
                "setAlwaysOnTop:true".to_string(),
                format!("setSize:{COMPACT_WIDTH}x{COMPACT_HEIGHT}")
            ]
        );
    }

    #[test]
    fn toggle_round_trips_normal_window_to_exact_prior_bounds() {
        let mut win = FakeWindow::new(false, false);
        let mut state = create_compact_state();
        toggle_compact(&mut win, &mut state, true);
        win.calls.clear();
        let res = toggle_compact(&mut win, &mut state, false);
        assert!(!res);
        assert_eq!(
            win.calls,
            vec![
                "setAlwaysOnTop:false".to_string(),
                format!("setBounds:{}x{}", RECT.width, RECT.height)
            ]
        );
        assert_eq!(win.bounds, RECT);
    }

    #[test]
    fn toggle_round_trips_maximized_window() {
        let mut win = FakeWindow::new(true, false);
        let mut state = create_compact_state();
        toggle_compact(&mut win, &mut state, true);
        assert_eq!(
            win.calls,
            vec![
                "unmaximize".to_string(),
                "setAlwaysOnTop:true".to_string(),
                format!("setSize:{COMPACT_WIDTH}x{COMPACT_HEIGHT}")
            ]
        );
        win.calls.clear();
        toggle_compact(&mut win, &mut state, false);
        assert_eq!(
            win.calls,
            vec![
                "setAlwaysOnTop:false".to_string(),
                format!("setBounds:{}x{}", RECT.width, RECT.height),
                "maximize".to_string()
            ]
        );
    }

    #[test]
    fn toggle_round_trips_fullscreen_window() {
        let mut win = FakeWindow::new(false, true);
        let mut state = create_compact_state();
        toggle_compact(&mut win, &mut state, true);
        assert_eq!(
            win.calls,
            vec![
                "setFullScreen:false".to_string(),
                "setAlwaysOnTop:true".to_string(),
                format!("setSize:{COMPACT_WIDTH}x{COMPACT_HEIGHT}")
            ]
        );
        win.calls.clear();
        toggle_compact(&mut win, &mut state, false);
        assert_eq!(
            win.calls,
            vec![
                "setAlwaysOnTop:false".to_string(),
                format!("setBounds:{}x{}", RECT.width, RECT.height),
                "setFullScreen:true".to_string()
            ]
        );
    }

    #[test]
    fn toggle_is_idempotent_on_re_enter_and_keeps_snapshot() {
        let mut win = FakeWindow::new(true, false);
        let mut state = create_compact_state();
        toggle_compact(&mut win, &mut state, true);
        win.calls.clear();
        let res = toggle_compact(&mut win, &mut state, true); // already compact
        assert!(res);
        assert!(win.calls.is_empty()); // no actions — guard short-circuits
        // The ORIGINAL snapshot must survive, so a later leave still restores maximize.
        win.calls.clear();
        toggle_compact(&mut win, &mut state, false);
        assert!(win.calls.contains(&"maximize".to_string()));
    }

    #[test]
    fn toggle_is_idempotent_leaving_when_not_compact() {
        let mut win = FakeWindow::new(false, false);
        let mut state = create_compact_state();
        let res = toggle_compact(&mut win, &mut state, false); // never entered
        assert!(!res);
        assert!(win.calls.is_empty());
    }
}
