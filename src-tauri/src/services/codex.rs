use crate::domain::models::{
    CodexCredits, CodexData, CodexRateLimitWindow, CodexRateLimits, CodexStats,
};
use crate::services::http::{is_transient_os_error, shared_http_client};
use base64::{engine::general_purpose::STANDARD_NO_PAD, Engine as _};
use chrono::{DateTime, NaiveDate, Utc};
use std::fs;
use std::io::{BufRead, BufReader, Seek, SeekFrom};
use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};
use std::time::SystemTime;

#[derive(Clone)]
struct HistoryStatsCache {
    history_file: PathBuf,
    file_size: u64,
    modified_at: Option<SystemTime>,
    day: NaiveDate,
    total_sessions: u32,
    today_sessions: u32,
    last_ts: Option<i64>,
}

static HISTORY_STATS_CACHE: OnceLock<Mutex<Option<HistoryStatsCache>>> = OnceLock::new();

fn history_stats_cache() -> &'static Mutex<Option<HistoryStatsCache>> {
    HISTORY_STATS_CACHE.get_or_init(|| Mutex::new(None))
}

/// Most recent successful fetch results, retained without TTL so we can
/// short-circuit transient OS errors (EMFILE etc.) without flashing UI.
static LAST_GOOD_INFO: OnceLock<Mutex<Option<CodexData>>> = OnceLock::new();
static LAST_GOOD_LIMITS: OnceLock<Mutex<Option<CodexRateLimits>>> = OnceLock::new();

fn last_good_info() -> &'static Mutex<Option<CodexData>> {
    LAST_GOOD_INFO.get_or_init(|| Mutex::new(None))
}

fn last_good_limits() -> &'static Mutex<Option<CodexRateLimits>> {
    LAST_GOOD_LIMITS.get_or_init(|| Mutex::new(None))
}

fn get_codex_home() -> Option<PathBuf> {
    dirs::home_dir().map(|home| home.join(".codex"))
}

fn decode_jwt_payload(token: &str) -> Option<serde_json::Value> {
    let parts: Vec<&str> = token.split('.').collect();
    if parts.len() != 3 {
        return None;
    }

    let payload = parts[1];
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
        .and_then(|bytes| String::from_utf8(bytes).ok())
        .and_then(|json| serde_json::from_str(&json).ok())
}

fn read_auth_json() -> Result<serde_json::Value, String> {
    let codex_home = get_codex_home().ok_or_else(|| "Could not find home directory".to_string())?;
    let auth_file = codex_home.join("auth.json");
    if !auth_file.exists() {
        return Err("Codex not configured. Please run 'codex' to login.".to_string());
    }

    let content =
        fs::read_to_string(&auth_file).map_err(|e| format!("Failed to read auth.json: {e}"))?;
    serde_json::from_str(&content).map_err(|e| format!("Failed to parse auth.json: {e}"))
}

fn parse_used_percent(window: &serde_json::Value) -> Option<f64> {
    window
        .get("used_percent")
        .and_then(|value| value.as_f64().or_else(|| value.as_i64().map(|v| v as f64)))
        .map(|value| value.clamp(0.0, 100.0))
}

fn parse_rate_limit_window(window: &serde_json::Value) -> Option<CodexRateLimitWindow> {
    if window.is_null() || !window.is_object() {
        return None;
    }

    Some(CodexRateLimitWindow {
        used_percent: parse_used_percent(window)?,
        window_minutes: window["limit_window_seconds"]
            .as_i64()
            .map(|s| (s + 59) / 60),
        resets_at: window["reset_at"].as_i64(),
    })
}

fn update_stats_from_reader<R: BufRead>(
    reader: R,
    today: NaiveDate,
    total_sessions: &mut u32,
    today_sessions: &mut u32,
    last_ts: &mut Option<i64>,
) {
    for line in reader.lines().map_while(Result::ok) {
        if let Ok(entry) = serde_json::from_str::<serde_json::Value>(&line) {
            *total_sessions = total_sessions.saturating_add(1);
            if let Some(ts) = entry["ts"].as_i64() {
                if let Some(dt) = DateTime::from_timestamp(ts, 0) {
                    if dt.date_naive() == today {
                        *today_sessions = today_sessions.saturating_add(1);
                    }
                }

                if last_ts.is_none_or(|current| ts > current) {
                    *last_ts = Some(ts);
                }
            }
        }
    }
}

fn build_codex_stats(total_sessions: u32, today_sessions: u32, last_ts: Option<i64>) -> CodexStats {
    let last_activity = last_ts
        .and_then(|ts| DateTime::from_timestamp(ts, 0))
        .map(|dt| dt.format("%Y-%m-%d %H:%M").to_string());

    CodexStats {
        total_sessions,
        today_sessions,
        last_activity,
    }
}

fn fallback_or_disconnected_info(error: String) -> CodexData {
    if is_transient_os_error(&error) {
        if let Ok(guard) = last_good_info().lock() {
            if let Some(stale) = guard.as_ref() {
                return stale.clone();
            }
        }
    }
    CodexData::disconnected(error)
}

pub async fn fetch_codex_info() -> CodexData {
    let auth_json = match read_auth_json() {
        Ok(v) => v,
        Err(error) => return fallback_or_disconnected_info(error),
    };

    let id_token = match auth_json["tokens"]["id_token"].as_str() {
        Some(token) => token,
        None => return CodexData::disconnected("No id_token found in auth.json"),
    };

    let payload = match decode_jwt_payload(id_token) {
        Some(payload) => payload,
        None => return CodexData::disconnected("Failed to decode JWT token"),
    };

    let auth_info = &payload["https://api.openai.com/auth"];

    let info = CodexData {
        connected: true,
        plan_type: auth_info["chatgpt_plan_type"]
            .as_str()
            .map(ToString::to_string),
        account_id: auth_info["chatgpt_account_id"]
            .as_str()
            .map(ToString::to_string),
        subscription_until: auth_info["chatgpt_subscription_active_until"]
            .as_str()
            .map(ToString::to_string),
        email: payload["email"].as_str().map(ToString::to_string),
        error: None,
    };

    if let Ok(mut guard) = last_good_info().lock() {
        *guard = Some(info.clone());
    }
    info
}

pub async fn fetch_codex_stats() -> CodexStats {
    let codex_home = match get_codex_home() {
        Some(path) => path,
        None => return CodexStats::empty(),
    };

    let history_file = codex_home.join("history.jsonl");
    if !history_file.exists() {
        if let Ok(mut guard) = history_stats_cache().lock() {
            *guard = None;
        }
        return CodexStats::empty();
    }

    let metadata = match fs::metadata(&history_file) {
        Ok(metadata) => metadata,
        Err(_) => return CodexStats::empty(),
    };

    let current_size = metadata.len();
    let current_modified = metadata.modified().ok();
    let today = Utc::now().date_naive();

    let mut total_sessions = 0u32;
    let mut today_sessions = 0u32;
    let mut last_ts: Option<i64> = None;
    let mut offset = 0u64;
    let mut can_incrementally_scan = false;

    if let Ok(guard) = history_stats_cache().lock() {
        if let Some(cache) = guard.as_ref() {
            let same_file = cache.history_file == history_file;
            let same_day = cache.day == today;
            let file_grew = current_size >= cache.file_size;
            let modified_is_not_older = match (current_modified, cache.modified_at) {
                (Some(now), Some(cached)) => now >= cached,
                _ => true,
            };

            if same_file && same_day && file_grew && modified_is_not_older {
                total_sessions = cache.total_sessions;
                today_sessions = cache.today_sessions;
                last_ts = cache.last_ts;
                offset = cache.file_size;
                can_incrementally_scan = true;
            }
        }
    }

    if can_incrementally_scan {
        let mut file = match fs::File::open(&history_file) {
            Ok(file) => file,
            Err(_) => return CodexStats::empty(),
        };

        if file.seek(SeekFrom::Start(offset)).is_ok() {
            let reader = BufReader::new(file);
            update_stats_from_reader(
                reader,
                today,
                &mut total_sessions,
                &mut today_sessions,
                &mut last_ts,
            );
        } else {
            can_incrementally_scan = false;
        }
    }

    if !can_incrementally_scan {
        total_sessions = 0;
        today_sessions = 0;
        last_ts = None;

        let file = match fs::File::open(&history_file) {
            Ok(file) => file,
            Err(_) => return CodexStats::empty(),
        };
        let reader = BufReader::new(file);
        update_stats_from_reader(
            reader,
            today,
            &mut total_sessions,
            &mut today_sessions,
            &mut last_ts,
        );
    }

    if let Ok(mut guard) = history_stats_cache().lock() {
        *guard = Some(HistoryStatsCache {
            history_file,
            file_size: current_size,
            modified_at: current_modified,
            day: today,
            total_sessions,
            today_sessions,
            last_ts,
        });
    }

    build_codex_stats(total_sessions, today_sessions, last_ts)
}

fn fallback_or_disconnected_limits(error: String) -> CodexRateLimits {
    if is_transient_os_error(&error) {
        if let Ok(guard) = last_good_limits().lock() {
            if let Some(stale) = guard.as_ref() {
                return stale.clone();
            }
        }
    }
    CodexRateLimits::disconnected(error)
}

pub async fn fetch_codex_rate_limits() -> CodexRateLimits {
    let auth_json = match read_auth_json() {
        Ok(v) => v,
        Err(error) => return fallback_or_disconnected_limits(error),
    };

    let access_token = match auth_json["tokens"]["access_token"].as_str() {
        Some(token) => token,
        None => return CodexRateLimits::disconnected("No access_token found in auth.json"),
    };

    let account_id = auth_json["tokens"]["id_token"]
        .as_str()
        .and_then(decode_jwt_payload)
        .and_then(|payload| {
            payload["https://api.openai.com/auth"]["chatgpt_account_id"]
                .as_str()
                .map(ToString::to_string)
        });

    let client = shared_http_client();
    let mut request = client
        .get("https://chatgpt.com/backend-api/wham/usage")
        .header("Authorization", format!("Bearer {access_token}"))
        .header("User-Agent", "codex-cli")
        .timeout(std::time::Duration::from_secs(10));

    if let Some(account_id) = account_id {
        request = request.header("ChatGPT-Account-Id", account_id);
    }

    let response = match request.send().await {
        Ok(resp) => resp,
        Err(err) => return CodexRateLimits::disconnected(format!("Network error: {err}")),
    };

    if response.status().as_u16() == 401 || response.status().as_u16() == 403 {
        return CodexRateLimits::disconnected("Token expired. Please run 'codex' to re-login.");
    }

    if !response.status().is_success() {
        return CodexRateLimits::disconnected(format!("API error: {}", response.status()));
    }

    let data = match response.json::<serde_json::Value>().await {
        Ok(data) => data,
        Err(err) => {
            return CodexRateLimits::disconnected(format!("Failed to parse response: {err}"))
        }
    };

    let primary = data["rate_limit"]
        .get("primary_window")
        .and_then(parse_rate_limit_window);

    let secondary = data["rate_limit"]
        .get("secondary_window")
        .and_then(parse_rate_limit_window);

    if primary.is_none() && secondary.is_none() {
        return CodexRateLimits::disconnected(
            "Failed to parse response: no numeric Codex rate limit usage fields",
        );
    }

    let credits = data["credits"].as_object().map(|credits| CodexCredits {
        has_credits: credits
            .get("has_credits")
            .and_then(|v| v.as_bool())
            .unwrap_or(false),
        unlimited: credits
            .get("unlimited")
            .and_then(|v| v.as_bool())
            .unwrap_or(false),
        balance: credits
            .get("balance")
            .and_then(|v| v.as_str())
            .map(ToString::to_string),
    });

    let limits = CodexRateLimits {
        connected: true,
        plan_type: data["plan_type"].as_str().map(ToString::to_string),
        primary,
        secondary,
        credits,
        error: None,
    };

    if let Ok(mut guard) = last_good_limits().lock() {
        *guard = Some(limits.clone());
    }
    limits
}

#[cfg(test)]
mod tests {
    use super::parse_rate_limit_window;
    use serde_json::json;

    #[test]
    fn parse_rate_limit_window_requires_numeric_used_percent() {
        assert!(parse_rate_limit_window(&json!({ "limit_window_seconds": 18_000 })).is_none());
        assert!(parse_rate_limit_window(&json!({ "used_percent": "0" })).is_none());
    }

    #[test]
    fn parse_rate_limit_window_maps_numeric_used_percent() {
        let parsed = parse_rate_limit_window(&json!({
            "used_percent": 61.8,
            "limit_window_seconds": 18_000,
            "reset_at": 1_781_000_000
        }));
        let window = match parsed {
            Some(window) => window,
            None => panic!("numeric used_percent should parse"),
        };

        assert_eq!(window.used_percent, 61.8);
        assert_eq!(window.window_minutes, Some(300));
        assert_eq!(window.resets_at, Some(1_781_000_000));
    }

    #[test]
    fn parse_rate_limit_window_clamps_numeric_used_percent() {
        let high = match parse_rate_limit_window(&json!({ "used_percent": 120 })) {
            Some(window) => window,
            None => panic!("numeric used_percent should parse"),
        };
        let low = match parse_rate_limit_window(&json!({ "used_percent": -5 })) {
            Some(window) => window,
            None => panic!("numeric used_percent should parse"),
        };

        assert_eq!(high.used_percent, 100.0);
        assert_eq!(low.used_percent, 0.0);
    }
}
