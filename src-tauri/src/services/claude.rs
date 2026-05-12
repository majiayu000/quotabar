use crate::domain::models::{QuotaData, UsageInfo};
use std::fs::OpenOptions;
use std::io::Write as IoWrite;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};
#[cfg(target_os = "macos")]
use std::process::Command;

const TOKEN_CACHE_TTL: Duration = Duration::from_secs(300);
const QUOTA_CACHE_TTL: Duration = Duration::from_secs(120);
const CLAUDE_TOKEN_ENV_KEY: &str = "CLAUDE_CODE_OAUTH_TOKEN";
const OAUTH_TOKEN_URL: &str = "https://platform.claude.com/v1/oauth/token";
const OAUTH_CLIENT_ID: &str = "9d1c250a-e61b-44d9-88ed-5944d1962f5e";
/// Token expiry buffer: refresh 30 minutes before actual expiry
const TOKEN_EXPIRY_BUFFER_MS: u64 = 30 * 60 * 1000;

const CREDENTIAL_NAMES: [&str; 4] = [
    "Claude Code-credentials",
    "claude-credentials",
    "Claude-credentials",
    "claudecode-credentials",
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
    refresh_token: Option<String>,
    cred_name: Option<String>,
    cached_at: Instant,
    expires_at_ms: Option<u64>,
}

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// Check if a token is expired based on its expiresAt field.
/// Returns true if expired or will expire within the buffer window.
fn is_token_expired(expires_at_ms: Option<u64>) -> bool {
    let Some(expires_at) = expires_at_ms else {
        return false;
    };
    now_ms() + TOKEN_EXPIRY_BUFFER_MS > expires_at
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

fn claude_http_client() -> &'static reqwest::Client {
    static CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
    CLIENT.get_or_init(reqwest::Client::new)
}

fn read_oauth_token_from_env() -> Option<String> {
    std::env::var(CLAUDE_TOKEN_ENV_KEY)
        .ok()
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty())
}

struct KeychainCredentials {
    access_token: String,
    refresh_token: Option<String>,
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
                            refresh_token: oauth["refreshToken"]
                                .as_str()
                                .map(ToString::to_string),
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

fn token_preview(token: &str) -> String {
    if token.len() > 12 {
        format!("{}...{}", &token[..6], &token[token.len() - 6..])
    } else {
        "***".to_string()
    }
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
                    // Check if token is expired based on expiresAt
                    if is_token_expired(creds.expires_at_ms) {
                        log_msg(&format!(
                            "[OAuth] cache hit but token expired (expiresAt={}), needs refresh",
                            creds.expires_at_ms.unwrap_or(0)
                        ));
                        // Fall through to re-read from keychain
                    } else {
                        log_msg(&format!(
                            "[OAuth] cache hit, token={}, age={:.0}s, ttl={:.0}s remaining",
                            token_preview(&creds.access_token),
                            elapsed.as_secs_f64(),
                            (TOKEN_CACHE_TTL - elapsed).as_secs_f64()
                        ));
                        return Ok(creds.access_token.clone());
                    }
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
        log_msg(&format!(
            "[OAuth] using env var token={}",
            token_preview(&token)
        ));
        if let Ok(mut guard) = credentials_cache().lock() {
            *guard = Some(CachedCredentials {
                access_token: token.clone(),
                refresh_token: None,
                cred_name: None,
                cached_at: Instant::now(),
                expires_at_ms: None,
            });
        }
        return Ok(token);
    }

    log_msg("[OAuth] reading from keychain...");
    let keychain = read_credentials_from_system()?;
    log_msg(&format!(
        "[OAuth] keychain read ok: cred_name={}, token={}, has_refresh={}, expires_at={:?}",
        keychain.cred_name,
        token_preview(&keychain.access_token),
        keychain.refresh_token.is_some(),
        keychain.expires_at_ms
    ));

    // Check if keychain token is already expired
    if is_token_expired(keychain.expires_at_ms) {
        log_msg("[OAuth] keychain token is expired, marking for proactive refresh");
    }

    if let Ok(mut guard) = credentials_cache().lock() {
        *guard = Some(CachedCredentials {
            access_token: keychain.access_token.clone(),
            refresh_token: keychain.refresh_token,
            cred_name: Some(keychain.cred_name),
            cached_at: Instant::now(),
            expires_at_ms: keychain.expires_at_ms,
        });
    }
    Ok(keychain.access_token)
}

async fn refresh_access_token() -> Result<String, String> {
    log_msg("[OAuth] refresh_access_token: starting token refresh...");
    let (refresh_token, cred_name) = {
        let guard = credentials_cache()
            .lock()
            .map_err(|e| format!("Cache lock error: {e}"))?;
        let creds = guard.as_ref().ok_or("No cached credentials")?;
        let rt = creds
            .refresh_token
            .clone()
            .ok_or("No refresh token available")?;
        log_msg(&format!(
            "[OAuth] refresh_access_token: refresh_token={}, cred_name={:?}",
            token_preview(&rt),
            creds.cred_name
        ));
        (rt, creds.cred_name.clone())
    };

    let response = claude_http_client()
        .post(OAUTH_TOKEN_URL)
        .form(&[
            ("grant_type", "refresh_token"),
            ("refresh_token", &refresh_token),
            ("client_id", OAUTH_CLIENT_ID),
        ])
        .timeout(Duration::from_secs(10))
        .send()
        .await
        .map_err(|e| {
            log_msg(&format!(
                "[OAuth] refresh_access_token: network error: {e}"
            ));
            format!("Refresh network error: {e}")
        })?;

    let status = response.status();
    log_msg(&format!(
        "[OAuth] refresh_access_token: response status={status}"
    ));

    if !status.is_success() {
        let body = response.text().await.unwrap_or_default();
        log_msg(&format!(
            "[OAuth] refresh_access_token: failed body={body}"
        ));
        return Err(format!("Refresh failed: HTTP {status}, body={body}"));
    }

    let data = response
        .json::<serde_json::Value>()
        .await
        .map_err(|e| format!("Refresh parse error: {e}"))?;

    let new_access = data["access_token"]
        .as_str()
        .ok_or("No access_token in refresh response")?
        .to_string();

    let new_refresh = data["refresh_token"].as_str().map(ToString::to_string);
    let new_expires_at = data["expires_at"]
        .as_u64()
        .or_else(|| {
            // If expires_in is provided (seconds), compute absolute expiry
            data["expires_in"]
                .as_u64()
                .map(|secs| now_ms() + secs * 1000)
        });

    log_msg(&format!(
        "[OAuth] refresh_access_token: new token={}, has_new_refresh={}, expires_at={:?}",
        token_preview(&new_access),
        new_refresh.is_some(),
        new_expires_at
    ));

    // Update keychain so the fresh token persists across restarts
    #[cfg(target_os = "macos")]
    if let Some(name) = &cred_name {
        log_msg(&format!(
            "[OAuth] refresh_access_token: updating keychain entry '{name}'"
        ));
        update_keychain(name, &new_access, new_refresh.as_deref(), new_expires_at);
    }

    if let Ok(mut guard) = credentials_cache().lock() {
        *guard = Some(CachedCredentials {
            access_token: new_access.clone(),
            refresh_token: new_refresh,
            cred_name,
            cached_at: Instant::now(),
            expires_at_ms: new_expires_at,
        });
    }

    log_msg("[OAuth] refresh_access_token: cache updated successfully");
    Ok(new_access)
}

#[cfg(target_os = "macos")]
fn update_keychain(
    cred_name: &str,
    access_token: &str,
    refresh_token: Option<&str>,
    expires_at_ms: Option<u64>,
) {
    let output = Command::new("security")
        .args(["find-generic-password", "-s", cred_name, "-w"])
        .output();

    let Ok(result) = output else { return };
    if !result.status.success() {
        return;
    }

    let raw = String::from_utf8_lossy(&result.stdout).trim().to_string();
    let Ok(mut creds) = serde_json::from_str::<serde_json::Value>(&raw) else {
        return;
    };

    let oauth = &mut creds["claudeAiOauth"];
    oauth["accessToken"] = serde_json::Value::String(access_token.to_string());
    if let Some(rt) = refresh_token {
        oauth["refreshToken"] = serde_json::Value::String(rt.to_string());
    }
    if let Some(exp) = expires_at_ms {
        oauth["expiresAt"] = serde_json::json!(exp);
    }

    let new_json = serde_json::to_string(&creds).unwrap_or_default();
    if new_json.is_empty() {
        return;
    }

    // Read the account name for the keychain entry
    let account = Command::new("security")
        .args(["find-generic-password", "-s", cred_name, "-g"])
        .output()
        .ok()
        .and_then(|out| {
            let stderr = String::from_utf8_lossy(&out.stderr);
            stderr
                .lines()
                .find(|l| l.contains("\"acct\""))
                .and_then(|l| l.split('"').nth(3))
                .map(ToString::to_string)
        })
        .unwrap_or_default();

    if let Err(e) = Command::new("security")
        .args([
            "add-generic-password",
            "-U",
            "-s",
            cred_name,
            "-a",
            &account,
            "-w",
            &new_json,
        ])
        .output()
    {
        log_msg(&format!(
            "[OAuth] update_keychain: failed to write keychain: {e}"
        ));
    }
}

async fn request_quota(access_token: &str) -> Result<reqwest::Response, String> {
    let (count, gap) = track_request();
    log_msg(&format!(
        "[API] request_quota: token={}, req_count={count}, gap={:.1}s",
        token_preview(access_token),
        gap.unwrap_or(0.0)
    ));

    let start = Instant::now();
    let response = claude_http_client()
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

    let utilization = value["utilization"].as_f64().unwrap_or(0.0);
    let resets_at = value["resets_at"].as_str().map(ToString::to_string);

    Some(UsageInfo {
        used: utilization,
        limit: 100.0,
        percentage: utilization,
        reset_time: resets_at,
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

/// Check if the cached token is expired and proactively refresh it.
/// Returns the new token if refresh succeeded, None otherwise.
async fn try_proactive_refresh() -> Option<String> {
    let needs_refresh = credentials_cache()
        .lock()
        .ok()
        .and_then(|guard| {
            guard
                .as_ref()
                .map(|c| is_token_expired(c.expires_at_ms) && c.refresh_token.is_some())
        })
        .unwrap_or(false);

    if !needs_refresh {
        return None;
    }

    log_msg("[OAuth] token expired, attempting proactive refresh before API call");
    match refresh_access_token().await {
        Ok(token) => {
            log_msg("[OAuth] proactive refresh succeeded");
            Some(token)
        }
        Err(e) => {
            log_msg(&format!("[OAuth] proactive refresh failed: {e}"));
            None
        }
    }
}

pub async fn fetch_quota() -> QuotaData {
    log_msg("[Quota] ---- fetch_quota start ----");

    // Return cached response if still fresh
    if let Some(cached) = get_cached_quota() {
        return cached;
    }

    let mut access_token = match get_oauth_token(false) {
        Ok(token) => token,
        Err(error) => {
            log_msg(&format!("[Quota] get_oauth_token failed: {error}"));
            return QuotaData::disconnected(error);
        }
    };

    // Proactively refresh if token is expired (based on expiresAt)
    if let Some(refreshed) = try_proactive_refresh().await {
        access_token = refreshed;
    }

    let mut response = match request_quota(&access_token).await {
        Ok(resp) => resp,
        Err(error) => {
            log_msg(&format!("[Quota] initial request failed: {error}"));
            return get_stale_cached_quota()
                .unwrap_or_else(|| QuotaData::disconnected(error));
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
        access_token = match get_oauth_token(true) {
            Ok(token) => token,
            Err(error) => {
                log_msg(&format!("[Quota] keychain re-read failed: {error}"));
                return QuotaData::disconnected(error);
            }
        };

        response = match request_quota(&access_token).await {
            Ok(resp) => resp,
            Err(error) => {
                log_msg(&format!(
                    "[Quota] retry with keychain token failed: {error}"
                ));
                return QuotaData::disconnected(error);
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

        // Keychain token also expired — try OAuth refresh
        if is_auth_error(status2) {
            log_msg(&format!(
                "[Quota] auth error ({status2}), step 2: attempting OAuth refresh"
            ));
            access_token = match refresh_access_token().await {
                Ok(token) => token,
                Err(err) => {
                    log_msg(&format!("[Quota] OAuth refresh failed: {err}"));
                    return QuotaData::disconnected(
                        "Token expired. Please re-login to Claude Code.",
                    );
                }
            };

            response = match request_quota(&access_token).await {
                Ok(resp) => resp,
                Err(error) => {
                    log_msg(&format!(
                        "[Quota] retry with refreshed token failed: {error}"
                    ));
                    return QuotaData::disconnected(error);
                }
            };

            let status3 = response.status();
            log_msg(&format!(
                "[Quota] refreshed token response: status={status3}"
            ));

            if !status3.is_success() {
                log_msg(&format!(
                    "[Quota] FAILED after all recovery attempts: {status3}"
                ));
                return QuotaData::disconnected(format!("API error: {status3}"));
            }
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
    log_msg(&format!(
        "[Quota] SUCCESS: five_hour={five_hour:?}%, seven_day={seven_day:?}%"
    ));

    let result = QuotaData::connected(
        parse_quota_window(&data["five_hour"]),
        parse_quota_window(&data["seven_day"]),
        parse_quota_window(&data["seven_day_opus"]),
        parse_quota_window(&data["seven_day_sonnet"]),
    );

    save_quota_cache(&result);
    result
}
