mod commands;
mod domain;
mod services;

use services::tray::TrayState;

/// Raise the per-process file descriptor soft limit to its hard ceiling (capped
/// at 65536). macOS apps launched via launchd inherit a soft limit of 256 which
/// is easily exhausted when several services poll concurrently.
#[cfg(unix)]
fn raise_fd_limit() {
    use libc::{getrlimit, rlimit, setrlimit, RLIMIT_NOFILE};
    unsafe {
        let mut limits = rlimit {
            rlim_cur: 0,
            rlim_max: 0,
        };
        if getrlimit(RLIMIT_NOFILE, &mut limits) != 0 {
            return;
        }
        let target = limits.rlim_max.min(65536);
        if target > limits.rlim_cur {
            limits.rlim_cur = target;
            let _ = setrlimit(RLIMIT_NOFILE, &limits);
        }
    }
}

#[cfg(not(unix))]
fn raise_fd_limit() {}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    raise_fd_limit();

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(TrayState::default())
        .invoke_handler(tauri::generate_handler![
            commands::get_quota,
            commands::get_codex_info,
            commands::get_codex_stats,
            commands::get_codex_rate_limits,
            commands::get_codex_reset_credits,
            commands::get_cursor_info,
            commands::get_antigravity_info,
            commands::get_cost_overview,
            commands::open_claude_dashboard,
            commands::open_codex_dashboard,
            commands::open_cursor_dashboard,
            commands::open_antigravity_dashboard,
            commands::resize_window,
            commands::set_dock_visibility,
            commands::update_tray_icon,
            commands::quit_app,
        ])
        .setup(|app| {
            #[cfg(target_os = "macos")]
            {
                use tauri::ActivationPolicy;
                // Default to visible Dock; user can toggle to Accessory from UI.
                app.set_activation_policy(ActivationPolicy::Regular);
            }

            services::tray::setup_tray(app.handle())?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
