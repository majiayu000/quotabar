use std::fs;
use std::path::Path;
#[cfg(target_os = "macos")]
use std::path::PathBuf;
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

#[cfg(target_os = "macos")]
fn dock_pref_path() -> Option<PathBuf> {
    dirs::data_dir().map(|dir| dir.join("quotabar").join("dock-hidden"))
}

fn parse_dock_hidden(text: &str) -> Option<bool> {
    match text.trim() {
        "true" => Some(true),
        "false" => Some(false),
        _ => None,
    }
}

fn read_dock_hidden_from(path: &Path) -> Option<bool> {
    parse_dock_hidden(&fs::read_to_string(path).ok()?)
}

fn write_dock_hidden_to(path: &Path, hidden: bool) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("Failed to persist dock preference directory: {error}"))?;
    }
    fs::write(path, if hidden { "true\n" } else { "false\n" })
        .map_err(|error| format!("Failed to persist dock preference: {error}"))
}

#[cfg(target_os = "macos")]
fn persist_dock_hidden(hidden: bool) {
    let Some(path) = dock_pref_path() else {
        eprintln!("[Dock] data directory unavailable; skip persisting Hide Dock");
        return;
    };
    if let Err(error) = write_dock_hidden_to(&path, hidden) {
        eprintln!("[Dock] {error}");
    }
}

fn dock_visible_from_pref(hidden: Option<bool>) -> bool {
    !hidden.unwrap_or(false)
}

#[cfg(target_os = "macos")]
fn load_persisted_dock_visible() -> bool {
    dock_visible_from_pref(dock_pref_path().and_then(|path| read_dock_hidden_from(&path)))
}

#[cfg(target_os = "macos")]
pub fn apply_startup_activation_policy(app: &AppHandle) {
    let visible = load_persisted_dock_visible();
    DOCK_VISIBLE.store(visible, Ordering::SeqCst);
    let policy = if visible {
        tauri::ActivationPolicy::Regular
    } else {
        tauri::ActivationPolicy::Accessory
    };
    if let Err(error) = app.set_activation_policy(policy) {
        eprintln!("Failed to apply dock preference: {error}");
    }
}

pub async fn resize_window(app: AppHandle, height: f64) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("main") {
        let size = LogicalSize::new(340.0, height);
        window.set_size(size).map_err(|e| e.to_string())?;
    }
    Ok(())
}

pub async fn set_dock_visibility(app: AppHandle, visible: bool) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    persist_dock_hidden(!visible);
    DOCK_VISIBLE.store(visible, Ordering::SeqCst);
    apply_dock_visibility(&app).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::{
        dock_visible_from_pref, parse_dock_hidden, read_dock_hidden_from, write_dock_hidden_to,
    };
    use std::fs;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_pref_dir() -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "quotabar-dock-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .expect("clock")
                .as_nanos()
        ));
        fs::create_dir_all(&dir).expect("temp dock pref dir");
        dir
    }

    #[test]
    fn round_trips_dock_hidden_pref() {
        let dir = temp_pref_dir();
        let path = dir.join("dock-hidden");
        write_dock_hidden_to(&path, true).expect("write hidden");
        assert_eq!(read_dock_hidden_from(&path), Some(true));
        write_dock_hidden_to(&path, false).expect("write visible");
        assert_eq!(read_dock_hidden_from(&path), Some(false));
        fs::remove_dir_all(dir).expect("cleanup");
    }

    #[test]
    fn missing_or_invalid_dock_pref_defaults_to_visible() {
        let dir = temp_pref_dir();
        let path = dir.join("dock-hidden");
        assert_eq!(read_dock_hidden_from(&path), None);
        fs::write(&path, "nope\n").expect("write invalid");
        assert_eq!(parse_dock_hidden("nope"), None);
        assert_eq!(read_dock_hidden_from(&path), None);
        assert!(dock_visible_from_pref(None));
        assert!(dock_visible_from_pref(Some(false)));
        assert!(!dock_visible_from_pref(Some(true)));
        fs::remove_dir_all(dir).expect("cleanup");
    }
}
