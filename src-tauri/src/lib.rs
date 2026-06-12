//! NotepadE Tauri core — application entry (port of src/main/index.ts boot).
//!
//! FROZEN after scaffold (task #1): workers fill their OWN module files only.
//! If a command signature or registration here must change, message team-lead.
//!
//! Layout (1 module ≈ 1 Electron src/main/*.ts file):
//!   result.rs           Result envelope  (FROZEN)
//!   contract.rs         payload types mirroring src/shared/ipc-contract.ts (FROZEN)
//!   file_io / encoding / eol / system_codepage / mru          — task #2 (worker-core)
//!   settings / settings_reset / session / wallpaper / theme /
//!   shell_integration / search_url / context_menu             — task #3 (worker-persist)
//!   window_mgmt / compact_overlay / window_bounds / broker /
//!   argv_parse / dragout                                      — task #4 (worker-window)

mod argv_parse;
mod broker;
mod compact_overlay;
mod context_menu;
mod contract;
mod dragout;
mod encoding;
mod eol;
mod file_io;
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

    // Single-instance must be the FIRST registered plugin (Tauri docs). The
    // Electron app skipped single-instance under NOTEPADS_E2E=1 so parallel
    // test apps don't redirect into each other — preserve that.
    let is_e2e = std::env::var("NOTEPADS_E2E").map(|v| v == "1").unwrap_or(false);
    if !is_e2e {
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
        .setup(|app| {
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

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // file (task #2)
            file_io::file_open,
            file_io::file_open_dialog,
            file_io::file_save,
            file_io::file_save_as,
            file_io::file_reload_from_disk,
            file_io::file_revalidate_path,
            // recent (task #2)
            mru::recent_list,
            mru::recent_clear,
            // encoding + eol (task #2)
            encoding::encoding_list_ansi,
            encoding::encoding_decode_with,
            eol::encoding_convert_eol,
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
            window_mgmt::window_set_full_screen,
            compact_overlay::window_set_compact_overlay,
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
            shell_integration::shell_print,
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
