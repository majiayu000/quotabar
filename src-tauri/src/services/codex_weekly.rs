//! Cached Codex weekly value estimates powered by the `ccstats` SDK.

use once_cell::sync::Lazy;
use std::{
    path::{Path, PathBuf},
    sync::Mutex,
    time::{Duration, Instant},
};

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

pub fn estimate_codex_weekly_value(
    codex_home: &Path,
    quota: &ccstats_quota::CodexWeeklyQuota,
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

    let result = ccstats_quota::estimate_codex_weekly_value(Some(codex_home), true, false)
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
    *cache = Some(CachedWeeklyValue {
        codex_home: codex_home.to_path_buf(),
        quota: quota_identity,
        inserted_at: Instant::now(),
        result: result.clone(),
    });
    result
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
}
