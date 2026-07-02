use std::sync::{mpsc, Arc, Mutex};

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
const TRAY_HIDDEN_TOOLTIP_SUFFIX: &str = "hidden";

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct TraySnapshot {
    percentage: Option<u8>,
    visible: bool,
}

#[derive(Default)]
struct TrayRuntimeState {
    claude_generation: u64,
    codex_generation: u64,
    cursor_generation: u64,
    antigravity_generation: u64,
    claude_snapshot: Option<TraySnapshot>,
    codex_snapshot: Option<TraySnapshot>,
    cursor_snapshot: Option<TraySnapshot>,
    antigravity_snapshot: Option<TraySnapshot>,
}

impl TrayRuntimeState {
    fn bump_generation(&mut self, service: TrayService) -> u64 {
        let generation = match service {
            TrayService::Claude => {
                self.claude_generation = self.claude_generation.saturating_add(1);
                self.claude_generation
            }
            TrayService::Codex => {
                self.codex_generation = self.codex_generation.saturating_add(1);
                self.codex_generation
            }
            TrayService::Cursor => {
                self.cursor_generation = self.cursor_generation.saturating_add(1);
                self.cursor_generation
            }
            TrayService::Antigravity => {
                self.antigravity_generation = self.antigravity_generation.saturating_add(1);
                self.antigravity_generation
            }
        };
        generation
    }

    fn generation(&self, service: TrayService) -> u64 {
        match service {
            TrayService::Claude => self.claude_generation,
            TrayService::Codex => self.codex_generation,
            TrayService::Cursor => self.cursor_generation,
            TrayService::Antigravity => self.antigravity_generation,
        }
    }

    fn snapshot(&self, service: TrayService) -> Option<TraySnapshot> {
        match service {
            TrayService::Claude => self.claude_snapshot,
            TrayService::Codex => self.codex_snapshot,
            TrayService::Cursor => self.cursor_snapshot,
            TrayService::Antigravity => self.antigravity_snapshot,
        }
    }

    fn should_skip_update(
        &self,
        service: TrayService,
        snapshot: TraySnapshot,
        force: bool,
    ) -> bool {
        !force && self.snapshot(service) == Some(snapshot)
    }

    fn set_snapshot(&mut self, service: TrayService, snapshot: TraySnapshot) {
        match service {
            TrayService::Claude => self.claude_snapshot = Some(snapshot),
            TrayService::Codex => self.codex_snapshot = Some(snapshot),
            TrayService::Cursor => self.cursor_snapshot = Some(snapshot),
            TrayService::Antigravity => self.antigravity_snapshot = Some(snapshot),
        }
    }
}

#[derive(Default)]
pub struct TrayState {
    runtime: Arc<Mutex<TrayRuntimeState>>,
}

#[derive(Clone, Copy, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum TrayService {
    Claude,
    Codex,
    Cursor,
    Antigravity,
}

impl TrayService {
    fn label(self) -> &'static str {
        match self {
            Self::Claude => "Claude Code",
            Self::Codex => "Codex",
            Self::Cursor => "Cursor",
            Self::Antigravity => "Antigravity",
        }
    }

    fn tray_id(self) -> &'static str {
        match self {
            Self::Claude => "claude-tray",
            Self::Codex => "codex-tray",
            Self::Cursor => "cursor-tray",
            Self::Antigravity => "antigravity-tray",
        }
    }

    fn show_menu_id(self) -> &'static str {
        match self {
            Self::Claude => "claude-show",
            Self::Codex => "codex-show",
            Self::Cursor => "cursor-show",
            Self::Antigravity => "antigravity-show",
        }
    }

    fn tab_name(self) -> &'static str {
        match self {
            Self::Claude => "claude",
            Self::Codex => "codex",
            Self::Cursor => "cursor",
            Self::Antigravity => "antigravity",
        }
    }

    fn quit_menu_id(self) -> &'static str {
        match self {
            Self::Claude => "claude-quit",
            Self::Codex => "codex-quit",
            Self::Cursor => "cursor-quit",
            Self::Antigravity => "antigravity-quit",
        }
    }

    fn icon_identity(self) -> tray_icon::TrayIconIdentity {
        match self {
            Self::Claude => tray_icon::TrayIconIdentity::Claude,
            Self::Codex => tray_icon::TrayIconIdentity::Codex,
            Self::Cursor => tray_icon::TrayIconIdentity::Cursor,
            Self::Antigravity => tray_icon::TrayIconIdentity::Antigravity,
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
                    position_window_near_tray(app, tray);
                    let _ = window.show();
                    let _ = window.set_focus();
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
    build_service_tray(app, TrayService::Antigravity)?;
    build_service_tray(app, TrayService::Cursor)?;
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

    println!("[Tray] Ready: claude/codex/cursor/antigravity trays created");
    Ok(())
}

pub async fn update_tray_icon(
    app: AppHandle,
    tray_state: State<'_, TrayState>,
    service: TrayService,
    percentage: Option<u8>,
    visible: bool,
    force: bool,
) -> Result<(), String> {
    let runtime = tray_state.runtime.clone();
    let snapshot = TraySnapshot {
        percentage: percentage.map(|value| value.min(100)),
        visible,
    };
    let request_generation = {
        let mut state = runtime
            .lock()
            .map_err(|_| "failed to lock tray runtime state".to_string())?;
        if state.should_skip_update(service, snapshot, force) {
            return Ok(());
        }
        let generation = state.bump_generation(service);
        generation
    };

    let (tx, rx) = mpsc::channel();
    let app_handle = app.clone();

    app.run_on_main_thread(move || {
        let result = (|| -> Result<(), String> {
            {
                let state = runtime
                    .lock()
                    .map_err(|_| "failed to lock tray runtime state".to_string())?;
                if state.generation(service) != request_generation {
                    return Ok(());
                }
            }

            if !visible {
                if let Some(tray) = app_handle.tray_by_id(service.tray_id()) {
                    tray.set_visible(false).map_err(|e| e.to_string())?;
                    tray.set_tooltip(Some(format!(
                        "{}: {}",
                        service.label(),
                        TRAY_HIDDEN_TOOLTIP_SUFFIX
                    )))
                    .map_err(|e| e.to_string())?;
                }
                {
                    let mut state = runtime
                        .lock()
                        .map_err(|_| "failed to lock tray runtime state".to_string())?;
                    if state.generation(service) == request_generation {
                        state.set_snapshot(service, snapshot);
                    }
                }
                return Ok(());
            }

            if app_handle.tray_by_id(service.tray_id()).is_none() {
                build_service_tray(&app_handle, service).map_err(|e| e.to_string())?;
            }

            let Some(tray) = app_handle.tray_by_id(service.tray_id()) else {
                return Err(format!("missing tray icon for {}", service.label()));
            };

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

            {
                let mut state = runtime
                    .lock()
                    .map_err(|_| "failed to lock tray runtime state".to_string())?;
                if state.generation(service) == request_generation {
                    state.set_snapshot(service, snapshot);
                }
            }
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
    use super::{format_tooltip, TrayRuntimeState, TrayService, TraySnapshot};

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

    #[test]
    fn runtime_snapshot_is_tracked_per_service() {
        let mut state = TrayRuntimeState::default();
        let snapshot = TraySnapshot {
            percentage: Some(100),
            visible: true,
        };

        assert_eq!(state.snapshot(TrayService::Claude), None);
        assert_eq!(state.snapshot(TrayService::Codex), None);

        state.set_snapshot(TrayService::Claude, snapshot);

        assert_eq!(state.snapshot(TrayService::Claude), Some(snapshot));
        assert_eq!(state.snapshot(TrayService::Codex), None);
    }

    #[test]
    fn runtime_snapshot_skip_respects_forced_resync() {
        let mut state = TrayRuntimeState::default();
        let snapshot = TraySnapshot {
            percentage: Some(42),
            visible: true,
        };

        state.set_snapshot(TrayService::Claude, snapshot);

        assert!(state.should_skip_update(TrayService::Claude, snapshot, false));
        assert!(!state.should_skip_update(TrayService::Claude, snapshot, true));
    }
}
