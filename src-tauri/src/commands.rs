use ccstats::{
    AnalysisFilter, AnalysisSummary, ProjectDrilldownSummary, SessionTitle, SourceDescriptor,
    SourceDiagnosticDescriptor, SummaryOptions, UsageHistory, UsageRange, UsageSource,
};
use serde::{Deserialize, Serialize};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex, OnceLock,
};
use std::{collections::HashMap, str::FromStr};
use tauri::{AppHandle, State};

fn write_analysis_summary(
    directory: &std::path::Path,
    summary: &serde_json::Value,
    format: &str,
) -> Result<String, String> {
    use std::io::Write;
    let content = match format {
        "json" => serde_json::to_vec_pretty(summary).map_err(|e| e.to_string())?,
        "svg" => analysis_summary_svg(summary)?.into_bytes(),
        _ => return Err(format!("不支持的摘要格式：{format}")),
    };
    let path = directory.join(format!(
        "QuotaBar-{}.{format}",
        chrono::Local::now().format("%Y%m%d-%H%M%S-%f")
    ));
    let mut file = std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&path)
        .map_err(|e| format!("无法创建摘要文件：{e}"))?;
    file.write_all(&content)
        .and_then(|_| file.sync_all())
        .map_err(|e| format!("摘要写入失败：{e}"))?;
    Ok(path.to_string_lossy().into_owned())
}

fn analysis_summary_svg(summary: &serde_json::Value) -> Result<String, String> {
    fn escape(value: &str) -> String {
        value
            .replace('&', "&amp;")
            .replace('<', "&lt;")
            .replace('>', "&gt;")
            .replace('\"', "&quot;")
            .replace('\'', "&apos;")
    }
    let tokens = summary["total_tokens"]
        .as_i64()
        .ok_or("摘要缺少 Token 总量")?;
    let since = summary["since"].as_str().ok_or("摘要缺少开始日期")?;
    let until = summary["until"].as_str().ok_or("摘要缺少结束日期")?;
    let source = summary["source"].as_str().unwrap_or("来源已隐藏");
    let cost = summary["cost_label"].as_str().ok_or("摘要缺少费用说明")?;
    let scope = if summary["filtered"].as_bool() == Some(true) {
        "已按选定模型或项目筛选"
    } else {
        "所选来源的合计用量"
    };
    let quality = if summary["data_incomplete"].as_bool() == Some(true)
        || summary["cost_incomplete"].as_bool() == Some(true)
    {
        "数据或价格不完整 · 请保留此说明"
    } else {
        "本地记录 · API 等价估算不代表订阅账单"
    };
    Ok(format!(
        r##"<svg xmlns="http://www.w3.org/2000/svg" width="960" height="540" viewBox="0 0 960 540"><rect width="960" height="540" rx="24" fill="#f7f8fa"/><rect x="28" y="28" width="904" height="484" rx="16" fill="#ffffff" stroke="#e3e6ea"/><g font-family="system-ui, sans-serif" fill="#263346"><text x="76" y="97" font-size="24" font-weight="600">QuotaBar</text><text x="76" y="138" font-size="15" fill="#68788d">{} — {}</text><text x="76" y="253" font-size="66" font-weight="600">{tokens}</text><text x="76" y="290" font-size="19" fill="#68788d">Tokens · {scope}</text><path d="M76 326H884" stroke="#e3e6ea"/><text x="76" y="370" font-size="20" fill="#397e78">{} · 费用参考</text><text x="76" y="410" font-size="15">{}</text><text x="76" y="471" font-size="13" fill="#68788d">{quality}</text></g></svg>"##,
        escape(since),
        escape(until),
        escape(cost),
        escape(source)
    ))
}

#[tauri::command]
pub async fn save_analysis_summary(
    summary: serde_json::Value,
    format: String,
) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let directory = dirs::download_dir().ok_or("无法找到下载文件夹")?;
        write_analysis_summary(&directory, &summary, &format)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn open_analysis(app: AppHandle, source: String) -> Result<(), String> {
    window::open_analysis(app, source).await
}

#[tauri::command]
pub async fn analysis_source(
    state: State<'_, window::AnalysisWindowState>,
) -> Result<String, String> {
    state
        .0
        .lock()
        .map(|source| source.clone())
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn open_quota_popover(app: AppHandle) -> Result<(), String> {
    window::open_quota_popover(app)
}

#[derive(Serialize)]
pub struct AnalysisCatalog {
    sources: Vec<SourceDescriptor>,
    diagnostics: Vec<SourceDiagnosticDescriptor>,
}

#[tauri::command]
pub async fn analysis_catalog() -> Result<AnalysisCatalog, String> {
    tauri::async_runtime::spawn_blocking(|| {
        Ok(AnalysisCatalog {
            sources: ccstats::list_usage_sources().map_err(|e| e.to_string())?,
            diagnostics: ccstats::diagnose_usage_sources().map_err(|e| e.to_string())?,
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

fn analysis_options(source: &str, range: &str) -> Result<SummaryOptions, String> {
    let range = match range {
        "today" => UsageRange::Today,
        "this_week" => UsageRange::ThisWeek,
        "this_month" => UsageRange::ThisMonth,
        "last_7_days" | "last_30_days" => {
            let until = ccstats::current_usage_date_with_cli_config().map_err(|e| e.to_string())?;
            let days = if range == "last_7_days" { 6 } else { 29 };
            let since = until
                .checked_sub_days(chrono::Days::new(days))
                .ok_or("Invalid analysis date range")?;
            UsageRange::DateRange {
                since: Some(since),
                until: Some(until),
            }
        }
        _ => return Err(format!("Unsupported analysis range: {range}")),
    };
    Ok(SummaryOptions {
        source: UsageSource::from_str(source).map_err(|e| e.to_string())?,
        range,
        ..SummaryOptions::default()
    })
}

#[derive(Serialize)]
pub struct SourceUsage {
    source: String,
    summary: AnalysisSummary,
}

#[derive(Serialize)]
pub struct SourceProjects {
    #[serde(flatten)]
    usage: ProjectDrilldownSummary,
    session_titles: HashMap<String, SessionTitle>,
    session_titles_error: Option<String>,
}

#[derive(Default, Deserialize, Serialize)]
pub struct AnalysisQuery {
    model: Option<String>,
    project: Option<String>,
    since: Option<chrono::NaiveDate>,
    until: Option<chrono::NaiveDate>,
}

#[derive(Default, Serialize)]
pub struct AnalysisReport {
    cache_error: Option<String>,
    summaries: Vec<SourceUsage>,
    projects: Vec<SourceProjects>,
    history: Vec<UsageHistory>,
    hourly: Vec<SourceHours>,
    available_models: std::collections::BTreeSet<String>,
    available_projects: std::collections::BTreeSet<String>,
    since: Option<chrono::NaiveDate>,
    until: Option<chrono::NaiveDate>,
    timezone: String,
    generated_at: String,
    errors: Vec<String>,
}

#[derive(Serialize)]
struct SourceHours {
    source_name: String,
    points: Vec<ccstats::HourlyUsagePoint>,
}

#[cfg(test)]
fn load_analysis_report(
    source: &str,
    range: &str,
    query: &AnalysisQuery,
) -> Result<AnalysisReport, String> {
    load_analysis_report_cancellable(source, range, query, &|| false, &|_, _, _| {})
}

fn load_analysis_report_cancellable(
    source: &str,
    range: &str,
    query: &AnalysisQuery,
    cancelled: &(dyn Fn() -> bool + Sync),
    progress: &(dyn Fn(&str, usize, usize) + Sync),
) -> Result<AnalysisReport, String> {
    let mut base_options =
        analysis_options("claude", if range == "custom" { "today" } else { range })?;
    if query.since.is_some() || query.until.is_some() {
        let (Some(since), Some(until)) = (query.since, query.until) else {
            return Err("请选择完整的开始和结束日期".to_string());
        };
        if since > until {
            return Err("开始日期不能晚于结束日期".to_string());
        }
        base_options.range = UsageRange::DateRange {
            since: Some(since),
            until: Some(until),
        };
    } else if range == "custom" {
        return Err("请选择自定义日期范围".to_string());
    }
    let sources = if source == "all" {
        ccstats::diagnose_usage_sources()
            .map_err(|e| e.to_string())?
            .into_iter()
            .filter(|item| item.status != ccstats::SourceDiagnosticStatus::Missing)
            .map(|item| item.name)
            .collect::<Vec<_>>()
    } else {
        vec![source.to_owned()]
    };
    let mut report = AnalysisReport {
        generated_at: chrono::Utc::now().to_rfc3339(),
        ..AnalysisReport::default()
    };
    let total_sources = sources.len();
    for (index, source) in sources.into_iter().enumerate() {
        progress(&source, index + 1, total_sources);
        if cancelled() {
            return Err("Analysis cancelled".to_string());
        }
        let mut options = base_options.clone();
        options.source = source.parse::<UsageSource>().map_err(|e| e.to_string())?;
        let filter = AnalysisFilter {
            model: query.model.clone(),
            project: query.project.clone(),
        };
        match ccstats::usage_analysis_cancellable_with_cli_config(
            options.clone(),
            &filter,
            cancelled,
        ) {
            Ok(result) => {
                let ids = result
                    .projects
                    .projects
                    .iter()
                    .flat_map(|project| &project.sessions)
                    .map(|session| session.session_id.clone())
                    .collect::<Vec<_>>();
                let (session_titles, session_titles_error) =
                    match ccstats::load_session_titles(options.source, &ids) {
                        Ok(titles) => (titles, None),
                        Err(error) => (HashMap::new(), Some(error.to_string())),
                    };
                report.since = result.since;
                report.until = result.until;
                report.timezone = result.timezone;
                report.available_models.extend(result.available_models);
                report.available_projects.extend(result.available_projects);
                report.summaries.push(SourceUsage {
                    source: source.clone(),
                    summary: result.summary,
                });
                report.projects.push(SourceProjects {
                    usage: result.projects,
                    session_titles,
                    session_titles_error,
                });
                report.history.push(result.history);
                report.hourly.push(SourceHours {
                    source_name: source,
                    points: result.hourly,
                });
            }
            Err(error) => report.errors.push(format!("{source} · 用量：{error}")),
        }
    }
    if cancelled() {
        return Err("Analysis cancelled".to_string());
    }
    Ok(report)
}

type AnalysisJobs = Mutex<HashMap<String, Arc<AtomicBool>>>;
static ANALYSIS_JOBS: OnceLock<AnalysisJobs> = OnceLock::new();
fn analysis_jobs() -> &'static AnalysisJobs {
    ANALYSIS_JOBS.get_or_init(|| Mutex::new(HashMap::new()))
}

#[tauri::command]
pub fn cancel_analysis(request_id: String) -> Result<(), String> {
    if let Some(cancelled) = analysis_jobs()
        .lock()
        .map_err(|e| e.to_string())?
        .get(&request_id)
    {
        cancelled.store(true, Ordering::Relaxed);
    }
    Ok(())
}

#[tauri::command]
pub async fn cached_analysis_report(
    source: String,
    range: String,
    query: AnalysisQuery,
) -> Result<Option<serde_json::Value>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        use crate::services::analysis_snapshot;
        analysis_snapshot::read(
            &analysis_snapshot::path()?,
            &analysis_snapshot::key(&source, &range, &query)?,
        )
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn analysis_report(
    app: AppHandle,
    source: String,
    range: String,
    query: AnalysisQuery,
    request_id: String,
) -> Result<AnalysisReport, String> {
    let cancelled = Arc::new(AtomicBool::new(false));
    analysis_jobs()
        .lock()
        .map_err(|e| e.to_string())?
        .insert(request_id.clone(), cancelled.clone());
    let progress_id = request_id.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        let snapshot_key = crate::services::analysis_snapshot::key(&source, &range, &query)?;
        let mut report = load_analysis_report_cancellable(&source, &range, &query, &|| cancelled.load(Ordering::Relaxed), &|source, current, total| {
            use tauri::Emitter;
            if let Err(error) = app.emit_to("analysis", "analysis-progress", serde_json::json!({"requestId":progress_id,"source":source,"current":current,"total":total})) { eprintln!("Unable to send analysis progress: {error}"); }
        })?;
        if !cancelled.load(Ordering::Relaxed) && report.errors.is_empty() {
            use crate::services::analysis_snapshot;
            let save = || analysis_snapshot::save(&analysis_snapshot::path()?, &snapshot_key, &report);
            report.cache_error = save().err();
        }
        Ok::<_,String>(report)
    }).await.map_err(|e| e.to_string());
    analysis_jobs()
        .lock()
        .map_err(|e| e.to_string())?
        .remove(&request_id);
    result?
}

use crate::{
    domain::models::{
        AntigravityData, CodexData, CodexRateLimits, CodexResetCredits, CodexWeeklyQuotaData,
        CursorData, GrokData, QuotaData,
    },
    services::{
        antigravity, claude, codex, codex_weekly, cost, cursor, grok, link, tray, tray_icon, window,
    },
};

// Both windows share these lanes. Run provider-owned auth/cache checks after
// acquiring the lane so a second window cannot race the same cold cache miss.
static CLAUDE_READ: OnceLock<tauri::async_runtime::Mutex<()>> = OnceLock::new();
static CODEX_READ: OnceLock<tauri::async_runtime::Mutex<()>> = OnceLock::new();
static CURSOR_READ: OnceLock<tauri::async_runtime::Mutex<()>> = OnceLock::new();
static GROK_READ: OnceLock<tauri::async_runtime::Mutex<()>> = OnceLock::new();
static ANTIGRAVITY_READ: OnceLock<tauri::async_runtime::Mutex<()>> = OnceLock::new();

async fn provider_read<T>(
    lane: &OnceLock<tauri::async_runtime::Mutex<()>>,
    operation: impl std::future::Future<Output = T>,
) -> T {
    let _guard = lane
        .get_or_init(|| tauri::async_runtime::Mutex::new(()))
        .lock()
        .await;
    operation.await
}

#[tauri::command]
pub async fn get_quota(app: AppHandle, manual: bool) -> Result<QuotaData, String> {
    use tauri::Emitter;
    let result = provider_read(&CLAUDE_READ, claude::fetch_quota(manual)).await;
    if manual {
        app.emit("claude-login-rechecked", ())
            .map_err(|error| format!("Cannot synchronize Claude login result: {error}"))?;
    }
    Ok(result)
}

#[tauri::command]
pub async fn get_codex_info() -> Result<CodexData, String> {
    Ok(provider_read(&CODEX_READ, codex::fetch_codex_info()).await)
}

#[tauri::command]
pub async fn get_codex_rate_limits() -> Result<CodexRateLimits, String> {
    Ok(provider_read(&CODEX_READ, codex::fetch_codex_rate_limits()).await)
}

#[tauri::command]
pub async fn get_codex_reset_credits() -> Result<CodexResetCredits, String> {
    Ok(provider_read(&CODEX_READ, codex::fetch_codex_reset_credits()).await)
}

#[tauri::command]
pub async fn get_codex_weekly_quota() -> Result<CodexWeeklyQuotaData, String> {
    let Some(codex_home) = codex::get_codex_home() else {
        return Ok(CodexWeeklyQuotaData::unavailable(
            "Could not find the Codex home directory",
        ));
    };
    let fetched_official = get_codex_rate_limits().await?;
    let official = if fetched_official.error.is_none() {
        codex_weekly::OfficialWeeklySnapshot::from_limits(&fetched_official, chrono::Utc::now())
    } else {
        None
    };
    let data = tauri::async_runtime::spawn_blocking(move || {
        let quota =
            ccstats::load_codex_weekly_quota(Some(&codex_home)).map_err(|error| error.to_string());
        let value_estimate = match fetched_official.error {
            Some(error) => Err(error),
            None => codex_weekly::estimate_codex_weekly_value(&codex_home, official.as_ref()),
        };
        CodexWeeklyQuotaData::from_results(quota, value_estimate)
    })
    .await
    .map_err(|err| format!("Codex weekly quota task failed: {err}"))?;
    Ok(data)
}

#[tauri::command]
pub async fn get_cursor_info() -> Result<CursorData, String> {
    Ok(provider_read(&CURSOR_READ, cursor::fetch_cursor_info()).await)
}

#[tauri::command]
pub async fn get_antigravity_info() -> Result<AntigravityData, String> {
    Ok(provider_read(&ANTIGRAVITY_READ, antigravity::fetch_antigravity_info()).await)
}

#[tauri::command]
pub async fn get_grok_info() -> Result<GrokData, String> {
    Ok(provider_read(&GROK_READ, grok::fetch_grok_info()).await)
}

#[tauri::command]
pub async fn get_cost_overview(
    source: String,
    currency: Option<String>,
    timezone: Option<String>,
    force: Option<bool>,
) -> Result<cost::CostOverview, String> {
    cost::get_cost_overview(source, currency, timezone, force).await
}

#[tauri::command]
pub async fn get_cost_daily(
    source: String,
    days: u32,
    currency: Option<String>,
    timezone: Option<String>,
    force: Option<bool>,
) -> Result<cost::CostDailySeries, String> {
    cost::get_cost_daily(source, days, currency, timezone, force).await
}

#[tauri::command]
pub fn open_claude_dashboard() -> Result<(), String> {
    link::open_claude_dashboard()
}

#[tauri::command]
pub fn open_codex_dashboard() -> Result<(), String> {
    link::open_codex_dashboard()
}

#[tauri::command]
pub fn open_cursor_dashboard() -> Result<(), String> {
    link::open_cursor_dashboard()
}

#[tauri::command]
pub fn open_antigravity_dashboard() -> Result<(), String> {
    link::open_antigravity_dashboard()
}

#[tauri::command]
pub fn open_grok_dashboard() -> Result<(), String> {
    link::open_grok_dashboard()
}

#[tauri::command]
pub async fn resize_window(app: AppHandle, height: f64) -> Result<(), String> {
    window::resize_window(app, height).await
}

#[tauri::command]
pub async fn set_dock_visibility(app: AppHandle, visible: bool) -> Result<(), String> {
    window::set_dock_visibility(app, visible).await
}

#[tauri::command]
pub async fn update_tray_icon(
    app: AppHandle,
    tray_state: State<'_, tray::TrayState>,
    service: tray::TrayService,
    percentage: Option<u8>,
    visible: bool,
    force: Option<bool>,
    style: Option<tray_icon::TrayIconStyle>,
) -> Result<(), String> {
    tray::update_tray_icon(
        app,
        tray_state,
        service,
        percentage,
        visible,
        force.unwrap_or(false),
        style,
    )
    .await
}

#[tauri::command]
pub fn quit_app(app: AppHandle) {
    app.exit(0);
}

#[cfg(test)]
mod analysis_tests {
    use super::*;
    use std::{
        fs,
        process::Command,
        time::{SystemTime, UNIX_EPOCH},
    };

    #[test]
    fn provider_reads_serialize_without_reusing_another_accounts_result() {
        use std::{
            future::{poll_fn, Future},
            task::{Context, Poll, Waker},
        };
        let lane = OnceLock::new();
        let ready = AtomicBool::new(false);
        let mut first = Box::pin(provider_read(
            &lane,
            poll_fn(|_| {
                if ready.load(Ordering::Relaxed) {
                    Poll::Ready(41)
                } else {
                    Poll::Pending
                }
            }),
        ));
        let mut second = Box::pin(provider_read(&lane, async { 73 }));
        let mut context = Context::from_waker(Waker::noop());
        assert!(first.as_mut().poll(&mut context).is_pending());
        assert!(second.as_mut().poll(&mut context).is_pending());
        ready.store(true, Ordering::Relaxed);
        assert_eq!(first.as_mut().poll(&mut context), Poll::Ready(41));
        assert_eq!(second.as_mut().poll(&mut context), Poll::Ready(73));
    }

    #[test]
    fn summary_card_escapes_text_and_excludes_private_details() {
        let summary = serde_json::json!({"total_tokens":120,"since":"2026-09-01","until":"2026-09-02","source":"<script>& Account","cost_label":"≈ $0.01", "session_title":"PRIVATE TITLE", "project_path":"/PRIVATE/PATH"});
        let card = analysis_summary_svg(&summary).unwrap();
        assert!(card.contains("&lt;script&gt;&amp; Account"));
        assert!(!card.contains("<script>"));
        assert!(!card.contains("PRIVATE"));
        assert!(card.contains("不代表订阅账单"));
        assert!(analysis_summary_svg(&serde_json::json!({})).is_err());
    }

    #[test]
    #[ignore = "manual read-only verification against installed local records"]
    fn real_local_analysis_smoke() {
        crate::raise_fd_limit();
        for pass in ["first", "warm"] {
            let started = std::time::Instant::now();
            let report =
                load_analysis_report("all", "last_30_days", &AnalysisQuery::default()).unwrap();
            let aggregate_ms = started.elapsed().as_millis();
            let snapshot_file = std::env::temp_dir().join(format!(
                "quotabar-real-snapshot-{}-{}.sqlite3",
                std::process::id(),
                pass
            ));
            crate::services::analysis_snapshot::save(&snapshot_file, "benchmark", &report).unwrap();
            let read_started = std::time::Instant::now();
            let saved = crate::services::analysis_snapshot::read(&snapshot_file, "benchmark")
                .unwrap()
                .unwrap();
            let snapshot_ms = read_started.elapsed().as_millis();
            assert!(
                saved == serde_json::to_value(&report).unwrap(),
                "Snapshot must preserve the complete report exactly"
            );
            eprintln!("{pass}: aggregation_ms={aggregate_ms} snapshot_read_ms={snapshot_ms} snapshot_bytes={}", std::fs::metadata(&snapshot_file).unwrap().len());
            std::fs::remove_file(snapshot_file).unwrap();
            for row in &report.summaries {
                let projects = report
                    .projects
                    .iter()
                    .find(|group| group.usage.source_name == row.source)
                    .unwrap();
                let history = report
                    .history
                    .iter()
                    .find(|group| group.source_name == row.source)
                    .unwrap();
                let hours = report
                    .hourly
                    .iter()
                    .find(|group| group.source_name == row.source)
                    .unwrap();
                let total = row.summary.metrics.tokens.total_tokens;
                assert_eq!(
                    projects
                        .usage
                        .projects
                        .iter()
                        .map(|project| project.metrics.tokens.total_tokens)
                        .sum::<i64>(),
                    total
                );
                assert_eq!(
                    history
                        .points
                        .iter()
                        .map(|day| day.tokens.total_tokens)
                        .sum::<i64>(),
                    total
                );
                assert_eq!(
                    hours
                        .points
                        .iter()
                        .map(|hour| hour.tokens.total_tokens)
                        .sum::<i64>(),
                    total
                );
                eprintln!(
                    "{pass}: {} records={} sessions={} tokens={total}",
                    row.source,
                    row.summary.valid_entries,
                    projects
                        .usage
                        .projects
                        .iter()
                        .map(|project| project.sessions.len())
                        .sum::<usize>()
                );
            }
            eprintln!(
                "{pass}: elapsed_ms={} sources={} errors={}",
                started.elapsed().as_millis(),
                report.summaries.len(),
                report.errors.len()
            );
            assert!(report.errors.is_empty(), "{:?}", report.errors);
        }
    }

    #[test]
    fn analysis_summary_is_saved_without_replacing_an_existing_export() {
        let root = std::env::temp_dir().join(format!("quotabar-export-{}", std::process::id()));
        fs::create_dir_all(&root).unwrap();
        let summary = serde_json::json!({"total_tokens": 120, "note": "费用参考"});
        let first = write_analysis_summary(&root, &summary, "json").unwrap();
        let second = write_analysis_summary(&root, &summary, "json").unwrap();
        assert_ne!(first, second);
        assert_eq!(
            serde_json::from_slice::<serde_json::Value>(&fs::read(first).unwrap()).unwrap(),
            summary
        );
        assert!(write_analysis_summary(&root.join("missing-directory"), &summary, "json").is_err());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn rejects_unknown_ranges_and_views_before_scanning() {
        assert!(load_analysis_report("all", "last_8_days", &AnalysisQuery::default()).is_err());
        assert!(load_analysis_report("all", "custom", &AnalysisQuery::default()).is_err());
        assert!(analysis_options("unknown", "today").is_err());
    }

    #[test]
    fn rolling_analysis_ranges_are_inclusive_and_use_the_sdk_date() {
        let today = ccstats::current_usage_date_with_cli_config().unwrap();
        for (name, days) in [("last_7_days", 6), ("last_30_days", 29)] {
            let options = analysis_options("codex", name).unwrap();
            assert_eq!(
                options.range,
                UsageRange::DateRange {
                    since: today.checked_sub_days(chrono::Days::new(days)),
                    until: Some(today)
                }
            );
        }
    }

    #[test]
    fn real_sdk_report_retains_session_identity_titles_and_usage() {
        let root = std::env::temp_dir().join(format!(
            "quotabar-analysis-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let project = root.join("claude/projects/analysis-project");
        fs::create_dir_all(&project).unwrap();
        fs::create_dir_all(root.join(".config/ccstats")).unwrap();
        fs::write(
            root.join(".config/ccstats/config.toml"),
            "offline = true\ntimezone = 'UTC'\n",
        )
        .unwrap();
        let event = serde_json::json!({"timestamp":chrono::Utc::now().to_rfc3339(),"message":{"id":"analysis-message","model":"claude-sonnet-4-20250514","usage":{"input_tokens":100,"output_tokens":20}}});
        let transcript = format!("{event}\n");
        fs::write(project.join("session-one.jsonl"), &transcript).unwrap();
        fs::write(
            project.join("sessions-index.json"),
            r#"{"entries":[{"sessionId":"session-one","summary":"完善用量聚合"}]}"#,
        )
        .unwrap();
        let codex = root.join("codex/sessions/2026/09/02");
        fs::create_dir_all(&codex).unwrap();
        for (id, project, model, tokens, timestamp) in [
            (
                "codex-one",
                "/work/app",
                "gpt-5",
                100,
                "2026-09-02T01:15:00Z",
            ),
            (
                "codex-two",
                "/work/app-extra",
                "gpt-5-mini",
                900,
                "2026-09-01T01:15:00Z",
            ),
        ] {
            let meta = serde_json::json!({"type":"session_meta","payload":{"id":id,"cwd":project,"source":"cli"}});
            let event = serde_json::json!({"type":"event_msg","timestamp":timestamp,"payload":{"type":"token_count","info":{"model":model,"total_token_usage":{"input_tokens":tokens,"output_tokens":0,"total_tokens":tokens}}}});
            fs::write(
                codex.join(format!("rollout-unrelated-filename-{id}.jsonl")),
                format!("{meta}\n{event}\n"),
            )
            .unwrap();
        }
        fs::write(
            root.join("codex/session_index.jsonl"),
            "{\"id\":\"codex-one\",\"thread_name\":\"真实 Codex 标题\"}\n",
        )
        .unwrap();
        let output = Command::new(std::env::current_exe().unwrap())
            .args([
                "--exact",
                "commands::analysis_tests::isolated_analysis_fixture",
                "--ignored",
            ])
            .env("HOME", &root)
            .env("CLAUDE_CONFIG_DIR", root.join("claude"))
            .env("QUOTABAR_ANALYSIS_FIXTURE", &root)
            .env("CODEX_HOME", root.join("codex"))
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );
        let mut usage: serde_json::Value =
            serde_json::from_slice(&fs::read(root.join("usage.json")).unwrap()).unwrap();
        assert_eq!(
            usage["summaries"][0]["summary"]["tokens"]["total_tokens"],
            120
        );
        assert_eq!(
            usage["projects"][0]["projects"][0]["sessions"][0]["session_id"],
            "session-one"
        );
        assert_eq!(
            usage["projects"][0]["session_titles"]["session-one"]["text"],
            "完善用量聚合"
        );
        assert_eq!(
            fs::read_to_string(project.join("session-one.jsonl")).unwrap(),
            transcript
        );
        let mut failed: serde_json::Value =
            serde_json::from_slice(&fs::read(root.join("title-error.json")).unwrap()).unwrap();
        assert!(failed["projects"][0]["session_titles_error"]
            .as_str()
            .unwrap()
            .contains("Malformed"));
        // Query duration is observation metadata, not an accounting result.
        usage["summaries"][0]["summary"]
            .as_object_mut()
            .unwrap()
            .remove("elapsed_ms");
        failed["summaries"][0]["summary"]
            .as_object_mut()
            .unwrap()
            .remove("elapsed_ms");
        assert_eq!(usage["summaries"], failed["summaries"]);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    #[ignore = "runs in an isolated subprocess with synthetic source files"]
    fn isolated_analysis_fixture() {
        let root = std::path::PathBuf::from(
            std::env::var_os("QUOTABAR_ANALYSIS_FIXTURE").expect("fixture directory"),
        );
        for view in ["overview", "usage", "history"] {
            let report =
                load_analysis_report("claude", "this_week", &AnalysisQuery::default()).unwrap();
            assert!(report.errors.is_empty(), "{:?}", report.errors);
            fs::write(
                root.join(format!("{view}.json")),
                serde_json::to_vec(&report).unwrap(),
            )
            .unwrap();
        }
        let query = AnalysisQuery {
            model: Some("gpt-5".into()),
            project: Some("/work/app".into()),
            since: Some("2026-09-02".parse().unwrap()),
            until: Some("2026-09-02".parse().unwrap()),
        };
        let report = load_analysis_report("codex", "custom", &query).unwrap();
        assert!(report.errors.is_empty(), "{:?}", report.errors);
        assert_eq!(report.summaries[0].summary.metrics.tokens.total_tokens, 100);
        assert_eq!(
            report.projects[0].session_titles["codex-one"].text,
            "真实 Codex 标题"
        );
        assert_eq!(
            report.projects[0].usage.projects[0].sessions[0].session_id,
            "codex-one"
        );
        assert_eq!(report.history[0].points[0].tokens.total_tokens, 100);
        assert_eq!(report.hourly[0].points[0].tokens.total_tokens, 100);
        let warm = load_analysis_report("codex", "custom", &query).unwrap();
        assert_eq!(
            warm.summaries[0].summary.metrics,
            report.summaries[0].summary.metrics
        );
        let catalog = AnalysisCatalog {
            sources: ccstats::list_usage_sources().unwrap(),
            diagnostics: ccstats::diagnose_usage_sources().unwrap(),
        };
        fs::write(
            root.join("catalog.json"),
            serde_json::to_vec(&catalog).unwrap(),
        )
        .unwrap();
        fs::write(
            root.join("claude/projects/analysis-project/sessions-index.json"),
            "malformed",
        )
        .unwrap();
        fs::write(
            root.join("title-error.json"),
            serde_json::to_vec(
                &load_analysis_report("claude", "this_week", &AnalysisQuery::default()).unwrap(),
            )
            .unwrap(),
        )
        .unwrap();
    }
}
