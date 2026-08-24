pub fn open_claude_dashboard() -> Result<(), String> {
    tauri_plugin_opener::open_url("https://console.anthropic.com/settings/usage", None::<&str>)
        .map_err(|e| e.to_string())
}

pub fn open_codex_dashboard() -> Result<(), String> {
    tauri_plugin_opener::open_url("https://chatgpt.com", None::<&str>).map_err(|e| e.to_string())
}

pub fn open_cursor_dashboard() -> Result<(), String> {
    tauri_plugin_opener::open_url("https://www.cursor.com/settings", None::<&str>)
        .map_err(|e| e.to_string())
}

pub fn open_antigravity_dashboard() -> Result<(), String> {
    tauri_plugin_opener::open_url("https://antigravity.google.com", None::<&str>)
        .map_err(|e| e.to_string())
}

pub fn open_grok_dashboard() -> Result<(), String> {
    tauri_plugin_opener::open_url("https://grok.com/?_s=usage", None::<&str>)
        .map_err(|e| e.to_string())
}
