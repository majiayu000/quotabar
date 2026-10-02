//! Grok Build usage via the CLI billing proxy.
//!
//! Token resolution:
//!   1. `$GROK_HOME/auth.json` when `GROK_HOME` is set
//!   2. `~/.grok/auth.json`
//!
//! QuotaBar reads credentials; the official Grok CLI owns renewal and storage.
//! Tokens and CLI output are never logged.

use crate::domain::models::{GrokData, GrokExtraCredits, GrokProductUsage, GrokValueEstimate};
use crate::services::grok_local;
use crate::services::http::{is_transient_os_error, shared_http_client};
use chrono::{DateTime, Utc};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

const BILLING_URL: &str = "https://cli-chat-proxy.grok.com/v1/billing?format=credits";
const TOKEN_AUTH_HEADER: &str = "xai-grok-cli";
const QUOTA_CACHE_TTL: Duration = Duration::from_secs(120);
const MAX_STALE_GROK_AGE: Duration = Duration::from_secs(15 * 60);
const RENEWAL_RETRY_INTERVAL: Duration = Duration::from_secs(5 * 60);
const RENEWAL_TIMEOUT: Duration = Duration::from_secs(20);
struct RenewalState {
    last_attempt: Option<Instant>,
    running: Option<std::thread::JoinHandle<Result<(), String>>>,
}

static RENEWAL_STATE: Mutex<RenewalState> = Mutex::new(RenewalState {
    last_attempt: None,
    running: None,
});

struct CachedGrok {
    data: GrokData,
    cached_at: Instant,
    account_id: Option<String>,
}

static GROK_CACHE: OnceLock<Mutex<Option<CachedGrok>>> = OnceLock::new();
static LAST_GOOD: OnceLock<Mutex<Option<CachedGrok>>> = OnceLock::new();

fn grok_cache() -> &'static Mutex<Option<CachedGrok>> {
    GROK_CACHE.get_or_init(|| Mutex::new(None))
}

fn last_good() -> &'static Mutex<Option<CachedGrok>> {
    LAST_GOOD.get_or_init(|| Mutex::new(None))
}

fn grok_home() -> Option<PathBuf> {
    if let Ok(home) = std::env::var("GROK_HOME") {
        let trimmed = home.trim();
        if !trimmed.is_empty() {
            return Some(PathBuf::from(trimmed));
        }
    }
    dirs::home_dir().map(|home| home.join(".grok"))
}

struct GrokCredential {
    key: String,
    email: Option<String>,
    user_id: Option<String>,
}

fn parse_expiry(value: &serde_json::Value) -> Option<DateTime<Utc>> {
    value
        .as_str()
        .and_then(|raw| DateTime::parse_from_rfc3339(raw).ok())
        .map(|dt| dt.with_timezone(&Utc))
}

fn is_expired(expires_at: &serde_json::Value) -> bool {
    parse_expiry(expires_at)
        .map(|expires| expires <= Utc::now())
        .unwrap_or(false)
}

fn credential_from_object(
    value: &serde_json::Value,
) -> Option<(GrokCredential, Option<DateTime<Utc>>)> {
    let key = value
        .get("key")
        .and_then(serde_json::Value::as_str)
        .map(str::trim)
        .filter(|key| !key.is_empty())?
        .to_string();
    if is_expired(&value["expires_at"]) {
        return None;
    }
    Some((
        GrokCredential {
            key,
            email: value
                .get("email")
                .and_then(serde_json::Value::as_str)
                .map(str::trim)
                .filter(|email| !email.is_empty())
                .map(ToString::to_string),
            user_id: value
                .get("user_id")
                .and_then(serde_json::Value::as_str)
                .map(str::trim)
                .filter(|id| !id.is_empty())
                .map(ToString::to_string),
        },
        parse_expiry(&value["expires_at"]),
    ))
}

fn pick_credential(auth: &serde_json::Value) -> Result<GrokCredential, String> {
    let mut best: Option<(GrokCredential, Option<DateTime<Utc>>)> = None;
    let mut saw_entry = false;

    let mut consider = |value: &serde_json::Value| {
        if !value.is_object()
            || value
                .get("key")
                .and_then(serde_json::Value::as_str)
                .is_none()
        {
            return;
        }
        saw_entry = true;
        if let Some(candidate) = credential_from_object(value) {
            let replace = match &best {
                None => true,
                Some((_, current_expiry)) => match (current_expiry, &candidate.1) {
                    (None, Some(_)) => true,
                    (Some(current), Some(next)) => next > current,
                    _ => false,
                },
            };
            if replace {
                best = Some(candidate);
            }
        }
    };

    if let Some(obj) = auth.as_object() {
        consider(auth);
        for value in obj.values() {
            consider(value);
        }
    }

    if let Some((cred, _)) = best {
        return Ok(cred);
    }
    if saw_entry {
        return Err(
            "Grok session expired. Run 'grok login'; QuotaBar will check again automatically."
                .to_string(),
        );
    }
    Err("Grok Build not configured. Run 'grok login'.".to_string())
}

fn read_auth_json(auth_file: &Path) -> Result<serde_json::Value, String> {
    if !auth_file.exists() {
        return Err("Grok Build not configured. Run 'grok login'.".to_string());
    }
    let content = std::fs::read_to_string(auth_file)
        .map_err(|err| format!("Failed to read Grok auth: {err}"))?;
    serde_json::from_str(&content).map_err(|err| format!("Failed to parse Grok auth: {err}"))
}

fn read_credential_with_renewal(
    auth_file: &Path,
    renew: impl FnOnce() -> Result<(), String>,
) -> Result<GrokCredential, GrokData> {
    let auth = read_auth_json(auth_file).map_err(fallback_or_disconnected)?;
    let error = match pick_credential(&auth) {
        Ok(credential) => return Ok(credential),
        Err(error) => error,
    };
    let can_renew = |entry: &serde_json::Value| {
        entry["key"].as_str().is_some_and(|s| !s.trim().is_empty())
            && is_expired(&entry["expires_at"])
            && entry["refresh_token"]
                .as_str()
                .is_some_and(|s| !s.trim().is_empty())
    };
    let mut entries = std::iter::once(&auth)
        .chain(
            auth.as_object()
                .into_iter()
                .flat_map(|entries| entries.values()),
        )
        .filter(|entry| can_renew(entry));
    let Some(entry) = entries.next() else {
        return Err(fallback_or_disconnected(error));
    };
    let entry_account_id = |entry: &serde_json::Value| {
        grok_account_id(entry["user_id"].as_str(), entry["email"].as_str())
    };
    // Only retain quota when every renewable entry identifies the same account.
    let account_id = entry_account_id(entry)
        .filter(|id| entries.all(|entry| entry_account_id(entry).as_ref() == Some(id)));
    renew().map_err(|error| match account_id.as_deref() {
        Some(id) => last_good_snapshot_fallback(error, Some(id)),
        None => GrokData::disconnected(error),
    })?;
    // A successful command is not proof of renewal: only the saved credential is.
    let auth = read_auth_json(auth_file).map_err(fallback_or_disconnected)?;
    pick_credential(&auth).map_err(|_| {
        GrokData::disconnected(
            "Grok session renewal did not produce a valid credential. Open 'grok' to check sign-in.",
        )
    })
}

fn run_renewal_command(
    mut command: Command,
    state: &mut RenewalState,
    manual: bool,
    timeout: Duration,
) -> Result<(), String> {
    if state
        .running
        .as_ref()
        .is_some_and(|task| !task.is_finished())
    {
        return Err(
            "Grok session renewal is still running; waiting for the CLI to finish.".to_string(),
        );
    }
    let completed_error = match state.running.take() {
        Some(task) => task
            .join()
            .map_err(|_| "Grok session renewal task failed".to_string())?
            .err(),
        None => None,
    };
    if !manual
        && state
            .last_attempt
            .is_some_and(|last| last.elapsed() < RENEWAL_RETRY_INTERVAL)
    {
        return Err(completed_error.unwrap_or_else(|| {
            "Grok session renewal is waiting to retry. Open 'grok' or retry manually now."
                .to_string()
        }));
    }
    command
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000); // CREATE_NO_WINDOW
    }
    let started = Instant::now();
    state.running = Some(
        std::thread::Builder::new()
            .spawn(move || {
                let mut child = command.spawn().map_err(|error| {
                    format!("Grok session renewal could not start the Grok CLI: {error}")
                })?;
                // Always reap the CLI, even if the caller's deadline passes or credentials
                // become usable before the command exits. Never interrupt token storage.
                let status = child.wait().map_err(|error| {
                    format!("Grok session renewal could not wait for the CLI: {error}")
                })?;
                if status.success() {
                    Ok(())
                } else {
                    Err(format!(
                        "Grok session renewal failed ({status}). Open 'grok' to check sign-in."
                    ))
                }
            })
            .map_err(|error| format!("Grok session renewal could not start its task: {error}"))?,
    );
    state.last_attempt = Some(started);
    while state
        .running
        .as_ref()
        .is_some_and(|task| !task.is_finished())
    {
        if started.elapsed() >= timeout {
            return Err(
                "Grok session renewal timed out; waiting for the CLI to finish.".to_string(),
            );
        }
        std::thread::sleep(Duration::from_millis(50));
    }
    state
        .running
        .take()
        .ok_or_else(|| "Grok session renewal state is unavailable".to_string())?
        .join()
        .map_err(|_| "Grok session renewal task failed".to_string())?
}

fn renew_session(home: &Path, manual: bool) -> Result<(), String> {
    let mut state = RENEWAL_STATE
        .lock()
        .map_err(|_| "Grok session renewal state is unavailable".to_string())?;
    let executable = if cfg!(windows) { "grok.exe" } else { "grok" };
    let installed_cli = home.join("bin").join(executable);
    let mut command = Command::new(if installed_cli.is_file() {
        installed_cli
    } else {
        PathBuf::from(executable)
    });
    // `models` renews through Grok's auth manager without opening a conversation.
    // Keep its auth path aligned with the file we read, including custom GROK_HOME.
    command
        .arg("models")
        .current_dir(home)
        .env("GROK_HOME", home)
        .env("GROK_AUTH_PATH", home.join("auth.json"))
        .env_remove("GROK_AUTH");
    run_renewal_command(command, &mut state, manual, RENEWAL_TIMEOUT)
}

async fn read_credential(manual: bool) -> Result<GrokCredential, GrokData> {
    let home =
        grok_home().ok_or_else(|| GrokData::disconnected("Could not find home directory"))?;
    tauri::async_runtime::spawn_blocking(move || {
        read_credential_with_renewal(&home.join("auth.json"), || renew_session(&home, manual))
    })
    .await
    .map_err(|error| GrokData::disconnected(format!("Grok session renewal task failed: {error}")))?
}

fn parse_cent(value: &serde_json::Value) -> Option<i64> {
    if value.is_null() {
        return None;
    }
    value
        .get("val")
        .and_then(|val| val.as_i64().or_else(|| val.as_f64().map(|n| n as i64)))
        .or_else(|| value.as_i64())
}

fn clamp_percent(value: f64) -> f64 {
    value.clamp(0.0, 100.0)
}

fn parse_percent(value: &serde_json::Value) -> Option<f64> {
    value
        .as_f64()
        .or_else(|| value.as_i64().map(|n| n as f64))
        .map(clamp_percent)
}

fn normalize_product_key(raw: &str) -> String {
    raw.to_ascii_lowercase()
        .chars()
        .filter(|ch| ch.is_ascii_alphanumeric())
        .collect::<String>()
        .trim_start_matches("product")
        .trim_start_matches("grok")
        .to_string()
}

fn map_product(raw: &str) -> (String, String) {
    match normalize_product_key(raw).as_str() {
        "build" => ("build".to_string(), "Build".to_string()),
        "chat" => ("chat".to_string(), "Chat".to_string()),
        "imagine" | "image" => ("imagine".to_string(), "Imagine".to_string()),
        "voice" => ("voice".to_string(), "Voice".to_string()),
        "api" => ("api".to_string(), "API".to_string()),
        "other" => ("other".to_string(), "Other".to_string()),
        _ => {
            let label = raw
                .rsplit([':', '/', '_'])
                .next()
                .unwrap_or(raw)
                .trim()
                .to_string();
            let id = normalize_product_key(&label);
            (
                id,
                if label.is_empty() {
                    "Other".to_string()
                } else {
                    label
                },
            )
        }
    }
}

fn parse_products(value: &serde_json::Value) -> Vec<GrokProductUsage> {
    let Some(items) = value.as_array() else {
        return Vec::new();
    };
    items
        .iter()
        .filter_map(|item| {
            let raw = item.get("product").and_then(serde_json::Value::as_str)?;
            let usage_percent = parse_percent(&item["usagePercent"])?;
            let (product, label) = map_product(raw);
            Some(GrokProductUsage {
                product,
                label,
                usage_percent: Some(usage_percent),
            })
        })
        .collect()
}

fn product_usage_percents_complete(value: &serde_json::Value) -> bool {
    value.as_array().is_some_and(|items| {
        items
            .iter()
            .all(|item| parse_percent(&item["usagePercent"]).is_some())
    })
}

fn scale_used_pct(pool_pct: Option<f64>, products: &[GrokProductUsage]) -> Result<f64, String> {
    let build = products
        .iter()
        .find(|product| product.product == "build")
        .and_then(|product| product.usage_percent)
        .filter(|pct| pct.is_finite() && *pct > 0.0);
    if let Some(pct) = build {
        return Ok(pct);
    }
    pool_pct
        .filter(|pct| pct.is_finite() && *pct > 0.0)
        .ok_or_else(|| "The official Grok pool usage is unavailable.".to_string())
}

fn scale_product_id(products: &[GrokProductUsage]) -> Option<String> {
    products
        .iter()
        .find(|product| product.product == "build")
        .and_then(|product| product.usage_percent)
        .filter(|pct| pct.is_finite() && *pct > 0.0)
        .map(|_| "build".to_string())
}

fn period_from_config(
    config: &serde_json::Value,
) -> (
    Option<String>,
    Option<String>,
    Option<String>,
    Option<String>,
) {
    let period = &config["currentPeriod"];
    let raw_type = period
        .get("type")
        .and_then(serde_json::Value::as_str)
        .map(str::to_string);
    let (period_type, period_label) = match raw_type.as_deref() {
        Some(value) if value.contains("WEEKLY") => {
            (Some("weekly".to_string()), Some("Weekly".to_string()))
        }
        Some(value) if value.contains("MONTHLY") => {
            (Some("monthly".to_string()), Some("Monthly".to_string()))
        }
        Some(_) => (
            Some("current".to_string()),
            Some("Current period".to_string()),
        ),
        None => (None, None),
    };
    let started_at = period
        .get("start")
        .and_then(serde_json::Value::as_str)
        .map(ToString::to_string);
    let reset_at = period
        .get("end")
        .and_then(serde_json::Value::as_str)
        .or_else(|| config["billingPeriodEnd"].as_str())
        .map(ToString::to_string);
    (period_type, period_label, started_at, reset_at)
}

fn parse_rfc3339(value: &str) -> Option<DateTime<Utc>> {
    DateTime::parse_from_rfc3339(value)
        .ok()
        .map(|dt| dt.with_timezone(&Utc))
}

fn scale_observed_usage(
    observed_cost_usd: f64,
    observed_tokens: i64,
    used_pct: f64,
) -> Result<(f64, f64), String> {
    if !used_pct.is_finite() || used_pct <= 0.0 {
        return Err(
            "cannot estimate Grok pool value while the provider-reported used percentage is zero"
                .to_string(),
        );
    }
    if !observed_cost_usd.is_finite() || observed_cost_usd <= 0.0 {
        return Err(
            "no positive API-equivalent cost was available for the active Grok period".to_string(),
        );
    }
    if observed_tokens <= 0 {
        return Err("no Grok token usage matched the active billing period".to_string());
    }
    let scale = 100.0 / used_pct;
    let period_usd = observed_cost_usd * scale;
    let period_tokens = observed_tokens as f64 * scale;
    if !period_usd.is_finite() || !period_tokens.is_finite() {
        return Err("the Grok pool value calculation produced a non-finite result".to_string());
    }
    Ok((period_usd, period_tokens))
}

fn estimate_grok_period_value(
    used_pct: Option<f64>,
    products: Vec<GrokProductUsage>,
    started_at: Option<&str>,
    reset_at: Option<&str>,
) -> Result<GrokValueEstimate, String> {
    let display_pct =
        used_pct.ok_or_else(|| "The official Grok pool usage is unavailable.".to_string())?;
    let scale_pct = scale_used_pct(used_pct, &products)?;
    let scale_product = scale_product_id(&products);
    let started = started_at
        .and_then(parse_rfc3339)
        .ok_or_else(|| "The official Grok period start is unavailable.".to_string())?;
    let resets = reset_at
        .and_then(parse_rfc3339)
        .ok_or_else(|| "The official Grok period reset is unavailable.".to_string())?;
    let now = Utc::now();
    let observed_at = if now < resets { now } else { resets };
    if started > observed_at {
        return Err("The official Grok period window is invalid.".to_string());
    }
    let usage = grok_local::sum_period(started, observed_at)?;
    let (period_usd, period_tokens) =
        scale_observed_usage(usage.observed_cost_usd, usage.observed_tokens, scale_pct)?;
    Ok(GrokValueEstimate {
        observed_at: observed_at.to_rfc3339(),
        window_started_at: started.to_rfc3339(),
        resets_at: resets.to_rfc3339(),
        used_pct: display_pct,
        scale_used_pct: scale_pct,
        scale_product,
        observed_cost_usd: usage.observed_cost_usd,
        estimated_period_value_usd: period_usd,
        observed_tokens: usage.observed_tokens,
        estimated_period_tokens: period_tokens,
        coverage_percent: usage.coverage_percent,
        cost_is_lower_bound: usage.cost_is_lower_bound,
    })
}

fn parse_billing_payload(data: &serde_json::Value, email: Option<String>) -> GrokData {
    let config = if data.get("config").is_some() {
        &data["config"]
    } else {
        data
    };

    let products = parse_products(&config["productUsage"]);
    let percentage = parse_percent(&config["creditUsagePercent"]).or_else(|| {
        if products.is_empty() || !product_usage_percents_complete(&config["productUsage"]) {
            None
        } else {
            Some(clamp_percent(
                products
                    .iter()
                    .filter_map(|product| product.usage_percent)
                    .sum(),
            ))
        }
    });
    let (period_type, period_label, period_started_at, reset_at) = period_from_config(config);
    let extra = match (
        parse_cent(&config["onDemandUsed"]),
        parse_cent(&config["onDemandCap"]),
        parse_cent(&config["prepaidBalance"]),
    ) {
        (Some(used), Some(cap), Some(prepaid)) if used != 0 || cap != 0 || prepaid != 0 => {
            Some(GrokExtraCredits {
                on_demand_used_cents: used,
                on_demand_cap_cents: cap,
                prepaid_balance_cents: prepaid,
            })
        }
        _ => None,
    };

    let plan_type = data
        .get("subscriptionTier")
        .and_then(serde_json::Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string);

    if percentage.is_none() && products.is_empty() && reset_at.is_none() {
        return GrokData::disconnected("Grok billing returned no usage fields.");
    }

    GrokData {
        connected: true,
        plan_type,
        email,
        percentage,
        reset_at,
        period_started_at,
        period_type,
        period_label,
        products,
        extra,
        value_estimate: None,
        value_estimate_error: None,
        error: None,
    }
}

fn should_read_grok_cache(manual: bool) -> bool {
    !manual
}

fn get_cached(manual: bool) -> Option<GrokData> {
    if !should_read_grok_cache(manual) {
        return None;
    }
    let guard = grok_cache().lock().ok()?;
    let cached = guard.as_ref()?;
    if cached.cached_at.elapsed() < QUOTA_CACHE_TTL {
        Some(cached.data.clone())
    } else {
        None
    }
}

fn grok_account_id(user_id: Option<&str>, email: Option<&str>) -> Option<String> {
    user_id
        .map(str::trim)
        .filter(|id| !id.is_empty())
        .map(|id| format!("user_id:{id}"))
        .or_else(|| {
            email
                .map(str::trim)
                .filter(|email| !email.is_empty())
                .map(|email| format!("email:{}", email.to_ascii_lowercase()))
        })
}

fn save_cache(data: &GrokData, credential: &GrokCredential) {
    let account_id = grok_account_id(credential.user_id.as_deref(), credential.email.as_deref());
    if let Ok(mut guard) = grok_cache().lock() {
        *guard = Some(CachedGrok {
            data: data.clone(),
            cached_at: Instant::now(),
            account_id: account_id.clone(),
        });
    }
    if data.connected && data.error.is_none() {
        if let Ok(mut guard) = last_good().lock() {
            *guard = Some(CachedGrok {
                data: data.clone(),
                cached_at: Instant::now(),
                account_id,
            });
        }
    }
}

fn mark_grok_data_stale(mut data: GrokData, error: String) -> GrokData {
    data.error = Some(error);
    data
}

fn stale_grok_usable(connected: bool, age: Duration) -> bool {
    connected && age < MAX_STALE_GROK_AGE
}

fn last_good_or_disconnected(
    error: String,
    snapshot: Option<&GrokData>,
    age: Duration,
) -> GrokData {
    match snapshot {
        Some(data) if stale_grok_usable(data.connected, age) => {
            mark_grok_data_stale(data.clone(), error)
        }
        _ => GrokData::disconnected(error),
    }
}

fn last_good_snapshot_fallback(error: String, account_id: Option<&str>) -> GrokData {
    let (snapshot, age) = match last_good().lock() {
        Ok(guard) => match guard.as_ref() {
            Some(cached) if account_id.is_none() || account_id == cached.account_id.as_deref() => {
                (Some(cached.data.clone()), cached.cached_at.elapsed())
            }
            _ => (None, Duration::ZERO),
        },
        Err(_) => (None, Duration::ZERO),
    };
    last_good_or_disconnected(error, snapshot.as_ref(), age)
}

fn fallback_or_disconnected(error: impl Into<String>) -> GrokData {
    let error = error.into();
    if is_transient_os_error(&error) {
        return last_good_snapshot_fallback(error, None);
    }
    GrokData::disconnected(error)
}

fn is_grok_auth_status(status: reqwest::StatusCode) -> bool {
    status.as_u16() == 401 || status.as_u16() == 403
}

pub async fn fetch_grok_info(manual: bool) -> GrokData {
    let credential = match read_credential(manual).await {
        Ok(value) => value,
        Err(data) => return data,
    };

    // Check local expiry on every poll, even while a quota snapshot is cached.
    if let Some(cached) = get_cached(manual) {
        return cached;
    }

    let mut request = shared_http_client()
        .get(BILLING_URL)
        .header("Authorization", format!("Bearer {}", credential.key))
        .header("x-xai-token-auth", TOKEN_AUTH_HEADER)
        .header("Accept", "application/json")
        .header("User-Agent", "QuotaBar/0.3 (Grok monitor)")
        .timeout(Duration::from_secs(10));
    if let Some(user_id) = credential.user_id.as_deref() {
        request = request.header("x-userid", user_id);
    }

    let response = match request.send().await {
        Ok(resp) => resp,
        Err(err) => return fallback_or_disconnected(format!("Network error: {err}")),
    };

    let status = response.status();
    if !status.is_success() {
        if is_grok_auth_status(status) {
            return GrokData::disconnected(
                "Grok authentication failed (401/403). Run 'grok login'; QuotaBar will check again automatically.",
            );
        }
        return last_good_snapshot_fallback(format!("Grok billing API error: {status}"), None);
    }

    let data = match response.json::<serde_json::Value>().await {
        Ok(value) => value,
        Err(err) => {
            return GrokData::disconnected(format!("Failed to parse Grok billing response: {err}"))
        }
    };

    let mut result = parse_billing_payload(&data, credential.email.clone());
    if result.connected {
        let used_pct = result.percentage;
        let started_at = result.period_started_at.clone();
        let reset_at = result.reset_at.clone();
        let products = result.products.clone();
        match tauri::async_runtime::spawn_blocking(move || {
            estimate_grok_period_value(
                used_pct,
                products,
                started_at.as_deref(),
                reset_at.as_deref(),
            )
        })
        .await
        {
            Ok(Ok(estimate)) => result.value_estimate = Some(estimate),
            Ok(Err(error)) => result.value_estimate_error = Some(error),
            Err(error) => {
                result.value_estimate_error = Some(format!("Grok pool value task failed: {error}"));
            }
        }
        save_cache(&result, &credential);
    }
    result
}

#[cfg(test)]
mod tests {
    use super::{
        is_grok_auth_status, last_good_or_disconnected, map_product, mark_grok_data_stale,
        parse_billing_payload, pick_credential, scale_product_id, scale_used_pct,
        should_read_grok_cache, stale_grok_usable, MAX_STALE_GROK_AGE,
    };
    use crate::domain::models::{GrokData, GrokProductUsage};
    use chrono::Utc;
    use serde_json::json;
    use std::time::Duration;

    static LAST_GOOD_TEST_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

    fn grok_from_http_status(
        status: reqwest::StatusCode,
        snapshot: Option<&GrokData>,
        age: Duration,
    ) -> GrokData {
        if is_grok_auth_status(status) {
            return GrokData::disconnected(
                "Grok authentication failed (401/403). Run 'grok login'; QuotaBar will check again automatically.",
            );
        }
        last_good_or_disconnected(format!("Grok billing API error: {status}"), snapshot, age)
    }

    fn sample_connected_grok() -> GrokData {
        GrokData {
            connected: true,
            plan_type: Some("SuperGrok".into()),
            email: None,
            percentage: Some(4.0),
            reset_at: None,
            period_started_at: None,
            period_type: Some("weekly".into()),
            period_label: Some("Weekly".into()),
            products: Vec::new(),
            extra: None,
            value_estimate: None,
            value_estimate_error: None,
            error: None,
        }
    }

    #[test]
    fn maps_live_and_proto_product_names() {
        assert_eq!(
            map_product("GrokBuild"),
            ("build".to_string(), "Build".to_string())
        );
        assert_eq!(
            map_product("PRODUCT_GROK_BUILD"),
            ("build".to_string(), "Build".to_string())
        );
        assert_eq!(
            map_product("GrokChat"),
            ("chat".to_string(), "Chat".to_string())
        );
        assert_eq!(map_product("API"), ("api".to_string(), "API".to_string()));
    }

    #[test]
    fn parses_live_credits_shape() {
        let payload = json!({
            "config": {
                "currentPeriod": {
                    "type": "USAGE_PERIOD_TYPE_WEEKLY",
                    "start": "2026-08-23T15:25:10.879112+00:00",
                    "end": "2026-08-30T15:25:10.879112+00:00"
                },
                "creditUsagePercent": 4.0,
                "onDemandCap": {"val": 0},
                "onDemandUsed": {"val": 0},
                "productUsage": [
                    {"product": "GrokBuild", "usagePercent": 4.0},
                    {"product": "GrokChat"}
                ],
                "isUnifiedBillingUser": true,
                "prepaidBalance": {"val": 0}
            },
            "subscriptionTier": "SuperGrok Heavy"
        });
        let data = parse_billing_payload(&payload, Some("user@example.com".into()));
        assert!(data.connected);
        assert_eq!(data.percentage, Some(4.0));
        assert_eq!(data.period_label.as_deref(), Some("Weekly"));
        assert_eq!(
            data.reset_at.as_deref(),
            Some("2026-08-30T15:25:10.879112+00:00")
        );
        assert_eq!(data.plan_type.as_deref(), Some("SuperGrok Heavy"));
        assert_eq!(data.email.as_deref(), Some("user@example.com"));
        assert_eq!(
            data.period_started_at.as_deref(),
            Some("2026-08-23T15:25:10.879112+00:00")
        );
        assert_eq!(data.products.len(), 1);
        assert_eq!(data.products[0].label, "Build");
        assert_eq!(data.products[0].usage_percent, Some(4.0));
        assert!(data.products.iter().all(|product| product.label != "Chat"));
        assert!(data.extra.is_none());
    }

    #[test]
    fn omitted_percent_falls_back_to_product_sum() {
        let payload = json!({
            "config": {
                "currentPeriod": {
                    "type": "USAGE_PERIOD_TYPE_MONTHLY",
                    "end": "2026-09-01T00:00:00Z"
                },
                "productUsage": [
                    {"product": "PRODUCT_GROK_BUILD", "usagePercent": 12.5},
                    {"product": "PRODUCT_GROK_CHAT", "usagePercent": 7.5}
                ]
            }
        });
        let data = parse_billing_payload(&payload, None);
        assert_eq!(data.percentage, Some(20.0));
        assert_eq!(data.period_label.as_deref(), Some("Monthly"));
    }

    #[test]
    fn omitted_percent_does_not_sum_missing_product_fields() {
        let payload = json!({
            "config": {
                "currentPeriod": {
                    "type": "USAGE_PERIOD_TYPE_MONTHLY",
                    "end": "2026-09-01T00:00:00Z"
                },
                "productUsage": [
                    {"product": "PRODUCT_GROK_BUILD", "usagePercent": 12.5},
                    {"product": "PRODUCT_GROK_CHAT"}
                ]
            }
        });
        let data = parse_billing_payload(&payload, None);
        assert_eq!(data.percentage, None);
        assert_eq!(data.products.len(), 1);
        assert_eq!(data.products[0].label, "Build");
        assert_eq!(data.products[0].usage_percent, Some(12.5));
        assert!(data.products.iter().all(|product| product.label != "Chat"));
    }

    #[test]
    fn reported_zero_product_percent_is_kept() {
        let payload = json!({
            "config": {
                "creditUsagePercent": 4.0,
                "productUsage": [
                    {"product": "GrokBuild", "usagePercent": 4.0},
                    {"product": "GrokChat", "usagePercent": 0.0}
                ]
            }
        });
        let data = parse_billing_payload(&payload, None);
        assert_eq!(data.products.len(), 2);
        assert_eq!(data.products[1].label, "Chat");
        assert_eq!(data.products[1].usage_percent, Some(0.0));
    }

    #[test]
    fn extra_credits_surface_when_nonzero() {
        let payload = json!({
            "config": {
                "creditUsagePercent": 100.0,
                "currentPeriod": {"type": "USAGE_PERIOD_TYPE_WEEKLY", "end": "2026-09-01T00:00:00Z"},
                "onDemandCap": {"val": 5000},
                "onDemandUsed": {"val": 300},
                "prepaidBalance": {"val": 1250}
            }
        });
        let extra = parse_billing_payload(&payload, None)
            .extra
            .expect("extra credits");
        assert_eq!(extra.on_demand_cap_cents, 5000);
        assert_eq!(extra.on_demand_used_cents, 300);
        assert_eq!(extra.prepaid_balance_cents, 1250);
    }

    #[test]
    fn extra_credits_hide_when_used_cents_are_missing() {
        let payload = json!({
            "config": {
                "creditUsagePercent": 4.0,
                "currentPeriod": {"type": "USAGE_PERIOD_TYPE_WEEKLY", "end": "2026-09-01T00:00:00Z"},
                "onDemandCap": {"val": 5000},
                "prepaidBalance": {"val": 0}
            }
        });
        assert!(parse_billing_payload(&payload, None).extra.is_none());
    }

    #[test]
    fn extra_credits_hide_when_cents_are_malformed() {
        let payload = json!({
            "config": {
                "creditUsagePercent": 4.0,
                "currentPeriod": {"type": "USAGE_PERIOD_TYPE_WEEKLY", "end": "2026-09-01T00:00:00Z"},
                "onDemandCap": {"val": 5000},
                "onDemandUsed": {"val": "unknown"},
                "prepaidBalance": {"val": 0}
            }
        });
        assert!(parse_billing_payload(&payload, None).extra.is_none());
    }

    #[test]
    fn missing_usage_fields_disconnect() {
        let data = parse_billing_payload(&json!({"config": {}}), None);
        assert!(!data.connected);
        assert!(data.error.unwrap().contains("no usage fields"));
    }

    #[test]
    fn pick_credential_skips_expired_entries() {
        let auth = json!({
            "https://auth.x.ai::old": {
                "key": "expired-token-value-must-be-long-enough",
                "expires_at": "2020-01-01T00:00:00Z",
                "email": "old@example.com"
            },
            "https://auth.x.ai::live": {
                "key": "live-token-value-must-be-long-enough",
                "expires_at": "2099-01-01T00:00:00Z",
                "email": "live@example.com",
                "user_id": "user-1"
            }
        });
        let cred = pick_credential(&auth).expect("live credential");
        assert_eq!(cred.email.as_deref(), Some("live@example.com"));
        assert_eq!(cred.user_id.as_deref(), Some("user-1"));
        assert!(cred.key.starts_with("live-token"));
    }

    #[test]
    fn scale_used_pct_prefers_build_share() {
        let products = vec![
            GrokProductUsage {
                product: "build".to_string(),
                label: "Build".to_string(),
                usage_percent: Some(4.0),
            },
            GrokProductUsage {
                product: "chat".to_string(),
                label: "Chat".to_string(),
                usage_percent: Some(21.0),
            },
        ];
        assert_eq!(scale_used_pct(Some(25.0), &products).unwrap(), 4.0);
        assert_eq!(scale_used_pct(Some(25.0), &[]).unwrap(), 25.0);
        assert_eq!(scale_product_id(&products).as_deref(), Some("build"));
        assert_eq!(scale_product_id(&[]), None);
    }

    #[test]
    fn scale_observed_usage_projects_from_official_used_percent() {
        let (usd, tokens) = super::scale_observed_usage(8.0, 2_000, 4.0).expect("scaled");
        assert_eq!(usd, 200.0);
        assert_eq!(tokens, 50_000.0);
    }

    #[test]
    fn scale_observed_usage_rejects_zero_used_percent() {
        let error = super::scale_observed_usage(8.0, 2_000, 0.0).expect_err("zero usage");
        assert!(error.contains("used percentage is zero"));
    }

    #[test]
    fn estimate_requires_period_start() {
        let error = super::estimate_grok_period_value(
            Some(4.0),
            Vec::new(),
            None,
            Some("2026-08-30T15:25:10Z"),
        )
        .expect_err("missing start");
        assert!(error.contains("period start"));
    }

    #[test]
    fn pick_credential_rejects_only_expired() {
        let auth = json!({
            "entry": {
                "key": "expired-token-value-must-be-long-enough",
                "expires_at": "2020-01-01T00:00:00Z"
            }
        });
        let err = match pick_credential(&auth) {
            Err(message) => message,
            Ok(_) => panic!("expected expired credential error"),
        };
        assert!(err.contains("expired"));
        assert!(!err.contains("expired-token"));
    }

    #[test]
    fn renewal_rereads_credentials_and_preserves_failures() {
        let directory = std::env::temp_dir().join(format!(
            "quotabar-grok-renewal-{}-{}",
            std::process::id(),
            Utc::now().timestamp_nanos_opt().unwrap()
        ));
        std::fs::create_dir(&directory).unwrap();
        let path = directory.join("auth.json");
        let expired = json!({"entry": {
            "key": "test-expired-key",
            "refresh_token": "test-refresh-token",
            "expires_at": "2020-01-01T00:00:00Z"
        }});
        let live = json!({"entry": {
            "key": "test-renewed-key",
            "expires_at": "2099-01-01T00:00:00Z"
        }});
        std::fs::write(&path, expired.to_string()).unwrap();
        let credential = super::read_credential_with_renewal(&path, || {
            std::fs::write(&path, live.to_string()).unwrap();
            Ok(())
        })
        .unwrap_or_else(|data| panic!("{:?}", data.error));
        assert_eq!(credential.key, "test-renewed-key");

        assert!(super::read_credential_with_renewal(&path, || {
            panic!("valid credentials must not launch the CLI")
        })
        .is_ok());

        std::fs::write(&path, expired.to_string()).unwrap();
        let failed = super::read_credential_with_renewal(&path, || {
            Err("Grok session renewal timed out".to_string())
        });
        assert_eq!(
            failed.err().unwrap().error.as_deref(),
            Some("Grok session renewal timed out")
        );
        let unchanged = super::read_credential_with_renewal(&path, || Ok(()));
        assert!(unchanged
            .err()
            .unwrap()
            .error
            .unwrap()
            .contains("did not produce a valid credential"));

        let mut no_refresh = expired;
        no_refresh["entry"]
            .as_object_mut()
            .unwrap()
            .remove("refresh_token");
        std::fs::write(&path, no_refresh.to_string()).unwrap();
        assert!(super::read_credential_with_renewal(&path, || {
            panic!("credentials without a refresh token must not launch the CLI")
        })
        .err()
        .unwrap()
        .error
        .unwrap()
        .contains("session expired"));

        std::fs::write(&path, "{").unwrap();
        assert!(super::read_credential_with_renewal(&path, || {
            panic!("malformed credentials must not launch the CLI")
        })
        .err()
        .unwrap()
        .error
        .unwrap()
        .contains("Failed to parse Grok auth"));

        std::fs::remove_file(&path).unwrap();
        assert!(super::read_credential_with_renewal(&path, || {
            panic!("missing credentials must not launch the CLI")
        })
        .err()
        .unwrap()
        .error
        .unwrap()
        .contains("not configured"));
        std::fs::remove_dir(directory).unwrap();
    }

    #[test]
    #[cfg(unix)]
    fn renewal_command_handles_success_failure_timeout_and_missing_cli() {
        let mut success = std::process::Command::new("sh");
        success.args(["-c", "exit 0"]);
        assert!(super::run_renewal_command(
            success,
            &mut renewal_state(),
            true,
            Duration::from_secs(1)
        )
        .is_ok());

        let mut failure = std::process::Command::new("sh");
        failure.args(["-c", "echo test-secret >&2; exit 42"]);
        let error =
            super::run_renewal_command(failure, &mut renewal_state(), true, Duration::from_secs(1))
                .unwrap_err();
        assert!(error.contains("42"));
        assert!(!error.contains("test-secret"));

        let mut hung = std::process::Command::new("sh");
        hung.args(["-c", "exec sleep 0.3"]);
        let started = std::time::Instant::now();
        let error =
            super::run_renewal_command(hung, &mut renewal_state(), true, Duration::from_millis(20))
                .unwrap_err();
        assert!(error.contains("timed out"));
        assert!(started.elapsed() < Duration::from_secs(2));

        let missing = std::process::Command::new("/nonexistent/quotabar-test-grok");
        let error =
            super::run_renewal_command(missing, &mut renewal_state(), true, Duration::from_secs(1))
                .unwrap_err();
        assert!(error.contains("could not start"));
    }

    fn renewal_state() -> super::RenewalState {
        super::RenewalState {
            last_attempt: None,
            running: None,
        }
    }

    #[test]
    #[ignore = "subprocess fixture for the renewal deadline regression"]
    fn renewal_command_fixture() {
        let directory =
            std::path::PathBuf::from(std::env::var("QUOTABAR_RENEWAL_FIXTURE").unwrap());
        std::fs::write(directory.join("started"), "started").unwrap();
        let started = std::time::Instant::now();
        while !directory.join("finish").exists() && started.elapsed() < Duration::from_secs(5) {
            std::thread::sleep(Duration::from_millis(10));
        }
        assert!(
            directory.join("finish").exists(),
            "fixture must be released by the parent"
        );
        std::fs::write(
            directory.join("auth.json"),
            json!({"entry": {
                "key": "synthetic-renewed-key",
                "expires_at": "2099-01-01T00:00:00Z"
            }})
            .to_string(),
        )
        .unwrap();
    }

    #[test]
    fn renewal_deadline_allows_cli_to_finish_credential_write() {
        let directory = std::env::temp_dir().join(format!(
            "quotabar-grok-deadline-{}-{}",
            std::process::id(),
            Utc::now().timestamp_nanos_opt().unwrap()
        ));
        std::fs::create_dir(&directory).unwrap();
        let mut command = std::process::Command::new(std::env::current_exe().unwrap());
        command
            .args([
                "--exact",
                "services::grok::tests::renewal_command_fixture",
                "--ignored",
            ])
            .env("QUOTABAR_RENEWAL_FIXTURE", &directory);
        let started = std::time::Instant::now();
        let mut state = renewal_state();
        let error =
            super::run_renewal_command(command, &mut state, false, Duration::from_millis(100))
                .unwrap_err();
        for manual in [false, true] {
            let duplicate = std::process::Command::new("/nonexistent/quotabar-test-grok");
            assert!(super::run_renewal_command(
                duplicate,
                &mut state,
                manual,
                Duration::from_millis(100)
            )
            .unwrap_err()
            .contains("still running"));
        }
        assert!(error.contains("timed out"));
        assert!(started.elapsed() < Duration::from_secs(2));
        std::fs::write(directory.join("finish"), "finish").unwrap();
        while !directory.join("auth.json").exists() && started.elapsed() < Duration::from_secs(2) {
            std::thread::sleep(Duration::from_millis(10));
        }
        let credential = super::read_auth_json(&directory.join("auth.json"))
            .and_then(|auth| super::pick_credential(&auth));
        let cli_started = directory.join("started").exists();
        while state
            .running
            .as_ref()
            .is_some_and(|task| !task.is_finished())
            && started.elapsed() < Duration::from_secs(2)
        {
            std::thread::sleep(Duration::from_millis(10));
        }
        let duplicate = std::process::Command::new("/nonexistent/quotabar-test-grok");
        assert!(
            super::run_renewal_command(duplicate, &mut state, true, Duration::from_secs(1))
                .unwrap_err()
                .contains("could not start"),
            "first manual refresh must launch its current command"
        );
        assert!(state.running.is_none(), "completed renewal must be reaped");
        let duplicate = std::process::Command::new("/nonexistent/quotabar-test-grok");
        assert!(super::run_renewal_command(
            duplicate,
            &mut state,
            false,
            Duration::from_millis(100)
        )
        .unwrap_err()
        .contains("waiting to retry"));
        let duplicate = std::process::Command::new("/nonexistent/quotabar-test-grok");
        assert!(
            super::run_renewal_command(duplicate, &mut state, true, Duration::from_secs(1))
                .unwrap_err()
                .contains("could not start")
        );
        std::fs::remove_dir_all(directory).unwrap();
        assert!(
            cli_started,
            "synthetic CLI must reach the refresh operation"
        );
        assert!(
            credential.is_ok(),
            "deadline must allow the CLI to persist its replacement credential"
        );
    }

    #[test]
    fn finished_failure_does_not_skip_an_eligible_retry() {
        for manual in [false, true] {
            let mut state = renewal_state();
            state.last_attempt = Some(std::time::Instant::now() - super::RENEWAL_RETRY_INTERVAL);
            state.running = Some(std::thread::spawn(|| {
                Err("previous renewal failed".to_string())
            }));
            while !state.running.as_ref().unwrap().is_finished() {
                std::thread::yield_now();
            }
            let retry = std::process::Command::new("/nonexistent/quotabar-test-grok");
            let error =
                super::run_renewal_command(retry, &mut state, manual, Duration::from_secs(1))
                    .unwrap_err();
            assert!(
                error.contains("could not start"),
                "eligible refresh must attempt its current command"
            );
        }
    }

    #[test]
    fn renewal_errors_retain_last_known_quota() {
        let _cache_lock = LAST_GOOD_TEST_LOCK.lock().unwrap();
        let directory = std::env::temp_dir().join(format!(
            "quotabar-grok-fallback-{}-{}",
            std::process::id(),
            Utc::now().timestamp_nanos_opt().unwrap()
        ));
        std::fs::create_dir(&directory).unwrap();
        let path = directory.join("auth.json");
        std::fs::write(
            &path,
            json!({"entry": {
                "key": "synthetic-expired-key", "refresh_token": "synthetic-refresh-token",
                "expires_at": "2020-01-01T00:00:00Z", "email": "synthetic@example.invalid"
            }})
            .to_string(),
        )
        .unwrap();
        let previous = super::last_good()
            .lock()
            .unwrap()
            .replace(super::CachedGrok {
                data: sample_connected_grok(),
                cached_at: std::time::Instant::now(),
                account_id: super::grok_account_id(None, Some("synthetic@example.invalid")),
            });
        let mut results = Vec::new();
        let errors = [
            "Grok session renewal timed out; waiting for the CLI to finish.",
            "Grok session renewal is still running; waiting for the CLI to finish.",
            "Grok session renewal is waiting to retry. Open 'grok' or retry manually now.",
        ];
        for age in [Duration::from_secs(30), MAX_STALE_GROK_AGE] {
            super::last_good()
                .lock()
                .unwrap()
                .as_mut()
                .unwrap()
                .cached_at = std::time::Instant::now() - age;
            for error in errors {
                let data = super::read_credential_with_renewal(&path, || Err(error.to_string()))
                    .err()
                    .unwrap();
                results.push((data, age < MAX_STALE_GROK_AGE, Some(error.to_string())));
            }
        }
        // A completed renewal with no usable credential must not reuse a snapshot.
        super::last_good()
            .lock()
            .unwrap()
            .as_mut()
            .unwrap()
            .cached_at = std::time::Instant::now();
        results.push((
            super::read_credential_with_renewal(&path, || Ok(()))
                .err()
                .unwrap(),
            false,
            None,
        ));
        std::fs::remove_file(&path).unwrap();
        results.push((
            super::read_credential_with_renewal(&path, || {
                panic!("missing credentials must not renew")
            })
            .err()
            .unwrap(),
            false,
            None,
        ));
        // No snapshot must still return the renewal failure, with quota unavailable.
        *super::last_good().lock().unwrap() = None;
        std::fs::write(
            &path,
            json!({"entry": {
                "key": "synthetic-expired-key", "refresh_token": "synthetic-refresh-token",
                "expires_at": "2020-01-01T00:00:00Z", "email": "synthetic@example.invalid"
            }})
            .to_string(),
        )
        .unwrap();
        results.push((
            super::read_credential_with_renewal(&path, || Err(errors[0].to_string()))
                .err()
                .unwrap(),
            false,
            Some(errors[0].to_string()),
        ));
        *super::last_good().lock().unwrap() = previous;
        std::fs::remove_dir_all(directory).unwrap();
        drop(_cache_lock);
        for (data, connected, error) in results {
            assert_eq!(
                data.connected, connected,
                "only a recent snapshot can survive renewal errors"
            );
            assert_eq!(data.percentage, connected.then_some(4.0));
            if let Some(error) = error {
                assert_eq!(data.error, Some(error));
            } else {
                assert!(data.error.is_some());
            }
        }
    }

    #[test]
    fn renewal_fallback_does_not_cross_accounts() {
        let _cache_lock = LAST_GOOD_TEST_LOCK.lock().unwrap();
        let directory = std::env::temp_dir().join(format!(
            "quotabar-grok-account-{}-{}",
            std::process::id(),
            Utc::now().timestamp_nanos_opt().unwrap()
        ));
        std::fs::create_dir(&directory).unwrap();
        let path = directory.join("auth.json");
        let mut snapshot = sample_connected_grok();
        snapshot.email = Some("previous@example.invalid".to_string());
        let previous = super::last_good()
            .lock()
            .unwrap()
            .replace(super::CachedGrok {
                data: snapshot,
                cached_at: std::time::Instant::now(),
                account_id: super::grok_account_id(None, Some("previous@example.invalid")),
            });
        let mut results = Vec::new();
        for email in [
            Some("previous@example.invalid"),
            Some("current@example.invalid"),
            None,
        ] {
            let mut auth = json!({"entry": {
                "key": "synthetic-expired-key", "refresh_token": "synthetic-refresh-token",
                "expires_at": "2020-01-01T00:00:00Z"
            }});
            if let Some(email) = email {
                auth["entry"]["email"] = json!(email);
            }
            std::fs::write(&path, auth.to_string()).unwrap();
            let data = super::read_credential_with_renewal(&path, || {
                Err("Grok session renewal timed out".to_string())
            })
            .err()
            .unwrap();
            results.push((data, email == Some("previous@example.invalid")));
        }
        let auth = json!({
            "previous": {"key": "synthetic-old-key", "refresh_token": "synthetic-old-refresh", "expires_at": "2020-01-01T00:00:00Z", "email": "previous@example.invalid"},
            "current": {"key": "synthetic-new-key", "refresh_token": "synthetic-new-refresh", "expires_at": "2020-01-01T00:00:00Z", "email": "current@example.invalid"}
        });
        std::fs::write(&path, auth.to_string()).unwrap();
        results.push((
            super::read_credential_with_renewal(&path, || {
                Err("Grok session renewal timed out".to_string())
            })
            .err()
            .unwrap(),
            false,
        ));
        *super::last_good().lock().unwrap() = previous;
        std::fs::remove_dir_all(directory).unwrap();
        drop(_cache_lock);
        for (data, same_account) in results {
            assert_eq!(
                data.connected, same_account,
                "only the same identified account may reuse last-known quota"
            );
            assert_eq!(data.percentage, same_account.then_some(4.0));
            assert_eq!(
                data.email,
                same_account.then(|| "previous@example.invalid".to_string())
            );
            assert_eq!(
                data.error.as_deref(),
                Some("Grok session renewal timed out")
            );
        }
    }

    #[test]
    fn last_good_fallback_is_connected_with_error_not_clean_success() {
        let data = sample_connected_grok();
        let stale = last_good_or_disconnected(
            "Too many open files (os error 24)".to_string(),
            Some(&data),
            Duration::from_secs(30),
        );
        assert!(stale.connected);
        assert_eq!(stale.percentage, Some(4.0));
        assert_eq!(
            stale.error.as_deref(),
            Some("Too many open files (os error 24)")
        );
        assert_ne!(stale.error, None);

        let marked = mark_grok_data_stale(data.clone(), "EMFILE".to_string());
        assert!(marked.connected);
        assert_eq!(marked.error.as_deref(), Some("EMFILE"));

        assert!(stale_grok_usable(true, Duration::from_secs(60)));
        assert!(!stale_grok_usable(false, Duration::from_secs(1)));
        assert!(!stale_grok_usable(true, MAX_STALE_GROK_AGE));
        let expired = last_good_or_disconnected(
            "Too many open files (os error 24)".to_string(),
            Some(&data),
            MAX_STALE_GROK_AGE,
        );
        assert!(!expired.connected);
        assert!(expired.error.unwrap().contains("Too many open files"));
    }

    #[test]
    fn http_429_keeps_last_good_with_error_instead_of_disconnecting() {
        let data = sample_connected_grok();
        let stale = grok_from_http_status(
            reqwest::StatusCode::TOO_MANY_REQUESTS,
            Some(&data),
            Duration::from_secs(10),
        );
        assert!(stale.connected);
        assert_eq!(stale.percentage, Some(4.0));
        assert!(stale
            .error
            .as_deref()
            .unwrap()
            .contains("Grok billing API error: 429"));

        let server = grok_from_http_status(
            reqwest::StatusCode::BAD_GATEWAY,
            Some(&data),
            Duration::from_secs(10),
        );
        assert!(server.connected);
        assert!(server.error.as_deref().unwrap().contains("502"));

        let unauthorized = grok_from_http_status(
            reqwest::StatusCode::UNAUTHORIZED,
            Some(&data),
            Duration::from_secs(10),
        );
        assert!(!unauthorized.connected);
        assert!(unauthorized
            .error
            .unwrap()
            .contains("authentication failed"));
    }

    #[test]
    fn manual_refresh_skips_the_success_cache() {
        assert!(should_read_grok_cache(false));
        assert!(!should_read_grok_cache(true));
    }
}
