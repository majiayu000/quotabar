//! Cached Codex weekly value estimates powered by the `ccstats` SDK.

use crate::domain::models::{CodexRateLimitWindow, CodexRateLimits};
use ccstats_quota::{MultiSummaryOptions, UsageRange, UsageSource};
use once_cell::sync::Lazy;
use std::{
    path::{Path, PathBuf},
    sync::Mutex,
    time::{Duration, Instant},
};

const WEEKLY_WINDOW_MINUTES: i64 = 10_080;

const SUCCESS_CACHE_TTL: Duration = Duration::from_secs(300);
const ERROR_CACHE_TTL: Duration = Duration::from_secs(60);

type WeeklyValueResult = Result<ccstats_quota::CodexWeeklyValueEstimate, String>;

#[derive(Clone, Debug, PartialEq, Eq)]
struct WeeklyQuotaIdentity {
    observed_at: chrono::DateTime<chrono::Utc>,
    resets_at: chrono::DateTime<chrono::Utc>,
    used_pct_bits: u64,
}

impl From<&ccstats_quota::CodexWeeklyQuota> for WeeklyQuotaIdentity {
    fn from(quota: &ccstats_quota::CodexWeeklyQuota) -> Self {
        Self {
            observed_at: quota.observed_at,
            resets_at: quota.resets_at,
            used_pct_bits: quota.used_pct.to_bits(),
        }
    }
}

impl WeeklyQuotaIdentity {
    fn matches_estimate(&self, estimate: &ccstats_quota::CodexWeeklyValueEstimate) -> bool {
        self.observed_at == estimate.observed_at
            && self.resets_at == estimate.resets_at
            && self.used_pct_bits == estimate.used_pct.to_bits()
    }
}

#[derive(Clone)]
struct CachedWeeklyValue {
    codex_home: PathBuf,
    quota: WeeklyQuotaIdentity,
    inserted_at: Instant,
    result: WeeklyValueResult,
}

static WEEKLY_VALUE_CACHE: Lazy<Mutex<Option<CachedWeeklyValue>>> = Lazy::new(|| Mutex::new(None));

fn cache_ttl(result: &WeeklyValueResult) -> Duration {
    if result.is_ok() {
        SUCCESS_CACHE_TTL
    } else {
        ERROR_CACHE_TTL
    }
}

pub(crate) fn official_weekly_window(limits: &CodexRateLimits) -> Option<&CodexRateLimitWindow> {
    [limits.secondary.as_ref(), limits.primary.as_ref()]
        .into_iter()
        .flatten()
        .find(|window| window.window_minutes == Some(WEEKLY_WINDOW_MINUTES))
}

pub fn estimate_codex_weekly_value(
    codex_home: &Path,
    quota: &ccstats_quota::CodexWeeklyQuota,
    official: Option<&CodexRateLimits>,
) -> WeeklyValueResult {
    let quota_identity = WeeklyQuotaIdentity::from(quota);
    let mut cache = WEEKLY_VALUE_CACHE
        .lock()
        .map_err(|error| format!("Codex weekly value cache unavailable: {error}"))?;

    if let Some(cached) = cache.as_ref() {
        if cached.codex_home == codex_home
            && cached.quota == quota_identity
            && cached.inserted_at.elapsed() < cache_ttl(&cached.result)
        {
            return cached.result.clone();
        }
    }

    let result = if quota.used_pct > 0.0 {
        let sdk = ccstats_quota::estimate_codex_weekly_value(Some(codex_home), true, false)
            .map_err(|error| error.to_string())
            .and_then(|estimate| {
                if quota_identity.matches_estimate(&estimate) {
                    Ok(estimate)
                } else {
                    Err(
                        "Codex weekly quota changed while estimating its local value; refresh to retry"
                            .to_string(),
                    )
                }
            });
        match sdk {
            Ok(estimate) => Ok(estimate),
            Err(error) if should_fallback_to_official(&error) => {
                fallback_official_weekly_value(codex_home, official, error)
            }
            Err(error) => Err(error),
        }
    } else {
        fallback_official_weekly_value(
            codex_home,
            official,
            "cannot estimate weekly value while the provider-reported used percentage is zero"
                .to_string(),
        )
    };
    *cache = Some(CachedWeeklyValue {
        codex_home: codex_home.to_path_buf(),
        quota: quota_identity,
        inserted_at: Instant::now(),
        result: result.clone(),
    });
    result
}

fn should_fallback_to_official(error: &str) -> bool {
    error.contains("used percentage is zero")
        || error.contains("no Codex token usage matched the active weekly quota window")
}

fn fallback_official_weekly_value(
    codex_home: &Path,
    official: Option<&CodexRateLimits>,
    original_error: String,
) -> WeeklyValueResult {
    let Some(window) = official.and_then(official_weekly_window) else {
        return Err(original_error);
    };
    estimate_from_official_window(codex_home, window)
}

fn scale_observed_usage(
    observed_cost_usd: f64,
    observed_tokens: i64,
    used_pct: f64,
) -> Result<(f64, f64), String> {
    if !used_pct.is_finite() || used_pct <= 0.0 {
        return Err(
            "cannot estimate weekly value while the provider-reported used percentage is zero"
                .to_string(),
        );
    }
    if !observed_cost_usd.is_finite() || observed_cost_usd <= 0.0 {
        return Err(
            "no positive API-equivalent cost was available for the active weekly window"
                .to_string(),
        );
    }
    if observed_tokens <= 0 {
        return Err("no Codex token usage matched the active weekly quota window".to_string());
    }
    let scale = 100.0 / used_pct;
    let weekly_usd = observed_cost_usd * scale;
    let weekly_tokens = observed_tokens as f64 * scale;
    if !weekly_usd.is_finite() || !weekly_tokens.is_finite() {
        return Err("the weekly value calculation produced a non-finite result".to_string());
    }
    Ok((weekly_usd, weekly_tokens))
}

fn estimate_from_official_window(
    _codex_home: &Path,
    window: &CodexRateLimitWindow,
) -> WeeklyValueResult {
    let window_minutes = window
        .window_minutes
        .ok_or_else(|| "The official weekly window length is unavailable.".to_string())?;
    let resets_at = window
        .resets_at
        .ok_or_else(|| "The official weekly reset time is unavailable.".to_string())?;
    let resets = chrono::DateTime::from_timestamp(resets_at, 0)
        .ok_or_else(|| "The official weekly reset time is unavailable.".to_string())?;
    let started = resets - chrono::Duration::minutes(window_minutes);
    let now = chrono::Utc::now();
    let observed_at = if now < resets { now } else { resets };
    let batch = ccstats_quota::summarize_cost_ranges(MultiSummaryOptions {
        source: UsageSource::Codex,
        ranges: vec![UsageRange::DateRange {
            since: Some(started.date_naive()),
            until: Some(observed_at.date_naive()),
        }],
        timezone: None,
        offline: true,
        strict_pricing: false,
        currency: None,
    })
    .map_err(|error| error.to_string())?;
    let summary =
        batch.summaries.into_iter().next().ok_or_else(|| {
            "no Codex token usage matched the active weekly quota window".to_string()
        })?;
    let observed_cost = summary.cost_usd.or(summary.cost).ok_or_else(|| {
        "no positive API-equivalent cost was available for the active weekly window".to_string()
    })?;
    let (weekly_usd, weekly_tokens) = scale_observed_usage(
        observed_cost,
        summary.tokens.total_tokens,
        window.used_percent,
    )?;
    Ok(ccstats_quota::CodexWeeklyValueEstimate {
        observed_at,
        window_started_at: started,
        resets_at: resets,
        used_pct: window.used_percent,
        observed_cost_usd: observed_cost,
        estimated_weekly_value_usd: weekly_usd,
        observed_tokens: summary.tokens.total_tokens,
        estimated_weekly_tokens: weekly_tokens,
        valid_entries: summary.valid_entries,
        dedup_skipped_entries: summary.skipped_entries,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn estimate() -> ccstats_quota::CodexWeeklyValueEstimate {
        ccstats_quota::CodexWeeklyValueEstimate {
            observed_at: chrono::DateTime::UNIX_EPOCH,
            window_started_at: chrono::DateTime::UNIX_EPOCH,
            resets_at: chrono::DateTime::UNIX_EPOCH + chrono::Duration::days(7),
            used_pct: 25.0,
            observed_cost_usd: 50.0,
            estimated_weekly_value_usd: 200.0,
            observed_tokens: 1_000,
            estimated_weekly_tokens: 4_000.0,
            valid_entries: 1,
            dedup_skipped_entries: 0,
        }
    }

    fn identity(used_pct: f64) -> WeeklyQuotaIdentity {
        WeeklyQuotaIdentity {
            observed_at: chrono::DateTime::UNIX_EPOCH,
            resets_at: chrono::DateTime::UNIX_EPOCH + chrono::Duration::days(7),
            used_pct_bits: used_pct.to_bits(),
        }
    }

    #[test]
    fn successful_estimates_live_longer_than_errors() {
        let estimate = estimate();

        assert_eq!(cache_ttl(&Ok(estimate)), SUCCESS_CACHE_TTL);
        assert_eq!(cache_ttl(&Err("unavailable".to_string())), ERROR_CACHE_TTL);
    }

    #[test]
    fn quota_identity_rejects_estimates_from_another_snapshot() {
        let estimate = estimate();

        assert!(identity(25.0).matches_estimate(&estimate));
        assert!(!identity(30.0).matches_estimate(&estimate));
    }

    fn limits_with(
        primary: Option<(f64, i64)>,
        secondary: Option<(f64, i64)>,
    ) -> crate::domain::models::CodexRateLimits {
        use crate::domain::models::{CodexRateLimitWindow, CodexRateLimits};
        let window = |used: f64, minutes: i64| CodexRateLimitWindow {
            used_percent: used,
            window_minutes: Some(minutes),
            resets_at: Some(1_787_961_600),
        };
        CodexRateLimits {
            connected: true,
            plan_type: Some("plus".to_string()),
            primary: primary.map(|(used, minutes)| window(used, minutes)),
            secondary: secondary.map(|(used, minutes)| window(used, minutes)),
            credits: None,
            error: None,
        }
    }

    #[test]
    fn official_weekly_window_prefers_seven_day_primary() {
        let limits = limits_with(Some((25.0, 10_080)), None);
        let window = official_weekly_window(&limits).expect("weekly primary");
        assert_eq!(window.used_percent, 25.0);
        assert_eq!(window.window_minutes, Some(10_080));
    }

    #[test]
    fn official_weekly_window_ignores_five_hour_primary() {
        let limits = limits_with(Some((25.0, 300)), None);
        assert!(official_weekly_window(&limits).is_none());
    }

    #[test]
    fn scale_observed_usage_projects_from_official_used_percent() {
        let (usd, tokens) = scale_observed_usage(50.0, 1_000, 25.0).expect("scaled");
        assert_eq!(usd, 200.0);
        assert_eq!(tokens, 4_000.0);
    }

    #[test]
    fn scale_observed_usage_rejects_zero_used_percent() {
        let error = scale_observed_usage(50.0, 1_000, 0.0).expect_err("zero usage");
        assert!(error.contains("used percentage is zero"));
    }
}
