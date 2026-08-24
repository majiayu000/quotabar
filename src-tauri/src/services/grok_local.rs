//! Local Grok inference totals from `logs/unified.jsonl`.
//!
//! This path does not use ccstats. It prices `shell.turn.inference_done`
//! records against public xAI API list rates for grok-4.5 / grok-4.6.

use chrono::{DateTime, Utc};
use serde::Deserialize;
use std::collections::HashMap;
use std::fs::{self, File};
use std::io::{BufRead, BufReader};
use std::path::Path;

const INFERENCE_DONE: &str = "shell.turn.inference_done";
const LONG_CONTEXT_THRESHOLD: i64 = 200_000;

#[derive(Debug, Clone, PartialEq)]
pub(super) struct LocalPeriodUsage {
    pub observed_cost_usd: f64,
    pub observed_tokens: i64,
    pub valid_entries: i64,
}

#[derive(Debug, Deserialize, Default)]
struct UnifiedEnvelope {
    ts: Option<String>,
    sid: Option<String>,
    msg: Option<String>,
    ctx: Option<InferenceContext>,
}

#[derive(Debug, Deserialize, Default)]
struct InferenceContext {
    prompt_tokens: Option<i64>,
    cached_prompt_tokens: Option<i64>,
    completion_tokens: Option<i64>,
}

struct Rates {
    input: f64,
    cache_read: f64,
    output: f64,
}

pub(super) fn sum_period(
    grok_home: &Path,
    started: DateTime<Utc>,
    until: DateTime<Utc>,
) -> Result<LocalPeriodUsage, String> {
    let log_path = grok_home.join("logs").join("unified.jsonl");
    if !log_path.is_file() {
        return Err("no Grok token usage matched the active billing period".to_string());
    }
    let models = load_session_models(&grok_home.join("sessions"));
    let file =
        File::open(&log_path).map_err(|error| format!("Failed to read Grok usage log: {error}"))?;
    let mut observed_cost_usd = 0.0;
    let mut observed_tokens: i64 = 0;
    let mut valid_entries: i64 = 0;

    for line in BufReader::new(file).lines() {
        let line = line.map_err(|error| format!("Failed to read Grok usage log: {error}"))?;
        if !line.contains(INFERENCE_DONE) {
            continue;
        }
        let envelope: UnifiedEnvelope = match serde_json::from_str(&line) {
            Ok(value) => value,
            Err(_) => continue,
        };
        if envelope.msg.as_deref() != Some(INFERENCE_DONE) {
            continue;
        }
        let Some(ts) = envelope.ts.as_deref().and_then(parse_rfc3339) else {
            continue;
        };
        if ts < started || ts > until {
            continue;
        }
        let Some(ctx) = envelope.ctx else {
            continue;
        };
        let prompt_tokens = ctx.prompt_tokens.unwrap_or(0).max(0);
        let cached_prompt_tokens = ctx
            .cached_prompt_tokens
            .unwrap_or(0)
            .clamp(0, prompt_tokens);
        let completion_tokens = ctx.completion_tokens.unwrap_or(0).max(0);
        let model = envelope
            .sid
            .as_deref()
            .and_then(|sid| models.get(sid))
            .map(String::as_str)
            .unwrap_or("grok-4.6");
        let Some(cost) = api_cost_usd(
            model,
            prompt_tokens,
            cached_prompt_tokens,
            completion_tokens,
        ) else {
            continue;
        };
        observed_cost_usd += cost;
        observed_tokens = observed_tokens
            .saturating_add(prompt_tokens)
            .saturating_add(completion_tokens);
        valid_entries += 1;
    }

    if valid_entries == 0 || observed_cost_usd <= 0.0 || observed_tokens <= 0 {
        return Err("no Grok token usage matched the active billing period".to_string());
    }
    Ok(LocalPeriodUsage {
        observed_cost_usd,
        observed_tokens,
        valid_entries,
    })
}

fn parse_rfc3339(value: &str) -> Option<DateTime<Utc>> {
    DateTime::parse_from_rfc3339(value)
        .ok()
        .map(|dt| dt.with_timezone(&Utc))
}

fn load_session_models(sessions_dir: &Path) -> HashMap<String, String> {
    let mut models = HashMap::new();
    if sessions_dir.is_dir() {
        visit_summaries(sessions_dir, &mut models);
    }
    models
}

fn visit_summaries(dir: &Path, models: &mut HashMap<String, String>) {
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            visit_summaries(&path, models);
            continue;
        }
        if path.file_name().and_then(|name| name.to_str()) != Some("summary.json") {
            continue;
        }
        let Some(session_id) = path
            .parent()
            .and_then(Path::file_name)
            .and_then(|name| name.to_str())
        else {
            continue;
        };
        let Ok(contents) = fs::read_to_string(&path) else {
            continue;
        };
        let Ok(value) = serde_json::from_str::<serde_json::Value>(&contents) else {
            continue;
        };
        if let Some(model) = value
            .get("current_model_id")
            .and_then(serde_json::Value::as_str)
            .map(str::trim)
            .filter(|model| !model.is_empty())
        {
            models.insert(session_id.to_string(), model.to_string());
        }
    }
}

fn api_cost_usd(
    model: &str,
    prompt_tokens: i64,
    cached_prompt_tokens: i64,
    completion_tokens: i64,
) -> Option<f64> {
    let model = model.to_ascii_lowercase();
    let is_long = prompt_tokens >= LONG_CONTEXT_THRESHOLD;
    let rates = if model.contains("grok-4.6") {
        if is_long {
            Rates {
                input: 4e-6,
                cache_read: 1e-6,
                output: 12e-6,
            }
        } else {
            Rates {
                input: 2e-6,
                cache_read: 0.5e-6,
                output: 6e-6,
            }
        }
    } else if model.contains("grok-4.5") {
        if is_long {
            Rates {
                input: 4e-6,
                cache_read: 0.6e-6,
                output: 12e-6,
            }
        } else {
            Rates {
                input: 2e-6,
                cache_read: 0.3e-6,
                output: 6e-6,
            }
        }
    } else {
        return None;
    };
    let cached_prompt_tokens = cached_prompt_tokens.clamp(0, prompt_tokens.max(0));
    let uncached = prompt_tokens.max(0) - cached_prompt_tokens;
    Some(
        uncached as f64 * rates.input
            + cached_prompt_tokens as f64 * rates.cache_read
            + completion_tokens.max(0) as f64 * rates.output,
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use std::path::PathBuf;

    fn write_log(dir: &Path, body: &str) -> PathBuf {
        let logs = dir.join("logs");
        fs::create_dir_all(&logs).expect("logs dir");
        let path = logs.join("unified.jsonl");
        let mut file = File::create(&path).expect("log");
        file.write_all(body.as_bytes()).expect("write log");
        dir.to_path_buf()
    }

    #[test]
    fn prices_short_grok_46_turn() {
        let cost = api_cost_usd("grok-4.6", 1_000, 0, 100).expect("priced");
        assert!((cost - 0.0026).abs() < 1e-12);
    }

    #[test]
    fn sums_only_inference_inside_window() {
        let dir = tempfile_dir();
        write_log(
            &dir,
            concat!(
                r#"{"msg":"other","ts":"2026-08-24T12:00:00Z"}"#,
                "\n",
                r#"{"msg":"shell.turn.inference_done","ts":"2026-08-22T12:00:00Z","sid":"s1","ctx":{"prompt_tokens":1000,"cached_prompt_tokens":0,"completion_tokens":100}}"#,
                "\n",
                r#"{"msg":"shell.turn.inference_done","ts":"2026-08-24T12:00:00Z","sid":"s1","ctx":{"prompt_tokens":1000,"cached_prompt_tokens":0,"completion_tokens":100}}"#,
                "\n",
            ),
        );
        let started = parse_rfc3339("2026-08-23T15:25:10Z").expect("start");
        let until = parse_rfc3339("2026-08-30T15:25:10Z").expect("end");
        let usage = sum_period(&dir, started, until).expect("sum");
        assert_eq!(usage.valid_entries, 1);
        assert_eq!(usage.observed_tokens, 1_100);
        assert!((usage.observed_cost_usd - 0.0026).abs() < 1e-12);
    }

    fn tempfile_dir() -> PathBuf {
        let dir = std::env::temp_dir().join(format!("quotabar-grok-local-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).expect("temp");
        dir
    }
}
