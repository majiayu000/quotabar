//! Grok Build usage via the CLI billing proxy.
//!
//! Token resolution:
//!   1. `$GROK_HOME/auth.json` when `GROK_HOME` is set
//!   2. `~/.grok/auth.json`
//!
//! Credentials are read-only. QuotaBar never writes, refreshes, or logs tokens.

use crate::domain::models::{GrokData, GrokExtraCredits, GrokProductUsage, GrokValueEstimate};
use crate::services::grok_local;
use crate::services::http::{is_transient_os_error, shared_http_client};
use chrono::{DateTime, Utc};
use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

const BILLING_URL: &str = "https://cli-chat-proxy.grok.com/v1/billing?format=credits";
const TOKEN_AUTH_HEADER: &str = "xai-grok-cli";
const QUOTA_CACHE_TTL: Duration = Duration::from_secs(120);

struct CachedGrok {
    data: GrokData,
    cached_at: Instant,
}

static GROK_CACHE: OnceLock<Mutex<Option<CachedGrok>>> = OnceLock::new();
static LAST_GOOD: OnceLock<Mutex<Option<GrokData>>> = OnceLock::new();

fn grok_cache() -> &'static Mutex<Option<CachedGrok>> {
    GROK_CACHE.get_or_init(|| Mutex::new(None))
}

fn last_good() -> &'static Mutex<Option<GrokData>> {
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
        return Err("Grok session expired. Run 'grok login', then click Refresh.".to_string());
    }
    Err("Grok Build not configured. Run 'grok login'.".to_string())
}

fn read_auth_json() -> Result<serde_json::Value, String> {
    let home = grok_home().ok_or_else(|| "Could not find home directory".to_string())?;
    let auth_file = home.join("auth.json");
    if !auth_file.exists() {
        return Err("Grok Build not configured. Run 'grok login'.".to_string());
    }
    let content = std::fs::read_to_string(&auth_file)
        .map_err(|err| format!("Failed to read Grok auth: {err}"))?;
    serde_json::from_str(&content).map_err(|err| format!("Failed to parse Grok auth: {err}"))
}

fn parse_cent(value: &serde_json::Value) -> i64 {
    value
        .get("val")
        .and_then(|val| val.as_i64().or_else(|| val.as_f64().map(|n| n as i64)))
        .or_else(|| value.as_i64())
        .unwrap_or(0)
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
            let (product, label) = map_product(raw);
            Some(GrokProductUsage {
                product,
                label,
                usage_percent: parse_percent(&item["usagePercent"]).unwrap_or(0.0),
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
        .map(|product| product.usage_percent)
        .filter(|pct| pct.is_finite() && *pct > 0.0);
    if let Some(pct) = build {
        return Ok(pct);
    }
    pool_pct
        .filter(|pct| pct.is_finite() && *pct > 0.0)
        .ok_or_else(|| "The official Grok pool usage is unavailable.".to_string())
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
        observed_cost_usd: usage.observed_cost_usd,
        estimated_period_value_usd: period_usd,
        observed_tokens: usage.observed_tokens,
        estimated_period_tokens: period_tokens,
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
                products.iter().map(|product| product.usage_percent).sum(),
            ))
        }
    });
    let (period_type, period_label, period_started_at, reset_at) = period_from_config(config);
    let extra = GrokExtraCredits {
        on_demand_used_cents: parse_cent(&config["onDemandUsed"]),
        on_demand_cap_cents: parse_cent(&config["onDemandCap"]),
        prepaid_balance_cents: parse_cent(&config["prepaidBalance"]),
    };
    let extra = if extra.on_demand_used_cents == 0
        && extra.on_demand_cap_cents == 0
        && extra.prepaid_balance_cents == 0
    {
        None
    } else {
        Some(extra)
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

fn get_cached() -> Option<GrokData> {
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
    if data.connected {
        if let Ok(mut guard) = last_good().lock() {
            *guard = Some(data.clone());
        }
    }
}

fn fallback_or_disconnected(error: impl Into<String>) -> GrokData {
    let error = error.into();
    if is_transient_os_error(&error) {
        if let Ok(guard) = last_good().lock() {
            if let Some(stale) = guard.as_ref() {
                return stale.clone();
            }
        }
    }
    GrokData::disconnected(error)
}

pub async fn fetch_grok_info() -> GrokData {
    if let Some(cached) = get_cached() {
        return cached;
    }

    let auth = match read_auth_json() {
        Ok(value) => value,
        Err(error) => return fallback_or_disconnected(error),
    };
    let credential = match pick_credential(&auth) {
        Ok(value) => value,
        Err(error) => return fallback_or_disconnected(error),
    };

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
    if status.as_u16() == 401 || status.as_u16() == 403 {
        return GrokData::disconnected(
            "Grok session expired. Run 'grok login', then click Refresh.",
        );
    }
    if !status.is_success() {
        return GrokData::disconnected(format!("Grok billing API error: {status}"));
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
    use super::{map_product, parse_billing_payload, pick_credential, scale_used_pct};
    use crate::domain::models::GrokProductUsage;
    use serde_json::json;

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
        assert_eq!(data.products.len(), 2);
        assert_eq!(data.products[0].label, "Build");
        assert_eq!(data.products[0].usage_percent, 4.0);
        assert_eq!(data.products[1].label, "Chat");
        assert_eq!(data.products[1].usage_percent, 0.0);
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
        assert_eq!(data.products[1].usage_percent, 0.0);
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
                usage_percent: 4.0,
            },
            GrokProductUsage {
                product: "chat".to_string(),
                label: "Chat".to_string(),
                usage_percent: 21.0,
            },
        ];
        assert_eq!(scale_used_pct(Some(25.0), &products).unwrap(), 4.0);
        assert_eq!(scale_used_pct(Some(25.0), &[]).unwrap(), 25.0);
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
}
