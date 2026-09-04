//! Cached Codex weekly value estimates powered by the `ccstats` SDK.

use crate::domain::models::{CodexRateLimitWindow, CodexRateLimits};
use once_cell::sync::Lazy;
use std::{
    path::{Path, PathBuf},
    sync::Mutex,
    time::{Duration, Instant},
};

const WEEKLY_WINDOW_MINUTES: i64 = 10_080;
const OFFICIAL_RESET_TOLERANCE_SECONDS: i64 = 5 * 60;
const OFFICIAL_USED_TOLERANCE_PCT: f64 = 1.0;

const SUCCESS_CACHE_TTL: Duration = Duration::from_secs(300);
const ERROR_CACHE_TTL: Duration = Duration::from_secs(60);

type WeeklyValueResult = Result<ccstats::CodexWeeklyValueEstimate, String>;

#[derive(Clone, Debug, PartialEq, Eq)]
struct WeeklyQuotaIdentity {
    observed_at: chrono::DateTime<chrono::Utc>,
    resets_at: chrono::DateTime<chrono::Utc>,
    used_pct_bits: u64,
}

impl From<&ccstats::CodexWeeklyQuota> for WeeklyQuotaIdentity {
    fn from(quota: &ccstats::CodexWeeklyQuota) -> Self {
        Self {
            observed_at: quota.observed_at,
            resets_at: quota.resets_at,
            used_pct_bits: quota.used_pct.to_bits(),
        }
    }
}

impl WeeklyQuotaIdentity {
    fn matches_estimate(&self, estimate: &ccstats::CodexWeeklyValueEstimate) -> bool {
        self.observed_at == estimate.observed_at
            && self.resets_at == estimate.resets_at
            && self.used_pct_bits == estimate.used_pct.to_bits()
    }
}

#[derive(Clone)]
struct CachedWeeklyValue {
    codex_home: PathBuf,
    quota: WeeklyQuotaIdentity,
    official: Option<OfficialWeeklyIdentity>,
    inserted_at: Instant,
    result: WeeklyValueResult,
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct OfficialWeeklyIdentity {
    used_pct_bits: u64,
    window_minutes: Option<i64>,
    resets_at: Option<i64>,
}

#[derive(Clone, Debug)]
pub(crate) struct OfficialWeeklySnapshot {
    window: CodexRateLimitWindow,
    observed_at: chrono::DateTime<chrono::Utc>,
}

impl OfficialWeeklySnapshot {
    pub(crate) fn from_limits(
        limits: &CodexRateLimits,
        observed_at: chrono::DateTime<chrono::Utc>,
    ) -> Option<Self> {
        official_weekly_window(limits).cloned().map(|window| Self {
            window,
            observed_at,
        })
    }
}

impl From<&CodexRateLimitWindow> for OfficialWeeklyIdentity {
    fn from(window: &CodexRateLimitWindow) -> Self {
        Self {
            used_pct_bits: window.used_percent.to_bits(),
            window_minutes: window.window_minutes,
            resets_at: window.resets_at,
        }
    }
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
    quota: &ccstats::CodexWeeklyQuota,
    official: Option<&OfficialWeeklySnapshot>,
) -> WeeklyValueResult {
    let quota_identity = WeeklyQuotaIdentity::from(quota);
    let official_identity = official.map(|snapshot| OfficialWeeklyIdentity::from(&snapshot.window));
    let mut cache = WEEKLY_VALUE_CACHE
        .lock()
        .map_err(|error| format!("Codex weekly value cache unavailable: {error}"))?;

    if let Some(cached) = cache.as_ref() {
        if cached.codex_home == codex_home
            && cached.quota == quota_identity
            && cached.official == official_identity
            && cached.inserted_at.elapsed() < cache_ttl(&cached.result)
        {
            return cached.result.clone();
        }
    }

    let result = if quota.used_pct > 0.0
        && official.is_none_or(|snapshot| quota_matches_official(quota, &snapshot.window))
    {
        let local = estimate_from_local_snapshot(codex_home, &quota_identity);
        match (local, official) {
            (Err(error), Some(snapshot)) if should_fallback_to_official(&error) => {
                estimate_from_official_window(codex_home, snapshot)
            }
            (result, _) => result,
        }
    } else if let Some(snapshot) = official {
        estimate_from_official_window(codex_home, snapshot)
    } else {
        Err(
            "cannot estimate weekly value while the provider-reported used percentage is zero"
                .to_string(),
        )
    };
    *cache = Some(CachedWeeklyValue {
        codex_home: codex_home.to_path_buf(),
        quota: quota_identity,
        official: official_identity,
        inserted_at: Instant::now(),
        result: result.clone(),
    });
    result
}

fn should_fallback_to_official(error: &str) -> bool {
    error.contains("used percentage is zero")
        || error.contains("no Codex token usage matched the active weekly quota window")
}

fn quota_matches_official(
    quota: &ccstats::CodexWeeklyQuota,
    official: &CodexRateLimitWindow,
) -> bool {
    weekly_windows_match(
        quota.used_pct,
        quota.window_minutes,
        quota.resets_at,
        official,
    )
}

fn weekly_windows_match(
    used_pct: f64,
    window_minutes: i64,
    resets_at: chrono::DateTime<chrono::Utc>,
    official: &CodexRateLimitWindow,
) -> bool {
    let Some(official_reset) = official
        .resets_at
        .and_then(|timestamp| chrono::DateTime::from_timestamp(timestamp, 0))
    else {
        return false;
    };
    official.window_minutes == Some(window_minutes)
        && (official_reset - resets_at).num_seconds().abs() <= OFFICIAL_RESET_TOLERANCE_SECONDS
        && (official.used_percent - used_pct).abs() <= OFFICIAL_USED_TOLERANCE_PCT
}

fn estimate_from_local_snapshot(
    codex_home: &Path,
    quota_identity: &WeeklyQuotaIdentity,
) -> WeeklyValueResult {
    ccstats::estimate_codex_weekly_value(Some(codex_home), false, false)
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
        })
}

fn estimate_from_official_window(
    codex_home: &Path,
    snapshot: &OfficialWeeklySnapshot,
) -> WeeklyValueResult {
    let window_minutes = snapshot
        .window
        .window_minutes
        .ok_or_else(|| "The official weekly window length is unavailable.".to_string())?;
    let resets_at = snapshot
        .window
        .resets_at
        .ok_or_else(|| "The official weekly reset time is unavailable.".to_string())?;
    let resets = chrono::DateTime::from_timestamp(resets_at, 0)
        .ok_or_else(|| "The official weekly reset time is unavailable.".to_string())?;
    if snapshot.observed_at >= resets {
        return Err("The official weekly quota window has expired.".to_string());
    }
    ccstats::estimate_codex_weekly_value_for_window(
        &ccstats::CodexWeeklyValueWindow {
            observed_at: snapshot.observed_at,
            resets_at: resets,
            window_minutes,
            used_pct: snapshot.window.used_percent,
        },
        Some(codex_home),
        false,
        false,
    )
    .map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn estimate() -> ccstats::CodexWeeklyValueEstimate {
        ccstats::CodexWeeklyValueEstimate {
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
    fn official_identity_changes_with_provider_window() {
        let first = limits_with(Some((25.0, 10_080)), None);
        let second = limits_with(Some((30.0, 10_080)), None);

        assert_ne!(
            first.primary.as_ref().map(OfficialWeeklyIdentity::from),
            second.primary.as_ref().map(OfficialWeeklyIdentity::from),
        );
    }

    fn reset_time() -> chrono::DateTime<chrono::Utc> {
        chrono::DateTime::UNIX_EPOCH + chrono::Duration::seconds(1_787_961_600)
    }

    #[test]
    fn matching_official_window_keeps_the_atomic_local_snapshot() {
        let reset = reset_time();
        let official = CodexRateLimitWindow {
            used_percent: 26.0,
            window_minutes: Some(WEEKLY_WINDOW_MINUTES),
            resets_at: Some(reset.timestamp() + OFFICIAL_RESET_TOLERANCE_SECONDS),
        };

        assert!(weekly_windows_match(
            25.0,
            WEEKLY_WINDOW_MINUTES,
            reset,
            &official
        ));
    }

    #[test]
    fn divergent_official_usage_requires_the_official_snapshot() {
        let reset = reset_time();
        let official = CodexRateLimitWindow {
            used_percent: 26.01,
            window_minutes: Some(WEEKLY_WINDOW_MINUTES),
            resets_at: Some(reset.timestamp()),
        };

        assert!(!weekly_windows_match(
            25.0,
            WEEKLY_WINDOW_MINUTES,
            reset,
            &official
        ));
    }

    #[test]
    fn divergent_official_reset_requires_the_official_snapshot() {
        let reset = reset_time();
        let official = CodexRateLimitWindow {
            used_percent: 25.0,
            window_minutes: Some(WEEKLY_WINDOW_MINUTES),
            resets_at: Some(reset.timestamp() + OFFICIAL_RESET_TOLERANCE_SECONDS + 1),
        };

        assert!(!weekly_windows_match(
            25.0,
            WEEKLY_WINDOW_MINUTES,
            reset,
            &official
        ));
    }
}
