use crate::domain::models::{QuotaData, UsageInfo};
use crate::services::http::{is_transient_os_error, shared_http_client};
use std::fs::OpenOptions;
use std::io::Write as IoWrite;
use std::path::Path;
#[cfg(target_os = "macos")]
use std::process::Command;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

const TOKEN_CACHE_TTL: Duration = Duration::from_secs(300);
const QUOTA_CACHE_TTL: Duration = Duration::from_secs(120);
const MAX_STALE_QUOTA_AGE: Duration = Duration::from_secs(15 * 60);
const CLAUDE_TOKEN_ENV_KEY: &str = "CLAUDE_CODE_OAUTH_TOKEN";
const CLAUDE_AUTH_RELOGIN_MESSAGE: &str =
    "Claude OAuth token expired or invalid. Please re-login to Claude Code, then click Refresh.";
const MAX_LOG_BYTES: u64 = 2 * 1024 * 1024;

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

fn rotate_log_if_needed(path: &Path) {
    rotate_log_if_needed_with_limit(path, MAX_LOG_BYTES);
}

fn rotate_log_if_needed_with_limit(path: &Path, max_bytes: u64) {
    let Ok(metadata) = std::fs::metadata(path) else {
        return;
    };
    if metadata.len() <= max_bytes {
        return;
    }
    let rotated = path.with_extension("log.1");
    if let Err(error) = std::fs::rename(path, &rotated) {
        eprintln!("[log] failed to rotate log: {error}");
    }
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

    let log_path = log_dir.join("claude.log");
    rotate_log_if_needed(&log_path);

    match OpenOptions::new().create(true).append(true).open(&log_path) {
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

fn credential_expired(expires_at_ms: Option<u64>, now_ms: i64) -> bool {
    expires_at_ms.is_some_and(|expires| expires <= now_ms.max(0) as u64)
}

fn get_oauth_token(force_refresh: bool) -> Result<String, String> {
    log_msg(&format!(
        "[OAuth] get_oauth_token called, force_refresh={force_refresh}"
    ));

    if !force_refresh {
        if let Ok(guard) = credentials_cache().lock() {
            if let Some(creds) = guard.as_ref() {
                let elapsed = creds.cached_at.elapsed();
                if elapsed < TOKEN_CACHE_TTL
                    && !credential_expired(
                        creds.expires_at_ms,
                        chrono::Utc::now().timestamp_millis(),
                    )
                {
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
    if keychain.access_token.trim().is_empty()
        || credential_expired(
            keychain.expires_at_ms,
            chrono::Utc::now().timestamp_millis(),
        )
    {
        log_msg("[OAuth] local credential expired or empty; login required, no quota request");
        return Err(CLAUDE_AUTH_RELOGIN_MESSAGE.to_string());
    }
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

fn stale_quota_usable(connected: bool, age: Duration) -> bool {
    connected && age < MAX_STALE_QUOTA_AGE
}

fn get_stale_cached_quota() -> Option<QuotaData> {
    let guard = quota_cache().lock().ok()?;
    let cached = guard.as_ref()?;
    let age = cached.cached_at.elapsed();
    if stale_quota_usable(cached.data.connected, age) {
        log_msg(&format!(
            "[Quota] returning stale cache as fallback, age={:.0}s",
            age.as_secs_f64()
        ));
        Some(cached.data.clone())
    } else {
        if cached.data.connected {
            log_msg(&format!(
                "[Quota] stale cache too old to use as fallback, age={:.0}s",
                age.as_secs_f64()
            ));
        }
        None
    }
}

fn mark_quota_fetch_error(mut data: QuotaData, error: String) -> QuotaData {
    data.error = Some(error);
    data
}

fn stale_or_disconnected(error: String) -> QuotaData {
    if let Some(stale) = get_stale_cached_quota() {
        return mark_quota_fetch_error(stale, error);
    }
    QuotaData::disconnected(error)
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
        return stale_or_disconnected(error);
    }
    QuotaData::disconnected(error)
}

// All entry points share this deadline via the serialized Claude command. Persist
// only the retry time (no account or credential data) so reopening cannot bypass it.
fn cooldown_path() -> Result<std::path::PathBuf, String> {
    dirs::cache_dir()
        .map(|dir| dir.join("quotabar/claude-retry-at"))
        .ok_or_else(|| "Claude retry state: cache directory unavailable".to_string())
}

fn read_cooldown(path: &Path, now: i64) -> Result<Option<i64>, String> {
    let text = match std::fs::read_to_string(path) {
        Ok(text) => text,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(format!("Cannot read Claude retry state: {error}")),
    };
    let until: i64 = text
        .trim()
        .parse()
        .map_err(|error| format!("Invalid Claude retry state: {error}"))?;
    Ok((until > now).then_some(until))
}

fn save_cooldown(path: &Path, until: i64) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or("Claude retry state has no parent directory")?;
    std::fs::create_dir_all(parent)
        .map_err(|error| format!("Cannot create Claude retry directory: {error}"))?;
    let temporary = path.with_extension("tmp");
    std::fs::write(&temporary, until.to_string())
        .map_err(|error| format!("Cannot save Claude retry state: {error}"))?;
    std::fs::rename(&temporary, path)
        .map_err(|error| format!("Cannot persist Claude retry state: {error}"))
}

fn retry_deadline(header: Option<&str>, now: i64) -> i64 {
    let delay = header
        .and_then(|value| value.trim().parse::<i64>().ok())
        .filter(|seconds| *seconds >= 0);
    let deadline = delay
        .map(|seconds| now.saturating_add(seconds.saturating_mul(1000)))
        .or_else(|| {
            header
                .and_then(|value| chrono::DateTime::parse_from_rfc2822(value).ok())
                .map(|date| date.timestamp_millis())
        });
    // Missing/malformed Retry-After uses a five-minute local backoff. A past or
    // zero server deadline gets a small floor to prevent an immediate retry loop.
    deadline
        .unwrap_or(now.saturating_add(300_000))
        .max(now.saturating_add(1000))
}

fn cooldown_quota(until: i64) -> QuotaData {
    let mut data = stale_or_disconnected("API error: 429 Too Many Requests".to_string());
    data.retry_at = Some(until);
    data
}

fn rate_limited_quota(response: &reqwest::Response, path: &Path) -> QuotaData {
    let until = retry_deadline(
        response
            .headers()
            .get("retry-after")
            .and_then(|header| header.to_str().ok()),
        chrono::Utc::now().timestamp_millis(),
    );
    let mut data = cooldown_quota(until);
    if let Err(error) = save_cooldown(path, until) {
        log_msg(&error);
        data.error = Some(format!("API error: 429 Too Many Requests; {error}"));
    }
    data
}

// Failed reads stay stopped across App/Tray calls until an explicit recheck.
static LAST_QUOTA_FAILURE: OnceLock<Mutex<Option<QuotaData>>> = OnceLock::new();

pub async fn fetch_quota(manual: bool) -> QuotaData {
    let state = LAST_QUOTA_FAILURE.get_or_init(|| Mutex::new(None));
    if !manual {
        match state.lock() {
            Ok(guard) => {
                if let Some(failure) = guard.as_ref() {
                    return failure.clone();
                }
            }
            Err(error) => {
                return QuotaData::disconnected(format!("Claude read state unavailable: {error}"))
            }
        }
    }
    let data = fetch_quota_after_login_check(manual).await;
    match state.lock() {
        Ok(mut guard) => *guard = data.error.as_ref().map(|_| data.clone()),
        Err(error) => {
            return QuotaData::disconnected(format!("Claude read state unavailable: {error}"))
        }
    }
    data
}

async fn fetch_quota_after_login_check(manual: bool) -> QuotaData {
    // Local authentication comes first: an expired login should not be presented
    // as a quota limit left over from an earlier request.
    let access_token = match tauri::async_runtime::spawn_blocking(move || get_oauth_token(manual))
        .await
    {
        Ok(Ok(token)) => token,
        Ok(Err(error)) => return QuotaData::disconnected(error),
        Err(error) => return QuotaData::disconnected(format!("OAuth token task failed: {error}")),
    };
    let path = match cooldown_path() {
        Ok(path) => path,
        Err(error) => return QuotaData::disconnected(error),
    };
    fetch_quota_with_cooldown(&path, manual, &access_token).await
}

async fn fetch_quota_with_cooldown(path: &Path, manual: bool, access_token: &str) -> QuotaData {
    match read_cooldown(
        path,
        if manual {
            chrono::Utc::now().timestamp_millis()
        } else {
            i64::MIN
        },
    ) {
        Ok(Some(until)) => {
            log_msg(&format!(
                "[Quota] cooldown active until {until}; skipped network request"
            ));
            return cooldown_quota(until);
        }
        Ok(None) => {}
        Err(error) => return QuotaData::disconnected(error),
    }

    log_msg("[Quota] ---- fetch_quota start ----");

    // Return cached response if still fresh
    if !manual {
        if let Some(cached) = get_cached_quota() {
            return cached;
        }
    }

    let mut response = match request_quota(access_token).await {
        Ok(resp) => resp,
        Err(error) => {
            log_msg(&format!("[Quota] initial request failed: {error}"));
            return stale_or_disconnected(error);
        }
    };

    let status = response.status();
    log_msg(&format!("[Quota] initial response: status={status}"));

    if is_rate_limited(status) {
        return rate_limited_quota(&response, path);
    }

    if is_auth_error(status) {
        log_msg(&format!(
            "[Quota] auth error ({status}), step 1: force re-read from keychain"
        ));
        let fresh_access_token =
            match tauri::async_runtime::spawn_blocking(|| get_oauth_token(true)).await {
                Ok(Ok(token)) => token,
                Ok(Err(error)) => {
                    log_msg(&format!("[Quota] keychain re-read failed: {error}"));
                    return fallback_or_disconnected(error);
                }
                Err(error) => {
                    log_msg(&format!("[Quota] oauth token retry task failed: {error}"));
                    return fallback_or_disconnected(format!("OAuth token task failed: {error}"));
                }
            };

        if fresh_access_token == access_token {
            return QuotaData::disconnected(CLAUDE_AUTH_RELOGIN_MESSAGE);
        }
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
            return rate_limited_quota(&response, path);
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
        return stale_or_disconnected(format!("API error: {final_status}"));
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

    match std::fs::remove_file(path) {
        Ok(()) => {}
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => {
            return mark_quota_fetch_error(
                result,
                format!("Cannot clear Claude retry state: {error}"),
            )
        }
    }
    save_quota_cache(&result);
    result
}

#[cfg(test)]
mod tests {
    use super::{
        mark_quota_fetch_error, oauth_cache_hit_diagnostic, oauth_env_source_diagnostic,
        oauth_keychain_source_diagnostic, parse_first_quota_window, parse_quota_window,
        parse_weekly_scoped_model_quota, request_quota_diagnostic, stale_quota_usable,
        FABLE5_QUOTA_KEYS, MAX_STALE_QUOTA_AGE,
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
    fn local_expiry_requires_login_without_treating_unknown_expiry_as_expired() {
        assert!(super::credential_expired(Some(999), 1000));
        assert!(super::credential_expired(Some(1000), 1000));
        assert!(!super::credential_expired(Some(1001), 1000));
        assert!(!super::credential_expired(None, 1000));
    }

    #[test]
    fn respects_retry_after_seconds_dates_and_missing_header() {
        let now = 1_800_000_000_000;
        assert_eq!(super::retry_deadline(Some("3458"), now), now + 3_458_000);
        let date = chrono::DateTime::from_timestamp_millis(now + 3_458_000)
            .unwrap()
            .to_rfc2822();
        assert_eq!(super::retry_deadline(Some(&date), now), now + 3_458_000);
        assert_eq!(super::retry_deadline(None, now), now + 300_000);
        assert_eq!(super::retry_deadline(Some("broken"), now), now + 300_000);
        assert_eq!(super::retry_deadline(Some("0"), now), now + 1000);
    }

    #[test]
    fn persisted_cooldown_blocks_repeated_network_reads() {
        let dir = std::env::temp_dir().join(format!(
            "quotabar-retry-{}-{}",
            std::process::id(),
            chrono::Utc::now().timestamp_nanos_opt().unwrap()
        ));
        let path = dir.join("retry-at");
        let now = chrono::Utc::now().timestamp_millis();
        assert_eq!(super::read_cooldown(&path, now).unwrap(), None);
        super::save_cooldown(&path, now + 3_458_000).unwrap();
        // Both simulated App and Tray requests (and a fresh read after restart)
        // must stop before contacting Anthropic. No real credentials are used.
        for _ in 0..3 {
            let data = tauri::async_runtime::block_on(super::fetch_quota_with_cooldown(
                &path,
                false,
                "unused-test-token",
            ));
            assert_eq!(data.retry_at, Some(now + 3_458_000));
            assert!(data.error.unwrap().contains("429"));
        }
        assert_eq!(super::read_cooldown(&path, now + 3_458_000).unwrap(), None);
        super::save_cooldown(&path, now - 1000).unwrap();
        let stopped = tauri::async_runtime::block_on(super::fetch_quota_with_cooldown(
            &path,
            false,
            "unused-test-token",
        ));
        assert_eq!(stopped.retry_at, Some(now - 1000));
        assert!(stopped.error.unwrap().contains("429"));
        std::fs::write(&path, "invalid deadline").unwrap();
        let data = tauri::async_runtime::block_on(super::fetch_quota_with_cooldown(
            &path,
            false,
            "unused-test-token",
        ));
        assert!(data.error.unwrap().contains("Invalid Claude retry state"));
        std::fs::remove_dir_all(dir).unwrap();
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

    #[test]
    fn stale_quota_rejects_disconnected_and_expired_snapshots() {
        assert!(stale_quota_usable(true, Duration::from_secs(60)));
        assert!(!stale_quota_usable(false, Duration::from_secs(1)));
        assert!(!stale_quota_usable(true, MAX_STALE_QUOTA_AGE));
        assert!(stale_quota_usable(
            true,
            MAX_STALE_QUOTA_AGE - Duration::from_secs(1)
        ));
    }

    #[test]
    fn stale_quota_fallback_keeps_connected_data_and_sets_error() {
        let stale = mark_quota_fetch_error(
            crate::domain::models::QuotaData {
                connected: true,
                session: None,
                weekly_total: None,
                weekly_opus: None,
                weekly_sonnet: None,
                weekly_design: None,
                weekly_fable5: None,
                error: None,
                retry_at: None,
            },
            "Network error: connection reset".to_string(),
        );
        assert!(stale.connected);
        assert_eq!(
            stale.error.as_deref(),
            Some("Network error: connection reset")
        );
    }

    #[test]
    fn rotates_oversized_claude_logs() {
        use super::rotate_log_if_needed_with_limit;
        let dir = std::env::temp_dir().join(format!(
            "quotabar-claude-log-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("claude.log");
        std::fs::write(&path, vec![b'x'; 32]).unwrap();
        rotate_log_if_needed_with_limit(&path, 16);
        assert!(!path.exists());
        assert!(dir.join("claude.log.1").exists());
        let _ = std::fs::remove_dir_all(dir);
    }
}
