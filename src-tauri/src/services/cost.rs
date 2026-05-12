//! Local cost summaries powered by the `ccstats` SDK.

use ccstats::{
    summarize_cost, CostSummary, ModelCostSummary, SummaryOptions, TokenBreakdown, UsageRange,
    UsageSource,
};
use chrono::Utc;
use once_cell::sync::Lazy;
use serde::Serialize;
use std::{
    collections::HashMap,
    str::FromStr,
    sync::Mutex,
    time::{Duration, Instant},
};

const CACHE_TTL: Duration = Duration::from_secs(300);

static COST_CACHE: Lazy<Mutex<HashMap<String, CachedOverview>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));

#[derive(Clone)]
struct CachedOverview {
    inserted_at: Instant,
    overview: CostOverview,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CostOverview {
    pub source: String,
    pub display_name: String,
    pub currency: String,
    pub generated_at: String,
    pub cached: bool,
    pub ranges: Vec<CostRangeSummary>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CostRangeSummary {
    pub range: String,
    pub label: String,
    pub since: Option<String>,
    pub until: Option<String>,
    pub currency: String,
    pub cost: Option<f64>,
    pub cost_usd: Option<f64>,
    pub tokens: CostTokenBreakdown,
    pub models: Vec<CostModelSummary>,
    pub valid_entries: i64,
    pub skipped_entries: i64,
    pub elapsed_ms: f64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CostTokenBreakdown {
    pub input_tokens: i64,
    pub output_tokens: i64,
    pub reasoning_tokens: i64,
    pub cache_creation_tokens: i64,
    pub cache_read_tokens: i64,
    pub total_tokens: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CostModelSummary {
    pub model: String,
    pub cost: Option<f64>,
    pub cost_usd: Option<f64>,
    pub tokens: CostTokenBreakdown,
}

pub async fn get_cost_overview(
    source: String,
    currency: Option<String>,
    timezone: Option<String>,
    force: Option<bool>,
) -> Result<CostOverview, String> {
    tauri::async_runtime::spawn_blocking(move || {
        build_cost_overview(source, currency, timezone, force.unwrap_or(false))
    })
    .await
    .map_err(|err| format!("Cost summary task failed: {err}"))?
}

fn build_cost_overview(
    source: String,
    currency: Option<String>,
    timezone: Option<String>,
    force: bool,
) -> Result<CostOverview, String> {
    let source = UsageSource::from_str(&source).map_err(|err| err.to_string())?;
    let currency = normalize_optional(currency);
    let timezone = normalize_optional(timezone);
    let cache_key = format!(
        "{}|{}|{}",
        source.as_str(),
        currency.as_deref().unwrap_or("USD"),
        timezone.as_deref().unwrap_or("local")
    );

    if !force {
        if let Some(cached) = get_cached_overview(&cache_key)? {
            return Ok(cached);
        }
    }

    let range_specs = [
        ("today", "Today", UsageRange::Today),
        ("week", "This Week", UsageRange::ThisWeek),
        ("month", "This Month", UsageRange::ThisMonth),
    ];

    let mut ranges = Vec::with_capacity(range_specs.len());
    for (range_key, label, range) in range_specs {
        let summary = summarize_cost(SummaryOptions {
            source,
            range,
            timezone: timezone.clone(),
            offline: true,
            strict_pricing: false,
            currency: currency.clone(),
        })
        .map_err(|err| err.to_string())?;
        ranges.push(CostRangeSummary::from_summary(range_key, label, summary));
    }

    let display_name = match source {
        UsageSource::Claude => "Claude Code".to_string(),
        UsageSource::Codex => "Codex".to_string(),
        UsageSource::Cursor => "Cursor".to_string(),
    };
    let currency = ranges
        .first()
        .map(|range| range.currency.clone())
        .unwrap_or_else(|| currency.unwrap_or_else(|| "USD".to_string()));
    let overview = CostOverview {
        source: source.as_str().to_string(),
        display_name,
        currency,
        generated_at: Utc::now().to_rfc3339(),
        cached: false,
        ranges,
    };

    set_cached_overview(cache_key, overview.clone())?;
    Ok(overview)
}

fn normalize_optional(value: Option<String>) -> Option<String> {
    value
        .map(|item| item.trim().to_string())
        .filter(|item| !item.is_empty())
}

fn get_cached_overview(cache_key: &str) -> Result<Option<CostOverview>, String> {
    let cache = COST_CACHE.lock().map_err(|err| err.to_string())?;
    let Some(cached) = cache.get(cache_key) else {
        return Ok(None);
    };
    if cached.inserted_at.elapsed() > CACHE_TTL {
        return Ok(None);
    }

    let mut overview = cached.overview.clone();
    overview.cached = true;
    Ok(Some(overview))
}

fn set_cached_overview(cache_key: String, overview: CostOverview) -> Result<(), String> {
    let mut cache = COST_CACHE.lock().map_err(|err| err.to_string())?;
    cache.insert(
        cache_key,
        CachedOverview {
            inserted_at: Instant::now(),
            overview,
        },
    );
    Ok(())
}

impl CostRangeSummary {
    fn from_summary(range: &str, label: &str, summary: CostSummary) -> Self {
        Self {
            range: range.to_string(),
            label: label.to_string(),
            since: summary.since.map(|date| date.to_string()),
            until: summary.until.map(|date| date.to_string()),
            currency: summary.currency,
            cost: summary.cost,
            cost_usd: summary.cost_usd,
            tokens: CostTokenBreakdown::from(summary.tokens),
            models: summary.models.into_iter().map(CostModelSummary::from).collect(),
            valid_entries: summary.valid_entries,
            skipped_entries: summary.skipped_entries,
            elapsed_ms: summary.elapsed_ms,
        }
    }
}

impl From<TokenBreakdown> for CostTokenBreakdown {
    fn from(tokens: TokenBreakdown) -> Self {
        Self {
            input_tokens: tokens.input_tokens,
            output_tokens: tokens.output_tokens,
            reasoning_tokens: tokens.reasoning_tokens,
            cache_creation_tokens: tokens.cache_creation_tokens,
            cache_read_tokens: tokens.cache_read_tokens,
            total_tokens: tokens.total_tokens,
        }
    }
}

impl From<ModelCostSummary> for CostModelSummary {
    fn from(model: ModelCostSummary) -> Self {
        Self {
            model: model.model,
            cost: model.cost,
            cost_usd: model.cost_usd,
            tokens: CostTokenBreakdown::from(model.tokens),
        }
    }
}
