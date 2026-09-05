//! Cached Codex weekly value estimates powered by the `ccstats` SDK.

use crate::domain::models::{CodexRateLimitWindow, CodexRateLimits};
use once_cell::sync::Lazy;
use std::{
    path::{Path, PathBuf},
    sync::Mutex,
    time::{Duration, Instant},
};

const WEEKLY_WINDOW_MINUTES: i64 = 10_080;

const SUCCESS_CACHE_TTL: Duration = Duration::from_secs(300);
const ERROR_CACHE_TTL: Duration = Duration::from_secs(60);

type WeeklyValueResult = Result<ccstats::CodexWeeklyValueEstimate, String>;

#[derive(Clone)]
struct CachedWeeklyValue {
    codex_home: PathBuf,
    official: OfficialWeeklyIdentity,
    inserted_at: Instant,
    result: WeeklyValueResult,
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct OfficialWeeklyIdentity {
    observed_at: chrono::DateTime<chrono::Utc>,
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

impl From<&OfficialWeeklySnapshot> for OfficialWeeklyIdentity {
    fn from(snapshot: &OfficialWeeklySnapshot) -> Self {
        let window = &snapshot.window;
        Self {
            observed_at: snapshot.observed_at,
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
    official: Option<&OfficialWeeklySnapshot>,
) -> WeeklyValueResult {
    let official =
        official.ok_or_else(|| "The official weekly quota snapshot is unavailable.".to_string())?;
    let official_identity = OfficialWeeklyIdentity::from(official);
    let mut cache = WEEKLY_VALUE_CACHE
        .lock()
        .map_err(|error| format!("Codex weekly value cache unavailable: {error}"))?;

    if let Some(cached) = cache.as_ref() {
        if cached.codex_home == codex_home
            && cached.official == official_identity
            && cached.inserted_at.elapsed() < cache_ttl(&cached.result)
        {
            return cached.result.clone();
        }
    }

    let result = estimate_from_official_window(codex_home, official);
    *cache = Some(CachedWeeklyValue {
        codex_home: codex_home.to_path_buf(),
        official: official_identity,
        inserted_at: Instant::now(),
        result: result.clone(),
    });
    result
}

fn estimate_from_official_window(
    codex_home: &Path,
    snapshot: &OfficialWeeklySnapshot,
) -> WeeklyValueResult {
    ccstats::estimate_codex_weekly_value_for_window(
        &value_window(snapshot)?,
        Some(codex_home),
        false,
        false,
    )
    .map_err(|error| error.to_string())
}

fn value_window(
    snapshot: &OfficialWeeklySnapshot,
) -> Result<ccstats::CodexWeeklyValueWindow, String> {
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
    Ok(ccstats::CodexWeeklyValueWindow {
        observed_at: snapshot.observed_at,
        resets_at: resets,
        window_minutes,
        used_pct: snapshot.window.used_percent,
    })
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

    #[test]
    fn successful_estimates_live_longer_than_errors() {
        let estimate = estimate();

        assert_eq!(cache_ttl(&Ok(estimate)), SUCCESS_CACHE_TTL);
        assert_eq!(cache_ttl(&Err("unavailable".to_string())), ERROR_CACHE_TTL);
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
    fn cache_identity_changes_when_only_the_observation_advances() {
        let limits = limits_with(Some((5.0, 10_080)), None);
        let first = OfficialWeeklySnapshot::from_limits(&limits, chrono::Utc::now()).unwrap();
        let mut second = first.clone();
        second.observed_at += chrono::Duration::seconds(1);
        assert_ne!(
            OfficialWeeklyIdentity::from(&first),
            OfficialWeeklyIdentity::from(&second)
        );
    }

    #[test]
    fn missing_official_snapshot_does_not_use_local_usage() {
        let error = estimate_codex_weekly_value(Path::new("unused"), None).unwrap_err();
        assert!(error.contains("official weekly quota snapshot is unavailable"));
    }

    #[test]
    fn value_window_keeps_the_official_percentage_reset_and_observation_together() {
        let limits = limits_with(Some((5.0, 10_080)), None);
        let observed_at = chrono::DateTime::from_timestamp(1_787_960_000, 0).unwrap();
        let snapshot = OfficialWeeklySnapshot::from_limits(&limits, observed_at).unwrap();
        let window = value_window(&snapshot).unwrap();
        assert_eq!(window.used_pct, 5.0);
        assert_eq!(window.resets_at.timestamp(), 1_787_961_600);
        assert_eq!(window.observed_at, observed_at);
        assert_eq!(window.window_minutes, 10_080);
    }

    #[test]
    fn missing_local_pace_does_not_discard_an_official_window_estimate() {
        let data = crate::domain::models::CodexWeeklyQuotaData::from_results(
            Err("No local quota snapshot".to_string()),
            Ok(estimate()),
        );
        assert!(data.quota.is_none());
        assert_eq!(data.error.as_deref(), Some("No local quota snapshot"));
        assert!(data.value_estimate.is_some());
        assert!(data.value_estimate_error.is_none());
    }
}
