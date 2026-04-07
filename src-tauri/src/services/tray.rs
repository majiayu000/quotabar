use std::sync::mpsc;

use super::tray_icon;
use chrono::Local;
use serde::{Deserialize, Serialize};
use tauri::{
    image::Image,
    menu::{MenuBuilder, MenuItemBuilder},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager, Position, State,
};

const ICON_SIZE: u32 = 44;
const TRAY_SERVICE_ACTIVATED_EVENT: &str = "tray-service-activated";

#[derive(Default)]
pub struct TrayState;

#[derive(Clone, Copy, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum TrayService {
    Claude,
    Codex,
}

impl TrayService {
    fn label(self) -> &'static str {
        match self {
            Self::Claude => "Claude Code",
            Self::Codex => "Codex",
        }
    }

    fn tray_id(self) -> &'static str {
        match self {
            Self::Claude => "claude-tray",
            Self::Codex => "codex-tray",
        }
    }

    fn show_menu_id(self) -> &'static str {
        match self {
            Self::Claude => "claude-show",
            Self::Codex => "codex-show",
        }
    }

    fn tab_name(self) -> &'static str {
        match self {
            Self::Claude => "claude",
            Self::Codex => "codex",
        }
    }

    fn quit_menu_id(self) -> &'static str {
        match self {
            Self::Claude => "claude-quit",
            Self::Codex => "codex-quit",
        }
    }

    fn icon_identity(self) -> tray_icon::TrayIconIdentity {
        match self {
            Self::Claude => tray_icon::TrayIconIdentity::Claude,
            Self::Codex => tray_icon::TrayIconIdentity::Codex,
        }
    }
}

#[derive(Clone, Serialize)]
struct TrayServiceActivatedPayload {
    service: &'static str,
}

fn emit_tray_service_activated(app: &AppHandle, service: TrayService) {
    let _ = app.emit(
        TRAY_SERVICE_ACTIVATED_EVENT,
        TrayServiceActivatedPayload {
            service: service.tab_name(),
        },
    );
}

fn find_monitor_at_point(app: &AppHandle, x: i32, y: i32) -> Option<tauri::Monitor> {
    app.available_monitors().ok()?.into_iter().find(|monitor| {
        let pos = monitor.position();
        let size = monitor.size();
        x >= pos.x && x < pos.x + size.width as i32 && y >= pos.y && y < pos.y + size.height as i32
    })
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
    let mut x = pos.0 + (tray_size.0 as i32 / 2) - (window_width / 2);
    let mut y = pos.1 + tray_size.1 as i32 + 8;

    if let Some(monitor) = find_monitor_at_point(app, pos.0, pos.1) {
        let screen_pos = monitor.position();
        let screen_size = monitor.size();
        let min_x = screen_pos.x;
        let max_x = (screen_pos.x + screen_size.width as i32 - window_width).max(screen_pos.x);
        let min_y = screen_pos.y;
        let max_y = (screen_pos.y + screen_size.height as i32 - window_height).max(screen_pos.y);

        if pos.1 - screen_pos.y > screen_size.height as i32 / 2 {
            y = pos.1 - window_height - 8;
        }

        x = x.clamp(min_x, max_x);
        y = y.clamp(min_y, max_y);
    }

    let _ = window.set_position(tauri::Position::Physical(tauri::PhysicalPosition { x, y }));
}

fn toggle_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        if window.is_visible().unwrap_or(false) {
            let _ = window.hide();
        } else {
            let _ = window.show();
            let _ = window.set_focus();
        }
    }
}

fn format_tooltip(service: TrayService, percentage: Option<u8>) -> String {
    match percentage {
        Some(value) => format!("{}: {}% used", service.label(), value.min(100)),
        None => format!("{}: unavailable", service.label()),
    }
}

fn build_service_tray(app: &AppHandle, service: TrayService) -> tauri::Result<()> {
    let show_item =
        MenuItemBuilder::with_id(service.show_menu_id(), "Show / Hide Window").build(app)?;
    let quit_item = MenuItemBuilder::with_id(service.quit_menu_id(), "Quit").build(app)?;
    let menu = MenuBuilder::new(app)
        .items(&[&show_item, &quit_item])
        .build()?;
    let icon = Image::from_bytes(&tray_icon::generate_tray_icon(
        service.icon_identity(),
        None,
        ICON_SIZE,
    ))?;

    let menu_service = service;
    let click_service = service;

    let tray = TrayIconBuilder::with_id(service.tray_id())
        .icon(icon)
        .icon_as_template(false)
        .tooltip(service.label())
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(move |app, event| match event.id().as_ref() {
            id if id == menu_service.show_menu_id() => {
                emit_tray_service_activated(app, menu_service);
                toggle_main_window(app);
            }
            id if id == menu_service.quit_menu_id() => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(move |tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                let app = tray.app_handle();
                emit_tray_service_activated(app, click_service);
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
    let _ = tray.set_visible(false);
    Ok(())
}

pub fn setup_tray(app: &AppHandle) -> tauri::Result<()> {
    build_service_tray(app, TrayService::Codex)?;
    build_service_tray(app, TrayService::Claude)?;

    if let Some(window) = app.get_webview_window("main") {
        let window_clone = window.clone();
        window.on_window_event(move |event| {
            if let tauri::WindowEvent::Focused(false) = event {
                let _ = window_clone.hide();
            }
        });
    }

    println!("[Tray] Ready: claude-tray and codex-tray created");
    Ok(())
}

pub async fn update_tray_icon(
    app: AppHandle,
    _tray_state: State<'_, TrayState>,
    service: TrayService,
    percentage: Option<u8>,
    visible: bool,
) -> Result<(), String> {
    let (tx, rx) = mpsc::channel();
    let app_handle = app.clone();

    app.run_on_main_thread(move || {
        let result = (|| -> Result<(), String> {
            let Some(tray) = app_handle.tray_by_id(service.tray_id()) else {
                return Ok(());
            };

            if !visible {
                tray.set_visible(false).map_err(|e| e.to_string())?;
                return Ok(());
            }

            let icon = Image::from_bytes(&tray_icon::generate_tray_icon(
                service.icon_identity(),
                percentage,
                ICON_SIZE,
            ))
            .map_err(|e| e.to_string())?;
            let updated_at = Local::now().format("%H:%M:%S").to_string();

            tray.set_icon(Some(icon)).map_err(|e| e.to_string())?;
            tray.set_icon_as_template(false)
                .map_err(|e| e.to_string())?;
            tray.set_tooltip(Some(format!(
                "{}\nUpdated: {}",
                format_tooltip(service, percentage),
                updated_at
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

#[cfg(test)]
mod tests {
    use super::{format_tooltip, TrayService};

    #[test]
    fn tooltip_marks_unavailable() {
        assert_eq!(
            format_tooltip(TrayService::Claude, None),
            "Claude Code: unavailable"
        );
    }

    #[test]
    fn tooltip_clamps_usage() {
        assert_eq!(
            format_tooltip(TrayService::Codex, Some(130)),
            "Codex: 100% used"
        );
    }
}
