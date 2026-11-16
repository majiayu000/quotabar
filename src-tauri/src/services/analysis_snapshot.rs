//! Recent UI reports for immediate startup display while fresh analysis runs.
use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;
use serde_json::Value;
use std::{
    path::{Path, PathBuf},
    time::Duration,
};

/// File names of earlier report shapes. Nothing reads them, and they still hold project paths and session titles.
const RETIRED_FILES: [&str; 1] = ["analysis-reports-v1.sqlite3"];

pub fn path() -> Result<PathBuf, String> {
    dirs::cache_dir()
        // Bump when the report shape changes so older payloads are never painted, and retire the old name above.
        .map(|dir| dir.join("quotabar/analysis-reports-v2.sqlite3"))
        .ok_or_else(|| "Cannot locate analysis cache directory".to_string())
}

pub fn key(source: &str, range: &str, query: &impl Serialize) -> Result<String, String> {
    // Relative ranges must never paint yesterday's result as today's usage.
    let now = chrono::Local::now();
    let usage_date =
        ccstats::current_usage_date_with_cli_config().map_err(|error| error.to_string())?;
    serde_json::to_string(&(
        source,
        range,
        query,
        usage_date,
        now.offset().local_minus_utc(),
    ))
    .map_err(|error| error.to_string())
}

fn open(path: &Path) -> Result<Connection, String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    let db = Connection::open(path).map_err(|error| error.to_string())?;
    db.busy_timeout(Duration::from_millis(500))
        .map_err(|error| error.to_string())?;
    db.execute_batch("CREATE TABLE IF NOT EXISTS reports (scope TEXT PRIMARY KEY, payload TEXT NOT NULL, saved_ms INTEGER NOT NULL);")
        .map_err(|error| error.to_string())?;
    Ok(db)
}

pub fn read(path: &Path, key: &str) -> Result<Option<Value>, String> {
    match std::fs::metadata(path) {
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(error.to_string()),
        Ok(_) => {}
    }
    let db = open(path)?;
    let value: Option<String> = db
        .query_row("SELECT payload FROM reports WHERE scope=?1", [key], |row| {
            row.get(0)
        })
        .optional()
        .map_err(|error| error.to_string())?;
    value
        .map(|value| serde_json::from_str(&value).map_err(|error| error.to_string()))
        .transpose()
}

pub fn save(path: &Path, key: &str, report: &impl Serialize) -> Result<(), String> {
    let payload = serde_json::to_string(report).map_err(|error| error.to_string())?;
    let mut db = open(path)?;
    let transaction = db.transaction().map_err(|error| error.to_string())?;
    transaction.execute("INSERT INTO reports(scope,payload,saved_ms) VALUES(?1,?2,?3) ON CONFLICT(scope) DO UPDATE SET payload=excluded.payload,saved_ms=excluded.saved_ms",
        params![key, payload, chrono::Utc::now().timestamp_millis()]).map_err(|error| error.to_string())?;
    transaction.execute("DELETE FROM reports WHERE scope NOT IN (SELECT scope FROM reports ORDER BY saved_ms DESC, rowid DESC LIMIT 8)", [])
        .map_err(|error| error.to_string())?;
    transaction.commit().map_err(|error| error.to_string())?;
    remove_retired(path);
    Ok(())
}

fn remove_retired(current: &Path) {
    for name in RETIRED_FILES {
        for suffix in ["", "-journal", "-wal", "-shm"] {
            // Best effort: a leftover that cannot be deleted must not fail the save that just succeeded.
            let _ = std::fs::remove_file(current.with_file_name(format!("{name}{suffix}")));
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn snapshots_survive_reopen_match_exact_scope_and_keep_only_eight() {
        let dir = std::env::temp_dir().join(format!(
            "quota-snapshot-{}-{}",
            std::process::id(),
            chrono::Utc::now().timestamp_nanos_opt().unwrap()
        ));
        let path = dir.join("snapshots.sqlite3");
        let query = serde_json::json!({"model":null,"project":null});
        let scope = key("all", "last_30_days", &query).unwrap();
        assert_eq!(read(&path, &scope).unwrap(), None);
        let report = serde_json::json!({"generated_at":"2026-09-06T00:00:00Z","total":12345});
        save(&path, &scope, &report).unwrap();
        assert_eq!(read(&path, &scope).unwrap(), Some(report.clone()));
        assert_eq!(
            read(&path, &key("codex", "last_30_days", &query).unwrap()).unwrap(),
            None
        );
        assert_eq!(
            read(&path, &key("all", "today", &query).unwrap()).unwrap(),
            None
        );
        assert_eq!(
            read(
                &path,
                &key(
                    "all",
                    "last_30_days",
                    &serde_json::json!({"model":"gpt-5","project":null})
                )
                .unwrap()
            )
            .unwrap(),
            None
        );
        for index in 0..8 {
            save(&path, &format!("scope-{index}"), &report).unwrap();
        }
        assert_eq!(read(&path, &scope).unwrap(), None);
        let db = open(&path).unwrap();
        assert_eq!(
            db.query_row("SELECT COUNT(*) FROM reports", [], |row| row
                .get::<_, i64>(0))
                .unwrap(),
            8
        );
        db.execute(
            "UPDATE reports SET payload='broken' WHERE scope='scope-7'",
            [],
        )
        .unwrap();
        assert!(read(&path, "scope-7").is_err());
        drop(db);
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn saving_removes_snapshot_files_left_by_older_report_shapes() {
        let dir = std::env::temp_dir().join(format!(
            "quota-snapshot-retired-{}-{}",
            std::process::id(),
            chrono::Utc::now().timestamp_nanos_opt().unwrap()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        // 0.6.0 and earlier kept reports here; 0.7.0 moved to -v2 and left the file behind.
        let retired = dir.join("analysis-reports-v1.sqlite3");
        let retired_journal = dir.join("analysis-reports-v1.sqlite3-journal");
        let unrelated = dir.join("claude-retry-at");
        for file in [&retired, &retired_journal, &unrelated] {
            std::fs::write(file, b"left behind").unwrap();
        }
        let current = dir.join(path().unwrap().file_name().unwrap());
        let report = serde_json::json!({"generated_at":"2026-11-16T00:00:00Z","total":1});
        save(&current, "scope", &report).unwrap();
        assert!(!retired.exists(), "retired snapshot is still on disk");
        assert!(
            !retired_journal.exists(),
            "retired journal is still on disk"
        );
        assert!(unrelated.exists());
        assert_eq!(read(&current, "scope").unwrap(), Some(report));
        std::fs::remove_dir_all(dir).unwrap();
    }
}
