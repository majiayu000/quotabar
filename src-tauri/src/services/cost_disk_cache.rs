//! Disk persistence for cost summaries so cold starts can paint instantly.

use serde::{de::DeserializeOwned, Serialize};
use std::{
    fs,
    path::{Path, PathBuf},
    time::{Duration, SystemTime, UNIX_EPOCH},
};

/// Snapshots older than this are ignored entirely.
pub const STALE_MAX_AGE: Duration = Duration::from_secs(24 * 60 * 60);

#[derive(serde::Serialize, serde::Deserialize)]
struct Snapshot<T> {
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

fn read_snapshot_in<T: DeserializeOwned>(base_dir: &Path, cache_key: &str) -> Option<(Duration, T)> {
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

    let saved_at = UNIX_EPOCH + Duration::from_millis(snapshot.saved_at_unix_ms);
    let age = SystemTime::now()
        .duration_since(saved_at)
        .unwrap_or(Duration::ZERO);
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
    let snapshot = Snapshot {
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
        eprintln!(
            "[CostCache] failed to create {}: {err}",
            base_dir.display()
        );
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
        let overview = snapshot_path(&base, "overview|claude|USD|local");
        let daily = snapshot_path(&base, "daily|claude|30|USD|local");
        assert_ne!(overview, daily);
        assert_eq!(
            overview.file_name().and_then(|name| name.to_str()),
            Some("cost-overview-claude-USD-local.json")
        );
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
