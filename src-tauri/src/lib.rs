#![allow(linker_messages)]
//! NotepadE Tauri core — application entry (port of src/main/index.ts boot).
//!
//! FROZEN after scaffold (task #1): workers fill their OWN module files only.
//! If a command signature or registration here must change, message team-lead.
//!
//! Layout follows the backend responsibilities:
//!   result / contract       — shared envelopes and payloads
//!   file_io / encoding / eol — file content and encoding operations
//!   settings / session / theme / shell — persisted app integrations
//!   window_mgmt / bounds / broker / argv_parse / dragout — window lifecycle

mod argv_parse;
mod broker;
mod context_menu;
mod contract;
mod diff;
mod dragout;
mod encoding;
mod eol;
mod file_io;
mod file_stream;
mod folder;
mod folder_watcher;
mod hash;
mod markdown;
mod mru;
mod result;
mod search_url;
mod session;
mod settings;
mod settings_reset;
mod shell_integration;
mod system_codepage;
mod theme;
mod updater;
mod wallpaper;
mod window_bounds;
mod window_mgmt;

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut builder = tauri::Builder::default();

    // Single-instance must be the FIRST registered plugin (Tauri docs).
    // A marker-spawned child (the "New Window" path) must NOT be forwarded into
    // an existing instance — it boots as an independent process.
    let is_new_process = std::env::var(argv_parse::NEW_PROCESS_ENV)
        .map(|v| v == "1")
        .unwrap_or(false);
    if !is_new_process {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, argv, cwd| {
            // Broker routing (task #4): redirect-vs-spawn per alwaysOpenNewWindow /
            // notepads://newinstance; EvtAppActivation carries the SECOND
            // instance's cwd for relative path resolution (argv-parse.ts).
            broker::on_second_instance(app, argv, cwd);
        }));
    }

    builder = builder
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_opener::init());

    builder
        .setup(move |app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }

            let main_window = app
                .get_webview_window("main")
                .expect("main window declared in tauri.conf.json");

            // Native window material: Windows acrylic / macOS vibrancy. Each
            // backs the transparent frameless window with a real blurred
            // surface so the renderer's CSS tint rides on actual translucency.
            // Linux gets no native backing — the renderer paints its opaque
            // theme base (#2E2E2E dark / #F0F0F0 light) itself.
            #[cfg(target_os = "windows")]
            {
                if let Err(e) = window_vibrancy::apply_acrylic(&main_window, None) {
                    log::warn!("apply_acrylic failed (pre-Win10 1809?): {e}");
                }
            }
            #[cfg(target_os = "macos")]
            {
                use window_vibrancy::{NSVisualEffectMaterial, NSVisualEffectState};
                // UnderWindowBackground + Active mirrors the Electron build
                // (vibrancy:'under-window', visualEffectState:'active'); the
                // window keeps native decorations (rounded corners + traffic
                // lights pushed off-screen) per tauri.macos.conf.json.
                if let Err(e) = window_vibrancy::apply_vibrancy(
                    &main_window,
                    NSVisualEffectMaterial::UnderWindowBackground,
                    Some(NSVisualEffectState::Active),
                    None,
                ) {
                    log::warn!("apply_vibrancy failed: {e}");
                }
            }

            // Task #4 (worker-window): hooks (close guard + maximize push +
            // focus tracking), persisted-bounds restore BEFORE show, bounds
            // tracker, then show. Acrylic was already applied above for main,
            // so apply_acrylic=false here.
            window_mgmt::setup_window(&app.handle().clone(), &main_window, false);

            // Broker: renderer-ready queue listener, macOS deep-link hook,
            // and this process's own cold-start argv activation.
            broker::init_broker(&app.handle().clone());

            // Folder watcher state (issue #13)
            folder_watcher::init(&app.handle().clone());

            // Windows/Linux: ensure the notepads:// scheme is registered with
            // the OS even on dev / non-installed runs (the NSIS installer also
            // registers it on a real install; register_all is idempotent so
            // the two don't conflict). macOS registers via Info.plist. Without
            // this, second-instance/protocol routing only works post-install.
            // A marker-spawned child (independent "New Window" process) skips
            // this — the primary/installer already registered the scheme, and a
            // child re-registering is harmless but redundant (design R4).
            #[cfg(any(target_os = "windows", target_os = "linux"))]
            {
                if !is_new_process {
                    use tauri_plugin_deep_link::DeepLinkExt;
                    if let Err(e) = app.deep_link().register_all() {
                        log::warn!("deep_link register_all failed: {e}");
                    }
                }
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // folder (issue #10)
            folder::folder_open_dialog,
            folder::folder_list,
            folder::folder_create_file,
            folder::folder_create_folder,
            folder::folder_rename,
            folder::folder_delete,
            // folder watcher (issue #13)
            folder_watcher::folder_start_watch,
            folder_watcher::folder_stop_watch,
            // file (task #2)
            file_io::file_open,
            file_io::file_open_dialog,
            file_io::file_save,
            file_io::file_save_as,
            file_io::file_reload_from_disk,
            file_io::file_revalidate_path,
            // file streaming (large files)
            file_stream::file_get_size,
            file_stream::file_open_streamed,
            file_stream::file_stream_chunks,
            file_stream::file_stream_ack,
            file_stream::file_stream_cancel,
            file_stream::file_save_large_start,
            file_stream::file_save_large_chunk,
            file_stream::file_save_large_finish,
            file_stream::file_discard_large,
            mru::recent_list,
            mru::recent_clear,
            mru::recent_add_folder,
            // encoding + eol (task #2)
            encoding::encoding_decode_with,
            encoding::encoding_list_ansi,
            // hash
            hash::compute_text_hash,
            // diff
            diff::compute_diff,
            // markdown
            markdown::markdown_render,
            // session (task #3)
            session::session_snapshot,
            session::session_load_last,
            session::session_clear_recovered,
            // settings (task #3)
            settings::settings_get,
            settings::settings_set,
            settings_reset::settings_reset_all,
            // window (task #4)
            broker::window_broker_request,
            window_mgmt::window_minimize,
            window_mgmt::window_toggle_maximize,
            window_mgmt::window_close,
            window_mgmt::window_is_maximized,
            window_mgmt::window_quit,
            window_mgmt::window_confirm_close,
            // dragOut (task #4)
            dragout::drag_out_begin,
            dragout::drag_out_complete,
            // shell (task #3)
            shell_integration::shell_open_containing_folder,
            shell_integration::shell_copy_path,
            shell_integration::shell_web_search,
            shell_integration::shell_share,
            // theme (task #3)
            theme::theme_get,
            // updater
            updater::update_check,
            updater::update_install,
            // wallpaper (task #3)
            wallpaper::wallpaper_get,
            wallpaper::wallpaper_set_from_path,
            wallpaper::wallpaper_set_from_url,
            wallpaper::wallpaper_pick,
            wallpaper::wallpaper_clear,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
