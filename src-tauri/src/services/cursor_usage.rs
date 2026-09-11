//! Fetch Cursor dashboard usage events for ccstats cost summaries.
//!
//! ccstats prices Cursor from usage-events, not `state.vscdb`. Its own HTTP
//! client is ureq and currently fails closed on this host (`unexpected end of
//! file`). QuotaBar already talks to `usage-summary` with reqwest, so the cost
//! path reuses that stack and points ccstats at a replay file.

use super::cursor::{set_env_var, usage_api_cookie};
use super::http::shared_http_client;
use chrono::{Duration as ChronoDuration, Utc};
use serde_json::{json, Value};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{Duration, Instant};

const EVENTS_URL: &str = "https://cursor.com/api/dashboard/get-filtered-usage-events";
const USAGE_FILE_ENV: &str = "CURSOR_USAGE_FILE";
const USER_AGENT: &str = "QuotaBar/0.2 (Cursor monitor)";
const PAGE_SIZE: u32 = 1000;
const MAX_PAGES: u32 = 100;
const LOOKBACK_DAYS: i64 = 30;
const REPLAY_TTL: Duration = Duration::from_secs(20 * 60);

struct Replay {
    path: PathBuf,
    fetched_at: Instant,
}

static REPLAY: Mutex<Option<Replay>> = Mutex::new(None);

pub(super) fn ensure_replay() -> Result<(), String> {
    if super::cursor::env_nonempty(USAGE_FILE_ENV).is_some() {
        return Ok(());
    }

    let mut guard = REPLAY
        .lock()
        .map_err(|error| format!("Cursor usage replay lock unavailable: {error}"))?;
    if let Some(replay) = guard.as_ref() {
        if replay.fetched_at.elapsed() < REPLAY_TTL && replay.path.is_file() {
            set_env_var(USAGE_FILE_ENV, path_to_env(&replay.path)?);
            return Ok(());
        }
    }

    let path = replay_path()?;
    if let Some(age) = file_age(&path) {
        if age < REPLAY_TTL {
            set_env_var(USAGE_FILE_ENV, path_to_env(&path)?);
            *guard = Some(Replay {
                path,
                fetched_at: Instant::now().checked_sub(age).unwrap_or_else(Instant::now),
            });
            return Ok(());
        }
    }

    let cookie = usage_api_cookie()?;
    let events = fetch_usage_events(&cookie)?;
    let path = write_replay(&events)?;
    set_env_var(USAGE_FILE_ENV, path_to_env(&path)?);
    *guard = Some(Replay {
        path,
        fetched_at: Instant::now(),
    });
    Ok(())
}

fn fetch_usage_events(cookie: &str) -> Result<Vec<Value>, String> {
    let end = Utc::now();
    let start = end - ChronoDuration::days(LOOKBACK_DAYS);
    let start_ms = start.timestamp_millis();
    let end_ms = end.timestamp_millis();
    let mut events = Vec::new();
    let mut page = 1u32;

    loop {
        if page > MAX_PAGES {
            break;
        }
        let payload = post_events(
            cookie,
            json!({
                "startDate": start_ms.to_string(),
                "endDate": end_ms.to_string(),
                "page": page,
                "pageSize": PAGE_SIZE,
            }),
        )?;
        let page_events = events_from_payload(&payload).ok_or_else(|| {
            "Cursor usage API returned an unsupported response schema".to_string()
        })?;
        let page_len = page_events.len();
        events.extend(page_events);
        if page_len == 0 || !has_next_page(&payload, page, events.len()) {
            break;
        }
        page += 1;
    }

    Ok(events)
}

fn post_events(cookie: &str, body: Value) -> Result<Value, String> {
    tauri::async_runtime::block_on(async {
        let response = shared_http_client()
            .post(EVENTS_URL)
            .header("Cookie", format!("WorkosCursorSessionToken={cookie}"))
            .header("Origin", "https://cursor.com")
            .header("Accept", "application/json")
            .header("User-Agent", USER_AGENT)
            .header("Content-Type", "application/json")
            .timeout(Duration::from_secs(30))
            .json(&body)
            .send()
            .await
            .map_err(|error| format!("Cursor usage API request failed: {error}"))?;
        let status = response.status();
        let payload = response
            .json::<Value>()
            .await
            .map_err(|error| format!("Cursor usage API returned invalid JSON: {error}"))?;
        if status.as_u16() == 401 || status.as_u16() == 403 {
            return Err("Cursor session expired. Re-open Cursor and sign in.".to_string());
        }
        if !status.is_success() {
            let message = payload
                .get("error")
                .or_else(|| payload.get("message"))
                .and_then(Value::as_str)
                .unwrap_or("request failed");
            return Err(format!(
                "Cursor usage API returned HTTP {}: {message}",
                status.as_u16()
            ));
        }
        Ok(payload)
    })
}

fn events_from_payload(value: &Value) -> Option<Vec<Value>> {
    if let Some(items) = value.as_array() {
        return Some(items.clone());
    }
    for key in ["usageEventsDisplay", "usageEvents", "events"] {
        if let Some(items) = value.get(key).and_then(Value::as_array) {
            return Some(items.clone());
        }
    }
    None
}

fn has_next_page(payload: &Value, page: u32, fetched: usize) -> bool {
    if let Some(pagination) = payload.get("pagination") {
        if let Some(has_next) = pagination.get("hasNextPage").and_then(Value::as_bool) {
            return has_next;
        }
        if let Some(num_pages) = pagination.get("numPages").and_then(Value::as_u64) {
            return u64::from(page) < num_pages;
        }
    }
    let total = payload
        .get("totalUsageEventsCount")
        .and_then(Value::as_u64)
        .unwrap_or(0);
    fetched < total as usize && (fetched as u32) >= page.saturating_sub(1) * PAGE_SIZE
}

fn write_replay(events: &[Value]) -> Result<PathBuf, String> {
    let path = replay_path()?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("Failed to create Cursor usage cache: {error}"))?;
    }
    let tmp = path.with_extension("json.tmp");
    let payload = replay_document(events);
    fs::write(
        &tmp,
        serde_json::to_vec(&payload).map_err(|error| error.to_string())?,
    )
    .map_err(|error| format!("Failed to write Cursor usage cache: {error}"))?;
    fs::rename(&tmp, &path)
        .map_err(|error| format!("Failed to replace Cursor usage cache: {error}"))?;
    Ok(path)
}

fn replay_document(events: &[Value]) -> Value {
    json!({ "usageEventsDisplay": events })
}

fn replay_path() -> Result<PathBuf, String> {
    dirs::cache_dir()
        .map(|dir| dir.join("quotabar").join("cursor-usage-replay.json"))
        .ok_or_else(|| "Cursor usage cache directory is unavailable".to_string())
}

fn file_age(path: &Path) -> Option<Duration> {
    let modified = fs::metadata(path).ok()?.modified().ok()?;
    modified.elapsed().ok()
}

fn path_to_env(path: &Path) -> Result<&str, String> {
    path.to_str()
        .ok_or_else(|| "Cursor usage cache path is not valid UTF-8".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn wraps_events_in_dashboard_replay_schema() {
        let events = vec![json!({"chargedCents": 12, "tokenUsage": {"inputTokens": 1}})];
        let payload = replay_document(&events);
        assert_eq!(payload["usageEventsDisplay"].as_array().unwrap().len(), 1);
    }

    #[test]
    fn continues_until_total_usage_count() {
        let payload = json!({ "totalUsageEventsCount": 2500 });
        assert!(has_next_page(&payload, 1, 1000));
        assert!(has_next_page(&payload, 2, 2000));
        assert!(!has_next_page(&payload, 3, 2500));
    }

    #[test]
    #[ignore = "hits the live Cursor usage-events API"]
    fn live_replay_has_usage_events() {
        ensure_replay().expect("replay");
        let path = std::env::var(USAGE_FILE_ENV).expect("CURSOR_USAGE_FILE");
        let payload: Value =
            serde_json::from_str(&fs::read_to_string(path).expect("replay file")).expect("json");
        let count = payload["usageEventsDisplay"]
            .as_array()
            .map(Vec::len)
            .unwrap_or(0);
        assert!(count > 0, "expected usage events in the replay file");
    }
}
