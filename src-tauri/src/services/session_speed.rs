//! Output speed of Claude responses from native transcript timestamps.
//!
//! A response runs from its trigger (the nearest `user` record in its parent
//! chain: a prompt or tool result) to its last logged content block. The start
//! never precedes the previous response in the same thread, so queued prompts
//! do not count earlier turns. The figure includes time to first token.
//! Responses whose chain passes a `system` record (API retries, resumes), has
//! no user trigger, reports no output or has no positive duration are excluded
//! rather than estimated.
use ccstats::{ProjectDrilldownSummary, UsageSource};
use serde::{Deserialize, Serialize};
use std::{
    collections::{BTreeMap, BTreeSet, HashMap, HashSet},
    fs::File,
    io::{self, BufRead, BufReader, Read},
    path::Path,
};

#[derive(Debug, Default, PartialEq, Serialize)]
pub struct SessionSpeed {
    /// Median output tokens per second across measured responses. `None` when
    /// nothing is measurable, or when a model filter would make an all-model
    /// figure disagree with the filtered session totals.
    pub median_tokens_per_second: Option<f64>,
    pub measured_responses: usize,
    pub excluded_responses: usize,
    /// Per native model ID, so model changes are not mistaken for slowdowns.
    pub models: Vec<ModelSpeed>,
}

#[derive(Debug, PartialEq, Serialize)]
pub struct ModelSpeed {
    pub model: String,
    pub median_tokens_per_second: f64,
    pub measured_responses: usize,
}

pub fn load(
    projects: &ProjectDrilldownSummary,
    model_filtered: bool,
    cancelled: &dyn Fn() -> bool,
) -> (HashMap<String, SessionSpeed>, Option<String>) {
    if projects.source != UsageSource::Claude || cancelled() {
        return (HashMap::new(), None);
    }
    let sessions = projects
        .projects
        .iter()
        .flat_map(|project| &project.sessions)
        .collect::<Vec<_>>();
    let ids = sessions
        .iter()
        .map(|session| session.session_id.as_str())
        .collect::<HashSet<_>>();
    let paths = sessions
        .iter()
        .flat_map(|session| &session.source_paths)
        .collect::<BTreeSet<_>>();
    let mut threads = HashMap::new();
    let mut errors = Vec::new();
    for (file, path) in paths.into_iter().enumerate() {
        if cancelled() {
            return (HashMap::new(), None);
        }
        if let Err(error) = read_claude(Path::new(path), file, cancelled, &ids, &mut threads) {
            errors.push(error.to_string());
        }
    }
    let speeds = sessions
        .iter()
        .map(|session| {
            let window = (
                parse_ms(&session.first_timestamp),
                parse_ms(&session.last_timestamp),
            );
            let speed = threads
                .get(session.session_id.as_str())
                .map_or_else(SessionSpeed::default, |thread: &Thread| {
                    thread.speed(window, model_filtered)
                });
            (session.session_id.clone(), speed)
        })
        .collect();
    (speeds, (!errors.is_empty()).then(|| errors.join("; ")))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Record {
    #[serde(rename = "type")]
    kind: Option<String>,
    uuid: Option<String>,
    parent_uuid: Option<String>,
    session_id: Option<String>,
    timestamp: Option<String>,
    is_sidechain: Option<bool>,
    agent_id: Option<String>,
    message: Option<Message>,
}

#[derive(Deserialize)]
struct Message {
    id: Option<String>,
    model: Option<String>,
    usage: Option<Usage>,
}

#[derive(Deserialize)]
struct Usage {
    output_tokens: Option<u64>,
}

#[derive(Clone, Copy, PartialEq)]
enum Kind {
    User,
    Assistant,
    System,
    Other,
}

struct Node {
    kind: Kind,
    parent: Option<String>,
    at_ms: Option<i64>,
}

struct Response {
    file: usize,
    model: String,
    parent: Option<String>,
    first_ms: Option<i64>,
    end_ms: Option<i64>,
    output_tokens: u64,
    /// End of the previous response in the same file and thread.
    previous_end_ms: Option<i64>,
}

#[derive(Default)]
struct Thread {
    nodes: HashMap<String, Node>,
    responses: BTreeMap<String, Response>,
    last_end_ms: HashMap<(usize, bool, Option<String>), i64>,
}

fn parse_ms(value: &str) -> Option<i64> {
    chrono::DateTime::parse_from_rfc3339(value)
        .ok()
        .map(|at| at.timestamp_millis())
}

fn read_claude(
    path: &Path,
    file: usize,
    cancelled: &dyn Fn() -> bool,
    ids: &HashSet<&str>,
    threads: &mut HashMap<String, Thread>,
) -> io::Result<()> {
    let handle = File::open(path).map_err(|e| {
        io::Error::new(
            e.kind(),
            format!("Cannot read speed records {}: {e}", path.display()),
        )
    })?;
    // Capture the current prefix so an active session cannot extend this scan indefinitely.
    let size = handle.metadata()?.len();
    let mut lines = BufReader::new(handle.take(size)).split(b'\n').enumerate();
    let mut malformed = None;
    while !cancelled() {
        let Some((index, line)) = lines.next() else {
            break;
        };
        let line = line?;
        if line.iter().all(u8::is_ascii_whitespace) {
            continue;
        }
        let Ok(row) = serde_json::from_slice::<Record>(&line) else {
            malformed.get_or_insert_with(|| {
                io::Error::new(
                    io::ErrorKind::InvalidData,
                    format!(
                        "Malformed speed records {} at line {}",
                        path.display(),
                        index + 1
                    ),
                )
            });
            continue;
        };
        let Some(id) = row.session_id.as_deref().filter(|id| ids.contains(id)) else {
            continue;
        };
        let thread = threads.entry(id.to_owned()).or_default();
        let at_ms = row.timestamp.as_deref().and_then(parse_ms);
        let kind = match row.kind.as_deref() {
            Some("user") => Kind::User,
            Some("assistant") => Kind::Assistant,
            Some("system") => Kind::System,
            _ => Kind::Other,
        };
        if let Some(uuid) = row.uuid {
            thread.nodes.entry(uuid).or_insert(Node {
                kind,
                parent: row.parent_uuid.clone(),
                at_ms,
            });
        }
        let Some(message) = row.message.filter(|_| kind == Kind::Assistant) else {
            continue;
        };
        let (Some(message_id), Some(model)) = (message.id, message.model) else {
            continue;
        };
        // Claude Code writes synthetic error notices as assistant messages.
        if model == "<synthetic>" {
            continue;
        }
        let lane = (file, row.is_sidechain == Some(true), row.agent_id);
        let previous_end_ms = thread.last_end_ms.get(&lane).copied();
        if let Some(at) = at_ms {
            let end = thread.last_end_ms.entry(lane).or_insert(at);
            *end = (*end).max(at);
        }
        let response = thread
            .responses
            .entry(message_id)
            .or_insert_with(|| Response {
                file,
                model,
                parent: row.parent_uuid,
                first_ms: at_ms,
                end_ms: None,
                output_tokens: 0,
                previous_end_ms,
            });
        // A resumed transcript can copy earlier responses; the first file owns them.
        if response.file != file {
            continue;
        }
        response.end_ms = response.end_ms.max(at_ms);
        // Streaming blocks repeat usage; the largest count is the final one.
        let output = message.usage.and_then(|usage| usage.output_tokens);
        response.output_tokens = response.output_tokens.max(output.unwrap_or(0));
    }
    malformed.map_or(Ok(()), Err)
}

impl Thread {
    /// Seconds from trigger to last block, or `None` when timing is unreliable.
    fn duration_secs(&self, response: &Response) -> Option<f64> {
        let mut parent = response.parent.as_deref();
        // Bounded by the node count so a malformed parent cycle cannot loop.
        for _ in 0..=self.nodes.len() {
            let node = self.nodes.get(parent?)?;
            match node.kind {
                Kind::User => {
                    let start = node
                        .at_ms?
                        .max(response.previous_end_ms.unwrap_or(i64::MIN));
                    let millis = response.end_ms? - start;
                    return (millis > 0).then(|| millis as f64 / 1000.0);
                }
                Kind::Assistant | Kind::System => return None,
                Kind::Other => parent = node.parent.as_deref(),
            }
        }
        None
    }

    fn speed(&self, window: (Option<i64>, Option<i64>), model_filtered: bool) -> SessionSpeed {
        let mut all = Vec::new();
        let mut models = BTreeMap::<&str, Vec<f64>>::new();
        let mut excluded = 0;
        for response in self.responses.values() {
            // Keep only responses overlapping the session's filtered range.
            let in_window = match (window, response.first_ms, response.end_ms) {
                ((Some(since), Some(until)), Some(first), Some(end)) => {
                    end >= since && first <= until
                }
                _ => true,
            };
            if !in_window {
                continue;
            }
            match self
                .duration_secs(response)
                .filter(|_| response.output_tokens > 0)
            {
                Some(secs) => {
                    let rate = response.output_tokens as f64 / secs;
                    all.push(rate);
                    models.entry(&response.model).or_default().push(rate);
                }
                None => excluded += 1,
            }
        }
        SessionSpeed {
            median_tokens_per_second: if model_filtered {
                None
            } else {
                median(&mut all)
            },
            measured_responses: all.len(),
            excluded_responses: excluded,
            models: models
                .into_iter()
                .filter_map(|(model, mut rates)| {
                    Some(ModelSpeed {
                        model: model.to_owned(),
                        measured_responses: rates.len(),
                        median_tokens_per_second: median(&mut rates)?,
                    })
                })
                .collect(),
        }
    }
}

fn median(values: &mut [f64]) -> Option<f64> {
    values.sort_by(f64::total_cmp);
    let mid = values.len() / 2;
    match values.len() {
        0 => None,
        len if len % 2 == 1 => Some(values[mid]),
        _ => Some((values[mid - 1] + values[mid]) / 2.0),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU64, Ordering};

    fn fixture(content: &str) -> std::path::PathBuf {
        static NEXT: AtomicU64 = AtomicU64::new(0);
        let path = std::env::temp_dir().join(format!(
            "quotabar-speed-{}-{}-{}.jsonl",
            std::process::id(),
            chrono::Utc::now().timestamp_nanos_opt().unwrap(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        ));
        std::fs::write(&path, content).unwrap();
        path
    }

    fn user(uuid: &str, parent: Option<&str>, at: &str) -> String {
        serde_json::json!({"type":"user","sessionId":"s","uuid":uuid,"parentUuid":parent,"timestamp":at,"message":{"role":"user","content":"PRIVATE PROMPT"}}).to_string()
    }

    fn other(kind: &str, uuid: &str, parent: &str, at: &str) -> String {
        serde_json::json!({"type":kind,"sessionId":"s","uuid":uuid,"parentUuid":parent,"timestamp":at}).to_string()
    }

    fn block(uuid: &str, parent: &str, at: &str, id: &str, model: &str, output: u64) -> String {
        serde_json::json!({"type":"assistant","sessionId":"s","uuid":uuid,"parentUuid":parent,"timestamp":at,"message":{"id":id,"model":model,"usage":{"output_tokens":output},"content":[]}}).to_string()
    }

    fn read(paths: &[&std::path::Path]) -> Thread {
        let mut threads = HashMap::new();
        for (file, path) in paths.iter().enumerate() {
            read_claude(path, file, &|| false, &HashSet::from(["s"]), &mut threads).unwrap();
        }
        threads.remove("s").unwrap()
    }

    fn ms(value: &str) -> Option<i64> {
        parse_ms(value)
    }

    #[test]
    fn rates_run_from_trigger_to_last_block_and_exclude_unreliable_timing() {
        let lines = [
            // Prompt -> attachment -> two streamed blocks: 200 tokens over 4s = 50/s.
            user("u1", None, "2026-11-01T00:00:00Z"),
            other("attachment", "a1", "u1", "2026-11-01T00:00:01Z"),
            block("b1", "a1", "2026-11-01T00:00:02Z", "m1", "claude-opus", 40),
            block("b2", "b1", "2026-11-01T00:00:04Z", "m1", "claude-opus", 200),
            // Tool execution time before the result is not generation: 300 over 3s.
            user("t1", Some("b2"), "2026-11-01T00:01:00Z"),
            block("b3", "t1", "2026-11-01T00:01:03Z", "m2", "claude-opus", 300),
            // API retry recorded as system: excluded rather than measured.
            user("u2", Some("b3"), "2026-11-01T00:02:00Z"),
            other("system", "e1", "u2", "2026-11-01T00:02:30Z"),
            block("b4", "e1", "2026-11-01T00:05:00Z", "m3", "claude-opus", 500),
            // A prompt queued during an earlier response starts when it ends:
            // 120 tokens over 1s, not over the minute since it was submitted.
            user("q1", Some("b4"), "2026-11-01T00:04:00Z"),
            block("b5", "q1", "2026-11-01T00:05:01Z", "m4", "claude-sonnet", 120),
            // No reported output, synthetic notices and other sessions are ignored or excluded.
            user("u3", Some("b5"), "2026-11-01T00:06:00Z"),
            block("b6", "u3", "2026-11-01T00:06:05Z", "m5", "claude-opus", 0),
            block("b7", "b6", "2026-11-01T00:06:06Z", "m6", "<synthetic>", 0),
            serde_json::json!({"type":"assistant","sessionId":"other","uuid":"x","parentUuid":"u3","timestamp":"2026-11-01T00:06:07Z","message":{"id":"m7","model":"claude-opus","usage":{"output_tokens":9}}}).to_string(),
            // Chained directly to another response: no trigger, excluded.
            block("b8", "b6", "2026-11-01T00:06:09Z", "m8", "claude-opus", 90),
        ];
        let path = fixture(&(lines.join("\n") + "\n"));
        let thread = read(&[&path]);
        std::fs::remove_file(path).unwrap();
        let speed = thread.speed((None, None), false);
        assert_eq!(
            speed,
            SessionSpeed {
                median_tokens_per_second: Some(100.0),
                measured_responses: 3,
                excluded_responses: 3,
                models: vec![
                    ModelSpeed {
                        model: "claude-opus".into(),
                        median_tokens_per_second: 75.0,
                        measured_responses: 2,
                    },
                    ModelSpeed {
                        model: "claude-sonnet".into(),
                        median_tokens_per_second: 120.0,
                        measured_responses: 1,
                    },
                ],
            }
        );
        // A model filter keeps per-model rates but hides the mixed-model median.
        let filtered = thread.speed((None, None), true);
        assert_eq!(filtered.median_tokens_per_second, None);
        assert_eq!(filtered.models, speed.models);
        // Responses outside the session's selected range are not counted.
        let window = thread.speed(
            (ms("2026-11-01T00:01:00Z"), ms("2026-11-01T00:01:30Z")),
            false,
        );
        assert_eq!(window.median_tokens_per_second, Some(100.0));
        assert_eq!(
            (window.measured_responses, window.excluded_responses),
            (1, 0)
        );
    }

    #[test]
    fn resumed_copies_in_later_files_do_not_double_count_or_extend_responses() {
        let first = fixture(&format!(
            "{}\n{}\n",
            user("u1", None, "2026-11-01T00:00:00Z"),
            block("b1", "u1", "2026-11-01T00:00:02Z", "m1", "claude-opus", 100),
        ));
        let second = fixture(&format!(
            "{}\n{}\n",
            block("b1", "u1", "2026-11-02T00:00:00Z", "m1", "claude-opus", 900),
            user("u2", Some("b1"), "2026-11-02T00:00:01Z"),
        ));
        let thread = read(&[&first, &second]);
        std::fs::remove_file(first).unwrap();
        std::fs::remove_file(second).unwrap();
        let speed = thread.speed((None, None), false);
        assert_eq!(speed.median_tokens_per_second, Some(50.0));
        assert_eq!(speed.measured_responses, 1);
    }

    #[test]
    fn malformed_rows_are_errors_without_private_values_and_do_not_hide_later_rows() {
        let path = fixture(&format!(
            "{{\"type\":\"user\",\"message\":\"PRIVATE PROMPT\"\n{}\n{}\n",
            user("u1", None, "2026-11-01T00:00:00Z"),
            block("b1", "u1", "2026-11-01T00:00:01Z", "m1", "claude-opus", 30),
        ));
        let mut threads = HashMap::new();
        let error = read_claude(&path, 0, &|| false, &HashSet::from(["s"]), &mut threads)
            .unwrap_err()
            .to_string();
        std::fs::remove_file(path).unwrap();
        assert!(error.contains("line 1") && !error.contains("PRIVATE PROMPT"));
        let speed = threads["s"].speed((None, None), false);
        assert_eq!(speed.median_tokens_per_second, Some(30.0));
    }

    #[test]
    fn sessions_without_measurable_responses_have_no_rate() {
        let speed = Thread::default().speed((None, None), false);
        assert_eq!(speed, SessionSpeed::default());
        assert_eq!(median(&mut [3.0, 1.0, 2.0, 10.0]), Some(2.5));
    }
}
