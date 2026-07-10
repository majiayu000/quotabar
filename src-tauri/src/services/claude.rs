use crate::domain::models::{QuotaData, UsageInfo};
use crate::services::http::{is_transient_os_error, shared_http_client};
use std::fs::OpenOptions;
use std::io::Write as IoWrite;
#[cfg(target_os = "macos")]
use std::process::Command;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

const TOKEN_CACHE_TTL: Duration = Duration::from_secs(300);
const QUOTA_CACHE_TTL: Duration = Duration::from_secs(120);
const CLAUDE_TOKEN_ENV_KEY: &str = "CLAUDE_CODE_OAUTH_TOKEN";
const CLAUDE_AUTH_RELOGIN_MESSAGE: &str =
    "Claude OAuth token expired or invalid. Please re-login to Claude Code, then click Refresh.";

const CREDENTIAL_NAMES: [&str; 4] = [
    "Claude Code-credentials",
    "claude-credentials",
    "Claude-credentials",
    "claudecode-credentials",
];
const FABLE5_QUOTA_KEYS: [&str; 5] = [
    "seven_day_fable5",
    "seven_day_fable_5",
    "seven_day_fable",
    "seven_day_claude_fable5",
    "seven_day_claude_fable_5",
];

static REQUEST_COUNT: AtomicU64 = AtomicU64::new(0);
static LAST_REQUEST_TIME: OnceLock<Mutex<Option<Instant>>> = OnceLock::new();

fn last_request_time() -> &'static Mutex<Option<Instant>> {
    LAST_REQUEST_TIME.get_or_init(|| Mutex::new(None))
}

fn log_msg(msg: &str) {
    let timestamp = chrono::Local::now().format("%Y-%m-%d %H:%M:%S%.3f");
    let line = format!("[{timestamp}] {msg}\n");

    print!("{line}");

    let log_dir = dirs::home_dir()
        .unwrap_or_default()
        .join("Library/Logs/quotabar");
    if let Err(e) = std::fs::create_dir_all(&log_dir) {
        eprintln!("[log] failed to create log dir: {e}");
        return;
    }

    match OpenOptions::new()
        .create(true)
        .append(true)
        .open(log_dir.join("claude.log"))
    {
        Ok(mut file) => {
            if let Err(e) = file.write_all(line.as_bytes()) {
                eprintln!("[log] failed to write log: {e}");
            }
        }
        Err(e) => eprintln!("[log] failed to open log file: {e}"),
    }
}

fn log_response_headers(response: &reqwest::Response) {
    let headers = response.headers();
    let interesting = [
        "retry-after",
        "x-ratelimit-limit-requests",
        "x-ratelimit-limit-tokens",
        "x-ratelimit-remaining-requests",
        "x-ratelimit-remaining-tokens",
        "x-ratelimit-reset-requests",
        "x-ratelimit-reset-tokens",
        "cf-ray",
        "x-should-retry",
        "request-id",
    ];

    let mut parts = Vec::new();
    for name in interesting {
        if let Some(val) = headers.get(name) {
            let val_str = val.to_str().unwrap_or("?");
            parts.push(format!("{name}={val_str}"));
        }
    }
    if !parts.is_empty() {
        log_msg(&format!("[API] response headers: {}", parts.join(", ")));
    }
}

fn track_request() -> (u64, Option<f64>) {
    let count = REQUEST_COUNT.fetch_add(1, Ordering::Relaxed) + 1;
    let gap = if let Ok(mut guard) = last_request_time().lock() {
        let gap = guard.map(|t| t.elapsed().as_secs_f64());
        *guard = Some(Instant::now());
        gap
    } else {
        None
    };
    (count, gap)
}

#[derive(Clone)]
struct CachedCredentials {
    access_token: String,
    cached_at: Instant,
    expires_at_ms: Option<u64>,
}

static CREDENTIALS_CACHE: OnceLock<Mutex<Option<CachedCredentials>>> = OnceLock::new();

fn credentials_cache() -> &'static Mutex<Option<CachedCredentials>> {
    CREDENTIALS_CACHE.get_or_init(|| Mutex::new(None))
}

struct CachedQuota {
    data: QuotaData,
    cached_at: Instant,
}

static QUOTA_CACHE: OnceLock<Mutex<Option<CachedQuota>>> = OnceLock::new();

fn quota_cache() -> &'static Mutex<Option<CachedQuota>> {
    QUOTA_CACHE.get_or_init(|| Mutex::new(None))
}

fn read_oauth_token_from_env() -> Option<String> {
    std::env::var(CLAUDE_TOKEN_ENV_KEY)
        .ok()
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty())
}

struct KeychainCredentials {
    access_token: String,
    expires_at_ms: Option<u64>,
    cred_name: String,
}

#[cfg(target_os = "macos")]
fn read_credentials_from_system() -> Result<KeychainCredentials, String> {
    let username = std::env::var("USER").unwrap_or_default();

    for cred_name in CREDENTIAL_NAMES {
        // Use -a $USER to match the exact keychain entry that Claude Code CLI uses
        let mut args = vec!["find-generic-password"];
        if !username.is_empty() {
            args.extend(["-a", &username]);
        }
        args.extend(["-s", cred_name, "-w"]);

        let output = Command::new("security").args(&args).output();

        if let Ok(result) = output {
            if result.status.success() {
                let creds_json = String::from_utf8_lossy(&result.stdout).trim().to_string();
                if creds_json.is_empty() {
                    continue;
                }

                if let Ok(creds) = serde_json::from_str::<serde_json::Value>(&creds_json) {
                    let oauth = &creds["claudeAiOauth"];
                    if let Some(access_token) = oauth["accessToken"].as_str() {
                        let expires_at_ms = oauth["expiresAt"].as_u64();
                        return Ok(KeychainCredentials {
                            access_token: access_token.to_string(),
                            expires_at_ms,
                            cred_name: cred_name.to_string(),
                        });
                    }
                }
            }
        }
    }

    Err(format!(
        "OAuth token not found. Please login to Claude Code or set {CLAUDE_TOKEN_ENV_KEY}."
    ))
}

#[cfg(not(target_os = "macos"))]
fn read_credentials_from_system() -> Result<KeychainCredentials, String> {
    Err(format!(
        "OAuth token not configured for this OS. Set {CLAUDE_TOKEN_ENV_KEY}."
    ))
}

struct RedactedCredential<'a> {
    _secret: &'a str,
}

impl<'a> RedactedCredential<'a> {
    fn new(secret: &'a str) -> Self {
        Self { _secret: secret }
    }
}

impl std::fmt::Display for RedactedCredential<'_> {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str("<redacted>")
    }
}

fn oauth_cache_hit_diagnostic(
    access_token: &str,
    elapsed: Duration,
    expires_at_ms: Option<u64>,
) -> String {
    format!(
        "[OAuth] cache hit, credential={}, age={:.0}s, ttl={:.0}s remaining, expires_at={expires_at_ms:?}",
        RedactedCredential::new(access_token),
        elapsed.as_secs_f64(),
        (TOKEN_CACHE_TTL - elapsed).as_secs_f64()
    )
}

fn oauth_env_source_diagnostic(access_token: &str) -> String {
    format!(
        "[OAuth] using env var credentials: credential={}",
        RedactedCredential::new(access_token)
    )
}

fn oauth_keychain_source_diagnostic(
    cred_name: &str,
    access_token: &str,
    expires_at_ms: Option<u64>,
) -> String {
    format!(
        "[OAuth] keychain read ok: cred_name={cred_name}, credential={}, expires_at={expires_at_ms:?}",
        RedactedCredential::new(access_token)
    )
}

fn request_quota_diagnostic(access_token: &str, count: u64, gap: Option<f64>) -> String {
    format!(
        "[API] request_quota: credential={}, req_count={count}, gap={:.1}s",
        RedactedCredential::new(access_token),
        gap.unwrap_or(0.0)
    )
}

fn get_oauth_token(force_refresh: bool) -> Result<String, String> {
    log_msg(&format!(
        "[OAuth] get_oauth_token called, force_refresh={force_refresh}"
    ));

    if !force_refresh {
        if let Ok(guard) = credentials_cache().lock() {
            if let Some(creds) = guard.as_ref() {
                let elapsed = creds.cached_at.elapsed();
                if elapsed < TOKEN_CACHE_TTL {
                    log_msg(&oauth_cache_hit_diagnostic(
                        &creds.access_token,
                        elapsed,
                        creds.expires_at_ms,
                    ));
                    return Ok(creds.access_token.clone());
                } else {
                    log_msg(&format!(
                        "[OAuth] cache expired, age={:.0}s > ttl={:.0}s, re-reading credentials",
                        elapsed.as_secs_f64(),
                        TOKEN_CACHE_TTL.as_secs_f64()
                    ));
                }
            } else {
                log_msg("[OAuth] cache empty, first-time read");
            }
        }
    }

    if let Some(token) = read_oauth_token_from_env() {
        log_msg(&oauth_env_source_diagnostic(&token));
        if let Ok(mut guard) = credentials_cache().lock() {
            *guard = Some(CachedCredentials {
                access_token: token.clone(),
                cached_at: Instant::now(),
                expires_at_ms: None,
            });
        }
        return Ok(token);
    }

    log_msg("[OAuth] reading from keychain...");
    let keychain = read_credentials_from_system()?;
    log_msg(&oauth_keychain_source_diagnostic(
        &keychain.cred_name,
        &keychain.access_token,
        keychain.expires_at_ms,
    ));

    if let Ok(mut guard) = credentials_cache().lock() {
        *guard = Some(CachedCredentials {
            access_token: keychain.access_token.clone(),
            cached_at: Instant::now(),
            expires_at_ms: keychain.expires_at_ms,
        });
    }
    Ok(keychain.access_token)
}

async fn request_quota(access_token: &str) -> Result<reqwest::Response, String> {
    let (count, gap) = track_request();
    log_msg(&request_quota_diagnostic(access_token, count, gap));

    let start = Instant::now();
    let response = shared_http_client()
        .get("https://api.anthropic.com/api/oauth/usage")
        .header("Accept", "application/json")
        .header("Authorization", format!("Bearer {access_token}"))
        .header("anthropic-beta", "oauth-2025-04-20")
        .header("User-Agent", "claude-code/1.0.0")
        .timeout(Duration::from_secs(10))
        .send()
        .await
        .map_err(|err| {
            log_msg(&format!("[API] request_quota: network error: {err}"));
            format!("Network error: {err}")
        })?;

    let elapsed = start.elapsed();
    let status = response.status();
    log_msg(&format!(
        "[API] request_quota: status={status}, latency={:.1}s",
        elapsed.as_secs_f64()
    ));
    log_response_headers(&response);

    Ok(response)
}

fn is_auth_error(status: reqwest::StatusCode) -> bool {
    status == reqwest::StatusCode::UNAUTHORIZED || status == reqwest::StatusCode::FORBIDDEN
}

fn parse_quota_window(value: &serde_json::Value) -> Option<UsageInfo> {
    if value.is_null() || !value.is_object() {
        return None;
    }

    let utilization = value.get("utilization")?.as_f64()?;
    let resets_at = value["resets_at"].as_str().map(ToString::to_string);

    Some(UsageInfo {
        used: utilization,
        limit: 100.0,
        percentage: utilization,
        reset_time: resets_at,
    })
}

fn parse_first_quota_window(data: &serde_json::Value, keys: &[&str]) -> Option<UsageInfo> {
    keys.iter().find_map(|key| parse_quota_window(&data[*key]))
}

fn parse_weekly_scoped_model_quota(
    data: &serde_json::Value,
    model_display_name: &str,
) -> Option<UsageInfo> {
    let limits = data.get("limits")?.as_array()?;
    limits.iter().find_map(|limit| {
        if limit.get("group")?.as_str()? != "weekly" {
            return None;
        }
        if limit.get("kind")?.as_str()? != "weekly_scoped" {
            return None;
        }
        let display_name = limit
            .get("scope")?
            .get("model")?
            .get("display_name")?
            .as_str()?;
        if !display_name.eq_ignore_ascii_case(model_display_name) {
            return None;
        }

        let percent = limit.get("percent")?.as_f64()?;
        let resets_at = limit["resets_at"].as_str().map(ToString::to_string);
        Some(UsageInfo {
            used: percent,
            limit: 100.0,
            percentage: percent,
            reset_time: resets_at,
        })
    })
}

fn get_cached_quota() -> Option<QuotaData> {
    let guard = quota_cache().lock().ok()?;
    let cached = guard.as_ref()?;
    let age = cached.cached_at.elapsed();
    if age < QUOTA_CACHE_TTL {
        log_msg(&format!(
            "[Quota] response cache hit, age={:.0}s, ttl={:.0}s remaining",
            age.as_secs_f64(),
            (QUOTA_CACHE_TTL - age).as_secs_f64()
        ));
        Some(cached.data.clone())
    } else {
        log_msg(&format!(
            "[Quota] response cache expired, age={:.0}s",
            age.as_secs_f64()
        ));
        None
    }
}

fn get_stale_cached_quota() -> Option<QuotaData> {
    let guard = quota_cache().lock().ok()?;
    let cached = guard.as_ref()?;
    if cached.data.connected {
        let age = cached.cached_at.elapsed();
        log_msg(&format!(
            "[Quota] returning stale cache as fallback, age={:.0}s",
            age.as_secs_f64()
        ));
        Some(cached.data.clone())
    } else {
        None
    }
}

fn save_quota_cache(data: &QuotaData) {
    if let Ok(mut guard) = quota_cache().lock() {
        *guard = Some(CachedQuota {
            data: data.clone(),
            cached_at: Instant::now(),
        });
    }
}

fn is_rate_limited(status: reqwest::StatusCode) -> bool {
    status == reqwest::StatusCode::TOO_MANY_REQUESTS
}

/// On transient OS errors (EMFILE / EAGAIN), return the last successful
/// QuotaData instead of surfacing the error to the UI.
fn fallback_or_disconnected(error: String) -> QuotaData {
    if is_transient_os_error(&error) {
        if let Some(stale) = get_stale_cached_quota() {
            return stale;
        }
    }
    QuotaData::disconnected(error)
}

pub async fn fetch_quota() -> QuotaData {
    log_msg("[Quota] ---- fetch_quota start ----");

    // Return cached response if still fresh
    if let Some(cached) = get_cached_quota() {
        return cached;
    }

    let access_token = match get_oauth_token(false) {
        Ok(token) => token,
        Err(error) => {
            log_msg(&format!("[Quota] get_oauth_token failed: {error}"));
            return fallback_or_disconnected(error);
        }
    };

    let mut response = match request_quota(&access_token).await {
        Ok(resp) => resp,
        Err(error) => {
            log_msg(&format!("[Quota] initial request failed: {error}"));
            return get_stale_cached_quota().unwrap_or_else(|| QuotaData::disconnected(error));
        }
    };

    let status = response.status();
    log_msg(&format!("[Quota] initial response: status={status}"));

    // 429: return stale cache data if available, but always include error
    // so the frontend can trigger adaptive backoff
    if is_rate_limited(status) {
        log_msg("[Quota] 429 rate limited, returning stale cache if available");
        if let Some(mut stale) = get_stale_cached_quota() {
            stale.error = Some("API error: 429 Too Many Requests".to_string());
            return stale;
        }
        return QuotaData::disconnected("API error: 429 Too Many Requests");
    }

    if is_auth_error(status) {
        log_msg(&format!(
            "[Quota] auth error ({status}), step 1: force re-read from keychain"
        ));
        let fresh_access_token = match get_oauth_token(true) {
            Ok(token) => token,
            Err(error) => {
                log_msg(&format!("[Quota] keychain re-read failed: {error}"));
                return fallback_or_disconnected(error);
            }
        };

        response = match request_quota(&fresh_access_token).await {
            Ok(resp) => resp,
            Err(error) => {
                log_msg(&format!(
                    "[Quota] retry with keychain token failed: {error}"
                ));
                return fallback_or_disconnected(error);
            }
        };

        let status2 = response.status();
        log_msg(&format!(
            "[Quota] keychain retry response: status={status2}"
        ));

        if is_rate_limited(status2) {
            log_msg("[Quota] 429 after keychain retry, returning stale cache");
            if let Some(mut stale) = get_stale_cached_quota() {
                stale.error = Some("API error: 429 Too Many Requests".to_string());
                return stale;
            }
            return QuotaData::disconnected("API error: 429 Too Many Requests");
        }

        if is_auth_error(status2) {
            log_msg(&format!(
                "[Quota] auth error ({status2}) after keychain re-read; stopping until Claude Code login is refreshed"
            ));
            return QuotaData::disconnected(CLAUDE_AUTH_RELOGIN_MESSAGE);
        }
    }

    if !response.status().is_success() {
        let final_status = response.status();
        log_msg(&format!("[Quota] non-success response: {final_status}"));
        return QuotaData::disconnected(format!("API error: {final_status}"));
    }

    let data = match response.json::<serde_json::Value>().await {
        Ok(data) => data,
        Err(err) => {
            log_msg(&format!("[Quota] parse error: {err}"));
            return QuotaData::disconnected(format!("Failed to parse response: {err}"));
        }
    };

    if data["error"].is_object() {
        let error_msg = data["error"]["message"].as_str().unwrap_or("API error");
        log_msg(&format!("[Quota] API returned error: {error_msg}"));
        return QuotaData::disconnected(format!("{error_msg} (Token may be expired)"));
    }

    let five_hour = data["five_hour"]["utilization"].as_f64();
    let seven_day = data["seven_day"]["utilization"].as_f64();
    let seven_day_design = data["seven_day_omelette"]["utilization"].as_f64();
    let weekly_fable5 = parse_first_quota_window(&data, &FABLE5_QUOTA_KEYS)
        .or_else(|| parse_weekly_scoped_model_quota(&data, "Fable"));
    let seven_day_fable5 = weekly_fable5.as_ref().map(|window| window.percentage);
    log_msg(&format!(
        "[Quota] SUCCESS: five_hour={five_hour:?}%, seven_day={seven_day:?}%, seven_day_omelette={seven_day_design:?}%, seven_day_fable5={seven_day_fable5:?}%"
    ));

    let session = parse_quota_window(&data["five_hour"]);
    let weekly_total = parse_quota_window(&data["seven_day"]);
    let weekly_opus = parse_quota_window(&data["seven_day_opus"]);
    let weekly_sonnet = parse_quota_window(&data["seven_day_sonnet"]);
    let weekly_design = parse_quota_window(&data["seven_day_omelette"]);

    if session.is_none()
        && weekly_total.is_none()
        && weekly_opus.is_none()
        && weekly_sonnet.is_none()
        && weekly_design.is_none()
        && weekly_fable5.is_none()
    {
        log_msg("[Quota] parse error: no numeric quota utilization fields");
        return QuotaData::disconnected(
            "Failed to parse response: no numeric quota utilization fields",
        );
    }

    let result = QuotaData::connected(
        session,
        weekly_total,
        weekly_opus,
        weekly_sonnet,
        weekly_design,
        weekly_fable5,
    );

    save_quota_cache(&result);
    result
}

#[cfg(test)]
mod tests {
    use super::{
        oauth_cache_hit_diagnostic, oauth_env_source_diagnostic, oauth_keychain_source_diagnostic,
        parse_first_quota_window, parse_quota_window, parse_weekly_scoped_model_quota,
        request_quota_diagnostic, FABLE5_QUOTA_KEYS,
    };
    use serde_json::{json, Value};
    use std::time::Duration;

    const SENTINEL_TOKEN: &str = "secret-prefix-sensitive-value-secret-suffix";

    fn assert_excludes_token_fragments(diagnostic: &str) {
        assert!(SENTINEL_TOKEN.is_ascii());
        assert!(diagnostic.contains("<redacted>"));
        assert!(!diagnostic.contains(SENTINEL_TOKEN));
        for width in 6..=SENTINEL_TOKEN.len() {
            for start in 0..=SENTINEL_TOKEN.len() - width {
                let fragment = &SENTINEL_TOKEN[start..start + width];
                assert!(
                    !diagnostic.contains(fragment),
                    "diagnostic contains a token-derived fragment"
                );
            }
        }
        assert!(!diagnostic.contains("token="));
    }

    #[test]
    fn credential_diagnostics_exclude_oauth_token_fragments() {
        let diagnostics = [
            oauth_cache_hit_diagnostic(
                SENTINEL_TOKEN,
                Duration::from_secs(12),
                Some(1_800_000_000_000),
            ),
            oauth_env_source_diagnostic(SENTINEL_TOKEN),
            oauth_keychain_source_diagnostic(
                "Claude Code-credentials",
                SENTINEL_TOKEN,
                Some(1_800_000_000_000),
            ),
        ];

        for diagnostic in diagnostics {
            assert_excludes_token_fragments(&diagnostic);
        }
    }

    #[test]
    fn request_diagnostic_excludes_oauth_token_fragments() {
        let diagnostic = request_quota_diagnostic(SENTINEL_TOKEN, 7, Some(1.5));

        assert_excludes_token_fragments(&diagnostic);
    }

    #[test]
    fn parse_quota_window_requires_numeric_utilization() {
        assert!(parse_quota_window(&json!({ "resets_at": "2026-06-06T00:00:00Z" })).is_none());
        assert!(parse_quota_window(&json!({ "utilization": "0" })).is_none());
    }

    #[test]
    fn parse_quota_window_maps_numeric_utilization() {
        let parsed = parse_quota_window(&json!({
            "utilization": 42.5,
            "resets_at": "2026-06-06T00:00:00Z"
        }));
        let window = match parsed {
            Some(window) => window,
            None => panic!("numeric utilization should parse"),
        };

        assert_eq!(window.used, 42.5);
        assert_eq!(window.limit, 100.0);
        assert_eq!(window.percentage, 42.5);
        assert_eq!(window.reset_time.as_deref(), Some("2026-06-06T00:00:00Z"));
    }

    #[test]
    fn parse_first_quota_window_accepts_fable5_aliases() {
        for (index, key) in FABLE5_QUOTA_KEYS.iter().enumerate() {
            let utilization = 60.0 + index as f64;
            let mut data = serde_json::Map::new();
            data.insert(
                (*key).to_string(),
                json!({
                    "utilization": utilization,
                    "resets_at": "2026-07-09T00:00:00Z"
                }),
            );

            let parsed = parse_first_quota_window(&Value::Object(data), &FABLE5_QUOTA_KEYS);
            let window = match parsed {
                Some(window) => window,
                None => panic!("{key} should parse as Fable 5 usage"),
            };

            assert_eq!(window.percentage, utilization);
            assert_eq!(window.reset_time.as_deref(), Some("2026-07-09T00:00:00Z"));
        }
    }

    #[test]
    fn parse_weekly_scoped_model_quota_accepts_limits_array_fable() {
        let parsed = parse_weekly_scoped_model_quota(
            &json!({
                "limits": [
                    {
                        "group": "weekly",
                        "kind": "weekly_scoped",
                        "scope": {
                            "model": {
                                "display_name": "Fable"
                            }
                        },
                        "percent": 28,
                        "resets_at": "2026-07-09T00:00:00Z"
                    }
                ]
            }),
            "Fable",
        );
        let window = match parsed {
            Some(window) => window,
            None => panic!("Fable scoped weekly limit should parse"),
        };

        assert_eq!(window.percentage, 28.0);
        assert_eq!(window.reset_time.as_deref(), Some("2026-07-09T00:00:00Z"));
    }
}
