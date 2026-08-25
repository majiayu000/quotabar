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
            .and_then(Value::as_f64)
            .filter(|ticks| ticks.is_finite() && *ticks > 0.0)
            .ok_or_else(|| "a Grok turn_completed record has invalid costUsdTicks".to_string())?;
        let tokens = positive_token_total(usage)?;
        observed_cost_usd += ticks / TICKS_PER_USD;
        observed_tokens = observed_tokens.saturating_add(tokens);
        valid_entries += 1;
        Ok(())
    })?;

    if valid_entries == 0 || observed_cost_usd <= 0.0 || observed_tokens <= 0 {
        return Err("no Grok token usage matched the active billing period".to_string());
    }
    Ok(LocalPeriodUsage {
        observed_cost_usd,
        observed_tokens,
        valid_entries,
    })
}

fn positive_token_total(usage: &Value) -> Result<i64, String> {
    if let Some(total) = usage.get("totalTokens") {
        return total
            .as_i64()
            .filter(|tokens| *tokens > 0)
            .ok_or_else(|| "a Grok turn_completed record has invalid totalTokens".to_string());
    }

    let input = usage
        .get("inputTokens")
        .and_then(Value::as_i64)
        .filter(|tokens| *tokens >= 0)
        .ok_or_else(|| "a Grok turn_completed record has invalid inputTokens".to_string())?;
    let output = usage
        .get("outputTokens")
        .and_then(Value::as_i64)
        .filter(|tokens| *tokens >= 0)
        .ok_or_else(|| "a Grok turn_completed record has invalid outputTokens".to_string())?;
    input
        .checked_add(output)
        .filter(|tokens| *tokens > 0)
        .ok_or_else(|| "a Grok turn_completed record has no positive token usage".to_string())
}

fn visit_updates(
    dir: &Path,
    started: DateTime<Utc>,
    until: DateTime<Utc>,
    on_usage: &mut dyn FnMut(&Value) -> Result<(), String>,
) -> Result<(), String> {
    let entries = fs::read_dir(dir)
        .map_err(|error| format!("Could not read Grok session directory: {error}"))?;
    for entry in entries {
        let entry =
            entry.map_err(|error| format!("Could not read a Grok session entry: {error}"))?;
        let path = entry.path();
        let file_type = entry
            .file_type()
            .map_err(|error| format!("Could not inspect a Grok session entry: {error}"))?;
        if file_type.is_symlink() {
            continue;
        }
        if file_type.is_dir() {
            visit_updates(&path, started, until, on_usage)?;
            continue;
        }
        if path.file_name().and_then(|name| name.to_str()) != Some("updates.jsonl") {
            continue;
        }
        let file = File::open(&path)
            .map_err(|error| format!("Could not open Grok session updates: {error}"))?;
        for line in BufReader::new(file).lines() {
            let line =
                line.map_err(|error| format!("Could not read Grok session updates: {error}"))?;
            if !line.contains("turn_completed") {
                continue;
            }
            let record = serde_json::from_str::<UpdateLine>(&line)
                .map_err(|error| format!("Could not parse Grok session updates: {error}"))?;
            let update = record
                .params
                .and_then(|params| params.update)
                .ok_or_else(|| "a Grok update record is missing update data".to_string())?;
            if update.get("sessionUpdate").and_then(Value::as_str) != Some("turn_completed") {
                continue;
            }
            let ts = record.timestamp.and_then(unix_to_utc).ok_or_else(|| {
                "a Grok turn_completed record has an invalid timestamp".to_string()
            })?;
            if ts < started || ts > until {
                continue;
            }
            let usage = update
                .get("usage")
                .ok_or_else(|| "a Grok turn_completed record is missing usage data".to_string())?;
            on_usage(usage)?;
        }
    }
    Ok(())
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
        let dir = tempfile_dir("valid");
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

    #[test]
    fn malformed_completed_turn_fails_closed() {
        let dir = tempfile_dir("malformed");
        let (started, until) = window();
        let inside = started.timestamp() + 3600;
        write_session(
            &dir,
            &format!(
                "{}\n{}\n",
                format!(
                    r#"{{"timestamp":{inside},"params":{{"update":{{"sessionUpdate":"turn_completed","usage":{{"costUsdTicks":10000000000,"totalTokens":50}}}}}}}}"#
                ),
                r#"{"sessionUpdate":"turn_completed"#,
            ),
        );

        let error = sum_period(&dir, started, until).expect_err("malformed update");
        assert!(error.contains("Could not parse Grok session updates"));
    }

    #[test]
    fn completed_turn_without_cost_fails_closed() {
        let dir = tempfile_dir("missing-cost");
        let (started, until) = window();
        let inside = started.timestamp() + 3600;
        write_session(
            &dir,
            &format!(
                r#"{{"timestamp":{inside},"params":{{"update":{{"sessionUpdate":"turn_completed","usage":{{"totalTokens":50}}}}}}}}"#
            ),
        );

        let error = sum_period(&dir, started, until).expect_err("missing cost");
        assert!(error.contains("invalid costUsdTicks"));
    }

    fn tempfile_dir(label: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "quotabar-grok-local-{}-{label}",
            std::process::id(),
        ));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).expect("temp");
        dir
    }
}
