//! Read explicit Claude title records from the usage report's native files.
//! Prompts, responses and last-prompt records are never title fallbacks.
use ccstats::{ProjectDrilldownSummary, SessionTitle, SessionTitleOrigin, UsageSource};
use serde::Deserialize;
use std::{
    collections::{BTreeSet, HashMap, HashSet},
    fs::File,
    io::{self, BufRead, BufReader, Read},
    path::Path,
};

pub fn load(
    projects: &ProjectDrilldownSummary,
    cancelled: &dyn Fn() -> bool,
) -> (HashMap<String, SessionTitle>, Option<String>) {
    if cancelled() {
        return (HashMap::new(), None);
    }
    let sessions = projects
        .projects
        .iter()
        .flat_map(|project| &project.sessions);
    let ids = sessions
        .clone()
        .map(|session| session.session_id.clone())
        .collect::<Vec<_>>();
    let (mut titles, mut errors) = match ccstats::load_session_titles(projects.source, &ids) {
        Ok(titles) => (titles, Vec::new()),
        Err(error) => (HashMap::new(), vec![error.to_string()]),
    };
    if projects.source == UsageSource::Claude {
        // Use native provenance; encoded project names cannot reconstruct Windows paths.
        let paths = sessions
            .flat_map(|session| &session.source_paths)
            .collect::<BTreeSet<_>>();
        let ids = ids.iter().map(String::as_str).collect::<HashSet<_>>();
        let mut custom = HashMap::new();
        let mut generated = HashMap::new();
        // Append order is meaningful within a file. Untimestamped titles in
        // different files have no reliable global order; keep traversal deterministic.
        for path in paths {
            if cancelled() {
                break;
            }
            if let Err(error) = read_claude(
                Path::new(path),
                cancelled,
                &ids,
                &mut custom,
                &mut generated,
            ) {
                errors.push(error.to_string());
            }
        }
        for (id, text) in generated.into_iter().chain(custom) {
            titles.insert(
                id,
                SessionTitle {
                    text,
                    origin: SessionTitleOrigin::SourceTitle,
                },
            );
        }
    }
    (titles, (!errors.is_empty()).then(|| errors.join("; ")))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ClaudeRecord {
    #[serde(rename = "type")]
    kind: Option<String>,
    session_id: Option<String>,
    custom_title: Option<String>,
    ai_title: Option<String>,
}

fn read_claude(
    path: &Path,
    cancelled: &dyn Fn() -> bool,
    ids: &HashSet<&str>,
    custom: &mut HashMap<String, String>,
    generated: &mut HashMap<String, String>,
) -> io::Result<()> {
    if cancelled() {
        return Ok(());
    }
    let file = File::open(path).map_err(|e| {
        io::Error::new(
            e.kind(),
            format!("Cannot read title records {}: {e}", path.display()),
        )
    })?;
    // Capture the current prefix so an active session cannot extend this scan indefinitely.
    let size = file.metadata()?.len();
    let mut lines = BufReader::new(file.take(size)).split(b'\n').enumerate();
    let mut malformed = None;
    while !cancelled() {
        let Some((index, line)) = lines.next() else {
            break;
        };
        let line = line?;
        if line.iter().all(u8::is_ascii_whitespace) {
            continue;
        }
        let row: ClaudeRecord = match serde_json::from_slice(&line) {
            Ok(row) => row,
            Err(_) => {
                malformed.get_or_insert_with(|| {
                    io::Error::new(
                        io::ErrorKind::InvalidData,
                        format!(
                            "Malformed title records {} at line {}",
                            path.display(),
                            index + 1
                        ),
                    )
                });
                continue;
            }
        };
        let Some(id) = row.session_id.filter(|id| ids.contains(id.as_str())) else {
            continue;
        };
        let (title, target) = match row.kind.as_deref() {
            Some("custom-title") => (row.custom_title, &mut *custom),
            Some("ai-title") => (row.ai_title, &mut *generated),
            _ => continue,
        };
        // Blank records do not create an invisible name or erase an existing title.
        if let Some(title) = title.filter(|title| !title.trim().is_empty()) {
            target.insert(id, title.trim().to_owned());
        }
    }
    malformed.map_or(Ok(()), Err)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU64, Ordering};

    fn fixture(content: &str) -> std::path::PathBuf {
        static NEXT: AtomicU64 = AtomicU64::new(0);
        let path = std::env::temp_dir().join(format!(
            "quotabar-titles-{}-{}-{}.jsonl",
            std::process::id(),
            chrono::Utc::now().timestamp_nanos_opt().unwrap(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        ));
        std::fs::write(&path, content).unwrap();
        path
    }

    #[test]
    fn explicit_titles_follow_session_ids_and_append_order_without_prompt_fallbacks() {
        let content = concat!(
            "{\"type\":\"user\",\"sessionId\":\"untitled\",\"message\":{\"content\":\"PRIVATE PROMPT\"}}\n",
            "{\"type\":\"last-prompt\",\"sessionId\":\"untitled\",\"lastPrompt\":\"PRIVATE PROMPT\"}\n",
            "{\"type\":\"custom-title\",\"sessionId\":\"one\",\"customTitle\":\"Old\"}\n",
            "{\"type\":\"custom-title\",\"sessionId\":\"two\",\"customTitle\":\"第二个会话\"}\n",
            "{\"type\":\"custom-title\",\"sessionId\":\"other\",\"customTitle\":\"Not requested\"}\n",
            "{\"type\":\"custom-title\",\"sessionId\":\"one\",\"customTitle\":\" 修复标题 🛠️ \"}\n",
            "{\"type\":\"custom-title\",\"sessionId\":\"one\",\"customTitle\":\"  \"}\n",
            "{\"type\":\"ai-title\",\"sessionId\":\"one\",\"aiTitle\":\"Later generated title\"}\n",
            "{\"type\":\"ai-title\",\"sessionId\":\"generated\",\"aiTitle\":\"原生自动标题\"}\n",
        );
        let path = fixture(content);
        let (mut custom, mut generated) = (HashMap::new(), HashMap::new());
        read_claude(
            &path,
            &|| false,
            &HashSet::from(["one", "two", "untitled", "generated"]),
            &mut custom,
            &mut generated,
        )
        .unwrap();
        generated.extend(custom);
        assert_eq!(generated.len(), 3);
        assert_eq!(generated["one"], "修复标题 🛠️");
        assert_eq!(generated["two"], "第二个会话");
        assert_eq!(generated["generated"], "原生自动标题");
        assert_eq!(std::fs::read_to_string(&path).unwrap(), content);
        std::fs::remove_file(path).unwrap();
    }

    #[test]
    fn titles_in_the_middle_of_large_transcripts_are_not_lost_to_head_tail_limits() {
        let message = serde_json::json!({"type":"assistant","sessionId":"one","message":{"content":"fixture body ".repeat(20_000)}});
        let content = format!("{message}\n{{\"type\":\"custom-title\",\"sessionId\":\"one\",\"customTitle\":\"Middle title\"}}\n{message}\n");
        let path = fixture(&content);
        let mut custom = HashMap::new();
        read_claude(
            &path,
            &|| false,
            &HashSet::from(["one"]),
            &mut custom,
            &mut HashMap::new(),
        )
        .unwrap();
        assert_eq!(custom["one"], "Middle title");
        std::fs::remove_file(path).unwrap();
    }

    #[test]
    fn multiple_files_route_titles_by_record_session_id_without_leaking_unrequested_sessions() {
        let first = fixture(concat!(
            "{\"type\":\"custom-title\",\"sessionId\":\"two\",\"customTitle\":\"Second session\"}\n",
            "{\"type\":\"custom-title\",\"sessionId\":\"unrequested\",\"customTitle\":\"Ignore this\"}\n",
        ));
        let second = fixture(
            "{\"type\":\"custom-title\",\"sessionId\":\"one\",\"customTitle\":\"First session\"}\n",
        );
        let mut custom = HashMap::new();
        for path in [&first, &second] {
            read_claude(
                path,
                &|| false,
                &HashSet::from(["one", "two"]),
                &mut custom,
                &mut HashMap::new(),
            )
            .unwrap();
        }
        assert_eq!(
            custom,
            HashMap::from([
                ("one".into(), "First session".into()),
                ("two".into(), "Second session".into())
            ])
        );
        std::fs::remove_file(first).unwrap();
        std::fs::remove_file(second).unwrap();
    }

    #[test]
    fn malformed_records_and_unreadable_files_are_errors_without_private_values() {
        let path = fixture("{\"type\":\"user\",\"message\":\"PRIVATE PROMPT\"\n");
        let error = read_claude(
            &path,
            &|| false,
            &HashSet::from(["one"]),
            &mut HashMap::new(),
            &mut HashMap::new(),
        )
        .unwrap_err();
        assert_eq!(error.kind(), io::ErrorKind::InvalidData);
        assert!(error.to_string().contains("line 1"));
        assert!(!error.to_string().contains("PRIVATE PROMPT"));
        std::fs::remove_file(&path).unwrap();
        assert_eq!(
            read_claude(
                &path,
                &|| false,
                &HashSet::from(["one"]),
                &mut HashMap::new(),
                &mut HashMap::new()
            )
            .unwrap_err()
            .kind(),
            io::ErrorKind::NotFound
        );
    }

    #[test]
    fn malformed_rows_do_not_hide_later_explicit_titles() {
        let path = fixture(concat!(
            "{\"type\":\"user\",\"message\":\"PRIVATE PROMPT\"\n",
            "{\"type\":\"custom-title\",\"sessionId\":\"one\",\"customTitle\":\"Recovered title\"}\n",
        ));
        let mut custom = HashMap::new();
        let result = read_claude(
            &path,
            &|| false,
            &HashSet::from(["one"]),
            &mut custom,
            &mut HashMap::new(),
        );
        std::fs::remove_file(path).unwrap();
        assert_eq!(
            custom.get("one").map(String::as_str),
            Some("Recovered title")
        );
        let error = result.unwrap_err().to_string();
        assert!(error.contains("line 1"));
        assert!(!error.contains("PRIVATE PROMPT"));
    }

    #[test]
    fn unreadable_title_paths_remain_errors_without_relying_on_permissions() {
        let path = fixture("{}\n");
        // A regular file cannot be a parent directory, even when running as root.
        let invalid = path.join("not-a-file.jsonl");
        let result = read_claude(
            &invalid,
            &|| false,
            &HashSet::from(["one"]),
            &mut HashMap::new(),
            &mut HashMap::new(),
        );
        std::fs::remove_file(path).unwrap();
        assert!(result
            .unwrap_err()
            .to_string()
            .contains("Cannot read title records"));
    }

    #[test]
    fn cancelled_title_reads_do_not_open_files_or_parse_later_records() {
        use std::cell::Cell;
        let path = fixture(concat!(
            "{\"type\":\"custom-title\",\"sessionId\":\"one\",\"customTitle\":\"Read before cancellation\"}\n",
            "{\"type\":\"custom-title\",\"sessionId\":\"two\",\"customTitle\":\"Do not read after cancellation\"}\n",
        ));
        let ids = HashSet::from(["one", "two"]);
        let mut custom = HashMap::new();
        let checks = Cell::new(0);
        read_claude(
            &path,
            &|| {
                let count = checks.get();
                checks.set(count + 1);
                count >= 2 // Open, read the first record, then cancel before the next.
            },
            &ids,
            &mut custom,
            &mut HashMap::new(),
        )
        .unwrap();
        assert_eq!(
            custom,
            HashMap::from([("one".into(), "Read before cancellation".into())])
        );
        assert_eq!(checks.get(), 3);
        read_claude(
            &path.join("not-a-file.jsonl"),
            &|| true,
            &ids,
            &mut custom,
            &mut HashMap::new(),
        )
        .unwrap();
        std::fs::remove_file(path).unwrap();
    }
}
