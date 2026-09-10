//! Disk persistence for cost summaries so cold starts can paint instantly.

use serde::{de::DeserializeOwned, Serialize};
use std::{
    fs,
    path::{Path, PathBuf},
    time::{Duration, SystemTime, UNIX_EPOCH},
};

/// Snapshots older than this are ignored entirely.
pub const STALE_MAX_AGE: Duration = Duration::from_secs(24 * 60 * 60);

/// Bump when the cost snapshot or range payload schema changes.
pub const COST_CACHE_SCHEMA_VERSION: u32 = 1;

/// Identity of the compiled `ccstats` crate, injected by `src-tauri/build.rs`.
pub const CCSTATS_VERSION: &str = env!("CCSTATS_VERSION");

#[derive(serde::Serialize, serde::Deserialize)]
struct Snapshot<T> {
    schema_version: u32,
    app_version: String,
    ccstats_version: String,
    saved_at_unix_ms: u64,
    payload: T,
}

/// How a disk snapshot may be used by the caller.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SnapshotUse {
    /// Within the cache TTL: as good as a memory-cache hit.
    Fresh,
    /// Expired but recent enough to paint a first frame once.
    ServeStaleOnce,
    /// Too old (or callers already served it once): ignore.
    Ignore,
}

pub fn cache_identity() -> String {
    format!(
        "v{COST_CACHE_SCHEMA_VERSION}|app{}|ccstats{CCSTATS_VERSION}",
        env!("CARGO_PKG_VERSION"),
    )
}

pub fn versioned_key(parts: &[&str]) -> String {
    format!("{}|{}", cache_identity(), parts.join("|"))
}

pub fn classify_snapshot(age: Duration, ttl: Duration, already_served: bool) -> SnapshotUse {
    if age <= ttl {
        SnapshotUse::Fresh
    } else if age <= STALE_MAX_AGE && !already_served {
        SnapshotUse::ServeStaleOnce
    } else {
        SnapshotUse::Ignore
    }
}

fn default_cache_dir() -> Option<PathBuf> {
    dirs::cache_dir().map(|dir| dir.join("quotabar"))
}

fn snapshot_path(base_dir: &Path, cache_key: &str) -> PathBuf {
    let file_name: String = cache_key
        .chars()
        .map(|ch| if ch.is_ascii_alphanumeric() { ch } else { '-' })
        .collect();
    base_dir.join(format!("cost-{file_name}.json"))
}

pub fn read_snapshot<T: DeserializeOwned>(cache_key: &str) -> Option<(Duration, T)> {
    read_snapshot_in(&default_cache_dir()?, cache_key)
}

pub fn write_snapshot<T: Serialize>(cache_key: &str, payload: &T) {
    let Some(base_dir) = default_cache_dir() else {
        eprintln!("[CostCache] cache dir unavailable; skipping disk write");
        return;
    };
    write_snapshot_in(&base_dir, cache_key, payload);
}

fn current_identity() -> (u32, &'static str, &'static str) {
    (
        COST_CACHE_SCHEMA_VERSION,
        env!("CARGO_PKG_VERSION"),
        CCSTATS_VERSION,
    )
}

fn snapshot_identity_matches<T>(snapshot: &Snapshot<T>) -> bool {
    let (schema, app, ccstats) = current_identity();
    snapshot.schema_version == schema
        && snapshot.app_version == app
        && snapshot.ccstats_version == ccstats
}

fn read_snapshot_in<T: DeserializeOwned>(
    base_dir: &Path,
    cache_key: &str,
) -> Option<(Duration, T)> {
    let path = snapshot_path(base_dir, cache_key);
    let bytes = match fs::read(&path) {
        Ok(bytes) => bytes,
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => return None,
        Err(err) => {
            eprintln!("[CostCache] failed to read {}: {err}", path.display());
            return None;
        }
    };
    let snapshot: Snapshot<T> = match serde_json::from_slice(&bytes) {
        Ok(snapshot) => snapshot,
        Err(err) => {
            eprintln!("[CostCache] discarding corrupt {}: {err}", path.display());
            let _removed = fs::remove_file(&path);
            return None;
        }
    };

    if !snapshot_identity_matches(&snapshot) {
        eprintln!(
            "[CostCache] discarding incompatible snapshot {}",
            path.display()
        );
        let _removed = fs::remove_file(&path);
        return None;
    }

    let saved_at = UNIX_EPOCH + Duration::from_millis(snapshot.saved_at_unix_ms);
    let age = match SystemTime::now().duration_since(saved_at) {
        Ok(age) => age,
        Err(_) => {
            eprintln!("[CostCache] discarding future snapshot {}", path.display());
            let _removed = fs::remove_file(&path);
            return None;
        }
    };
    Some((age, snapshot.payload))
}

fn write_snapshot_in<T: Serialize>(base_dir: &Path, cache_key: &str, payload: &T) {
    let saved_at_unix_ms = match SystemTime::now().duration_since(UNIX_EPOCH) {
        Ok(elapsed) => elapsed.as_millis() as u64,
        Err(err) => {
            eprintln!("[CostCache] system clock before epoch; skipping disk write: {err}");
            return;
        }
    };
    write_snapshot_in_at(base_dir, cache_key, payload, saved_at_unix_ms);
}

fn write_snapshot_in_at<T: Serialize>(
    base_dir: &Path,
    cache_key: &str,
    payload: &T,
    saved_at_unix_ms: u64,
) {
    let (schema_version, app_version, ccstats_version) = current_identity();
    let snapshot = Snapshot {
        schema_version,
        app_version: app_version.to_string(),
        ccstats_version: ccstats_version.to_string(),
        saved_at_unix_ms,
        payload,
    };
    let bytes = match serde_json::to_vec(&snapshot) {
        Ok(bytes) => bytes,
        Err(err) => {
            eprintln!("[CostCache] failed to serialize snapshot {cache_key}: {err}");
            return;
        }
    };

    if let Err(err) = fs::create_dir_all(base_dir) {
        eprintln!("[CostCache] failed to create {}: {err}", base_dir.display());
        return;
    }
    let path = snapshot_path(base_dir, cache_key);
    let tmp_path = path.with_extension("json.tmp");
    if let Err(err) = fs::write(&tmp_path, &bytes) {
        eprintln!("[CostCache] failed to write {}: {err}", tmp_path.display());
        return;
    }
    if let Err(err) = fs::rename(&tmp_path, &path) {
        eprintln!("[CostCache] failed to move {}: {err}", path.display());
        let _removed = fs::remove_file(&tmp_path);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU64, Ordering};

    fn temp_base() -> PathBuf {
        static SEQ: AtomicU64 = AtomicU64::new(0);
        std::env::temp_dir().join(format!(
            "quotabar-cost-cache-test-{}-{}",
            std::process::id(),
            SEQ.fetch_add(1, Ordering::Relaxed)
        ))
    }

    #[test]
    fn snapshot_roundtrip_preserves_payload_and_reports_small_age() {
        let base = temp_base();
        write_snapshot_in(&base, "overview|claude|USD|local", &vec![1_i64, 2, 3]);
        let (age, payload): (Duration, Vec<i64>) =
            read_snapshot_in(&base, "overview|claude|USD|local")
                .expect("snapshot should read back");
        assert_eq!(payload, vec![1, 2, 3]);
        assert!(age < Duration::from_secs(60), "age should be near zero");
        let _cleanup = std::fs::remove_dir_all(&base);
    }

    #[test]
    fn missing_snapshot_returns_none() {
        let base = temp_base();
        let result: Option<(Duration, Vec<i64>)> = read_snapshot_in(&base, "missing");
        assert!(result.is_none());
    }

    #[test]
    fn corrupt_snapshot_is_discarded_and_removed() {
        let base = temp_base();
        std::fs::create_dir_all(&base).expect("temp dir should create");
        let path = snapshot_path(&base, "bad");
        std::fs::write(&path, b"not json").expect("corrupt file should write");
        let result: Option<(Duration, Vec<i64>)> = read_snapshot_in(&base, "bad");
        assert!(result.is_none());
        assert!(!path.exists(), "corrupt file should be deleted");
        let _cleanup = std::fs::remove_dir_all(&base);
    }

    #[test]
    fn cache_keys_map_to_distinct_sanitized_files() {
        let base = PathBuf::from("/base");
        let overview = snapshot_path(&base, &versioned_key(&["claude", "USD", "local"]));
        let daily = snapshot_path(
            &base,
            &versioned_key(&["daily", "claude", "30", "USD", "local"]),
        );
        assert_ne!(overview, daily);
        let overview_name = overview
            .file_name()
            .and_then(|name| name.to_str())
            .expect("file name");
        assert!(overview_name.starts_with("cost-v1-app"));
        let ccstats_file_token: String = CCSTATS_VERSION
            .chars()
            .map(|ch| if ch.is_ascii_alphanumeric() { ch } else { '-' })
            .collect();
        assert!(overview_name.contains(&format!("ccstats{ccstats_file_token}")));
        assert!(overview_name.contains("claude-USD-local"));
    }

    #[test]
    fn ccstats_version_matches_vendor_manifest_and_cargo_dep() {
        let vendor = include_str!("../../../vendor/ccstats/Cargo.toml");
        let cargo = include_str!("../../Cargo.toml");
        assert!(
            vendor.contains(&format!("version = \"{CCSTATS_VERSION}\"")),
            "vendor/ccstats package version must match CCSTATS_VERSION"
        );
        assert!(
            cargo.contains(&format!(
                "ccstats = {{ path = \"../vendor/ccstats\", version = \"{CCSTATS_VERSION}\" }}"
            )),
            "src-tauri/Cargo.toml ccstats version must match CCSTATS_VERSION"
        );
    }

    #[test]
    fn versioned_keys_include_schema_app_and_ccstats() {
        let key = versioned_key(&["claude", "USD", "local"]);
        assert!(key.starts_with(&format!("v{COST_CACHE_SCHEMA_VERSION}|app")));
        assert!(key.contains(&format!("ccstats{CCSTATS_VERSION}")));
        assert!(key.contains(env!("CARGO_PKG_VERSION")));
        assert!(key.ends_with("|claude|USD|local"));
    }

    #[test]
    fn future_saved_at_is_invalid() {
        let base = temp_base();
        let future_ms = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock")
            .as_millis() as u64
            + 60_000;
        write_snapshot_in_at(&base, "future", &vec![1_i64], future_ms);
        let path = snapshot_path(&base, "future");
        assert!(path.exists());
        let result: Option<(Duration, Vec<i64>)> = read_snapshot_in(&base, "future");
        assert!(result.is_none());
        assert!(!path.exists(), "future snapshot should be deleted");
        let _cleanup = std::fs::remove_dir_all(&base);
    }

    #[test]
    fn mismatched_schema_is_discarded() {
        let base = temp_base();
        std::fs::create_dir_all(&base).expect("temp dir should create");
        let snapshot = Snapshot {
            schema_version: COST_CACHE_SCHEMA_VERSION + 1,
            app_version: env!("CARGO_PKG_VERSION").to_string(),
            ccstats_version: CCSTATS_VERSION.to_string(),
            saved_at_unix_ms: 1,
            payload: vec![1_i64],
        };
        let path = snapshot_path(&base, "mismatch");
        std::fs::write(&path, serde_json::to_vec(&snapshot).expect("json"))
            .expect("snapshot should write");
        let result: Option<(Duration, Vec<i64>)> = read_snapshot_in(&base, "mismatch");
        assert!(result.is_none());
        assert!(!path.exists());
        let _cleanup = std::fs::remove_dir_all(&base);
    }

    #[test]
    fn classify_snapshot_covers_fresh_stale_and_ignore() {
        let ttl = Duration::from_secs(1200);
        assert_eq!(
            classify_snapshot(Duration::from_secs(60), ttl, false),
            SnapshotUse::Fresh
        );
        assert_eq!(
            classify_snapshot(Duration::from_secs(3600), ttl, false),
            SnapshotUse::ServeStaleOnce
        );
        assert_eq!(
            classify_snapshot(Duration::from_secs(3600), ttl, true),
            SnapshotUse::Ignore
        );
        assert_eq!(
            classify_snapshot(STALE_MAX_AGE + Duration::from_secs(1), ttl, false),
            SnapshotUse::Ignore
        );
    }
}
