use crate::domain::models::CodexRateLimits;
use std::sync::{Mutex, OnceLock};
use std::time::SystemTime;

#[derive(Clone, Debug, Eq, PartialEq)]
pub(super) struct AuthFileStamp {
    pub(super) len: u64,
    pub(super) modified: SystemTime,
}

struct CachedCodexRateLimits {
    account_id: String,
    auth_stamp: AuthFileStamp,
    limits: CodexRateLimits,
}

#[derive(Default)]
struct CodexRateLimitCache {
    cached: Option<CachedCodexRateLimits>,
}

impl CodexRateLimitCache {
    fn retain_for_account(&self, account_id: Option<&str>, error: String) -> CodexRateLimits {
        match (&self.cached, account_id) {
            (Some(stale), Some(current_account_id)) if stale.account_id == current_account_id => {
                stale_limits_with_error(&stale.limits, error)
            }
            _ => CodexRateLimits::disconnected(error),
        }
    }

    fn retain_for_auth_stamp(
        &self,
        auth_stamp: Option<&AuthFileStamp>,
        error: String,
    ) -> CodexRateLimits {
        match (&self.cached, auth_stamp) {
            (Some(stale), Some(current_stamp)) if stale.auth_stamp == *current_stamp => {
                stale_limits_with_error(&stale.limits, error)
            }
            _ => CodexRateLimits::disconnected(error),
        }
    }

    fn store(&mut self, account_id: String, auth_stamp: AuthFileStamp, limits: CodexRateLimits) {
        self.cached = Some(CachedCodexRateLimits {
            account_id,
            auth_stamp,
            limits,
        });
    }

    fn invalidate(&mut self, auth_stamp: &AuthFileStamp, account_id: Option<&str>) {
        let should_clear = self.cached.as_ref().is_some_and(|cached| {
            account_id.map_or_else(
                || cached.auth_stamp == *auth_stamp,
                |current_account_id| cached.account_id == current_account_id,
            )
        });
        if should_clear {
            self.cached = None;
        }
    }
}

fn stale_limits_with_error(limits: &CodexRateLimits, error: String) -> CodexRateLimits {
    let mut result = limits.clone();
    result.error = Some(error);
    result
}

static LAST_GOOD_LIMITS: OnceLock<Mutex<CodexRateLimitCache>> = OnceLock::new();

fn cache() -> &'static Mutex<CodexRateLimitCache> {
    LAST_GOOD_LIMITS.get_or_init(|| Mutex::new(CodexRateLimitCache::default()))
}

pub(super) fn retain_for_account(
    account_id: Option<&str>,
    error: String,
) -> Result<CodexRateLimits, String> {
    cache()
        .lock()
        .map_err(|lock_error| format!("last-good cache lock poisoned: {lock_error}"))
        .map(|cache| cache.retain_for_account(account_id, error))
}

pub(super) fn retain_for_auth_stamp(
    auth_stamp: Option<&AuthFileStamp>,
    error: String,
) -> Result<CodexRateLimits, String> {
    cache()
        .lock()
        .map_err(|lock_error| format!("last-good cache lock poisoned: {lock_error}"))
        .map(|cache| cache.retain_for_auth_stamp(auth_stamp, error))
}

pub(super) fn store(
    account_id: String,
    auth_stamp: AuthFileStamp,
    limits: CodexRateLimits,
) -> Result<(), String> {
    cache()
        .lock()
        .map_err(|lock_error| format!("last-good cache lock poisoned: {lock_error}"))?
        .store(account_id, auth_stamp, limits);
    Ok(())
}

pub(super) fn invalidate(
    auth_stamp: &AuthFileStamp,
    account_id: Option<&str>,
) -> Result<(), String> {
    cache()
        .lock()
        .map_err(|lock_error| format!("last-good cache lock poisoned: {lock_error}"))?
        .invalidate(auth_stamp, account_id);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{AuthFileStamp, CodexRateLimitCache};
    use crate::domain::models::{CodexRateLimitWindow, CodexRateLimits};
    use std::time::{Duration, UNIX_EPOCH};

    fn sample_rate_limits() -> CodexRateLimits {
        CodexRateLimits {
            connected: true,
            plan_type: Some("pro".to_string()),
            primary: Some(CodexRateLimitWindow {
                used_percent: 39.0,
                window_minutes: Some(300),
                resets_at: Some(1_781_000_000),
            }),
            secondary: None,
            credits: None,
            error: None,
        }
    }

    fn auth_stamp(len: u64, seconds: u64) -> AuthFileStamp {
        AuthFileStamp {
            len,
            modified: UNIX_EPOCH + Duration::from_secs(seconds),
        }
    }

    fn populated_cache() -> CodexRateLimitCache {
        let mut cache = CodexRateLimitCache::default();
        cache.store(
            "account-a".to_string(),
            auth_stamp(512, 100),
            sample_rate_limits(),
        );
        cache
    }

    #[test]
    fn transient_failure_preserves_only_the_same_accounts_limits() {
        let cache = populated_cache();
        let error = "Network error: operation timed out".to_string();

        let same_account = cache.retain_for_account(Some("account-a"), error.clone());
        let switched_account = cache.retain_for_account(Some("account-b"), error.clone());
        let unknown_account = cache.retain_for_account(None, error);

        assert!(same_account.connected);
        assert_eq!(
            same_account.primary.map(|window| window.used_percent),
            Some(39.0)
        );
        assert_eq!(
            same_account.error.as_deref(),
            Some("Network error: operation timed out")
        );
        assert!(!switched_account.connected);
        assert!(!unknown_account.connected);
    }

    #[test]
    fn transient_auth_read_preserves_only_the_same_file_stamp() {
        let cache = populated_cache();
        let error = "Failed to read auth.json: too many open files".to_string();

        let same_file = cache.retain_for_auth_stamp(Some(&auth_stamp(512, 100)), error.clone());
        let changed_file = cache.retain_for_auth_stamp(Some(&auth_stamp(513, 100)), error.clone());
        let replaced_file = cache.retain_for_auth_stamp(Some(&auth_stamp(512, 101)), error.clone());
        let unknown_file = cache.retain_for_auth_stamp(None, error);

        assert!(same_file.connected);
        assert_eq!(
            same_file.error.as_deref(),
            Some("Failed to read auth.json: too many open files")
        );
        assert!(!changed_file.connected);
        assert!(!replaced_file.connected);
        assert!(!unknown_file.connected);
    }

    #[test]
    fn matching_authentication_failure_clears_cached_limits() {
        let mut cache = populated_cache();

        cache.invalidate(&auth_stamp(512, 100), Some("account-a"));
        let result = cache.retain_for_account(
            Some("account-a"),
            "Network error: operation timed out".to_string(),
        );

        assert!(!result.connected);
        assert!(result.primary.is_none());
    }

    #[test]
    fn authentication_failure_clears_same_account_after_auth_file_changes() {
        let mut cache = populated_cache();

        cache.invalidate(&auth_stamp(513, 101), Some("account-a"));
        let result = cache.retain_for_account(
            Some("account-a"),
            "Network error: operation timed out".to_string(),
        );

        assert!(!result.connected);
    }

    #[test]
    fn old_authentication_failure_does_not_clear_a_different_accounts_cache() {
        let mut cache = populated_cache();

        cache.invalidate(&auth_stamp(512, 100), Some("account-b"));
        let result = cache.retain_for_account(
            Some("account-a"),
            "Network error: operation timed out".to_string(),
        );

        assert!(result.connected);
    }
}
