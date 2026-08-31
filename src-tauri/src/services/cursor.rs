//! Cursor usage tracking via cursor.com/api/usage-summary.
//!
//! Token resolution order:
//!   1. CURSOR_SESSION_TOKEN env var (JWT or Workos cookie value)
//!   2. Cursor `state.vscdb` ItemTable `cursorAuth/accessToken`
//!      (legacy `WorkosCursorSessionToken` key is still accepted)
//!
//! The dashboard API authenticates with cookie
//! `WorkosCursorSessionToken=<jwt.sub>%3A%3A<accessToken>`.

use crate::domain::models::CursorData;
use crate::services::http::{is_transient_os_error, shared_http_client};
use base64::{engine::general_purpose::STANDARD_NO_PAD, Engine as _};
use chrono::{DateTime, Months, NaiveDate, Utc};
use rusqlite::types::ValueRef;
use rusqlite::{Connection, OpenFlags};
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

const CURSOR_TOKEN_ENV_KEY: &str = "CURSOR_SESSION_TOKEN";
const CURSOR_USAGE_SUMMARY_URL: &str = "https://cursor.com/api/usage-summary";
const QUOTA_CACHE_TTL: Duration = Duration::from_secs(120);
const ACCESS_TOKEN_KEY: &str = "cursorAuth/accessToken";
const CACHED_EMAIL_KEY: &str = "cursorAuth/cachedEmail";
const LEGACY_SESSION_KEY: &str = "WorkosCursorSessionToken";

struct CachedCursor {
    data: CursorData,
    cached_at: Instant,
}

#[derive(Debug)]
struct CursorSession {
    token: String,
    email: Option<String>,
}

static CURSOR_CACHE: OnceLock<Mutex<Option<CachedCursor>>> = OnceLock::new();

fn cursor_cache() -> &'static Mutex<Option<CachedCursor>> {
    CURSOR_CACHE.get_or_init(|| Mutex::new(None))
}

fn state_vscdb_path() -> Option<PathBuf> {
    dirs::config_dir().map(|config| {
        config
            .join("Cursor")
            .join("User")
            .join("globalStorage")
            .join("state.vscdb")
    })
}

fn read_env_token() -> Option<String> {
    std::env::var(CURSOR_TOKEN_ENV_KEY)
        .ok()
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty())
}

fn open_state_db(path: &Path) -> Result<Connection, String> {
    let conn = Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY)
        .map_err(|error| format!("Failed to read state.vscdb: {error}"))?;
    conn.busy_timeout(Duration::from_millis(300))
        .map_err(|error| format!("Failed to configure state.vscdb read timeout: {error}"))?;
    Ok(conn)
}

fn column_utf8(row: &rusqlite::Row, idx: usize) -> rusqlite::Result<String> {
    match row.get_ref(idx)? {
        ValueRef::Text(bytes) | ValueRef::Blob(bytes) => {
            Ok(String::from_utf8_lossy(bytes).trim().to_string())
        }
        ValueRef::Null => Ok(String::new()),
        other => Err(rusqlite::Error::InvalidColumnType(
            idx,
            "value".into(),
            other.data_type(),
        )),
    }
}

fn normalize_stored(value: String) -> String {
    value.trim().trim_matches('"').trim().to_string()
}

fn read_session_from_db_path(path: &Path) -> Result<CursorSession, String> {
    if !path.exists() {
        return Err(
            "Cursor not configured. Open Cursor and sign in, or set CURSOR_SESSION_TOKEN."
                .to_string(),
        );
    }

    let conn = open_state_db(path)?;
    let mut stmt = conn
        .prepare("SELECT key, value FROM ItemTable WHERE key IN (?1, ?2, ?3)")
        .map_err(|e| format!("Failed to read state.vscdb: {e}"))?;
    let rows = stmt
        .query_map(
            rusqlite::params![ACCESS_TOKEN_KEY, CACHED_EMAIL_KEY, LEGACY_SESSION_KEY],
            |row| {
                let key: String = row.get(0)?;
                Ok((key, column_utf8(row, 1)?))
            },
        )
        .map_err(|e| format!("Failed to read state.vscdb: {e}"))?;

    let mut access_token = None;
    let mut legacy_token = None;
    let mut email = None;
    for row in rows {
        let (key, value) = row.map_err(|e| format!("Failed to read state.vscdb: {e}"))?;
        let value = normalize_stored(value);
        if value.is_empty() {
            continue;
        }
        match key.as_str() {
            ACCESS_TOKEN_KEY => access_token = Some(value),
            LEGACY_SESSION_KEY => legacy_token = Some(value),
            CACHED_EMAIL_KEY => email = Some(value),
            _ => {}
        }
    }

    let token = access_token.or(legacy_token).ok_or_else(|| {
        "Cursor session not found in local state. Open Cursor and sign in, or set CURSOR_SESSION_TOKEN.".to_string()
    })?;
    Ok(CursorSession { token, email })
}

fn read_session_from_state_vscdb() -> Result<CursorSession, String> {
    let path =
        state_vscdb_path().ok_or_else(|| "Could not resolve Cursor storage path".to_string())?;
    read_session_from_db_path(&path)
}

fn get_cursor_session() -> Result<CursorSession, String> {
    if let Some(token) = read_env_token() {
        return Ok(CursorSession { token, email: None });
    }
    read_session_from_state_vscdb()
}

fn decode_jwt_payload(token: &str) -> Option<serde_json::Value> {
    let mut parts = token.split('.');
    let _header = parts.next()?;
    let payload = parts.next()?;
    if parts.next().is_none() {
        return None;
    }
    let padded = match payload.len() % 4 {
        2 => format!("{payload}=="),
        3 => format!("{payload}="),
        _ => payload.to_string(),
    };
    let standard = padded.replace('-', "+").replace('_', "/");
    STANDARD_NO_PAD
        .decode(&standard)
        .ok()
        .or_else(|| {
            base64::engine::general_purpose::STANDARD
                .decode(&standard)
                .ok()
        })
        .and_then(|bytes| serde_json::from_slice(&bytes).ok())
}

fn jwt_sub(token: &str) -> Option<String> {
    decode_jwt_payload(token)?
        .get("sub")?
        .as_str()
        .filter(|sub| !sub.is_empty())
        .map(ToString::to_string)
}

/// Build the dashboard cookie value from a JWT, `user::jwt`, or already-encoded cookie.
fn workos_cookie_value(token: &str) -> Result<String, String> {
    let token = token.trim();
    if token.is_empty() {
        return Err("Cursor session token is empty.".to_string());
    }
    if token.contains("%3A%3A") {
        return Ok(token.to_string());
    }
    if let Some((id, jwt)) = token.split_once("::") {
        if !id.is_empty() && jwt.contains('.') {
            return Ok(format!("{id}%3A%3A{jwt}"));
        }
    }
    let sub = jwt_sub(token).ok_or_else(|| {
        "Cursor session token has unexpected format. Re-login to Cursor.".to_string()
    })?;
    Ok(format!("{sub}%3A%3A{token}"))
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

fn is_transient_cursor_error(message: &str) -> bool {
    let lowercase = message.to_ascii_lowercase();
    is_transient_os_error(message)
        || lowercase.contains("database is locked")
        || lowercase.contains("database table is locked")
}

fn fallback_or_disconnected(error: impl Into<String>) -> CursorData {
    let error = error.into();
    if is_transient_cursor_error(&error) {
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

    let session = match get_cursor_session() {
        Ok(session) => session,
        Err(error) => return fallback_or_disconnected(error),
    };

    let cookie = match workos_cookie_value(&session.token) {
        Ok(cookie) => cookie,
        Err(error) => return CursorData::disconnected(error),
    };

    let response = shared_http_client()
        .get(CURSOR_USAGE_SUMMARY_URL)
        .header("Cookie", format!("WorkosCursorSessionToken={cookie}"))
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

    let mut result = parse_cursor_payload(&data);
    if result.email.is_none() {
        result.email = session.email;
    }
    save_cursor_cache(&result);
    result
}

fn json_i64(value: &serde_json::Value) -> Option<i64> {
    value
        .as_i64()
        .or_else(|| value.as_u64().and_then(|n| i64::try_from(n).ok()))
        .or_else(|| value.as_f64().map(|n| n.round() as i64))
}

fn json_f64(value: &serde_json::Value) -> Option<f64> {
    value.as_f64().or_else(|| value.as_i64().map(|n| n as f64))
}

fn parse_cursor_payload(data: &serde_json::Value) -> CursorData {
    if data.get("individualUsage").is_some() || data.get("membershipType").is_some() {
        parse_usage_summary(data)
    } else {
        parse_usage_payload(data)
    }
}

fn max_percent(values: impl IntoIterator<Item = Option<f64>>) -> Option<f64> {
    values
        .into_iter()
        .flatten()
        .max_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal))
}

fn parse_usage_summary(data: &serde_json::Value) -> CursorData {
    let plan = &data["individualUsage"]["plan"];
    let on_demand = &data["individualUsage"]["onDemand"];
    let used = json_i64(&plan["used"]);
    let limit = json_i64(&plan["limit"]);
    let auto_percent = json_f64(&plan["autoPercentUsed"]);
    let api_percent = json_f64(&plan["apiPercentUsed"]);
    let computed = match (used, limit) {
        (Some(used_v), Some(limit_v)) if limit_v > 0 => {
            Some((used_v as f64 / limit_v as f64) * 100.0)
        }
        _ => None,
    };
    // Dashboard bars are auto (Cursor Models) and api (Other Models).
    // Do not use used/limit as the headline percent when those exist.
    let percentage = max_percent([auto_percent, api_percent])
        .or_else(|| json_f64(&plan["totalPercentUsed"]))
        .or(computed);

    let plan_type = data["membershipType"].as_str().map(ToString::to_string);
    let email = data["email"].as_str().map(ToString::to_string);
    let reset_at = data["billingCycleEnd"]
        .as_str()
        .and_then(parse_cursor_timestamp)
        .map(|reset| reset.to_rfc3339());
    let on_demand_enabled = on_demand["enabled"].as_bool();
    let on_demand_used_cents = json_f64(&on_demand["used"]);

    let connected = percentage.is_some()
        || auto_percent.is_some()
        || api_percent.is_some()
        || (used.is_some() && limit.is_some())
        || on_demand_used_cents.is_some_and(|used| used > 0.0);

    CursorData {
        connected,
        plan_type,
        email,
        fast_used: used,
        fast_limit: limit,
        percentage,
        auto_percent,
        api_percent,
        on_demand_enabled,
        on_demand_used_cents,
        slow_used: None,
        reset_at,
        error: if connected {
            None
        } else {
            Some("Cursor API returned no usage fields.".to_string())
        },
    }
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
        auto_percent: None,
        api_percent: None,
        on_demand_enabled: None,
        on_demand_used_cents: None,
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
    use base64::engine::general_purpose::URL_SAFE_NO_PAD;

    fn encode_jwt(sub: &str) -> String {
        let header = URL_SAFE_NO_PAD.encode(br#"{"alg":"HS256","typ":"JWT"}"#);
        let payload =
            URL_SAFE_NO_PAD.encode(format!(r#"{{"sub":"{sub}","type":"session"}}"#).as_bytes());
        format!("{header}.{payload}.signature")
    }

    fn temp_db_path(label: &str) -> PathBuf {
        static COUNTER: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
        let n = COUNTER.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        std::env::temp_dir().join(format!(
            "quotabar-cursor-{}-{}-{}.vscdb",
            std::process::id(),
            label,
            n
        ))
    }

    fn write_item_table(path: &Path, pairs: &[(&str, &str)]) {
        let _ = std::fs::remove_file(path);
        let conn = Connection::open(path).expect("create temp sqlite");
        conn.execute(
            "CREATE TABLE ItemTable (key TEXT PRIMARY KEY, value BLOB)",
            [],
        )
        .unwrap();
        for (key, value) in pairs {
            conn.execute(
                "INSERT INTO ItemTable (key, value) VALUES (?1, ?2)",
                rusqlite::params![*key, *value],
            )
            .unwrap();
        }
    }

    #[test]
    fn synthesizes_cookie_from_access_token_jwt() {
        let jwt = encode_jwt("google-oauth2|user_test");
        let cookie = workos_cookie_value(&jwt).expect("cookie");
        assert_eq!(cookie, format!("google-oauth2|user_test%3A%3A{jwt}"));
    }

    #[test]
    fn passes_through_encoded_cookie_and_double_colon_form() {
        let jwt = encode_jwt("user_test");
        assert_eq!(
            workos_cookie_value(&format!("user_test%3A%3A{jwt}")).unwrap(),
            format!("user_test%3A%3A{jwt}")
        );
        assert_eq!(
            workos_cookie_value(&format!("user_test::{jwt}")).unwrap(),
            format!("user_test%3A%3A{jwt}")
        );
    }

    #[test]
    fn rejects_garbage_session_token() {
        assert!(workos_cookie_value("not-a-token").is_err());
        assert!(workos_cookie_value("").is_err());
    }

    #[test]
    fn reads_access_token_and_email_from_item_table() {
        let path = temp_db_path("access-email");
        let jwt = encode_jwt("user_test");
        write_item_table(
            &path,
            &[
                (ACCESS_TOKEN_KEY, &jwt),
                (CACHED_EMAIL_KEY, "user@example.com"),
            ],
        );
        let session = read_session_from_db_path(&path).expect("session");
        let _ = std::fs::remove_file(&path);
        assert_eq!(session.token, jwt);
        assert_eq!(session.email.as_deref(), Some("user@example.com"));
    }

    #[test]
    fn opens_state_database_read_only() {
        let path = temp_db_path("read-only");
        write_item_table(&path, &[(ACCESS_TOKEN_KEY, "token")]);
        let conn = open_state_db(&path).expect("read-only connection");

        let result = conn.execute(
            "INSERT INTO ItemTable (key, value) VALUES (?1, ?2)",
            rusqlite::params!["unexpected", "write"],
        );

        drop(conn);
        let cleanup = std::fs::remove_file(&path);
        assert!(result.is_err());
        assert!(
            cleanup.is_ok(),
            "failed to remove temporary Cursor database"
        );
    }

    #[test]
    fn prefers_access_token_over_legacy_cookie_key() {
        let path = temp_db_path("prefer-access");
        let jwt = encode_jwt("user_new");
        write_item_table(
            &path,
            &[
                (ACCESS_TOKEN_KEY, &jwt),
                (LEGACY_SESSION_KEY, "user_old%3A%3Alegacy"),
            ],
        );
        let session = read_session_from_db_path(&path).expect("session");
        let _ = std::fs::remove_file(&path);
        assert_eq!(session.token, jwt);
    }

    #[test]
    fn missing_session_keys_return_clear_error() {
        let path = temp_db_path("missing-keys");
        write_item_table(&path, &[("unrelated", "value")]);
        let err = read_session_from_db_path(&path).expect_err("missing");
        let _ = std::fs::remove_file(&path);
        assert!(err.contains("Cursor session not found"));
    }

    #[test]
    fn summary_metadata_without_usage_is_disconnected() {
        let payload: serde_json::Value = serde_json::json!({
            "membershipType": "pro",
            "individualUsage": {}
        });

        let data = parse_cursor_payload(&payload);

        assert!(!data.connected);
        assert_eq!(
            data.error.as_deref(),
            Some("Cursor API returned no usage fields.")
        );
    }

    #[test]
    fn non_renderable_summary_fields_are_disconnected() {
        for payload in [
            serde_json::json!({
                "individualUsage": {
                    "onDemand": { "enabled": false, "used": 0 }
                }
            }),
            serde_json::json!({
                "individualUsage": {
                    "plan": { "used": 10 }
                }
            }),
            serde_json::json!({ "isUnlimited": true }),
        ] {
            let data = parse_cursor_payload(&payload);
            assert!(!data.connected, "unexpected connected payload: {payload}");
            assert_eq!(
                data.error.as_deref(),
                Some("Cursor API returned no usage fields.")
            );
        }
    }

    #[test]
    fn sqlite_lock_errors_are_transient() {
        assert!(is_transient_cursor_error("Too many open files"));
        assert!(is_transient_cursor_error(
            "Resource temporarily unavailable"
        ));
        assert!(is_transient_cursor_error(
            "Failed to read state.vscdb: database is locked"
        ));
        assert!(is_transient_cursor_error(
            "Failed to read state.vscdb: database table is locked"
        ));
        assert!(!is_transient_cursor_error("Cursor session not found"));
    }

    #[test]
    fn parses_usage_summary_payload() {
        let payload: serde_json::Value = serde_json::json!({
            "billingCycleStart": "2026-08-16T15:37:22.000Z",
            "billingCycleEnd": "2026-09-16T15:37:22.000Z",
            "membershipType": "ultra",
            "isUnlimited": false,
            "individualUsage": {
                "plan": {
                    "used": 40000,
                    "limit": 40000,
                    "autoPercentUsed": 2.888666666666667,
                    "apiPercentUsed": 91.082,
                    "totalPercentUsed": 15.487714285714285
                },
                "onDemand": { "enabled": false, "used": 0 }
            }
        });
        let data = parse_cursor_payload(&payload);
        assert!(data.connected);
        assert_eq!(data.plan_type.as_deref(), Some("ultra"));
        assert_eq!(data.fast_used, Some(40000));
        assert_eq!(data.fast_limit, Some(40000));
        assert!(data.auto_percent.unwrap() > 2.8 && data.auto_percent.unwrap() < 3.0);
        assert!(data.api_percent.unwrap() > 91.0 && data.api_percent.unwrap() < 91.1);
        assert!(data.percentage.unwrap() > 91.0 && data.percentage.unwrap() < 91.1);
        assert_eq!(data.on_demand_enabled, Some(false));
        assert_eq!(data.slow_used, None);
        assert_eq!(data.reset_at.as_deref(), Some("2026-09-16T15:37:22+00:00"));
    }

    #[test]
    fn preserves_fractional_on_demand_cents() {
        let payload: serde_json::Value = serde_json::json!({
            "membershipType": "pro",
            "individualUsage": {
                "plan": { "totalPercentUsed": 25.0 },
                "onDemand": { "enabled": true, "used": 1250.5 }
            }
        });

        let data = parse_cursor_payload(&payload);

        assert_eq!(data.on_demand_used_cents, Some(1250.5));
        assert_eq!(data.slow_used, None);
    }

    #[test]
    fn accrued_on_demand_spend_connects_when_disabled() {
        let payload: serde_json::Value = serde_json::json!({
            "individualUsage": {
                "onDemand": { "enabled": false, "used": 1250.5 }
            }
        });

        let data = parse_cursor_payload(&payload);

        assert!(data.connected);
        assert_eq!(data.on_demand_enabled, Some(false));
        assert_eq!(data.on_demand_used_cents, Some(1250.5));
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
            auto_percent: None,
            api_percent: None,
            on_demand_enabled: None,
            on_demand_used_cents: None,
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
