//! Cursor usage tracking via cursor.com/api/usage.
//!
//! Token resolution order:
//!   1. CURSOR_SESSION_TOKEN env var
//!   2. ~/Library/Application Support/Cursor/User/globalStorage/state.vscdb
//!      byte-scanned for the `WorkosCursorSessionToken` literal (no SQLite dep).

use crate::domain::models::CursorData;
use crate::services::http::{is_transient_os_error, shared_http_client};
use chrono::{DateTime, Months, NaiveDate, Utc};
use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

const CURSOR_TOKEN_ENV_KEY: &str = "CURSOR_SESSION_TOKEN";
const CURSOR_USAGE_URL: &str = "https://www.cursor.com/api/usage";
const QUOTA_CACHE_TTL: Duration = Duration::from_secs(120);
const TOKEN_NEEDLE: &[u8] = b"WorkosCursorSessionToken";

struct CachedCursor {
    data: CursorData,
    cached_at: Instant,
}

static CURSOR_CACHE: OnceLock<Mutex<Option<CachedCursor>>> = OnceLock::new();

fn cursor_cache() -> &'static Mutex<Option<CachedCursor>> {
    CURSOR_CACHE.get_or_init(|| Mutex::new(None))
}

fn state_vscdb_path() -> Option<PathBuf> {
    dirs::home_dir()
        .map(|home| home.join("Library/Application Support/Cursor/User/globalStorage/state.vscdb"))
}

fn read_env_token() -> Option<String> {
    std::env::var(CURSOR_TOKEN_ENV_KEY)
        .ok()
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty())
}

/// Scan the SQLite file as raw bytes for the `WorkosCursorSessionToken` key.
/// The value column in SQLite stores the cookie string as plain UTF-8.
fn read_token_from_state_vscdb() -> Result<String, String> {
    let path =
        state_vscdb_path().ok_or_else(|| "Could not resolve Cursor storage path".to_string())?;
    if !path.exists() {
        return Err(
            "Cursor not configured. Open Cursor and sign in, or set CURSOR_SESSION_TOKEN."
                .to_string(),
        );
    }

    let bytes = std::fs::read(&path).map_err(|e| format!("Failed to read state.vscdb: {e}"))?;

    let mut search_from = 0usize;
    while search_from + TOKEN_NEEDLE.len() < bytes.len() {
        let Some(rel) = bytes[search_from..]
            .windows(TOKEN_NEEDLE.len())
            .position(|w| w == TOKEN_NEEDLE)
        else {
            break;
        };
        let start = search_from + rel + TOKEN_NEEDLE.len();
        if let Some(token) = extract_token_after(&bytes[start..]) {
            return Ok(token);
        }
        search_from = start;
    }

    Err("WorkosCursorSessionToken not found in state.vscdb. Re-login to Cursor or set CURSOR_SESSION_TOKEN.".to_string())
}

/// After the key literal, SQLite leaves a length-prefix byte then the value bytes.
/// We accept any leading non-printable bytes and then read ASCII until the next
/// non-printable byte. Cursor tokens are `userId%3A%3A<JWT>` ASCII only.
fn extract_token_after(tail: &[u8]) -> Option<String> {
    let mut i = 0;
    while i < tail.len() && !is_token_byte(tail[i]) {
        i += 1;
        if i > 16 {
            return None;
        }
    }
    let start = i;
    while i < tail.len() && is_token_byte(tail[i]) {
        i += 1;
    }
    if i - start < 32 {
        return None;
    }
    let candidate = std::str::from_utf8(&tail[start..i]).ok()?;
    if !candidate.contains("%3A%3A") {
        return None;
    }
    Some(candidate.to_string())
}

fn is_token_byte(b: u8) -> bool {
    b.is_ascii_alphanumeric() || matches!(b, b'.' | b'-' | b'_' | b'%' | b'/' | b'+' | b'=')
}

fn get_cursor_token() -> Result<String, String> {
    if let Some(token) = read_env_token() {
        return Ok(token);
    }
    read_token_from_state_vscdb()
}

fn user_id_from_token(token: &str) -> Option<&str> {
    token.split_once("%3A%3A").map(|(id, _)| id)
}

fn get_cached_cursor() -> Option<CursorData> {
    let guard = cursor_cache().lock().ok()?;
    let cached = guard.as_ref()?;
    if cached.cached_at.elapsed() < QUOTA_CACHE_TTL {
        Some(cached.data.clone())
    } else {
        None
    }
}

/// Return last cached value regardless of TTL, but only if it represents a
/// successful connection. Used to absorb transient OS errors without flashing
/// the UI.
fn get_stale_cached_cursor() -> Option<CursorData> {
    let guard = cursor_cache().lock().ok()?;
    let cached = guard.as_ref()?;
    if cached.data.connected {
        Some(cached.data.clone())
    } else {
        None
    }
}

fn mark_cursor_data_stale(mut data: CursorData, error: String) -> CursorData {
    data.error = Some(error);
    data
}

fn fallback_or_disconnected(error: impl Into<String>) -> CursorData {
    let error = error.into();
    if is_transient_os_error(&error) {
        if let Some(stale) = get_stale_cached_cursor() {
            return mark_cursor_data_stale(stale, error);
        }
    }
    CursorData::disconnected(error)
}

fn save_cursor_cache(data: &CursorData) {
    if let Ok(mut guard) = cursor_cache().lock() {
        *guard = Some(CachedCursor {
            data: data.clone(),
            cached_at: Instant::now(),
        });
    }
}

pub async fn fetch_cursor_info() -> CursorData {
    if let Some(cached) = get_cached_cursor() {
        return cached;
    }

    let token = match get_cursor_token() {
        Ok(t) => t,
        Err(error) => return fallback_or_disconnected(error),
    };

    let user_id = match user_id_from_token(&token) {
        Some(id) => id,
        None => {
            return CursorData::disconnected(
                "Cursor session token has unexpected format. Re-login to Cursor.",
            );
        }
    };

    let url = format!("{CURSOR_USAGE_URL}?user={user_id}");
    let response = shared_http_client()
        .get(&url)
        .header("Cookie", format!("WorkosCursorSessionToken={token}"))
        .header("Accept", "application/json")
        .header("User-Agent", "QuotaBar/0.2 (Cursor monitor)")
        .timeout(Duration::from_secs(10))
        .send()
        .await;

    let response = match response {
        Ok(resp) => resp,
        Err(err) => return fallback_or_disconnected(format!("Network error: {err}")),
    };

    let status = response.status();
    if status.as_u16() == 401 || status.as_u16() == 403 {
        return CursorData::disconnected("Cursor session expired. Re-open Cursor and sign in.");
    }
    if !status.is_success() {
        return CursorData::disconnected(format!("Cursor API error: {status}"));
    }

    let data = match response.json::<serde_json::Value>().await {
        Ok(v) => v,
        Err(err) => {
            return CursorData::disconnected(format!("Failed to parse Cursor response: {err}"))
        }
    };

    let result = parse_usage_payload(&data);
    save_cursor_cache(&result);
    result
}

fn parse_usage_payload(data: &serde_json::Value) -> CursorData {
    // The payload shape: { "gpt-4": { numRequests, maxRequestUsage }, "gpt-3.5-turbo": {...}, "startOfMonth": "..." }
    // Some accounts return { "fastRequestsUsed", "fastRequestsLimit" } directly.
    // We pick the largest numRequests/maxRequestUsage pair as the "fast" window.
    let mut best_used: Option<i64> = None;
    let mut best_limit: Option<i64> = None;
    let mut slow_used: Option<i64> = None;

    if let Some(obj) = data.as_object() {
        for (key, value) in obj.iter() {
            if !value.is_object() {
                continue;
            }
            let used = value["numRequests"].as_i64();
            let limit = value["maxRequestUsage"].as_i64();
            let no_limit = value["numRequestsTotal"].as_i64();

            if let (Some(used_v), Some(limit_v)) = (used, limit) {
                if best_limit.map(|cur| limit_v > cur).unwrap_or(true) {
                    best_used = Some(used_v);
                    best_limit = Some(limit_v);
                }
            }

            if key.contains("slow") || key.eq_ignore_ascii_case("gpt-3.5-turbo") {
                if let Some(n) = no_limit.or(used) {
                    slow_used = Some(n);
                }
            }
        }
    }

    if best_used.is_none() {
        best_used = data["fastRequestsUsed"].as_i64();
    }
    if best_limit.is_none() {
        best_limit = data["fastRequestsLimit"].as_i64();
    }

    let percentage = match (best_used, best_limit) {
        (Some(u), Some(l)) if l > 0 => Some((u as f64 / l as f64) * 100.0),
        _ => None,
    };

    let reset_at = cursor_reset_at(data);

    let connected = best_used.is_some() || best_limit.is_some();

    CursorData {
        connected,
        plan_type: data["plan"].as_str().map(ToString::to_string),
        email: data["email"].as_str().map(ToString::to_string),
        fast_used: best_used,
        fast_limit: best_limit,
        percentage,
        slow_used,
        reset_at,
        error: if connected {
            None
        } else {
            Some("Cursor API returned no usage fields.".to_string())
        },
    }
}

fn parse_cursor_timestamp(value: &str) -> Option<DateTime<Utc>> {
    DateTime::parse_from_rfc3339(value)
        .ok()
        .map(|timestamp| timestamp.with_timezone(&Utc))
        .or_else(|| {
            NaiveDate::parse_from_str(value, "%Y-%m-%d")
                .ok()?
                .and_hms_opt(0, 0, 0)
                .map(|timestamp| timestamp.and_utc())
        })
}

fn cursor_reset_at(data: &serde_json::Value) -> Option<String> {
    data["resetAt"]
        .as_str()
        .and_then(parse_cursor_timestamp)
        .or_else(|| {
            data["startOfMonth"]
                .as_str()
                .and_then(parse_cursor_timestamp)
                .and_then(|started| started.checked_add_months(Months::new(1)))
        })
        .map(|reset| reset.to_rfc3339())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extracts_token_from_padded_tail() {
        let tail = b"\x00\x00user1234%3A%3AeyJhbGciOiJSUzI1NiIsImtpZCI6InRlc3RrZXkifQ.signature_more_chars_here_xyz\x00\x00";
        let got = extract_token_after(tail).expect("should parse");
        assert!(got.starts_with("user1234%3A%3A"));
        assert!(user_id_from_token(&got) == Some("user1234"));
    }

    #[test]
    fn rejects_short_garbage() {
        assert!(extract_token_after(b"\x00short").is_none());
    }

    #[test]
    fn parses_object_payload_picks_largest_limit() {
        let payload: serde_json::Value = serde_json::json!({
            "gpt-4": { "numRequests": 120, "maxRequestUsage": 500 },
            "gpt-3.5-turbo": { "numRequests": 12, "numRequestsTotal": 99 },
            "startOfMonth": "2026-05-01T00:00:00Z"
        });
        let data = parse_usage_payload(&payload);
        assert!(data.connected);
        assert_eq!(data.fast_used, Some(120));
        assert_eq!(data.fast_limit, Some(500));
        assert_eq!(data.slow_used, Some(99));
        assert!(data.percentage.unwrap() > 23.9 && data.percentage.unwrap() < 24.1);
        assert_eq!(data.reset_at.as_deref(), Some("2026-06-01T00:00:00+00:00"));
    }

    #[test]
    fn malformed_explicit_reset_falls_back_to_period_start() {
        let payload: serde_json::Value = serde_json::json!({
            "fastRequestsUsed": 650,
            "fastRequestsLimit": 500,
            "startOfMonth": "2026-05-01",
            "resetAt": "not-a-date"
        });

        let data = parse_usage_payload(&payload);

        assert_eq!(data.percentage, Some(130.0));
        assert_eq!(data.reset_at.as_deref(), Some("2026-06-01T00:00:00+00:00"));
    }

    #[test]
    fn stale_data_keeps_usage_and_reports_refresh_error() {
        let data = CursorData {
            connected: true,
            plan_type: Some("pro".to_string()),
            email: None,
            fast_used: Some(120),
            fast_limit: Some(500),
            percentage: Some(24.0),
            slow_used: None,
            reset_at: None,
            error: None,
        };

        let stale = mark_cursor_data_stale(data, "Network error: timed out".to_string());

        assert!(stale.connected);
        assert_eq!(stale.fast_used, Some(120));
        assert_eq!(stale.fast_limit, Some(500));
        assert_eq!(stale.error.as_deref(), Some("Network error: timed out"));
    }
}
