use std::sync::{mpsc, Mutex};

use super::tray_icon;
use chrono::Local;
use tauri::{
    image::Image,
    menu::{MenuBuilder, MenuItemBuilder},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent, TrayIconId},
    AppHandle, Manager, Position, State,
};

pub struct TrayState {
    pub tray_id: Mutex<Option<TrayIconId>>,
}

impl Default for TrayState {
    fn default() -> Self {
        Self {
            tray_id: Mutex::new(None),
        }
    }
}

fn find_monitor_at_point(app: &AppHandle, x: i32, y: i32) -> Option<tauri::Monitor> {
    let monitors = app.available_monitors().ok()?;
    for monitor in monitors {
        let pos = monitor.position();
        let size = monitor.size();
        let mx = pos.x;
        let my = pos.y;
        let mw = size.width as i32;
        let mh = size.height as i32;
        if x >= mx && x < mx + mw && y >= my && y < my + mh {
            return Some(monitor);
        }
    }
    None
}

fn position_window_near_tray(app: &AppHandle, tray: &tauri::tray::TrayIcon) {
    let Some(window) = app.get_webview_window("main") else {
        return;
    };

    let Ok(Some(rect)) = tray.rect() else {
        return;
    };

    let Ok(window_size) = window.outer_size() else {
        return;
    };

    let pos = match rect.position {
        Position::Physical(p) => (p.x, p.y),
        Position::Logical(l) => (l.x as i32, l.y as i32),
    };

    let tray_size = match rect.size {
        tauri::Size::Physical(s) => (s.width, s.height),
        tauri::Size::Logical(l) => (l.width as u32, l.height as u32),
    };

    let window_width = window_size.width as i32;
    let window_height = window_size.height as i32;
    let tray_center_x = pos.0 + (tray_size.0 as i32 / 2);

    let mut x = tray_center_x - (window_width / 2);
    let mut y = pos.1 + tray_size.1 as i32 + 8;

    if let Some(monitor) = find_monitor_at_point(app, pos.0, pos.1) {
        let monitor_pos = monitor.position();
        let monitor_size = monitor.size();
        let screen_x = monitor_pos.x;
        let screen_y = monitor_pos.y;
        let screen_width = monitor_size.width as i32;
        let screen_height = monitor_size.height as i32;

        if pos.1 - screen_y > screen_height / 2 {
            y = pos.1 - window_height - 8;
        }

        let min_x = screen_x;
        let max_x = (screen_x + screen_width - window_width).max(screen_x);
        let min_y = screen_y;
        let max_y = (screen_y + screen_height - window_height).max(screen_y);
        x = x.clamp(min_x, max_x);
        y = y.clamp(min_y, max_y);
    }

    let _ = window.set_position(tauri::Position::Physical(tauri::PhysicalPosition { x, y }));
}

pub fn toggle_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        if window.is_visible().unwrap_or(false) {
            let _ = window.hide();
        } else {
            let _ = window.show();
            let _ = window.set_focus();
        }
    }
}

pub fn setup_tray(app: &AppHandle) -> tauri::Result<()> {
    let show_item = MenuItemBuilder::with_id("show", "Show / Hide Window").build(app)?;
    let quit_item = MenuItemBuilder::with_id("quit", "Quit").build(app)?;
    let menu = MenuBuilder::new(app).items(&[&show_item, &quit_item]).build()?;

    let initial_icon_bytes = tray_icon::generate_tray_icon(0, 44);
    let initial_icon = Image::from_bytes(&initial_icon_bytes)?;

    let tray = TrayIconBuilder::with_id("quota-tray")
        .icon(initial_icon)
        .icon_as_template(false)
        .tooltip("Quota Menubar")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "show" => toggle_main_window(app),
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                let app = tray.app_handle();
                if let Some(window) = app.get_webview_window("main") {
                    if window.is_visible().unwrap_or(false) {
                        let _ = window.hide();
                    } else {
                        position_window_near_tray(app, tray);
                        let _ = window.show();
                        let _ = window.set_focus();
                    }
                }
            }
        })
        .build(app)?;

    let _ = tray.set_visible(true);
    let _ = tray.set_icon_as_template(false);

    if let Some(state) = app.try_state::<TrayState>() {
        if let Ok(mut guard) = state.tray_id.lock() {
            *guard = Some(tray.id().clone());
        }
    }

    if let Some(window) = app.get_webview_window("main") {
        let window_clone = window.clone();
        window.on_window_event(move |event| {
            if let tauri::WindowEvent::Focused(false) = event {
                let _ = window_clone.hide();
            }
        });
    }

    println!("[Tray] Ready: quota-tray created");
    Ok(())
}

pub async fn update_tray_tooltip(
    app: AppHandle,
    tray_state: State<'_, TrayState>,
    percentage: u8,
) -> Result<(), String> {
    let tray_id = {
        let guard = tray_state.tray_id.lock().map_err(|e| e.to_string())?;
        guard.clone()
    };

    let Some(id) = tray_id else {
        return Ok(());
    };

    let pct = percentage.min(100);
    let (tx, rx) = mpsc::channel();
    let app_handle = app.clone();

    app.run_on_main_thread(move || {
        let result = (|| -> Result<(), String> {
            let Some(tray) = app_handle.tray_by_id(&id) else {
                return Ok(());
            };

            let icon_bytes = tray_icon::generate_tray_icon(pct, 44);
            let icon = Image::from_bytes(&icon_bytes).map_err(|e| e.to_string())?;

            tray.set_icon(Some(icon)).map_err(|e| e.to_string())?;
            tray.set_icon_as_template(false).map_err(|e| e.to_string())?;

            let updated_at = Local::now().format("%H:%M:%S").to_string();
            tray
                .set_tooltip(Some(format!(
                    "Quota Menubar ({pct}% used, updated {updated_at})"
                )))
                .map_err(|e| e.to_string())?;
            tray.set_visible(true).map_err(|e| e.to_string())?;
            Ok(())
        })();

        let _ = tx.send(result);
    })
    .map_err(|e| e.to_string())?;

    rx.recv()
        .map_err(|_| "failed to receive tray update result".to_string())?
}
