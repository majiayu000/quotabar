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
static LAST_RENEWAL_ATTEMPT: Mutex<Option<Instant>> = Mutex::new(None);

struct CachedGrok {
    data: GrokData,
    cached_at: Instant,
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
    entry_name: Option<String>,
    needs_renewal: bool,
}

fn parse_expiry(value: &serde_json::Value) -> Option<DateTime<Utc>> {
    value
        .as_str()
        .and_then(|raw| DateTime::parse_from_rfc3339(raw).ok())
        .map(|dt| dt.with_timezone(&Utc))
}

fn is_expired(expires_at: &serde_json::Value) -> bool {
    let buffer = std::env::var("GROK_AUTH_EARLY_INVALIDATION_SECS")
        .ok()
        .and_then(|value| value.parse::<u64>().ok())
        .unwrap_or(300);
    parse_expiry(expires_at)
        .map(|expires| {
            expires
                .signed_duration_since(Utc::now())
                .to_std()
                .map(|remaining| remaining <= Duration::from_secs(buffer))
                .unwrap_or(true)
        })
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
    let expires_at = parse_expiry(&value["expires_at"]);
    // Pick the preferred wire-valid entry before deciding whether it needs renewal.
    if expires_at.is_some_and(|expires| expires <= Utc::now()) {
        return None;
    }
    Some((
        GrokCredential {
            key,
            entry_name: None,
            needs_renewal: is_expired(&value["expires_at"]),
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
        expires_at,
    ))
}

fn pick_credential(auth: &serde_json::Value) -> Result<GrokCredential, String> {
    let mut best: Option<(GrokCredential, Option<DateTime<Utc>>)> = None;
    let mut saw_entry = false;

    let mut consider = |value: &serde_json::Value, entry_name: Option<&str>| {
        if !value.is_object()
            || value
                .get("key")
                .and_then(serde_json::Value::as_str)
                .is_none()
        {
            return;
        }
        saw_entry = true;
        if let Some(mut candidate) = credential_from_object(value) {
            candidate.0.entry_name = entry_name.map(ToString::to_string);
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
        consider(auth, None);
        for (name, value) in obj {
            consider(value, Some(name));
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
) -> Result<GrokCredential, String> {
    let auth = read_auth_json(auth_file)?;
    let error = match pick_credential(&auth) {
        Ok(credential) if !credential.needs_renewal => return Ok(credential),
        Ok(credential) => {
            let entry = match credential.entry_name.as_deref() {
                Some(name) => &auth[name],
                None => &auth,
            };
            if !entry["refresh_token"]
                .as_str()
                .is_some_and(|value| !value.trim().is_empty())
            {
                return Err("Grok session expired. Run 'grok login'; QuotaBar will check again automatically.".to_string());
            }
            renew()?;
            let renewed = read_renewed_credential(auth_file, credential.entry_name.as_deref())?;
            clear_renewal_retry()?;
            return Ok(renewed);
        }
        Err(error) => error,
    };
    let can_renew = |entry: &serde_json::Value| {
        entry["key"].as_str().is_some_and(|s| !s.trim().is_empty())
            && is_expired(&entry["expires_at"])
            && entry["refresh_token"]
                .as_str()
                .is_some_and(|s| !s.trim().is_empty())
    };
    if !can_renew(&auth)
        && !auth
            .as_object()
            .is_some_and(|entries| entries.values().any(can_renew))
    {
        return Err(error);
    }
    renew()?;
    // A successful command is not proof of renewal: only the saved credential is.
    let renewed = pick_credential(&read_auth_json(auth_file)?)
        .ok()
        .filter(|credential| !credential.needs_renewal)
        .ok_or_else(|| {
            "Grok session renewal did not produce a valid credential. Open 'grok' to check sign-in."
                .to_string()
        })?;
    clear_renewal_retry()?;
    Ok(renewed)
}

fn read_renewed_credential(
    auth_file: &Path,
    entry_name: Option<&str>,
) -> Result<GrokCredential, String> {
    let auth = read_auth_json(auth_file)?;
    let entry = match entry_name {
        Some(name) => &auth[name],
        None => &auth,
    };
    credential_from_object(entry)
        .filter(|(credential, _)| !credential.needs_renewal)
        .map(|(mut credential, _)| {
            credential.entry_name = entry_name.map(ToString::to_string);
            credential
        })
        .ok_or_else(|| {
            "Grok session renewal did not produce a valid credential. Open 'grok' to check sign-in."
                .to_string()
        })
}

fn read_rejected_credential_with_renewal(
    auth_file: &Path,
    rejected_key: &str,
    entry_name: Option<&str>,
    renew: impl FnOnce() -> Result<(), String>,
) -> Result<GrokCredential, String> {
    let auth = read_auth_json(auth_file)?;
    let auth_error = || {
        "Grok authentication failed (401/403). Run 'grok login'; QuotaBar will check again automatically."
            .to_string()
    };
    let entry = match entry_name {
        Some(name) => &auth[name],
        None => &auth,
    };
    if let Some((mut credential, _)) = credential_from_object(entry) {
        if credential.key != rejected_key && !credential.needs_renewal {
            credential.entry_name = entry_name.map(ToString::to_string);
            return Ok(credential);
        }
    }
    if !entry["key"]
        .as_str()
        .is_some_and(|value| !value.trim().is_empty())
        || !entry["refresh_token"]
            .as_str()
            .is_some_and(|value| !value.trim().is_empty())
    {
        return Err(auth_error());
    }
    renew()?;
    read_renewed_credential(auth_file, entry_name)
}

fn run_renewal_command(command: &mut Command, timeout: Duration) -> Result<(), String> {
    command
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000); // CREATE_NO_WINDOW
    }
    let mut child = command
        .spawn()
        .map_err(|error| format!("Grok session renewal could not start the Grok CLI: {error}"))?;
    let started = Instant::now();
    let result = loop {
        match child.try_wait() {
            Ok(Some(status)) if status.success() => return Ok(()),
            Ok(Some(status)) => {
                return Err(format!(
                    "Grok session renewal failed ({status}). Open 'grok' to check sign-in."
                ));
            }
            Ok(None) if started.elapsed() < timeout => {
                std::thread::sleep(Duration::from_millis(50));
            }
            Ok(None) => break "Grok session renewal timed out; it will retry later.".to_string(),
            Err(error) => {
                break format!("Grok session renewal could not wait for the CLI: {error}")
            }
        }
    };
    // Do not leave a hung helper running after returning to the polling loop.
    let cleanup = child.kill().and_then(|_| child.wait());
    match cleanup {
        Ok(_) => Err(result),
        Err(error) => Err(format!("{result} Could not stop the CLI: {error}")),
    }
}

fn clear_renewal_retry() -> Result<(), String> {
    *LAST_RENEWAL_ATTEMPT
        .lock()
        .map_err(|_| "Grok session renewal state is unavailable".to_string())? = None;
    Ok(())
}

fn renew_session(home: &Path, manual: bool) -> Result<(), String> {
    {
        let mut last_attempt = LAST_RENEWAL_ATTEMPT
            .lock()
            .map_err(|_| "Grok session renewal state is unavailable".to_string())?;
        if !manual && last_attempt.is_some_and(|last| last.elapsed() < RENEWAL_RETRY_INTERVAL) {
            return Err(
                "Grok session renewal is waiting to retry. Open 'grok' or retry manually now."
                    .to_string(),
            );
        }
        *last_attempt = Some(Instant::now());
    }
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
    run_renewal_command(&mut command, RENEWAL_TIMEOUT)
}

async fn read_credential(manual: bool) -> Result<GrokCredential, String> {
    let home = grok_home().ok_or_else(|| "Could not find home directory".to_string())?;
    tauri::async_runtime::spawn_blocking(move || {
        read_credential_with_renewal(&home.join("auth.json"), || renew_session(&home, manual))
    })
    .await
    .map_err(|error| format!("Grok session renewal task failed: {error}"))?
}

async fn renew_rejected_credential(
    rejected_key: String,
    entry_name: Option<String>,
    manual: bool,
) -> Result<GrokCredential, String> {
    let home = grok_home().ok_or_else(|| "Could not find home directory".to_string())?;
    tauri::async_runtime::spawn_blocking(move || {
        read_rejected_credential_with_renewal(
            &home.join("auth.json"),
            &rejected_key,
            entry_name.as_deref(),
            || renew_session(&home, manual),
        )
    })
    .await
    .map_err(|error| format!("Grok session renewal task failed: {error}"))?
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

fn save_cache(data: &GrokData) {
    if let Ok(mut guard) = grok_cache().lock() {
        *guard = Some(CachedGrok {
            data: data.clone(),
            cached_at: Instant::now(),
        });
    }
    if data.connected && data.error.is_none() {
        if let Ok(mut guard) = last_good().lock() {
            *guard = Some(CachedGrok {
                data: data.clone(),
                cached_at: Instant::now(),
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

fn last_good_snapshot_fallback(error: String) -> GrokData {
    let (snapshot, age) = match last_good().lock() {
        Ok(guard) => match guard.as_ref() {
            Some(cached) => (Some(cached.data.clone()), cached.cached_at.elapsed()),
            None => (None, Duration::ZERO),
        },
        Err(_) => (None, Duration::ZERO),
    };
    last_good_or_disconnected(error, snapshot.as_ref(), age)
}

fn fallback_or_disconnected(error: impl Into<String>) -> GrokData {
    let error = error.into();
    if is_transient_os_error(&error) {
        return last_good_snapshot_fallback(error);
    }
    GrokData::disconnected(error)
}

fn is_grok_auth_status(status: reqwest::StatusCode) -> bool {
    status.as_u16() == 401 || status.as_u16() == 403
}

async fn fetch_grok_billing<F, Fut>(
    mut credential: GrokCredential,
    billing_url: &str,
    renew: F,
) -> Result<(reqwest::Response, GrokCredential), GrokData>
where
    F: FnOnce(String, Option<String>) -> Fut,
    Fut: std::future::Future<Output = Result<GrokCredential, String>>,
{
    let mut renew = Some(renew);
    loop {
        let mut request = shared_http_client()
            .get(billing_url)
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
            Err(err) => return Err(fallback_or_disconnected(format!("Network error: {err}"))),
        };

        if is_grok_auth_status(response.status()) {
            if let Some(renew) = renew.take() {
                credential = renew(credential.key.clone(), credential.entry_name.clone())
                    .await
                    .map_err(GrokData::disconnected)?;
                continue;
            }
        }
        if response.status().is_success() {
            clear_renewal_retry().map_err(GrokData::disconnected)?;
        }
        return Ok((response, credential));
    }
}

pub async fn fetch_grok_info(manual: bool) -> GrokData {
    let credential = match read_credential(manual).await {
        Ok(value) => value,
        Err(error) => return fallback_or_disconnected(error),
    };

    // Check local expiry on every poll, even while a quota snapshot is cached.
    if let Some(cached) = get_cached(manual) {
        return cached;
    }

    let (response, credential) =
        match fetch_grok_billing(credential, BILLING_URL, |key, entry_name| {
            renew_rejected_credential(key, entry_name, manual)
        })
        .await
        {
            Ok(value) => value,
            Err(data) => return data,
        };

    let status = response.status();
    if !status.is_success() {
        if is_grok_auth_status(status) {
            return GrokData::disconnected(
                "Grok authentication failed (401/403). Run 'grok login'; QuotaBar will check again automatically.",
            );
        }
        return last_good_snapshot_fallback(format!("Grok billing API error: {status}"));
    }

    let data = match response.json::<serde_json::Value>().await {
        Ok(value) => value,
        Err(err) => {
            return GrokData::disconnected(format!("Failed to parse Grok billing response: {err}"))
        }
    };

    let mut result = parse_billing_payload(&data, credential.email);
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
        save_cache(&result);
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

    fn auth_test_path() -> std::path::PathBuf {
        static NEXT_DIRECTORY: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
        let directory = std::env::temp_dir().join(format!(
            "quotabar-grok-195-{}-{}-{}",
            std::process::id(),
            Utc::now().timestamp_nanos_opt().unwrap(),
            NEXT_DIRECTORY.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
        ));
        std::fs::create_dir(&directory).unwrap();
        directory.join("auth.json")
    }

    #[test]
    fn early_invalidation_renews_before_actual_expiry() {
        let path = auth_test_path();
        let auth = json!({"entry": {
            "key": "test-near-expiry-key",
            "refresh_token": "test-refresh-token",
            "expires_at": (Utc::now() + chrono::Duration::seconds(120)).to_rfc3339()
        }});
        std::fs::write(&path, auth.to_string()).unwrap();
        let mut renewals = 0;
        let credential = super::read_credential_with_renewal(&path, || {
            renewals += 1;
            std::fs::write(
                &path,
                json!({"entry": {
                    "key": "test-renewed-key", "expires_at": "2099-01-01T00:00:00Z"
                }})
                .to_string(),
            )
            .unwrap();
            Ok(())
        })
        .unwrap_or_else(|_| panic!("renewal should succeed"));
        std::fs::remove_dir_all(path.parent().unwrap()).unwrap();
        assert_eq!(renewals, 1, "renew inside the CLI's 300-second window");
        assert_eq!(credential.key, "test-renewed-key");
    }

    #[test]
    fn early_invalidation_renews_preferred_entry_before_an_unbounded_account() {
        let path = auth_test_path();
        let mut auth = json!({
            "preferred": {"key": "test-near-expiry-key", "refresh_token": "test-refresh",
                "expires_at": (Utc::now() + chrono::Duration::seconds(120)).to_rfc3339(),
                "user_id": "test-preferred-user"},
            "other": {"key": "test-other-key", "user_id": "test-unrelated-user"}
        });
        std::fs::write(&path, auth.to_string()).unwrap();
        let mut renewals = 0;
        let credential = super::read_credential_with_renewal(&path, || {
            renewals += 1;
            auth["preferred"]["key"] = json!("test-renewed-key");
            auth["preferred"]["expires_at"] = json!("2099-01-01T00:00:00Z");
            std::fs::write(&path, auth.to_string()).unwrap();
            Ok(())
        })
        .unwrap_or_else(|_| panic!("preferred entry renewal"));
        std::fs::remove_dir_all(path.parent().unwrap()).unwrap();
        assert_eq!(
            renewals, 1,
            "renew the due preferred entry before selecting another account"
        );
        assert_eq!(credential.key, "test-renewed-key");
        assert_eq!(credential.user_id.as_deref(), Some("test-preferred-user"));
        assert_eq!(credential.entry_name.as_deref(), Some("preferred"));
    }

    #[test]
    fn proactive_renewal_cannot_replace_a_removed_preferred_entry() {
        let path = auth_test_path();
        let mut auth = json!({
            "preferred": {"key": "test-near-expiry-key", "refresh_token": "test-refresh",
                "expires_at": (Utc::now() + chrono::Duration::seconds(120)).to_rfc3339()},
            "other": {"key": "test-other-key"}
        });
        std::fs::write(&path, auth.to_string()).unwrap();
        let result = super::read_credential_with_renewal(&path, || {
            auth.as_object_mut().unwrap().remove("preferred");
            auth["other"]["key"] = json!("test-unrelated-renewed-key");
            std::fs::write(&path, auth.to_string()).unwrap();
            Ok(())
        });
        std::fs::remove_dir_all(path.parent().unwrap()).unwrap();
        assert!(
            result.is_err(),
            "renewal must reread the same preferred entry"
        );
    }

    #[test]
    #[cfg(unix)]
    fn successful_renewal_does_not_block_auth_recovery() {
        let status = std::process::Command::new(std::env::current_exe().unwrap())
            .args([
                "--exact",
                "services::grok::tests::renewal_cooldown_fixture",
                "--ignored",
            ])
            .status()
            .unwrap();
        assert!(status.success());
    }

    #[test]
    #[cfg(unix)]
    #[ignore = "isolated renewal state fixture executed by parent regression"]
    fn renewal_cooldown_fixture() {
        use std::os::unix::fs::PermissionsExt;
        let path = auth_test_path();
        let home = path.parent().unwrap();
        let bin = home.join("bin");
        std::fs::create_dir(&bin).unwrap();
        let cli = bin.join("grok");
        let near_expiry = (Utc::now() + chrono::Duration::seconds(120)).to_rfc3339();
        let near = json!({"key": "test-near-key", "refresh_token": "test-refresh", "expires_at": near_expiry});
        let renewed = json!({"key": "test-renewed-key", "refresh_token": "test-refresh", "expires_at": "2099-01-01T00:00:00Z"});
        std::fs::write(&path, near.to_string()).unwrap();
        std::fs::write(home.join("renewed.json"), renewed.to_string()).unwrap();
        std::fs::write(
            &cli,
            "#!/bin/sh\ncp \"$GROK_HOME/renewed.json\" \"$GROK_AUTH_PATH\"\n",
        )
        .unwrap();
        std::fs::set_permissions(&cli, std::fs::Permissions::from_mode(0o700)).unwrap();
        let credential =
            super::read_credential_with_renewal(&path, || super::renew_session(home, false))
                .unwrap();
        let (url, server) = billing_server(vec![401, 200]);
        let result = tauri::async_runtime::block_on(super::fetch_grok_billing(
            credential,
            &url,
            |key, entry_name| {
                std::future::ready(super::read_rejected_credential_with_renewal(
                    &path,
                    &key,
                    entry_name.as_deref(),
                    || super::renew_session(home, false),
                ))
            },
        ));
        let (response, credential) = result.unwrap();
        assert!(
            response.status().is_success(),
            "a successful proactive renewal must allow rejection recovery"
        );
        assert_eq!(server.join().unwrap().len(), 2);

        let (url, server) = billing_server(vec![401, 500]);
        let result = tauri::async_runtime::block_on(super::fetch_grok_billing(
            credential,
            &url,
            |key, entry_name| {
                std::future::ready(super::read_rejected_credential_with_renewal(
                    &path,
                    &key,
                    entry_name.as_deref(),
                    || super::renew_session(home, false),
                ))
            },
        ));
        let (response, credential) = result.unwrap();
        assert_eq!(response.status().as_u16(), 500);
        assert_eq!(server.join().unwrap().len(), 2);
        assert!(super::LAST_RENEWAL_ATTEMPT.lock().unwrap().is_some());

        let (url, server) = billing_server(vec![200]);
        let result = tauri::async_runtime::block_on(super::fetch_grok_billing(
            credential,
            &url,
            |_, _| async { panic!("successful billing must not renew") },
        ));
        assert!(result.unwrap().0.status().is_success());
        assert_eq!(server.join().unwrap().len(), 1);
        assert!(
            super::LAST_RENEWAL_ATTEMPT.lock().unwrap().is_none(),
            "a later successful poll validates the credential and clears cooldown"
        );

        std::fs::write(&path, near.to_string()).unwrap();
        std::fs::write(&cli, "#!/bin/sh\nexit 0\n").unwrap();
        let invalid =
            super::read_credential_with_renewal(&path, || super::renew_session(home, false))
                .err()
                .unwrap();
        assert!(invalid.contains("did not produce a valid credential"));
        let backoff = super::renew_session(home, false).err().unwrap();
        assert!(
            backoff.contains("waiting to retry"),
            "a zero CLI exit without a valid saved credential retains cooldown"
        );

        *super::LAST_RENEWAL_ATTEMPT.lock().unwrap() = None;
        std::fs::write(&cli, "#!/bin/sh\nexit 7\n").unwrap();
        assert!(super::renew_session(home, false).is_err());
        let backoff = super::renew_session(home, false).err().unwrap();
        assert!(
            backoff.contains("waiting to retry"),
            "failed automatic renewal retains cooldown"
        );
        std::fs::remove_dir_all(home).unwrap();
    }

    fn billing_server(statuses: Vec<u16>) -> (String, std::thread::JoinHandle<Vec<String>>) {
        use std::io::{Read, Write};
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        listener.set_nonblocking(true).unwrap();
        let url = format!("http://{}/billing", listener.local_addr().unwrap());
        let thread = std::thread::spawn(move || {
            let started = std::time::Instant::now();
            let mut requests = Vec::new();
            for status in statuses {
                let mut stream = loop {
                    match listener.accept() {
                        Ok((stream, _)) => break stream,
                        Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                            if started.elapsed() > Duration::from_secs(3) {
                                return requests;
                            }
                            std::thread::sleep(Duration::from_millis(5));
                        }
                        Err(error) => panic!("local billing server: {error}"),
                    }
                };
                stream.set_nonblocking(false).unwrap();
                stream
                    .set_read_timeout(Some(Duration::from_secs(2)))
                    .unwrap();
                let mut request = Vec::new();
                let mut buffer = [0; 1024];
                while !request.windows(4).any(|part| part == b"\r\n\r\n") {
                    let count = stream.read(&mut buffer).unwrap();
                    assert!(count > 0);
                    request.extend_from_slice(&buffer[..count]);
                }
                requests.push(String::from_utf8(request).unwrap().to_ascii_lowercase());
                let body = "{\"config\":{\"creditUsagePercent\":12.5}}";
                write!(stream, "HTTP/1.1 {status} Test\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len()).unwrap();
            }
            requests
        });
        (url, thread)
    }

    fn rejected_unexpired_billing_renews(status: u16) {
        let path = auth_test_path();
        let auth = json!({"entry": {
            "key": "test-rejected-key", "refresh_token": "test-refresh-token",
            "expires_at": "2099-01-01T00:00:00Z", "user_id": "test-user-old"
        }});
        std::fs::write(&path, auth.to_string()).unwrap();
        let credential = pick_credential(&auth).unwrap_or_else(|_| panic!("unexpired credential"));
        let (url, server) = billing_server(vec![status, 200]);
        let mut renewals = 0;
        let result = tauri::async_runtime::block_on(super::fetch_grok_billing(
            credential,
            &url,
            |key, entry_name| {
                renewals += 1;
                assert_eq!(key, "test-rejected-key");
                std::future::ready(super::read_rejected_credential_with_renewal(
                    &path,
                    &key,
                    entry_name.as_deref(),
                    || {
                        std::fs::write(
                            &path,
                            json!({"entry": {
                                "key": "test-renewed-key", "expires_at": "2099-01-01T00:00:00Z",
                                "user_id": "test-user-new", "email": "test@example.invalid"
                            }})
                            .to_string(),
                        )
                        .unwrap();
                        Ok(())
                    },
                ))
            },
        ));
        let requests = server.join().unwrap();
        std::fs::remove_dir_all(path.parent().unwrap()).unwrap();
        assert!(
            result.is_ok(),
            "HTTP {status} should renew and retry billing"
        );
        let (response, credential) = result.unwrap_or_else(|_| unreachable!());
        assert_eq!(response.status(), reqwest::StatusCode::OK);
        let payload = tauri::async_runtime::block_on(response.json::<serde_json::Value>()).unwrap();
        assert_eq!(renewals, 1);
        assert_eq!(requests.len(), 2);
        assert!(requests[0].contains("authorization: bearer test-rejected-key"));
        assert!(requests[1].contains("authorization: bearer test-renewed-key"));
        assert!(requests[1].contains("x-userid: test-user-new"));
        assert_eq!(credential.email.as_deref(), Some("test@example.invalid"));
        assert_eq!(payload["config"]["creditUsagePercent"], 12.5);
    }

    #[test]
    fn unexpired_401_renews_and_retries_billing() {
        rejected_unexpired_billing_renews(401);
    }

    #[test]
    fn unexpired_403_renews_and_retries_billing() {
        rejected_unexpired_billing_renews(403);
    }

    #[test]
    fn billing_retry_is_bounded_and_renewal_errors_disconnect() {
        for (statuses, renewal_error, expected_requests) in [
            (vec![401, 403], None, 2),
            (vec![403], Some("Grok session renewal timed out"), 1),
            (
                vec![401],
                Some("Grok session renewal is waiting to retry"),
                1,
            ),
            (
                vec![401],
                Some("Grok session renewal could not start the Grok CLI"),
                1,
            ),
            (vec![429], None, 1),
            (vec![500], None, 1),
            (vec![200], None, 1),
        ] {
            let status = statuses[0];
            let credential = pick_credential(&json!({"key": "test-key"}))
                .unwrap_or_else(|_| panic!("credential"));
            let (url, server) = billing_server(statuses);
            let mut renewals = 0;
            let result = tauri::async_runtime::block_on(super::fetch_grok_billing(
                credential,
                &url,
                |_, _| {
                    renewals += 1;
                    std::future::ready(match renewal_error {
                        Some(error) => Err(error.to_string()),
                        None => pick_credential(&json!({"key": "test-key"})),
                    })
                },
            ));
            assert_eq!(server.join().unwrap().len(), expected_requests);
            assert_eq!(renewals, usize::from(status == 401 || status == 403));
            match renewal_error {
                Some(error) => {
                    let data = result.err().expect("failed renewal must disconnect");
                    assert!(!data.connected);
                    assert_eq!(data.percentage, None);
                    assert_eq!(data.error.as_deref(), Some(error));
                }
                None => {
                    let (response, _) = result.unwrap_or_else(|_| panic!("HTTP response"));
                    assert_eq!(
                        response.status().as_u16(),
                        if status == 401 { 403 } else { status }
                    );
                }
            }
        }
    }

    #[test]
    fn rejected_credential_requires_its_own_refresh_token() {
        let path = auth_test_path();
        for refresh in [serde_json::Value::Null, json!(""), json!("   ")] {
            std::fs::write(
                &path,
                json!({
                    "selected": {"key": "test-rejected-key", "refresh_token": refresh,
                        "expires_at": "2099-01-01T00:00:00Z"},
                    "other": {"key": "test-other-key", "refresh_token": "test-other-refresh",
                        "expires_at": "2020-01-01T00:00:00Z"}
                })
                .to_string(),
            )
            .unwrap();
            let result = super::read_rejected_credential_with_renewal(
                &path,
                "test-rejected-key",
                Some("selected"),
                || panic!("another entry's refresh token must not renew the rejected key"),
            );
            assert!(result.err().unwrap().contains("authentication failed"));
        }
        std::fs::write(
            &path,
            json!({"key": "test-rejected-key", "refresh_token": "test-refresh"}).to_string(),
        )
        .unwrap();
        let failure =
            super::read_rejected_credential_with_renewal(&path, "test-rejected-key", None, || {
                Err("test renewal failure".to_string())
            });
        assert_eq!(failure.err().as_deref(), Some("test renewal failure"));
        let credential =
            super::read_rejected_credential_with_renewal(&path, "test-rejected-key", None, || {
                std::fs::write(&path, json!({"key": "test-new-key"}).to_string()).unwrap();
                Ok(())
            })
            .unwrap_or_else(|_| panic!("flat auth renewal"));
        assert_eq!(credential.key, "test-new-key");
        let replaced =
            super::read_rejected_credential_with_renewal(&path, "test-rejected-key", None, || {
                panic!("already replaced flat credentials do not need renewal")
            });
        assert_eq!(
            replaced.unwrap_or_else(|_| panic!("same flat entry")).key,
            "test-new-key"
        );
        let removed = super::read_rejected_credential_with_renewal(
            &path,
            "test-rejected-key",
            Some("removed"),
            || panic!("removed rejected entries must not renew another credential"),
        );
        assert!(removed.err().unwrap().contains("authentication failed"));
        std::fs::write(&path, "{").unwrap();
        assert!(
            super::read_rejected_credential_with_renewal(&path, "test-key", None, || panic!(
                "malformed auth"
            ))
            .err()
            .unwrap()
            .contains("Failed to parse Grok auth")
        );
        std::fs::remove_file(&path).unwrap();
        assert!(
            super::read_rejected_credential_with_renewal(&path, "test-key", None, || panic!(
                "missing auth"
            ))
            .err()
            .unwrap()
            .contains("not configured")
        );
        std::fs::remove_dir_all(path.parent().unwrap()).unwrap();
    }

    #[test]
    fn early_invalidation_honors_env_without_affecting_other_tests() {
        for value in [
            None,
            Some("0"),
            Some("60"),
            Some("300"),
            Some("600"),
            Some("invalid"),
            Some("-1"),
            Some(""),
        ] {
            let mut command = std::process::Command::new(std::env::current_exe().unwrap());
            command.args([
                "--exact",
                "services::grok::tests::early_invalidation_env_fixture",
                "--ignored",
            ]);
            match value {
                Some(value) => {
                    command.env("GROK_AUTH_EARLY_INVALIDATION_SECS", value);
                }
                None => {
                    command.env_remove("GROK_AUTH_EARLY_INVALIDATION_SECS");
                }
            }
            assert!(command.status().unwrap().success());
        }
    }

    #[test]
    fn rejected_entry_renewal_never_selects_another_account() {
        let path = auth_test_path();
        for other_expiry in [serde_json::Value::Null, json!("2199-01-01T00:00:00Z")] {
            let mut auth = json!({
                "rejected": {"key": "test-rejected-key", "refresh_token": "test-refresh",
                    "expires_at": "2020-01-01T00:00:00Z", "user_id": "test-original-user"},
                "other": {"key": "test-other-key", "expires_at": other_expiry,
                    "user_id": "test-unrelated-user"}
            });
            std::fs::write(&path, auth.to_string()).unwrap();
            let mut renewals = 0;
            let credential = super::read_rejected_credential_with_renewal(
                &path,
                "test-rejected-key",
                Some("rejected"),
                || {
                    renewals += 1;
                    auth["rejected"]["key"] = json!("test-renewed-key");
                    auth["rejected"]["expires_at"] = json!("2099-01-01T00:00:00Z");
                    std::fs::write(&path, auth.to_string()).unwrap();
                    Ok(())
                },
            )
            .unwrap_or_else(|_| panic!("rejected entry renewal"));
            assert_eq!(renewals, 1);
            assert_eq!(credential.key, "test-renewed-key");
            assert_eq!(credential.user_id.as_deref(), Some("test-original-user"));
        }
        std::fs::remove_dir_all(path.parent().unwrap()).unwrap();
    }

    #[test]
    fn concurrent_same_entry_replacement_retries_without_renewal() {
        let path = auth_test_path();
        let mut auth = json!({
            "issuer": {"key": "test-rejected-key", "refresh_token": "test-refresh",
                "expires_at": "2999-01-01T00:00:00Z", "user_id": "test-original-user"},
            "other": {"key": "test-other-key", "expires_at": "2199-01-01T00:00:00Z",
                "user_id": "test-unrelated-user"}
        });
        let selected = pick_credential(&auth).unwrap_or_else(|_| panic!("selected credential"));
        assert_eq!(selected.key, "test-rejected-key");
        auth["issuer"]["key"] = json!("test-concurrently-renewed-key");
        auth["issuer"]["expires_at"] = json!("2099-01-01T00:00:00Z");
        std::fs::write(&path, auth.to_string()).unwrap();
        let result = super::read_rejected_credential_with_renewal(
            &path,
            &selected.key,
            selected.entry_name.as_deref(),
            || panic!("the same entry already has a renewed token"),
        );
        std::fs::remove_dir_all(path.parent().unwrap()).unwrap();
        assert!(
            result.is_ok(),
            "retry with the same entry's already renewed credential"
        );
        let credential = result.unwrap_or_else(|_| unreachable!());
        assert_eq!(credential.key, "test-concurrently-renewed-key");
        assert_eq!(credential.user_id.as_deref(), Some("test-original-user"));
    }

    #[test]
    #[ignore = "isolated environment fixture executed by parent regression"]
    fn early_invalidation_env_fixture() {
        let buffer = std::env::var("GROK_AUTH_EARLY_INVALIDATION_SECS")
            .ok()
            .and_then(|value| value.parse::<u64>().ok())
            .unwrap_or(300);
        for seconds in [30, 120, 450, 900] {
            let expires = (Utc::now() + chrono::Duration::seconds(seconds)).to_rfc3339();
            assert_eq!(super::is_expired(&json!(expires)), seconds as u64 <= buffer);
        }
        assert!(super::is_expired(&json!("2020-01-01T00:00:00Z")));
        assert!(!super::is_expired(&json!("invalid")));
        assert!(!super::is_expired(&serde_json::Value::Null));
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
        .unwrap_or_else(|error| panic!("{error}"));
        assert_eq!(credential.key, "test-renewed-key");

        assert!(super::read_credential_with_renewal(&path, || {
            panic!("valid credentials must not launch the CLI")
        })
        .is_ok());

        std::fs::write(&path, expired.to_string()).unwrap();
        let failed = super::read_credential_with_renewal(&path, || {
            Err("Grok session renewal timed out".to_string())
        });
        assert_eq!(failed.err().unwrap(), "Grok session renewal timed out");
        let unchanged = super::read_credential_with_renewal(&path, || Ok(()));
        assert!(unchanged
            .err()
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
        .contains("session expired"));

        std::fs::write(&path, "{").unwrap();
        assert!(super::read_credential_with_renewal(&path, || {
            panic!("malformed credentials must not launch the CLI")
        })
        .err()
        .unwrap()
        .contains("Failed to parse Grok auth"));

        std::fs::remove_file(&path).unwrap();
        assert!(super::read_credential_with_renewal(&path, || {
            panic!("missing credentials must not launch the CLI")
        })
        .err()
        .unwrap()
        .contains("not configured"));
        std::fs::remove_dir(directory).unwrap();
    }

    #[test]
    #[cfg(unix)]
    fn renewal_command_handles_success_failure_timeout_and_missing_cli() {
        let mut success = std::process::Command::new("sh");
        success.args(["-c", "exit 0"]);
        assert!(super::run_renewal_command(&mut success, Duration::from_secs(1)).is_ok());

        let mut failure = std::process::Command::new("sh");
        failure.args(["-c", "echo test-secret >&2; exit 42"]);
        let error = super::run_renewal_command(&mut failure, Duration::from_secs(1)).unwrap_err();
        assert!(error.contains("42"));
        assert!(!error.contains("test-secret"));

        let mut hung = std::process::Command::new("sh");
        hung.args(["-c", "exec sleep 30"]);
        let started = std::time::Instant::now();
        let error = super::run_renewal_command(&mut hung, Duration::from_millis(20)).unwrap_err();
        assert!(error.contains("timed out"));
        assert!(started.elapsed() < Duration::from_secs(2));

        let mut missing = std::process::Command::new("/nonexistent/quotabar-test-grok");
        let error = super::run_renewal_command(&mut missing, Duration::from_secs(1)).unwrap_err();
        assert!(error.contains("could not start"));
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
