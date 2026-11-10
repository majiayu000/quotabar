use super::*;

#[cfg(unix)]
fn run_pricing_fixture(live: bool) {
    let root = std::env::temp_dir().join(format!(
        "quotabar-pricing-{}-{}",
        std::process::id(),
        chrono::Utc::now().timestamp_nanos_opt().unwrap()
    ));
    std::fs::create_dir_all(&root).unwrap();
    let output = std::process::Command::new(std::env::current_exe().unwrap())
        .args([
            "--exact",
            "services::cost::pricing_tests::isolated_model_pricing_fixture",
            "--ignored",
            "--nocapture",
        ])
        .env("HOME", &root)
        .env("XDG_CACHE_HOME", root.join("cache"))
        .env("XDG_CONFIG_HOME", root.join("config"))
        .env("CODEX_HOME", root.join("codex"))
        .env("QUOTABAR_PRICING_FIXTURE", &root)
        .env("QUOTABAR_LIVE_PRICING", if live { "1" } else { "0" })
        .output()
        .unwrap();
    if live {
        println!("{}", String::from_utf8_lossy(&output.stdout));
    }
    std::fs::remove_dir_all(root).unwrap();
    assert!(
        output.status.success(),
        "stdout: {}\nstderr: {}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
}

#[cfg(unix)]
#[test]
fn catalog_prices_sol_and_a_new_model_without_a_bundled_rate() {
    run_pricing_fixture(false);
}

#[cfg(unix)]
#[test]
#[ignore = "downloads the public price catalog; run manually with --ignored"]
fn sol_and_fable_prices_download_automatically_without_a_price_cache() {
    run_pricing_fixture(true);
}

#[cfg(unix)]
#[test]
#[ignore = "isolated child process for pricing fixtures"]
fn isolated_model_pricing_fixture() {
    let Some(root) = std::env::var_os("QUOTABAR_PRICING_FIXTURE") else {
        return;
    };
    let root = std::path::PathBuf::from(root);
    let live = std::env::var("QUOTABAR_LIVE_PRICING").unwrap() == "1";
    let pricing_path = root.join("cache/ccstats/pricing.json");
    assert!(!pricing_path.exists());
    if !live {
        // OpenAI standard rates checked 2026-09-30, including >272K pricing:
        // https://developers.openai.com/api/docs/pricing
        let prices = serde_json::json!({
            "gpt-6.1-sol": {
                "input_cost_per_token": 2e-6,
                "output_cost_per_token": 10e-6,
                "cache_read_input_token_cost": 0.1e-6,
                "cache_creation_input_token_cost": 2.5e-6,
                "input_cost_per_token_above_272k_tokens": 4e-6,
                "output_cost_per_token_above_272k_tokens": 15e-6,
                "cache_read_input_token_cost_above_272k_tokens": 0.2e-6,
                "cache_creation_input_token_cost_above_272k_tokens": 5e-6
            },
            "gpt-99-sol": {"input_cost_per_token": 7e-6, "output_cost_per_token": 11e-6},
            // https://platform.claude.com/docs/en/models/fable-5-2/overview
            // Standard rates checked 2026-11-10.
            "claude-fable-5-2": {
                "input_cost_per_token": 8e-6,
                "output_cost_per_token": 40e-6,
                "cache_read_input_token_cost": 0.2e-6,
                "cache_creation_input_token_cost": 10e-6,
                "cache_creation_input_token_cost_above_1hr": 16e-6
            }
        });
        std::fs::create_dir_all(pricing_path.parent().unwrap()).unwrap();
        std::fs::write(&pricing_path, serde_json::to_vec(&prices).unwrap()).unwrap();
    }
    let sessions = root.join("codex/sessions");
    std::fs::create_dir_all(&sessions).unwrap();
    let mut cases = vec![
        ("short", "gpt-6.1-sol", 200_000, 100_000, 20_000),
        ("long", "gpt-6.1-sol", 400_000, 100_000, 20_000),
    ];
    if !live {
        cases.push(("future", "gpt-99-sol", 10_000, 0, 1_000));
        cases.push(("unknown", "unpriced-model", 10_000, 0, 1_000));
    }
    for (id, model, input, cached, output) in cases {
        let meta = serde_json::json!({"type":"session_meta","payload":{"id":id,"cwd":"/fixture","source":"cli"}});
        let event = serde_json::json!({
            "type":"event_msg", "timestamp":chrono::Utc::now().to_rfc3339(),
            "payload":{"type":"token_count","info":{"model":model,"total_token_usage":{
                "input_tokens":input,"cached_input_tokens":cached,"output_tokens":output,
                "cache_write_input_tokens":if model == "gpt-6.1-sol" { 20_000 } else { 0 },
                "reasoning_output_tokens":5_000.min(output),"total_tokens":input + output
            }}}
        });
        std::fs::write(
            sessions.join(format!("{id}.jsonl")),
            format!("{meta}\n{event}\n"),
        )
        .unwrap();
    }
    let overview = build_cost_overview("codex".into(), None, None, true).unwrap();
    assert!(
        pricing_path.exists(),
        "online pricing must populate the cache"
    );
    let expected = if live { 1.96 } else { 2.041 };
    for range in &overview.ranges {
        assert!(
            (range.cost_usd.unwrap() - expected).abs() < 1e-9,
            "expected {expected}, got {range:?}"
        );
        let sol = range
            .models
            .iter()
            .find(|m| m.model == "gpt-6.1-sol")
            .unwrap();
        assert!((sol.cost_usd.unwrap() - 1.96).abs() < 1e-9);
        if !live {
            let unknown = range
                .models
                .iter()
                .find(|m| m.model == "unpriced-model")
                .unwrap();
            assert_eq!(unknown.cost_usd, None);
        }
    }
    let daily = build_cost_daily("codex".into(), 1, None, None, true).unwrap();
    assert!((daily.days[0].cost_usd.unwrap() - expected).abs() < 1e-9);

    let claude_project = root.join(".claude/projects/fable-fixture");
    std::fs::create_dir_all(&claude_project).unwrap();
    let event = serde_json::json!({
        "type": "assistant", "sessionId": "fable-fixture",
        "timestamp": chrono::Utc::now().to_rfc3339(),
        "message": {"id": "fable-message", "model": "claude-fable-5-2", "usage": {
            "input_tokens": 10_000, "output_tokens": 2_000,
            "cache_read_input_tokens": 100_000, "cache_creation_input_tokens": 5_000,
            "cache_creation": {"ephemeral_5m_input_tokens": 3_000, "ephemeral_1h_input_tokens": 2_000}
        }}
    });
    std::fs::write(claude_project.join("session.jsonl"), format!("{event}\n")).unwrap();
    let fable = build_cost_overview("claude".into(), None, None, true).unwrap();
    // $0.08 input + $0.08 output + $0.02 read + $0.03 5m write + $0.032 1h write.
    for range in &fable.ranges {
        assert_eq!(range.models.len(), 1);
        assert!(range.models[0].model.contains("fable-5-2"));
        assert!((range.cost_usd.unwrap() - 0.242).abs() < 1e-9, "{range:?}");
    }
    let daily = build_cost_daily("claude".into(), 1, None, None, true).unwrap();
    assert!((daily.days[0].cost_usd.unwrap() - 0.242).abs() < 1e-9);
    println!("Fable 5.2: input/output/cache read/5m write/1h write total $0.242 in summary and daily history (live={live})");
    // Corrupt prices must retain the SDK error contract, not silently cost $0.
    std::fs::write(pricing_path, "{broken").unwrap();
    let error = ccstats::summarize_cost(ccstats::SummaryOptions {
        source: UsageSource::Codex,
        offline: true,
        ..Default::default()
    })
    .unwrap_err();
    assert!(error.to_string().contains("malformed"));
}
