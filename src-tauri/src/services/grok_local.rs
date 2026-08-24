//! Local Grok period totals from session `turn_completed.usage`.
//!
//! SuperGrok billing is not the public API list price. Grok records
//! `costUsdTicks` on each completed turn, where 1 USD = 10_000_000_000 ticks
//! (xAI cost tracking). This module sums those ticks inside the official
//! billing window. It does not use ccstats.

use chrono::{DateTime, Utc};
use serde::Deserialize;
use serde_json::Value;
use std::fs::{self, File};
use std::io::{BufRead, BufReader};
use std::path::Path;

const TICKS_PER_USD: f64 = 10_000_000_000.0;

#[derive(Debug, Clone, PartialEq)]
pub(super) struct LocalPeriodUsage {
    pub observed_cost_usd: f64,
    pub observed_tokens: i64,
    pub valid_entries: i64,
}

#[derive(Debug, Deserialize)]
struct UpdateLine {
    timestamp: Option<f64>,
    params: Option<UpdateParams>,
}

#[derive(Debug, Deserialize)]
struct UpdateParams {
    update: Option<Value>,
}

pub(super) fn sum_period(
    grok_home: &Path,
    started: DateTime<Utc>,
    until: DateTime<Utc>,
) -> Result<LocalPeriodUsage, String> {
    let sessions = grok_home.join("sessions");
    if !sessions.is_dir() {
        return Err("no Grok token usage matched the active billing period".to_string());
    }

    let mut observed_cost_usd = 0.0;
    let mut observed_tokens: i64 = 0;
    let mut valid_entries: i64 = 0;
    visit_updates(&sessions, started, until, &mut |usage| {
        let ticks = usage
            .get("costUsdTicks")
            .and_then(Value::as_i64)
            .or_else(|| {
                usage
                    .get("costUsdTicks")
                    .and_then(Value::as_f64)
                    .map(|n| n as i64)
            })
            .unwrap_or(0);
        if ticks <= 0 {
            return;
        }
        let tokens = usage
            .get("totalTokens")
            .and_then(Value::as_i64)
            .unwrap_or_else(|| {
                usage
                    .get("inputTokens")
                    .and_then(Value::as_i64)
                    .unwrap_or(0)
                    + usage
                        .get("outputTokens")
                        .and_then(Value::as_i64)
                        .unwrap_or(0)
            });
        observed_cost_usd += ticks as f64 / TICKS_PER_USD;
        observed_tokens = observed_tokens.saturating_add(tokens.max(0));
        valid_entries += 1;
    });

    if valid_entries == 0 || observed_cost_usd <= 0.0 || observed_tokens <= 0 {
        return Err("no Grok token usage matched the active billing period".to_string());
    }
    Ok(LocalPeriodUsage {
        observed_cost_usd,
        observed_tokens,
        valid_entries,
    })
}

fn visit_updates(
    dir: &Path,
    started: DateTime<Utc>,
    until: DateTime<Utc>,
    on_usage: &mut dyn FnMut(&Value),
) {
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            visit_updates(&path, started, until, on_usage);
            continue;
        }
        if path.file_name().and_then(|name| name.to_str()) != Some("updates.jsonl") {
            continue;
        }
        let Ok(file) = File::open(&path) else {
            continue;
        };
        for line in BufReader::new(file).lines().map_while(Result::ok) {
            if !line.contains("turn_completed") {
                continue;
            }
            let Ok(record) = serde_json::from_str::<UpdateLine>(&line) else {
                continue;
            };
            let Some(ts) = record.timestamp.and_then(unix_to_utc) else {
                continue;
            };
            if ts < started || ts > until {
                continue;
            }
            let Some(update) = record.params.and_then(|params| params.update) else {
                continue;
            };
            if update.get("sessionUpdate").and_then(Value::as_str) != Some("turn_completed") {
                continue;
            }
            if let Some(usage) = update.get("usage") {
                on_usage(usage);
            }
        }
    }
}

fn unix_to_utc(timestamp: f64) -> Option<DateTime<Utc>> {
    let seconds = if timestamp > 1_000_000_000_000.0 {
        timestamp / 1000.0
    } else {
        timestamp
    } as i64;
    DateTime::from_timestamp(seconds, 0)
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::TimeZone;
    use std::fs;
    use std::io::Write;
    use std::path::PathBuf;

    fn write_session(dir: &Path, body: &str) {
        let session = dir.join("sessions").join("proj").join("sid1");
        fs::create_dir_all(&session).expect("session dir");
        let mut file = fs::File::create(session.join("updates.jsonl")).expect("updates");
        file.write_all(body.as_bytes()).expect("write");
    }

    fn window() -> (DateTime<Utc>, DateTime<Utc>) {
        (
            Utc.with_ymd_and_hms(2026, 8, 16, 15, 25, 10).unwrap(),
            Utc.with_ymd_and_hms(2026, 8, 23, 15, 25, 10).unwrap(),
        )
    }

    #[test]
    fn sums_completed_turn_ticks_inside_window() {
        let dir = tempfile_dir();
        let (started, until) = window();
        let inside = started.timestamp() + 3600;
        let outside = started.timestamp() - 3600;
        write_session(
            &dir,
            &format!(
                "{}\n{}\n{}\n",
                r#"{"timestamp":1,"params":{"update":{"sessionUpdate":"tool_call"}}}"#,
                format!(
                    r#"{{"timestamp":{inside},"params":{{"update":{{"sessionUpdate":"turn_completed","usage":{{"costUsdTicks":10000000000,"totalTokens":50,"inputTokens":40,"outputTokens":10}}}}}}}}"#
                ),
                format!(
                    r#"{{"timestamp":{outside},"params":{{"update":{{"sessionUpdate":"turn_completed","usage":{{"costUsdTicks":10000000000,"totalTokens":50}}}}}}}}"#
                ),
            ),
        );
        let usage = sum_period(&dir, started, until).expect("sum");
        assert_eq!(usage.valid_entries, 1);
        assert!((usage.observed_cost_usd - 1.0).abs() < 1e-9);
        assert_eq!(usage.observed_tokens, 50);
    }

    fn tempfile_dir() -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "quotabar-grok-local-{}-{}",
            std::process::id(),
            "ticks"
        ));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).expect("temp");
        dir
    }
}
