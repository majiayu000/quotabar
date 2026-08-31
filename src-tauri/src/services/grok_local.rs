//! Exact-window Grok usage totals from the `ccstats` SDK.

use ccstats_quota::{summarize_cost, CostSummary, SummaryOptions, UsageRange, UsageSource};
use chrono::{DateTime, Utc};

#[derive(Debug, Clone, PartialEq)]
pub(super) struct LocalPeriodUsage {
    pub observed_cost_usd: f64,
    pub observed_tokens: i64,
}

pub(super) fn sum_period(
    started: DateTime<Utc>,
    until: DateTime<Utc>,
) -> Result<LocalPeriodUsage, String> {
    let summary = summarize_cost(SummaryOptions {
        source: UsageSource::Grok,
        range: UsageRange::TimestampRange {
            since: started,
            until,
        },
        timezone: Some("UTC".to_string()),
        offline: true,
        strict_pricing: false,
        currency: None,
    })
    .map_err(|error| format!("Could not summarize Grok usage: {error}"))?;

    usage_from_summary(summary)
}

fn usage_from_summary(summary: CostSummary) -> Result<LocalPeriodUsage, String> {
    if summary.parse_error_entries > 0 {
        return Err(format!(
            "Grok usage contains {} malformed record(s) in the active billing period",
            summary.parse_error_entries
        ));
    }

    let coverage = summary
        .api_equivalent_cost_coverage
        .ok_or_else(|| "no Grok inference pricing matched the active billing period".to_string())?;
    if !coverage.complete {
        return Err(format!(
            "Grok API-equivalent pricing covers only {} of {} tokens in the active billing period",
            coverage.priced_tokens, coverage.total_tokens
        ));
    }

    let observed_cost_usd = summary
        .cost_usd
        .filter(|cost| cost.is_finite() && *cost > 0.0)
        .ok_or_else(|| {
            "no positive API-equivalent cost was available for the active Grok period".to_string()
        })?;
    if summary.valid_entries <= 0 || summary.tokens.total_tokens <= 0 {
        return Err("no Grok token usage matched the active billing period".to_string());
    }

    Ok(LocalPeriodUsage {
        observed_cost_usd,
        observed_tokens: summary.tokens.total_tokens,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::TimeZone;
    use std::ffi::OsString;
    use std::fs;
    use std::path::{Path, PathBuf};
    use std::sync::Mutex;

    static ENV_LOCK: Mutex<()> = Mutex::new(());

    fn window() -> (DateTime<Utc>, DateTime<Utc>) {
        (
            Utc.with_ymd_and_hms(2026, 8, 16, 15, 25, 10).unwrap(),
            Utc.with_ymd_and_hms(2026, 8, 23, 15, 25, 10).unwrap(),
        )
    }

    fn write_fixture(dir: &Path, updates: &str, unified: &str) {
        let session = dir.join("sessions").join("proj").join("sid1");
        fs::create_dir_all(&session).expect("session dir");
        fs::write(session.join("updates.jsonl"), updates).expect("updates");
        fs::write(
            session.join("summary.json"),
            r#"{"current_model_id":"grok-4.6","git_root_dir":"/tmp/project"}"#,
        )
        .expect("summary");
        let logs = dir.join("logs");
        fs::create_dir_all(&logs).expect("logs");
        fs::write(logs.join("unified.jsonl"), unified).expect("unified log");
    }

    fn with_grok_home(
        dir: &Path,
        started: DateTime<Utc>,
        until: DateTime<Utc>,
    ) -> Result<LocalPeriodUsage, String> {
        let _guard = ENV_LOCK.lock().expect("environment lock");
        let previous = std::env::var_os("GROK_HOME");
        std::env::set_var("GROK_HOME", dir);
        let result = sum_period(started, until);
        restore_env("GROK_HOME", previous);
        result
    }

    fn restore_env(name: &str, previous: Option<OsString>) {
        match previous {
            Some(value) => std::env::set_var(name, value),
            None => std::env::remove_var(name),
        }
    }

    #[test]
    fn uses_inference_pricing_instead_of_turn_cost_ticks() {
        let dir = tempfile_dir("inference-pricing");
        let (started, until) = window();
        let inside = started + chrono::Duration::hours(1);
        write_fixture(
            &dir,
            &format!(
                r#"{{"timestamp":{},"params":{{"update":{{"sessionUpdate":"turn_completed","usage":{{"totalTokens":110,"inputTokens":100,"outputTokens":10}}}}}}}}"#,
                inside.timestamp()
            ),
            &format!(
                r#"{{"ts":"{}","sid":"sid1","msg":"shell.turn.inference_done","ctx":{{"loop_index":1,"prompt_tokens":100,"cached_prompt_tokens":40,"completion_tokens":10,"reasoning_tokens":0}}}}"#,
                inside.to_rfc3339()
            ),
        );

        let usage = with_grok_home(&dir, started, until).expect("sum");

        assert!((usage.observed_cost_usd - 0.000_2).abs() < 1e-12);
        assert_eq!(usage.observed_tokens, 110);
    }

    #[test]
    fn rejects_incomplete_inference_pricing_coverage() {
        let dir = tempfile_dir("partial-coverage");
        let (started, until) = window();
        let inside = started + chrono::Duration::hours(1);
        write_fixture(
            &dir,
            &format!(
                r#"{{"timestamp":{},"params":{{"update":{{"sessionUpdate":"turn_completed","usage":{{"totalTokens":220,"inputTokens":200,"outputTokens":20}}}}}}}}"#,
                inside.timestamp()
            ),
            &format!(
                r#"{{"ts":"{}","sid":"sid1","msg":"shell.turn.inference_done","ctx":{{"loop_index":1,"prompt_tokens":100,"cached_prompt_tokens":0,"completion_tokens":10,"reasoning_tokens":0}}}}"#,
                inside.to_rfc3339()
            ),
        );

        let error = with_grok_home(&dir, started, until).expect_err("partial coverage");

        assert!(error.contains("covers only 110 of 220 tokens"));
    }

    #[test]
    fn malformed_inference_record_fails_closed() {
        let dir = tempfile_dir("malformed-inference");
        let (started, until) = window();
        let inside = started + chrono::Duration::hours(1);
        write_fixture(
            &dir,
            &format!(
                r#"{{"timestamp":{},"params":{{"update":{{"sessionUpdate":"turn_completed","usage":{{"totalTokens":110,"inputTokens":100,"outputTokens":10}}}}}}}}"#,
                inside.timestamp()
            ),
            r#"{"msg":"shell.turn.inference_done""#,
        );

        let error = with_grok_home(&dir, started, until).expect_err("malformed inference");

        assert!(error.contains("malformed record"));
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
