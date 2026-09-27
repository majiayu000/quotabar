#[cfg(target_os = "macos")]
#[path = "native_tray.rs"]
mod native_tray;

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{mpsc, Arc, Mutex};

use super::popover_layout::{self, Rect, POPOVER_WIDTH};
use super::tray_icon;
use serde::{Deserialize, Serialize};
use tauri::{
    image::Image,
    menu::{MenuBuilder, MenuItemBuilder},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize, Position, State, WebviewWindow,
};

const ICON_SIZE: u32 = 44;
const TRAY_SERVICE_ACTIVATED_EVENT: &str = "tray-service-activated";

static IGNORE_NEXT_UNFOCUS: AtomicBool = AtomicBool::new(false);
static TRAY_CLICK_WAS_VISIBLE: AtomicBool = AtomicBool::new(false);

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum TrayClickAction {
    Hide,
    Show,
}

fn tray_click_action(was_visible: bool) -> TrayClickAction {
    if was_visible {
        TrayClickAction::Hide
    } else {
        TrayClickAction::Show
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct TraySnapshot {
    percentage: Option<u8>,
    visible: bool,
    style: tray_icon::TrayIconStyle,
    stale: bool,
}

#[derive(Default)]
struct TrayRuntimeState {
    claude_generation: u64,
    codex_generation: u64,
    cursor_generation: u64,
    grok_generation: u64,
    antigravity_generation: u64,
    claude_snapshot: Option<TraySnapshot>,
    codex_snapshot: Option<TraySnapshot>,
    cursor_snapshot: Option<TraySnapshot>,
    grok_snapshot: Option<TraySnapshot>,
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
            TrayService::Grok => {
                self.grok_generation = self.grok_generation.saturating_add(1);
                self.grok_generation
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
            TrayService::Grok => self.grok_generation,
            TrayService::Antigravity => self.antigravity_generation,
        }
    }

    fn snapshot(&self, service: TrayService) -> Option<TraySnapshot> {
        match service {
            TrayService::Claude => self.claude_snapshot,
            TrayService::Codex => self.codex_snapshot,
            TrayService::Cursor => self.cursor_snapshot,
            TrayService::Grok => self.grok_snapshot,
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
            TrayService::Grok => self.grok_snapshot = Some(snapshot),
            TrayService::Antigravity => self.antigravity_snapshot = Some(snapshot),
        }
    }
}

/// Last tray anchor and content size, so every placement is recomputed from
/// the same inputs instead of from the window's previous physical frame.
#[derive(Default)]
struct PopoverLayoutState {
    anchor: Option<Rect>,
    logical_height: Option<f64>,
    logical_width: Option<f64>,
}

#[derive(Default)]
pub struct TrayState {
    runtime: Arc<Mutex<TrayRuntimeState>>,
    popover: Mutex<PopoverLayoutState>,
}

#[derive(Clone, Copy, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum TrayService {
    Claude,
    Codex,
    Cursor,
    Grok,
    Antigravity,
}

impl TrayService {
    fn label(self) -> &'static str {
        match self {
            Self::Claude => "Claude Code",
            Self::Codex => "Codex",
            Self::Cursor => "Cursor",
            Self::Grok => "Grok Build",
            Self::Antigravity => "Antigravity",
        }
    }

    fn tray_id(self) -> &'static str {
        match self {
            Self::Claude => "claude-tray",
            Self::Codex => "codex-tray",
            Self::Cursor => "cursor-tray",
            Self::Grok => "grok-tray",
            Self::Antigravity => "antigravity-tray",
        }
    }

    fn extra_title(self) -> &'static str {
        // Unique invisible titles keep macOS from coalescing extras.
        match self {
            Self::Claude => "\u{200b}",
            Self::Codex => "\u{200b}\u{200b}",
            Self::Cursor => "\u{200b}\u{200b}\u{200b}",
            Self::Grok => "\u{200b}\u{200b}\u{200b}\u{200b}",
            Self::Antigravity => "\u{200b}\u{200b}\u{200b}\u{200b}\u{200b}",
        }
    }

    #[cfg(target_os = "macos")]
    fn preferred_position(self) -> f64 {
        match self {
            Self::Claude => 10004.0,
            Self::Codex => 10003.0,
            Self::Cursor => 10002.0,
            Self::Grok => 10001.0,
            Self::Antigravity => 10000.0,
        }
    }

    fn show_menu_id(self) -> &'static str {
        match self {
            Self::Claude => "claude-show",
            Self::Codex => "codex-show",
            Self::Cursor => "cursor-show",
            Self::Grok => "grok-show",
            Self::Antigravity => "antigravity-show",
        }
    }

    fn tab_name(self) -> &'static str {
        match self {
            Self::Claude => "claude",
            Self::Codex => "codex",
            Self::Cursor => "cursor",
            Self::Grok => "grok",
            Self::Antigravity => "antigravity",
        }
    }

    fn quit_menu_id(self) -> &'static str {
        match self {
            Self::Claude => "claude-quit",
            Self::Codex => "codex-quit",
            Self::Cursor => "cursor-quit",
            Self::Grok => "grok-quit",
            Self::Antigravity => "antigravity-quit",
        }
    }

    fn icon_identity(self) -> tray_icon::TrayIconIdentity {
        match self {
            Self::Claude => tray_icon::TrayIconIdentity::Claude,
            Self::Codex => tray_icon::TrayIconIdentity::Codex,
            Self::Cursor => tray_icon::TrayIconIdentity::Cursor,
            Self::Grok => tray_icon::TrayIconIdentity::Grok,
            Self::Antigravity => tray_icon::TrayIconIdentity::Antigravity,
        }
    }
}

#[derive(Clone, Serialize)]
struct TrayServiceActivatedPayload {
    service: &'static str,
}

fn emit_tray_service_activated(app: &AppHandle, service: TrayService) {
    if let Some(window) = app.get_webview_window("main") {
        if let Err(error) = window.emit(
            TRAY_SERVICE_ACTIVATED_EVENT,
            TrayServiceActivatedPayload {
                service: service.tab_name(),
            },
        ) {
            eprintln!("Failed to activate tray provider: {error}");
        }
    }
}

fn find_monitor_at_point(app: &AppHandle, x: i32, y: i32) -> Option<tauri::Monitor> {
    app.available_monitors().ok()?.into_iter().find(|monitor| {
        let pos = monitor.position();
        let size = monitor.size();
        x >= pos.x && x < pos.x + size.width as i32 && y >= pos.y && y < pos.y + size.height as i32
    })
}

pub fn position_panel_at_visible_tray(app: &AppHandle) -> Result<(), String> {
    let state = app.state::<TrayState>();
    let runtime = state.runtime.lock().map_err(|error| error.to_string())?;
    let service = [
        TrayService::Claude,
        TrayService::Codex,
        TrayService::Cursor,
        TrayService::Grok,
        TrayService::Antigravity,
    ]
    .into_iter()
    .find(|service| {
        runtime
            .snapshot(*service)
            .is_some_and(|snapshot| snapshot.visible)
    })
    .ok_or("No menu bar icon is available yet")?;
    drop(runtime);
    let tray = app
        .tray_by_id(service.tray_id())
        .ok_or("Menu bar icon is unavailable")?;
    position_window_near_tray(app, &tray);
    Ok(())
}

fn tray_anchor(tray: &tauri::tray::TrayIcon) -> Option<Rect> {
    let rect = tray.rect().ok()??;
    let (x, y) = match rect.position {
        Position::Physical(p) => (p.x, p.y),
        Position::Logical(l) => (l.x as i32, l.y as i32),
    };
    let (width, height) = match rect.size {
        tauri::Size::Physical(s) => (s.width, s.height),
        tauri::Size::Logical(l) => (l.width as u32, l.height as u32),
    };
    Some(Rect {
        x,
        y,
        width,
        height,
    })
}

fn position_window_near_tray(app: &AppHandle, tray: &tauri::tray::TrayIcon) {
    let Some(anchor) = tray_anchor(tray) else {
        return;
    };
    let state = app.state::<TrayState>();
    match state.popover.lock() {
        Ok(mut layout) => layout.anchor = Some(anchor),
        Err(error) => {
            eprintln!("[Tray] popover layout state poisoned: {error}");
            return;
        }
    }
    if let Err(error) = apply_popover_layout(app) {
        eprintln!("[Tray] failed to place popover: {error}");
    }
}

/// Records the scaled logical content size reported by the frontend and re-places the
/// popover. Returns `false` when no tray anchor is known yet, so the caller can
/// fall back to a plain resize.
pub fn set_popover_logical_size(
    app: &AppHandle,
    logical_height: f64,
    logical_width: f64,
) -> Result<bool, String> {
    let state = app.state::<TrayState>();
    let has_anchor = {
        let mut layout = state.popover.lock().map_err(|error| error.to_string())?;
        layout.logical_height = Some(logical_height);
        layout.logical_width = Some(logical_width);
        layout.anchor.is_some()
    };
    if has_anchor {
        apply_popover_layout(app)?;
    }
    Ok(has_anchor)
}

fn apply_popover_layout(app: &AppHandle) -> Result<(), String> {
    let window = app
        .get_webview_window("main")
        .ok_or("Tray panel is unavailable")?;
    let (anchor, stored_height, stored_width) = {
        let state = app.state::<TrayState>();
        let layout = state.popover.lock().map_err(|error| error.to_string())?;
        (layout.anchor, layout.logical_height, layout.logical_width)
    };
    let anchor = anchor.ok_or("Tray anchor is unknown")?;
    let (cx, cy) = anchor.center();
    let monitor = find_monitor_at_point(app, cx, cy).ok_or("No monitor contains the tray icon")?;
    let logical_height = match stored_height {
        Some(height) => height,
        None => current_logical_height(&window)?,
    };
    let area = monitor.work_area();
    let work_area = Rect {
        x: area.position.x,
        y: area.position.y,
        width: area.size.width,
        height: area.size.height,
    };
    let frame = popover_layout::place_popover(
        anchor,
        work_area,
        monitor.scale_factor(),
        stored_width.unwrap_or(POPOVER_WIDTH),
        logical_height,
    );
    let position = PhysicalPosition::new(frame.x, frame.y);
    // Move first so Windows handles the target monitor's DPI before sizing.
    // Native mixed-DPI timing still needs platform validation, particularly on
    // macOS where Tao queues position and size changes asynchronously.
    window.set_position(position).map_err(|e| e.to_string())?;
    window
        .set_size(PhysicalSize::new(frame.width, frame.height))
        .map_err(|e| e.to_string())?;
    window.set_position(position).map_err(|e| e.to_string())
}

fn current_logical_height(window: &WebviewWindow) -> Result<f64, String> {
    let scale = window.scale_factor().map_err(|e| e.to_string())?;
    let size = window.inner_size().map_err(|e| e.to_string())?;
    Ok(size.to_logical::<f64>(scale).height)
}

fn toggle_main_window(app: &AppHandle) {
    IGNORE_NEXT_UNFOCUS.store(true, Ordering::SeqCst);
    if let Some(window) = app.get_webview_window("main") {
        if window.is_visible().unwrap_or(false) {
            let _ = window.hide();
        } else {
            let _ = window.show();
            let _ = window.set_focus();
        }
    }
}

fn remember_tray_click_visibility(app: &AppHandle) {
    let visible = app
        .get_webview_window("main")
        .and_then(|window| window.is_visible().ok())
        .unwrap_or(false);
    TRAY_CLICK_WAS_VISIBLE.store(visible, Ordering::SeqCst);
    IGNORE_NEXT_UNFOCUS.store(true, Ordering::SeqCst);
}

#[cfg(target_os = "macos")]
fn seed_status_item_defaults(service: TrayService) {
    use objc2_foundation::{NSString, NSUserDefaults};

    let defaults = NSUserDefaults::standardUserDefaults();
    let autosave = service.tray_id();
    let position_key = NSString::from_str(&format!("NSStatusItem Preferred Position {autosave}"));
    if defaults.objectForKey(&position_key).is_none() {
        defaults.setDouble_forKey(service.preferred_position(), &position_key);
    }
    // Visibility is applied by update_tray_icon, not by saved defaults.
}

#[cfg(target_os = "macos")]
fn apply_status_item_autosave(app: &AppHandle, tray_id: &str) -> Result<(), String> {
    let tray = app.tray_by_id(tray_id).ok_or("missing tray icon")?;
    let autosave_name = tray_id.to_owned();
    // Configure synchronously on the main thread. A delayed callback must not
    // resurrect an item after a newer update has hidden it.
    tray.with_inner_tray_icon(move |inner| {
        use objc2_foundation::NSString;
        let item = inner.ns_status_item().ok_or("missing native status item")?;
        item.setAutosaveName(Some(&NSString::from_str(&autosave_name)));
        Ok(())
    })
    .map_err(|error| error.to_string())?
}

fn destroy_hidden_tray() -> bool {
    !cfg!(target_os = "macos")
}

#[cfg(target_os = "macos")]
fn set_status_item_visible(app: &AppHandle, tray_id: &str, visible: bool) -> Result<(), String> {
    let Some(tray) = app.tray_by_id(tray_id) else {
        return if visible {
            Err("missing tray icon".into())
        } else {
            Ok(())
        };
    };
    tray.with_inner_tray_icon(move |inner| {
        let item = inner.ns_status_item().ok_or("missing native status item")?;
        native_tray::set_visible(&item, visible);
        Ok(())
    })
    .map_err(|error| error.to_string())?
}

fn format_tooltip(service: TrayService, percentage: Option<u8>, stale: bool) -> String {
    match percentage {
        Some(value) if stale => format!(
            "{}: {}% remaining (last known)",
            service.label(),
            100u8.saturating_sub(value)
        ),
        Some(value) => format!(
            "{}: {}% remaining",
            service.label(),
            100u8.saturating_sub(value)
        ),
        None => format!("{}: unavailable", service.label()),
    }
}

fn build_service_tray(app: &AppHandle, service: TrayService) -> tauri::Result<()> {
    #[cfg(target_os = "macos")]
    seed_status_item_defaults(service);

    let show_item =
        MenuItemBuilder::with_id(service.show_menu_id(), "Show / Hide Window").build(app)?;
    let workspace_item = MenuItemBuilder::with_id("open-workspace", "Open QuotaBar").build(app)?;
    let quit_item = MenuItemBuilder::with_id(service.quit_menu_id(), "Quit").build(app)?;
    let menu = MenuBuilder::new(app)
        .items(&[&show_item, &workspace_item, &quit_item])
        .build()?;
    let icon = Image::from_bytes(&tray_icon::generate_tray_icon(
        service.icon_identity(),
        None,
        ICON_SIZE,
        tray_icon::TrayIconStyle::default(),
    ))?;

    let menu_service = service;
    let click_service = service;

    let tray = TrayIconBuilder::with_id(service.tray_id())
        .icon(icon)
        .icon_as_template(false)
        .title(service.extra_title())
        .tooltip(service.label())
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(move |app, event| match event.id().as_ref() {
            id if id == menu_service.show_menu_id() => {
                emit_tray_service_activated(app, menu_service);
                toggle_main_window(app);
            }
            "open-workspace" => {
                if let Err(error) = super::window::show_workspace(app) {
                    eprintln!("Failed to open workspace: {error}");
                }
            }
            id if id == menu_service.quit_menu_id() => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(move |tray, event| match event {
            TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Down,
                ..
            } => {
                remember_tray_click_visibility(tray.app_handle());
            }
            TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } => {
                let app = tray.app_handle();
                emit_tray_service_activated(app, click_service);
                let was_visible = TRAY_CLICK_WAS_VISIBLE.load(Ordering::SeqCst);
                IGNORE_NEXT_UNFOCUS.store(false, Ordering::SeqCst);
                match app.get_webview_window("main") {
                    Some(window) => match tray_click_action(was_visible) {
                        TrayClickAction::Hide => {
                            let _ = window.hide();
                        }
                        TrayClickAction::Show => {
                            position_window_near_tray(app, tray);
                            let shown = window.show();
                            let focused = window.set_focus();
                            eprintln!(
                                "[Tray] {} clicked: show={:?} focus={:?} pos={:?}",
                                click_service.label(),
                                shown,
                                focused,
                                window.outer_position()
                            );
                        }
                    },
                    None => {
                        eprintln!(
                            "[Tray] {} clicked but main window is missing",
                            click_service.label()
                        );
                    }
                }
            }
            _ => {}
        })
        .build(app)?;

    // Keep ownership in tray-icon; native visibility controls menu-bar layout.
    tray.set_icon_as_template(false)?;
    #[cfg(target_os = "macos")]
    apply_status_item_autosave(app, service.tray_id())
        .map_err(|error| tauri::Error::Io(std::io::Error::other(error)))?;
    Ok(())
}

pub fn setup_tray(app: &AppHandle) -> tauri::Result<()> {
    if let Some(window) = app.get_webview_window("main") {
        // Windows adds hidden non-client insets to undecorated windows with
        // native shadows. Placement uses an outer position and an inner size,
        // so keep these frames identical before the first popover is shown.
        #[cfg(target_os = "windows")]
        window.set_shadow(false)?;

        let window_clone = window.clone();
        window.on_window_event(move |event| {
            if let tauri::WindowEvent::Focused(false) = event {
                if IGNORE_NEXT_UNFOCUS.swap(false, Ordering::SeqCst) {
                    return;
                }
                if let Err(error) = window_clone.hide() {
                    eprintln!("Failed to hide tray panel: {error}");
                }
            }
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                if let Err(error) = window_clone.hide() {
                    eprintln!("Failed to close tray panel: {error}");
                }
            }
        });
    }

    println!("[Tray] Ready: provider trays are created on first show");
    Ok(())
}

pub async fn update_tray_icon(
    app: AppHandle,
    tray_state: State<'_, TrayState>,
    service: TrayService,
    percentage: Option<u8>,
    visible: bool,
    force: bool,
    style: Option<tray_icon::TrayIconStyle>,
    stale: bool,
) -> Result<(), String> {
    let runtime = tray_state.runtime.clone();
    let style = style.unwrap_or_default();
    let snapshot = TraySnapshot {
        percentage,
        visible,
        style,
        stale,
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
                if destroy_hidden_tray() {
                    let _ = app_handle.remove_tray_by_id(service.tray_id());
                } else {
                    #[cfg(target_os = "macos")]
                    set_status_item_visible(&app_handle, service.tray_id(), false)?;
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
                style,
            ))
            .map_err(|e| e.to_string())?;

            tray.set_icon(Some(icon)).map_err(|e| e.to_string())?;
            tray.set_icon_as_template(false)
                .map_err(|e| e.to_string())?;
            tray.set_title(Some(service.extra_title()))
                .map_err(|e| e.to_string())?;
            tray.set_tooltip(Some(format_tooltip(service, percentage, stale)))
                .map_err(|e| e.to_string())?;
            #[cfg(target_os = "macos")]
            set_status_item_visible(&app_handle, service.tray_id(), true)?;
            #[cfg(not(target_os = "macos"))]
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

    tauri::async_runtime::spawn_blocking(move || rx.recv())
        .await
        .map_err(|_| "tray update task failed".to_string())?
        .map_err(|_| "failed to receive tray update result".to_string())?
}

#[cfg(test)]
mod tests {
    use super::{
        destroy_hidden_tray, format_tooltip, tray_click_action, TrayClickAction, TrayRuntimeState,
        TrayService, TraySnapshot,
    };
    use crate::services::tray_icon::TrayIconStyle;

    #[test]
    fn tooltip_marks_unavailable() {
        assert_eq!(
            format_tooltip(TrayService::Claude, None, false),
            "Claude Code: unavailable"
        );
    }

    #[test]
    fn tooltip_marks_stale_last_known_percent() {
        assert_eq!(
            format_tooltip(TrayService::Claude, Some(42), true),
            "Claude Code: 58% remaining (last known)"
        );
    }

    #[test]
    fn tooltip_clamps_exhausted_remaining_quota() {
        assert_eq!(
            format_tooltip(TrayService::Codex, Some(130), false),
            "Codex: 0% remaining"
        );
    }

    #[test]
    fn runtime_snapshot_is_tracked_per_service() {
        let mut state = TrayRuntimeState::default();
        let snapshot = TraySnapshot {
            percentage: Some(100),
            visible: true,
            style: TrayIconStyle::Percent,
            stale: false,
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
            style: TrayIconStyle::Percent,
            stale: false,
        };

        state.set_snapshot(TrayService::Claude, snapshot);

        assert!(state.should_skip_update(TrayService::Claude, snapshot, false));
        assert!(!state.should_skip_update(TrayService::Claude, snapshot, true));
        assert!(!state.should_skip_update(
            TrayService::Claude,
            TraySnapshot {
                stale: true,
                ..snapshot
            },
            false
        ));
    }

    #[test]
    fn tray_click_hides_when_the_popover_was_already_visible() {
        assert_eq!(tray_click_action(true), TrayClickAction::Hide);
        assert_eq!(tray_click_action(false), TrayClickAction::Show);
    }

    #[test]
    fn macos_keeps_hidden_status_items_alive() {
        assert_eq!(destroy_hidden_tray(), !cfg!(target_os = "macos"));
    }

    #[test]
    fn extra_titles_are_unique_per_service() {
        let titles = [
            TrayService::Claude.extra_title(),
            TrayService::Codex.extra_title(),
            TrayService::Cursor.extra_title(),
            TrayService::Grok.extra_title(),
            TrayService::Antigravity.extra_title(),
        ];
        for (index, title) in titles.iter().enumerate() {
            assert!(
                titles
                    .iter()
                    .enumerate()
                    .all(|(other, other_title)| other == index || other_title != title),
                "tray extra titles must stay unique"
            );
        }
    }
}
