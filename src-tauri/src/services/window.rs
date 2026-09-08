use std::sync::{
    atomic::{AtomicBool, Ordering},
    Mutex,
};

use tauri::{AppHandle, Emitter, LogicalSize, Manager};

static DOCK_VISIBLE: AtomicBool = AtomicBool::new(true);

#[derive(Default)]
pub struct AnalysisWindowState(pub Mutex<String>);

pub async fn open_analysis(app: AppHandle, source: String) -> Result<(), String> {
    let state = app.state::<AnalysisWindowState>();
    *state.0.lock().map_err(|e| e.to_string())? = source.clone();
    let window = app
        .get_webview_window("analysis")
        .ok_or("Analysis window is unavailable")?;
    window
        .emit("analysis-source-changed", &source)
        .map_err(|e| e.to_string())?;
    if let Some(popover) = app.get_webview_window("main") {
        popover.hide().map_err(|e| e.to_string())?;
    }
    show_workspace(&app)
}

pub fn open_quota_popover(app: AppHandle) -> Result<(), String> {
    super::tray::position_panel_at_visible_tray(&app)?;
    let window = app
        .get_webview_window("main")
        .ok_or("Tray panel is unavailable")?;
    window.show().map_err(|e| e.to_string())?;
    window.set_focus().map_err(|e| e.to_string())
}

pub fn show_workspace(app: &AppHandle) -> Result<(), String> {
    let window = app
        .get_webview_window("analysis")
        .ok_or("Analysis window is unavailable")?;
    #[cfg(target_os = "macos")]
    app.set_activation_policy(tauri::ActivationPolicy::Regular)
        .map_err(|e| e.to_string())?;
    window.unminimize().map_err(|e| e.to_string())?;
    window.show().map_err(|e| e.to_string())?;
    window.set_focus().map_err(|e| e.to_string())
}

pub fn setup_workspace(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("analysis") {
        let handle = app.clone();
        let window_clone = window.clone();
        window.on_window_event(move |event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                if let Err(error) = window_clone
                    .hide()
                    .and_then(|_| apply_dock_visibility(&handle))
                {
                    eprintln!("Failed to close analysis window: {error}");
                }
            }
        });
    }
}

fn apply_dock_visibility(app: &AppHandle) -> tauri::Result<()> {
    #[cfg(target_os = "macos")]
    {
        let workspace_visible = app
            .get_webview_window("analysis")
            .map(|window| window.is_visible())
            .transpose()?
            .unwrap_or(false);
        let policy = if DOCK_VISIBLE.load(Ordering::SeqCst) || workspace_visible {
            tauri::ActivationPolicy::Regular
        } else {
            tauri::ActivationPolicy::Accessory
        };
        app.set_activation_policy(policy)?;
    }
    #[cfg(not(target_os = "macos"))]
    let _ = app;
    Ok(())
}

pub async fn resize_window(app: AppHandle, height: f64) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("main") {
        let size = LogicalSize::new(340.0, height);
        window.set_size(size).map_err(|e| e.to_string())?;
    }
    Ok(())
}

pub async fn set_dock_visibility(app: AppHandle, visible: bool) -> Result<(), String> {
    DOCK_VISIBLE.store(visible, Ordering::SeqCst);
    apply_dock_visibility(&app).map_err(|e| e.to_string())
}
