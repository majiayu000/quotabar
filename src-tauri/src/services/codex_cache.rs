use crate::domain::models::CodexRateLimits;
use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
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
    request_sequence: u64,
    limits: CodexRateLimits,
}

#[derive(Default)]
struct CodexRateLimitCache {
    cached: Option<CachedCodexRateLimits>,
    auth_failures: HashMap<String, u64>,
    unknown_auth_failure: Option<u64>,
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

    fn store(
        &mut self,
        account_id: String,
        auth_stamp: AuthFileStamp,
        request_sequence: u64,
        limits: CodexRateLimits,
    ) -> bool {
        let blocked_by_account = self
            .auth_failures
            .get(&account_id)
            .is_some_and(|failure_sequence| *failure_sequence >= request_sequence);
        let blocked_by_unknown = self
            .unknown_auth_failure
            .is_some_and(|failure_sequence| failure_sequence >= request_sequence);
        let blocked_by_newer_cache = self
            .cached
            .as_ref()
            .is_some_and(|cached| cached.request_sequence > request_sequence);
        if blocked_by_account || blocked_by_unknown || blocked_by_newer_cache {
            return false;
        }

        self.auth_failures.remove(&account_id);
        self.unknown_auth_failure = None;
        self.cached = Some(CachedCodexRateLimits {
            account_id,
            auth_stamp,
            request_sequence,
            limits,
        });
        true
    }

    fn invalidate(&mut self, account_id: Option<&str>, request_sequence: u64) {
        match account_id {
            Some(account_id) => {
                self.auth_failures
                    .entry(account_id.to_string())
                    .and_modify(|sequence| *sequence = (*sequence).max(request_sequence))
                    .or_insert(request_sequence);
            }
            None => {
                self.unknown_auth_failure = Some(
                    self.unknown_auth_failure
                        .map_or(request_sequence, |sequence| sequence.max(request_sequence)),
                );
            }
        }

        let should_clear = self.cached.as_ref().is_some_and(|cached| {
            cached.request_sequence <= request_sequence
                && account_id
                    .is_none_or(|current_account_id| cached.account_id == current_account_id)
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
static NEXT_REQUEST_SEQUENCE: AtomicU64 = AtomicU64::new(1);

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
    request_sequence: u64,
    limits: CodexRateLimits,
) -> Result<bool, String> {
    let stored = cache()
        .lock()
        .map_err(|lock_error| format!("last-good cache lock poisoned: {lock_error}"))?
        .store(account_id, auth_stamp, request_sequence, limits);
    Ok(stored)
}

pub(super) fn invalidate(account_id: Option<&str>, request_sequence: u64) -> Result<(), String> {
    cache()
        .lock()
        .map_err(|lock_error| format!("last-good cache lock poisoned: {lock_error}"))?
        .invalidate(account_id, request_sequence);
    Ok(())
}

pub(super) fn next_request_sequence() -> u64 {
    NEXT_REQUEST_SEQUENCE.fetch_add(1, Ordering::Relaxed)
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
        assert!(cache.store(
            "account-a".to_string(),
            auth_stamp(512, 100),
            1,
            sample_rate_limits(),
        ));
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
    fn unknown_account_authentication_failure_clears_older_cached_limits() {
        let mut cache = populated_cache();

        cache.invalidate(None, 2);
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

        cache.invalidate(Some("account-a"), 2);
        let result = cache.retain_for_account(
            Some("account-a"),
            "Network error: operation timed out".to_string(),
        );

        assert!(!result.connected);
    }

    #[test]
    fn older_authentication_failure_does_not_clear_new_same_account_limits() {
        let mut cache = populated_cache();
        assert!(cache.store(
            "account-a".to_string(),
            auth_stamp(513, 101),
            3,
            sample_rate_limits(),
        ));

        cache.invalidate(Some("account-a"), 2);
        let result = cache.retain_for_account(
            Some("account-a"),
            "Network error: operation timed out".to_string(),
        );

        assert!(result.connected);
    }

    #[test]
    fn authentication_failure_blocks_an_older_success_from_repopulating_cache() {
        let mut cache = populated_cache();
        cache.invalidate(Some("account-a"), 3);

        let stored = cache.store(
            "account-a".to_string(),
            auth_stamp(512, 100),
            2,
            sample_rate_limits(),
        );

        assert!(!stored);
        assert!(
            !cache
                .retain_for_account(Some("account-a"), "timeout".to_string())
                .connected
        );
    }

    #[test]
    fn older_success_does_not_replace_newer_cached_limits() {
        let mut cache = populated_cache();
        assert!(cache.store(
            "account-a".to_string(),
            auth_stamp(513, 101),
            3,
            sample_rate_limits(),
        ));

        let stored = cache.store(
            "account-a".to_string(),
            auth_stamp(512, 100),
            2,
            sample_rate_limits(),
        );

        assert!(!stored);
    }

    #[test]
    fn old_authentication_failure_does_not_clear_a_different_accounts_cache() {
        let mut cache = populated_cache();

        cache.invalidate(Some("account-b"), 2);
        let result = cache.retain_for_account(
            Some("account-a"),
            "Network error: operation timed out".to_string(),
        );

        assert!(result.connected);
    }
}
