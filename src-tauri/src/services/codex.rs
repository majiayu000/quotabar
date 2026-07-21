use crate::domain::models::{
    CodexCredits, CodexData, CodexRateLimitWindow, CodexRateLimits, CodexResetCredit,
    CodexResetCredits,
};
use crate::services::codex_cache::{self, AuthFileStamp};
use crate::services::http::{is_transient_os_error, shared_http_client};
use base64::{engine::general_purpose::STANDARD_NO_PAD, Engine as _};
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use std::time::Instant;

/// Most recent successful fetch results, retained without TTL so a transient
/// polling failure does not erase quota that was already displayed.
static LAST_GOOD_INFO: OnceLock<Mutex<Option<CodexData>>> = OnceLock::new();

fn last_good_info() -> &'static Mutex<Option<CodexData>> {
    LAST_GOOD_INFO.get_or_init(|| Mutex::new(None))
}

fn log_msg(msg: &str) {
    let timestamp = chrono::Local::now().format("%Y-%m-%d %H:%M:%S%.3f");
    let line = format!("[{timestamp}] {msg}\n");

    print!("{line}");

    let home_dir = match dirs::home_dir() {
        Some(path) => path,
        None => {
            eprintln!("[CodexLog] failed to resolve home directory");
            return;
        }
    };
    let log_dir = home_dir.join("Library/Logs/quotabar");
    if let Err(error) = fs::create_dir_all(&log_dir) {
        eprintln!("[CodexLog] failed to create log directory: {error}");
        return;
    }

    match OpenOptions::new()
        .create(true)
        .append(true)
        .open(log_dir.join("codex.log"))
    {
        Ok(mut file) => {
            if let Err(error) = file.write_all(line.as_bytes()) {
                eprintln!("[CodexLog] failed to write log: {error}");
            }
        }
        Err(error) => eprintln!("[CodexLog] failed to open log file: {error}"),
    }
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

fn auth_file_path() -> Result<PathBuf, String> {
    let codex_home = get_codex_home().ok_or_else(|| "Could not find home directory".to_string())?;
    let auth_file = codex_home.join("auth.json");
    if !auth_file.exists() {
        return Err("Codex not configured. Please run 'codex' to login.".to_string());
    }
    Ok(auth_file)
}

fn auth_file_stamp(auth_file: &Path) -> Result<AuthFileStamp, String> {
    let metadata =
        fs::metadata(auth_file).map_err(|error| format!("Failed to inspect auth.json: {error}"))?;
    let modified = metadata
        .modified()
        .map_err(|error| format!("Failed to inspect auth.json modification time: {error}"))?;
    Ok(AuthFileStamp {
        len: metadata.len(),
        modified,
    })
}

struct StampedAuthReadError {
    message: String,
    pre_read_stamp: Option<AuthFileStamp>,
}

fn read_auth_json_with_stamp() -> Result<(serde_json::Value, AuthFileStamp), StampedAuthReadError> {
    let auth_file = auth_file_path().map_err(|message| StampedAuthReadError {
        message,
        pre_read_stamp: None,
    })?;
    let stamp_before = auth_file_stamp(&auth_file).map_err(|message| StampedAuthReadError {
        message,
        pre_read_stamp: None,
    })?;

    let content = fs::read_to_string(&auth_file).map_err(|error| StampedAuthReadError {
        message: format!("Failed to read auth.json: {error}"),
        pre_read_stamp: Some(stamp_before.clone()),
    })?;
    let stamp_after = auth_file_stamp(&auth_file).map_err(|message| StampedAuthReadError {
        message,
        pre_read_stamp: None,
    })?;
    if stamp_before != stamp_after {
        return Err(StampedAuthReadError {
            message: "auth.json changed while it was being read".to_string(),
            pre_read_stamp: None,
        });
    }

    serde_json::from_str(&content)
        .map(|auth_json| (auth_json, stamp_after))
        .map_err(|error| StampedAuthReadError {
            message: format!("Failed to parse auth.json: {error}"),
            pre_read_stamp: None,
        })
}

fn read_auth_json() -> Result<serde_json::Value, String> {
    let auth_file = auth_file_path()?;
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

fn transient_failure_limits(account_id: Option<&str>, error: String) -> CodexRateLimits {
    match codex_cache::retain_for_account(account_id, error.clone()) {
        Ok(limits) => limits,
        Err(lock_error) => {
            log_msg(&format!("[RateLimits] {lock_error}"));
            CodexRateLimits::disconnected(error)
        }
    }
}

fn transient_auth_failure_limits(
    auth_stamp: Option<&AuthFileStamp>,
    error: String,
) -> CodexRateLimits {
    match codex_cache::retain_for_auth_stamp(auth_stamp, error.clone()) {
        Ok(limits) => limits,
        Err(lock_error) => {
            log_msg(&format!("[RateLimits] {lock_error}"));
            CodexRateLimits::disconnected(error)
        }
    }
}

fn should_preserve_for_status(status: reqwest::StatusCode) -> bool {
    status == reqwest::StatusCode::TOO_MANY_REQUESTS
}

fn should_preserve_transport_failure(
    is_timeout: bool,
    is_connect: bool,
    is_transient_os_error: bool,
) -> bool {
    is_timeout || is_connect || is_transient_os_error
}

pub async fn fetch_codex_rate_limits() -> CodexRateLimits {
    let (auth_json, auth_stamp) = match read_auth_json_with_stamp() {
        Ok(auth) => auth,
        Err(error) => {
            log_msg(&format!("[RateLimits] auth read failed: {}", error.message));
            return if is_transient_os_error(&error.message) {
                transient_auth_failure_limits(error.pre_read_stamp.as_ref(), error.message)
            } else {
                CodexRateLimits::disconnected(error.message)
            };
        }
    };

    let access_token = match auth_json["tokens"]["access_token"].as_str() {
        Some(token) => token,
        None => {
            let error = "No access_token found in auth.json";
            log_msg(&format!("[RateLimits] {error}"));
            return CodexRateLimits::disconnected(error);
        }
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

    if let Some(account_id) = account_id.as_deref() {
        request = request.header("ChatGPT-Account-Id", account_id);
    }

    let started_at = Instant::now();
    let response = match request.send().await {
        Ok(resp) => resp,
        Err(err) => {
            let error = format!("Network error: {err}");
            let should_preserve = should_preserve_transport_failure(
                err.is_timeout(),
                err.is_connect(),
                is_transient_os_error(&error),
            );
            log_msg(&format!(
                "[RateLimits] request failed: latency={:.1}s, preservable={should_preserve}, error={error}",
                started_at.elapsed().as_secs_f64(),
            ));
            return if should_preserve {
                transient_failure_limits(account_id.as_deref(), error)
            } else {
                CodexRateLimits::disconnected(error)
            };
        }
    };

    let status = response.status();
    log_msg(&format!(
        "[RateLimits] response: status={status}, latency={:.1}s",
        started_at.elapsed().as_secs_f64()
    ));

    if should_preserve_for_status(status) {
        let error = format!("API error: {status}");
        log_msg("[RateLimits] rate limited; retaining last successful quota if available");
        return transient_failure_limits(account_id.as_deref(), error);
    }

    if status.as_u16() == 401 || status.as_u16() == 403 {
        let error = "Token expired. Please run 'codex' to re-login.";
        log_msg(&format!("[RateLimits] auth failure: status={status}"));
        if let Err(cache_error) = codex_cache::invalidate(&auth_stamp, account_id.as_deref()) {
            log_msg(&format!(
                "[RateLimits] failed to invalidate last-good cache: {cache_error}"
            ));
        }
        return CodexRateLimits::disconnected(error);
    }

    if !status.is_success() {
        let error = format!("API error: {status}");
        log_msg(&format!("[RateLimits] non-success response: {status}"));
        return CodexRateLimits::disconnected(error);
    }

    let data = match response.json::<serde_json::Value>().await {
        Ok(data) => data,
        Err(err) => {
            let should_preserve = should_preserve_transport_failure(
                err.is_timeout(),
                err.is_connect(),
                is_transient_os_error(&err.to_string()),
            );
            let error = if should_preserve {
                format!("Failed to read response body: {err}")
            } else {
                format!("Failed to parse response: {err}")
            };
            log_msg(&format!(
                "[RateLimits] body read failed: preservable={should_preserve}, error={error}"
            ));
            return if should_preserve {
                transient_failure_limits(account_id.as_deref(), error)
            } else {
                CodexRateLimits::disconnected(error)
            };
        }
    };

    let primary = data["rate_limit"]
        .get("primary_window")
        .and_then(parse_rate_limit_window);

    let secondary = data["rate_limit"]
        .get("secondary_window")
        .and_then(parse_rate_limit_window);

    if primary.is_none() && secondary.is_none() {
        let error = "Failed to parse response: no numeric Codex rate limit usage fields";
        log_msg(&format!("[RateLimits] {error}"));
        return CodexRateLimits::disconnected(error);
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

    match account_id {
        Some(account_id) => {
            if let Err(error) = codex_cache::store(account_id, auth_stamp, limits.clone()) {
                log_msg(&format!(
                    "[RateLimits] failed to update last-good cache: {error}"
                ));
            }
        }
        None => log_msg("[RateLimits] account ID missing; last-good cache not updated"),
    }
    log_msg(&format!(
        "[RateLimits] parsed: primary_used={:?}, secondary_used={:?}",
        limits.primary.as_ref().map(|window| window.used_percent),
        limits.secondary.as_ref().map(|window| window.used_percent)
    ));
    limits
}

fn parse_reset_credit(credit: &serde_json::Value) -> Option<CodexResetCredit> {
    Some(CodexResetCredit {
        status: credit["status"].as_str()?.to_string(),
        title: credit["title"].as_str().map(ToString::to_string),
        granted_at: credit["granted_at"].as_str().map(ToString::to_string),
        expires_at: credit["expires_at"].as_str().map(ToString::to_string),
    })
}

pub async fn fetch_codex_reset_credits() -> CodexResetCredits {
    let auth_json = match read_auth_json() {
        Ok(v) => v,
        Err(error) => return CodexResetCredits::disconnected(error),
    };

    let access_token = match auth_json["tokens"]["access_token"].as_str() {
        Some(token) => token,
        None => return CodexResetCredits::disconnected("No access_token found in auth.json"),
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
        .get("https://chatgpt.com/backend-api/wham/rate-limit-reset-credits")
        .header("Authorization", format!("Bearer {access_token}"))
        .header("User-Agent", "codex-cli")
        .timeout(std::time::Duration::from_secs(10));

    if let Some(account_id) = account_id {
        request = request.header("ChatGPT-Account-Id", account_id);
    }

    let response = match request.send().await {
        Ok(resp) => resp,
        Err(err) => return CodexResetCredits::disconnected(format!("Network error: {err}")),
    };

    if response.status().as_u16() == 401 || response.status().as_u16() == 403 {
        return CodexResetCredits::disconnected("Token expired. Please run 'codex' to re-login.");
    }

    if !response.status().is_success() {
        return CodexResetCredits::disconnected(format!("API error: {}", response.status()));
    }

    let data = match response.json::<serde_json::Value>().await {
        Ok(data) => data,
        Err(err) => {
            return CodexResetCredits::disconnected(format!("Failed to parse response: {err}"))
        }
    };

    let credits: Vec<CodexResetCredit> = data["credits"]
        .as_array()
        .map(|items| items.iter().filter_map(parse_reset_credit).collect())
        .unwrap_or_default();

    let available_count = data["available_count"]
        .as_u64()
        .map(|count| count.min(u32::MAX as u64) as u32)
        .unwrap_or_else(|| {
            credits
                .iter()
                .filter(|credit| credit.status == "available")
                .count() as u32
        });

    CodexResetCredits {
        connected: true,
        available_count,
        credits,
        error: None,
    }
}

#[cfg(test)]
mod tests {
    use super::{
        parse_rate_limit_window, parse_reset_credit, should_preserve_for_status,
        should_preserve_transport_failure,
    };
    use serde_json::json;

    #[test]
    fn only_rate_limiting_is_a_preservable_http_failure() {
        assert!(should_preserve_for_status(
            reqwest::StatusCode::TOO_MANY_REQUESTS
        ));
        assert!(!should_preserve_for_status(
            reqwest::StatusCode::UNAUTHORIZED
        ));
        assert!(!should_preserve_for_status(
            reqwest::StatusCode::INTERNAL_SERVER_ERROR
        ));
    }

    #[test]
    fn only_explicitly_transient_transport_failures_are_preservable() {
        assert!(should_preserve_transport_failure(true, false, false));
        assert!(should_preserve_transport_failure(false, true, false));
        assert!(should_preserve_transport_failure(false, false, true));
        assert!(!should_preserve_transport_failure(false, false, false));
    }

    #[test]
    fn parse_reset_credit_requires_status() {
        assert!(parse_reset_credit(&json!({ "title": "Full reset" })).is_none());
    }

    #[test]
    fn parse_reset_credit_maps_summary_fields_only() {
        let parsed = parse_reset_credit(&json!({
            "id": "credit-secret-id",
            "status": "available",
            "title": "Full reset (Weekly + 5 hr)",
            "granted_at": "2026-06-18T00:41:07.776451Z",
            "expires_at": "2026-07-18T00:41:07.776451Z"
        }));
        let credit = match parsed {
            Some(credit) => credit,
            None => panic!("credit with status should parse"),
        };

        assert_eq!(credit.status, "available");
        assert_eq!(credit.title.as_deref(), Some("Full reset (Weekly + 5 hr)"));
        assert_eq!(
            credit.granted_at.as_deref(),
            Some("2026-06-18T00:41:07.776451Z")
        );
        assert_eq!(
            credit.expires_at.as_deref(),
            Some("2026-07-18T00:41:07.776451Z")
        );
    }

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
