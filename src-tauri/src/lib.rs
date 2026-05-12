mod commands;
mod domain;
mod services;

use services::tray::TrayState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(TrayState::default())
        .invoke_handler(tauri::generate_handler![
            commands::get_quota,
            commands::get_codex_info,
            commands::get_codex_stats,
            commands::get_codex_rate_limits,
            commands::get_cost_overview,
            commands::open_claude_dashboard,
            commands::open_codex_dashboard,
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
