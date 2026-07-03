use tauri::{AppHandle, LogicalSize, Manager};

pub async fn resize_window(app: AppHandle, height: f64) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("main") {
        let size = LogicalSize::new(340.0, height);
        window.set_size(size).map_err(|e| e.to_string())?;
    }
    Ok(())
}

pub async fn set_dock_visibility(app: AppHandle, visible: bool) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        use tauri::ActivationPolicy;
        if visible {
            app.set_activation_policy(ActivationPolicy::Regular)
                .map_err(|e| e.to_string())?;
        } else {
            app.set_activation_policy(ActivationPolicy::Accessory)
                .map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}
