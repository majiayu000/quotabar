use tauri::{AppHandle, State};

use crate::{
    domain::models::{
        AntigravityData, CodexData, CodexRateLimits, CodexStats, CursorData, QuotaData,
    },
    services::{antigravity, claude, codex, cost, cursor, link, tray, window},
};

#[tauri::command]
pub async fn get_quota() -> Result<QuotaData, String> {
    Ok(claude::fetch_quota().await)
}

#[tauri::command]
pub async fn get_codex_info() -> Result<CodexData, String> {
    Ok(codex::fetch_codex_info().await)
}

#[tauri::command]
pub async fn get_codex_stats() -> Result<CodexStats, String> {
    Ok(codex::fetch_codex_stats().await)
}

#[tauri::command]
pub async fn get_codex_rate_limits() -> Result<CodexRateLimits, String> {
    Ok(codex::fetch_codex_rate_limits().await)
}

#[tauri::command]
pub async fn get_cursor_info() -> Result<CursorData, String> {
    Ok(cursor::fetch_cursor_info().await)
}

#[tauri::command]
pub async fn get_antigravity_info() -> Result<AntigravityData, String> {
    Ok(antigravity::fetch_antigravity_info().await)
}

#[tauri::command]
pub async fn get_cost_overview(
    source: String,
    currency: Option<String>,
    timezone: Option<String>,
    force: Option<bool>,
) -> Result<cost::CostOverview, String> {
    cost::get_cost_overview(source, currency, timezone, force).await
}

#[tauri::command]
pub fn open_claude_dashboard() -> Result<(), String> {
    link::open_claude_dashboard()
}

#[tauri::command]
pub fn open_codex_dashboard() -> Result<(), String> {
    link::open_codex_dashboard()
}

#[tauri::command]
pub fn open_cursor_dashboard() -> Result<(), String> {
    link::open_cursor_dashboard()
}

#[tauri::command]
pub fn open_antigravity_dashboard() -> Result<(), String> {
    link::open_antigravity_dashboard()
}

#[tauri::command]
pub async fn resize_window(app: AppHandle, height: f64) -> Result<(), String> {
    window::resize_window(app, height).await
}

#[tauri::command]
pub async fn set_dock_visibility(app: AppHandle, visible: bool) -> Result<(), String> {
    window::set_dock_visibility(app, visible).await
}

#[tauri::command]
pub async fn update_tray_icon(
    app: AppHandle,
    tray_state: State<'_, tray::TrayState>,
    service: tray::TrayService,
    percentage: Option<u8>,
    visible: bool,
    force: Option<bool>,
) -> Result<(), String> {
    tray::update_tray_icon(
        app,
        tray_state,
        service,
        percentage,
        visible,
        force.unwrap_or(false),
    )
    .await
}

#[tauri::command]
pub fn quit_app(app: AppHandle) {
    app.exit(0);
}
