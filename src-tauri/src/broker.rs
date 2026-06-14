//! broker — port of src/main/broker.ts (task #4, owner: worker-window).
//!
//! The single-instance coordinator + activation router. A second app launch
//! hands its argv + cwd to the primary via tauri-plugin-single-instance
//! (wired in lib.rs); the argv is parsed against the SECOND instance's cwd
//! (argv_parse) and routed: `settings.alwaysOpenNewWindow` OR the
//! `notepads://newinstance` protocol verb spawn a fresh window; anything else
//! redirects into the last-focused live window (unminimize/show/focus).
//!
//! The chosen window receives `notepads:evt:app:activation`
//! ({paths, cwd, protocolUrl}) plus `notepads:evt:app:protocol` (the raw url)
//! when a protocol url is present. Delivery is DEFERRED until that window's
//! renderer has signalled ready — the bridge shim (task #5) must emit the
//! `notepads:renderer:ready` Tauri event with the window LABEL as its string
//! payload once `window.notepads` is installed; queued activations for that
//! label are then flushed (cold-start file open is never dropped).
//!
//! Windows/Linux protocol launches arrive as argv (Electron parity) and are
//! handled by the same argv parse; the deep-link plugin's `on_open_url` is
//! only wired on macOS, where argv does not carry the url.

use std::collections::{HashMap, HashSet};
use std::sync::{Mutex, OnceLock};

use tauri::{Emitter, Listener, Manager};

use crate::argv_parse::{is_new_instance_protocol, parse_argv, NEW_INSTANCE_VERB, PROTOCOL_SCHEME};
use crate::contract::{ActivationEvent, BrokerRequestArgs};
use crate::result::NpResult;

/// `notepads:evt:app:activation` ({paths, cwd, protocolUrl}, window-scoped).
const EVT_ACTIVATION: &str = "notepads:evt:app:activation";
/// `notepads:evt:app:protocol` (raw url string, window-scoped).
const EVT_PROTOCOL: &str = "notepads:evt:app:protocol";
/// Renderer → core ready signal; payload is the window label (JSON string).
pub const EVT_RENDERER_READY: &str = "notepads:renderer:ready";

// ---------------------------------------------------------------------------
//  Broker state (pure data — the queue/focus logic is unit-tested below)
// ---------------------------------------------------------------------------

#[derive(Default)]
struct BrokerState {
    /// The window the broker last saw focused (UWP active-window tracking).
    last_focused: Option<String>,
    /// Labels whose renderer has signalled `notepads:renderer:ready`.
    ready: HashSet<String>,
    /// Activations queued per label until that renderer is ready.
    queued: HashMap<String, Vec<ActivationEvent>>,
    /// Sequence for spawned-window labels (main, win-2, win-3, ...).
    spawn_seq: u32,
}

impl BrokerState {
    fn note_focus(&mut self, label: &str) {
        // Keep last_focused as the most-recent; blur does not null it.
        self.last_focused = Some(label.to_string());
    }

    fn forget(&mut self, label: &str) {
        if self.last_focused.as_deref() == Some(label) {
            self.last_focused = None;
        }
        self.ready.remove(label);
        self.queued.remove(label);
    }

    /// Queue an activation if `label`'s renderer is not ready yet.
    /// Returns true when the caller may deliver immediately.
    fn deliverable_or_queue(&mut self, label: &str, event: ActivationEvent) -> Option<ActivationEvent> {
        if self.ready.contains(label) {
            Some(event)
        } else {
            self.queued.entry(label.to_string()).or_default().push(event);
            None
        }
    }

    /// Mark a renderer ready and drain everything queued for it.
    fn mark_ready(&mut self, label: &str) -> Vec<ActivationEvent> {
        self.ready.insert(label.to_string());
        self.queued.remove(label).unwrap_or_default()
    }

    /// Mint the next spawned-window label (main is the conf-declared window).
    fn next_label(&mut self) -> String {
        self.spawn_seq += 1;
        format!("win-{}", self.spawn_seq + 1) // first spawn is win-2
    }
}

fn state() -> &'static Mutex<BrokerState> {
    static STATE: OnceLock<Mutex<BrokerState>> = OnceLock::new();
    STATE.get_or_init(|| Mutex::new(BrokerState::default()))
}

/// Track focus so redirect targets the window the user last used
/// (called from window_mgmt's Focused(true) hook).
pub fn note_focus(label: &str) {
    if let Ok(mut s) = state().lock() {
        s.note_focus(label);
    }
}

/// Drop per-window broker state when a window is destroyed.
pub fn forget_window(label: &str) {
    if let Ok(mut s) = state().lock() {
        s.forget(label);
    }
}

// ---------------------------------------------------------------------------
//  Window spawn / redirect / deliver
// ---------------------------------------------------------------------------

/// Spawn a fresh app window (broker 'new window' path). Mirrors the main
/// window's tauri.conf.json declaration: 1100×720 min 480×320, hidden,
/// frameless, transparent; window_mgmt::setup_window then applies acrylic,
/// hooks, persisted bounds and shows it.
fn spawn_window(app: &tauri::AppHandle) -> Option<tauri::WebviewWindow> {
    let label = match state().lock() {
        Ok(mut s) => s.next_label(),
        Err(_) => return None,
    };
    // WebviewUrl::default() is an empty PathBuf, which resolves to "" and loads
    // a blank/failed page. The conf-declared "main" window uses the config's
    // default url ("index.html"); spawn the SAME entry so the renderer boots.
    let mut builder =
        tauri::WebviewWindowBuilder::new(app, &label, tauri::WebviewUrl::App("index.html".into()))
            .title("NotepadE")
        .inner_size(1100.0, 720.0)
        .min_inner_size(480.0, 320.0)
        .visible(false)
        .transparent(true)
        .resizable(true);
    // macOS keeps native decorations (rounded corners + native shadow) with the
    // title bar overlaid + title hidden; setup_window then HIDES the native
    // traffic lights so the renderer's custom CaptionButtons are the only
    // controls — matching the main window's tauri.macos.conf.json and the
    // pre-refactor Electron build. Windows/Linux stay frameless (decorations off).
    #[cfg(target_os = "macos")]
    {
        builder = builder
            .decorations(true)
            .title_bar_style(tauri::TitleBarStyle::Overlay)
            .hidden_title(true);
    }
    #[cfg(not(target_os = "macos"))]
    {
        builder = builder.decorations(false);
    }
    let built = builder.build();
    match built {
        Ok(win) => {
            crate::window_mgmt::setup_window(app, &win, true);
            Some(win)
        }
        Err(e) => {
            log::error!("broker: failed to spawn window {label}: {e}");
            // A reused label would otherwise stay burned; the seq already
            // advanced so the next spawn gets a fresh label — fine.
            None
        }
    }
}

/// Pick the redirect target: the last-focused live window, else any live one.
fn redirect_target(app: &tauri::AppHandle) -> Option<tauri::WebviewWindow> {
    let last = state().lock().ok().and_then(|s| s.last_focused.clone());
    if let Some(label) = last {
        if let Some(win) = app.get_webview_window(&label) {
            return Some(win);
        }
    }
    let windows = app.webview_windows();
    windows.get("main").cloned().or_else(|| windows.values().next().cloned())
}

/// Bring a window to the foreground for an activation: restore if minimized,
/// re-show, focus (Windows: show raises where a bare focus may only flash the
/// taskbar button) — UWP redirect parity.
fn bring_to_front(win: &tauri::WebviewWindow) {
    if win.is_minimized().unwrap_or(false) {
        let _ = win.unminimize();
    }
    let _ = win.show();
    let _ = win.set_focus();
}

/// Send the activation push to a specific window's renderer — or queue it
/// until that renderer signals ready (cold-start queue).
fn deliver(win: &tauri::WebviewWindow, event: ActivationEvent) {
    let label = win.label().to_string();
    let deliverable = match state().lock() {
        Ok(mut s) => s.deliverable_or_queue(&label, event),
        Err(_) => return,
    };
    if let Some(event) = deliverable {
        emit_activation(win, &event);
    }
}

fn emit_activation(win: &tauri::WebviewWindow, event: &ActivationEvent) {
    let _ = win.emit_to(win.label(), EVT_ACTIVATION, event);
    if let Some(url) = &event.protocol_url {
        let _ = win.emit_to(win.label(), EVT_PROTOCOL, url);
    }
}

/// Route an activation: spawn a new window when alwaysOpenNewWindow is set or
/// the protocol asked for a new instance; otherwise redirect into the
/// last-focused window (spawning one if none exist). The activation event is
/// then delivered to (or queued for) the chosen window's renderer.
async fn route_activation(app: &tauri::AppHandle, event: ActivationEvent) -> Result<(), String> {
    // settings.alwaysOpenNewWindow via worker-persist's settings module; an
    // unreadable settings store falls back to false (Electron parity).
    let always_new = match crate::settings::settings_get(app.clone()).await {
        NpResult::Ok(s) => s.always_open_new_window,
        NpResult::Err(_) => false,
    };
    let force_new = always_new || is_new_instance_protocol(event.protocol_url.as_deref());

    let target = if force_new {
        spawn_window(app)
    } else {
        redirect_target(app).or_else(|| spawn_window(app))
    };
    let Some(target) = target else {
        let msg = "broker: no window available for activation (spawn failed)";
        log::error!("{msg}");
        return Err(msg.to_string());
    };
    // A freshly spawned window already comes up shown+focused; a redirected
    // existing window may be behind other apps or minimized — surface it.
    if !force_new {
        bring_to_front(&target);
    }
    deliver(&target, event);
    Ok(())
}

// ---------------------------------------------------------------------------
//  Entry points
// ---------------------------------------------------------------------------

/// Second-instance hook wired from lib.rs (tauri-plugin-single-instance).
/// Parses the SECOND instance's argv against ITS cwd and routes.
pub fn on_second_instance(app: &tauri::AppHandle, argv: Vec<String>, cwd: String) {
    let parsed = parse_argv(&argv, &cwd);
    let event = ActivationEvent { paths: parsed.paths, cwd, protocol_url: parsed.protocol_url };
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        if let Err(e) = route_activation(&app, event).await {
            log::error!("broker: second-instance activation failed: {e}");
        }
    });
}

/// Initialize the broker. Call once from the lib.rs setup hook AFTER the main
/// window has been set up:
///  - listens for the renderer-ready signal and flushes that label's queue;
///  - (macOS) wires deep-link `on_open_url` into the activation path;
///  - parses THIS process's own argv (cold-launch file/protocol open) and
///    routes it — delivery waits in the queue until the renderer is ready.
pub fn init_broker(app: &tauri::AppHandle) {
    // Renderer-ready signal (bridge shim emits the window label as payload).
    {
        let app = app.clone();
        app.clone().listen_any(EVT_RENDERER_READY, move |event| {
            let label: String = serde_json::from_str(event.payload())
                .unwrap_or_else(|_| event.payload().trim_matches('"').to_string());
            let drained = match state().lock() {
                Ok(mut s) => s.mark_ready(&label),
                Err(_) => return,
            };
            if let Some(win) = app.get_webview_window(&label) {
                for ev in drained {
                    emit_activation(&win, &ev);
                }
            }
        });
    }

    // macOS: file-association opens AND protocol urls both arrive via
    // RunEvent::Opened (forwarded by the deep-link plugin), never argv.
    // `file://` urls are Finder "open with" documents — route them as paths
    // so the renderer's onActivation (which only reads event.paths) opens
    // them; anything else is a real notepads:// protocol url.
    //
    // Cold start: the OS may deliver the open-document event BEFORE our
    // on_open_url listener is registered — the plugin then only stashes the
    // urls in its `current` state. Drain get_current() once here (documented
    // cold-start pattern); on_open_url covers everything after.
    #[cfg(target_os = "macos")]
    {
        use tauri_plugin_deep_link::DeepLinkExt;

        fn route_urls(app: &tauri::AppHandle, urls: Vec<url::Url>) {
            let cwd = std::env::current_dir()
                .map(|p| p.to_string_lossy().into_owned())
                .unwrap_or_default();
            let mut paths: Vec<String> = Vec::new();
            for url in urls {
                if url.scheme() == "file" {
                    if let Ok(p) = url.to_file_path() {
                        paths.push(p.to_string_lossy().into_owned());
                    }
                    continue;
                }
                let ev = ActivationEvent {
                    paths: Vec::new(),
                    cwd: cwd.clone(),
                    protocol_url: Some(url.to_string()),
                };
                let app = app.clone();
                tauri::async_runtime::spawn(async move {
                    if let Err(e) = route_activation(&app, ev).await {
                        log::error!("broker: protocol-url activation failed: {e}");
                    }
                });
            }
            if !paths.is_empty() {
                let ev = ActivationEvent { paths, cwd, protocol_url: None };
                let app = app.clone();
                tauri::async_runtime::spawn(async move {
                    if let Err(e) = route_activation(&app, ev).await {
                        log::error!("broker: file-open activation failed: {e}");
                    }
                });
            }
        }

        if let Ok(Some(urls)) = app.deep_link().get_current() {
            route_urls(app, urls);
        }

        let handle = app.clone();
        app.deep_link().on_open_url(move |event| {
            route_urls(&handle, event.urls());
        });
    }

    // Cold-start: this process's OWN argv may carry file paths / a protocol
    // url (Windows file-association / protocol launch). Same parse, same
    // routing; the ready-queue defers delivery until the renderer is up.
    let argv: Vec<String> = std::env::args().collect();
    let cwd = std::env::current_dir().map(|p| p.to_string_lossy().into_owned()).unwrap_or_default();
    let parsed = parse_argv(&argv, &cwd);
    if !parsed.paths.is_empty() || parsed.protocol_url.is_some() {
        let event =
            ActivationEvent { paths: parsed.paths, cwd, protocol_url: parsed.protocol_url };
        let app = app.clone();
        tauri::async_runtime::spawn(async move {
            if let Err(e) = route_activation(&app, event).await {
                log::error!("broker: cold-start activation failed: {e}");
            }
        });
    }
}

/// Programmatic broker entry for the renderer's `window.brokerRequest` (File >
/// New Window + void-drop new-window path). Routes the requested paths
/// through the SAME spawn-vs-redirect logic as an OS activation;
/// `forceNewWindow` maps to the protocol `newinstance` semantics.
#[tauri::command]
pub async fn window_broker_request(
    app: tauri::AppHandle,
    args: BrokerRequestArgs,
) -> NpResult<()> {
    let cwd =
        std::env::current_dir().map(|p| p.to_string_lossy().into_owned()).unwrap_or_default();
    let protocol_url = if args.force_new_window.unwrap_or(false) {
        Some(format!("{PROTOCOL_SCHEME}://{NEW_INSTANCE_VERB}"))
    } else {
        None
    };
    route_activation(&app, ActivationEvent { paths: args.paths, cwd, protocol_url }).await.into()
}

// ---------------------------------------------------------------------------
//  Tests — the pure queue/focus/label state machine
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    fn ev(path: &str) -> ActivationEvent {
        ActivationEvent {
            paths: vec![path.to_string()],
            cwd: "/cwd".into(),
            protocol_url: None,
        }
    }

    #[test]
    fn activation_for_unready_window_is_queued_then_flushed_on_ready() {
        let mut s = BrokerState::default();
        assert!(s.deliverable_or_queue("main", ev("/a.txt")).is_none());
        assert!(s.deliverable_or_queue("main", ev("/b.txt")).is_none());
        let drained = s.mark_ready("main");
        assert_eq!(drained.len(), 2);
        assert_eq!(drained[0].paths, vec!["/a.txt"]);
        assert_eq!(drained[1].paths, vec!["/b.txt"]);
        // Once ready, activations deliver immediately.
        assert!(s.deliverable_or_queue("main", ev("/c.txt")).is_some());
        // Ready again drains nothing new.
        assert!(s.mark_ready("main").is_empty());
    }

    #[test]
    fn queues_are_per_label() {
        let mut s = BrokerState::default();
        assert!(s.deliverable_or_queue("main", ev("/a.txt")).is_none());
        assert!(s.deliverable_or_queue("win-2", ev("/b.txt")).is_none());
        let drained = s.mark_ready("win-2");
        assert_eq!(drained.len(), 1);
        assert_eq!(drained[0].paths, vec!["/b.txt"]);
        // main's queue is untouched.
        assert_eq!(s.mark_ready("main").len(), 1);
    }

    #[test]
    fn focus_tracking_keeps_most_recent_and_clears_on_forget() {
        let mut s = BrokerState::default();
        s.note_focus("main");
        s.note_focus("win-2");
        assert_eq!(s.last_focused.as_deref(), Some("win-2"));
        s.forget("win-2");
        assert_eq!(s.last_focused, None);
        // Forgetting a non-focused window keeps last_focused.
        s.note_focus("main");
        s.forget("win-3");
        assert_eq!(s.last_focused.as_deref(), Some("main"));
    }

    #[test]
    fn forget_drops_ready_flag_and_queue() {
        let mut s = BrokerState::default();
        s.mark_ready("win-2");
        s.forget("win-2");
        // A reused label starts unready: activations queue again.
        assert!(s.deliverable_or_queue("win-2", ev("/x.txt")).is_none());
    }

    #[test]
    fn spawned_labels_are_unique_and_sequential() {
        let mut s = BrokerState::default();
        assert_eq!(s.next_label(), "win-2");
        assert_eq!(s.next_label(), "win-3");
        assert_eq!(s.next_label(), "win-4");
    }
}
