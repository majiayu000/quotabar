//! Local cost summaries powered by the `ccstats` SDK.

use crate::services::codex_pricing::{
    requires_codex_priority_policy, CodexPriorityPricingPolicy, CodexTokenUsage,
};
use ccstats::{
    summarize_cost_ranges, CostSummary, ModelCostSummary, MultiSummaryOptions, TokenBreakdown,
    UsageRange, UsageSource,
};
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
        let overview = build_cost_overview(source, currency, timezone, force.unwrap_or(false));
        relieve_allocator_pressure();
        overview
    })
    .await
    .map_err(|err| format!("Cost summary task failed: {err}"))?
}

#[cfg(target_os = "macos")]
fn relieve_allocator_pressure() {
    unsafe extern "C" {
        fn malloc_zone_pressure_relief(zone: *mut std::ffi::c_void, goal: usize) -> usize;
    }

    unsafe {
        let released = malloc_zone_pressure_relief(std::ptr::null_mut(), 0);
        if released > 0 {
            eprintln!("[Cost] malloc pressure relief released {released} bytes");
        }
    }
}

#[cfg(not(target_os = "macos"))]
fn relieve_allocator_pressure() {}

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

    let range_specs = cost_range_specs();
    let batch = summarize_cost_ranges(MultiSummaryOptions {
        source,
        ranges: range_specs.iter().map(|spec| spec.range.clone()).collect(),
        timezone,
        offline: true,
        strict_pricing: false,
        currency,
    })
    .map_err(|err| err.to_string())?;
    let source_name = batch.source.as_str().to_string();
    let display_name = batch.display_name;
    let currency = batch.currency;
    let generated_at = batch.generated_at;
    let mut ranges = map_batch_ranges(&range_specs, batch.summaries)?;
    if batch.source == UsageSource::Codex && ranges_require_codex_priority_policy(&ranges) {
        let pricing_policy = CodexPriorityPricingPolicy::load_from_default_cache()?;
        apply_codex_priority_costs(&mut ranges, &pricing_policy)?;
    }
    let overview = CostOverview {
        source: source_name,
        display_name,
        currency,
        generated_at,
        cached: false,
        ranges,
    };

    set_cached_overview(cache_key, overview.clone())?;
    Ok(overview)
}

#[derive(Clone)]
struct CostRangeSpec {
    key: &'static str,
    label: &'static str,
    range: UsageRange,
}

fn cost_range_specs() -> [CostRangeSpec; 3] {
    [
        CostRangeSpec {
            key: "today",
            label: "Today",
            range: UsageRange::Today,
        },
        CostRangeSpec {
            key: "week",
            label: "This Week",
            range: UsageRange::ThisWeek,
        },
        CostRangeSpec {
            key: "month",
            label: "This Month",
            range: UsageRange::ThisMonth,
        },
    ]
}

fn map_batch_ranges(
    range_specs: &[CostRangeSpec],
    summaries: Vec<CostSummary>,
) -> Result<Vec<CostRangeSummary>, String> {
    if summaries.len() != range_specs.len() {
        return Err(format!(
            "ccstats returned {} cost ranges, expected {}",
            summaries.len(),
            range_specs.len()
        ));
    }

    let mut ranges = Vec::with_capacity(range_specs.len());
    for (spec, summary) in range_specs.iter().zip(summaries) {
        if summary.range != spec.range {
            return Err(format!(
                "ccstats returned {:?} for {} cost range, expected {:?}",
                summary.range, spec.key, spec.range
            ));
        }
        ranges.push(CostRangeSummary::from_summary(
            spec.key, spec.label, summary,
        ));
    }

    Ok(ranges)
}

fn apply_codex_priority_costs(
    ranges: &mut [CostRangeSummary],
    pricing_policy: &CodexPriorityPricingPolicy,
) -> Result<(), String> {
    for range in ranges {
        if !range.currency.eq_ignore_ascii_case("USD") {
            continue;
        }

        let mut range_cost = 0.0;
        let mut has_cost = false;
        for model in &mut range.models {
            let usage = CodexTokenUsage {
                input_tokens: model.tokens.input_tokens,
                output_tokens: model.tokens.output_tokens,
                reasoning_tokens: model.tokens.reasoning_tokens,
                cache_read_tokens: model.tokens.cache_read_tokens,
            };
            if let Some(cost) = pricing_policy.calculate_us_priority_cost(&model.model, usage)? {
                model.cost = Some(cost);
                model.cost_usd = Some(cost);
            }
            if let Some(cost) = model.cost_usd {
                range_cost += cost;
                has_cost = true;
            }
        }

        if has_cost {
            range.cost = Some(range_cost);
            range.cost_usd = Some(range_cost);
        }
    }

    Ok(())
}

fn ranges_require_codex_priority_policy(ranges: &[CostRangeSummary]) -> bool {
    ranges.iter().any(|range| {
        range.currency.eq_ignore_ascii_case("USD")
            && range
                .models
                .iter()
                .any(|model| requires_codex_priority_policy(&model.model))
    })
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
            models: summary
                .models
                .into_iter()
                .map(CostModelSummary::from)
                .collect(),
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

#[cfg(test)]
mod tests {
    use super::*;

    fn summary(range: UsageRange, valid_entries: i64) -> CostSummary {
        CostSummary {
            source: UsageSource::Codex,
            source_name: "codex".to_string(),
            display_name: "Codex".to_string(),
            range,
            since: None,
            until: None,
            currency: "USD".to_string(),
            cost: None,
            cost_usd: None,
            tokens: TokenBreakdown::default(),
            models: Vec::new(),
            valid_entries,
            skipped_entries: 0,
            elapsed_ms: 12.0,
        }
    }

    fn token_breakdown(
        input_tokens: i64,
        output_tokens: i64,
        reasoning_tokens: i64,
        cache_read_tokens: i64,
    ) -> CostTokenBreakdown {
        CostTokenBreakdown {
            input_tokens,
            output_tokens,
            reasoning_tokens,
            cache_creation_tokens: 0,
            cache_read_tokens,
            total_tokens: input_tokens + output_tokens + reasoning_tokens + cache_read_tokens,
        }
    }

    #[test]
    fn maps_batch_summaries_to_ui_ranges_in_order() {
        let specs = cost_range_specs();
        let ranges = match map_batch_ranges(
            &specs,
            vec![
                summary(UsageRange::Today, 1),
                summary(UsageRange::ThisWeek, 2),
                summary(UsageRange::ThisMonth, 3),
            ],
        ) {
            Ok(ranges) => ranges,
            Err(err) => panic!("failed to map summaries: {err}"),
        };

        let keys: Vec<_> = ranges.iter().map(|range| range.range.as_str()).collect();
        let labels: Vec<_> = ranges.iter().map(|range| range.label.as_str()).collect();

        assert_eq!(keys, ["today", "week", "month"]);
        assert_eq!(labels, ["Today", "This Week", "This Month"]);
        assert_eq!(ranges[0].valid_entries, 1);
        assert_eq!(ranges[1].valid_entries, 2);
        assert_eq!(ranges[2].valid_entries, 3);
    }

    #[test]
    fn rejects_unexpected_batch_summary_count() {
        let specs = cost_range_specs();
        let err = match map_batch_ranges(&specs, vec![summary(UsageRange::Today, 1)]) {
            Ok(_) => panic!("summary count mismatch should fail"),
            Err(err) => err,
        };

        assert!(err.contains("ccstats returned 1 cost ranges, expected 3"));
    }

    #[test]
    fn rejects_unexpected_batch_summary_order() {
        let specs = cost_range_specs();
        let err = match map_batch_ranges(
            &specs,
            vec![
                summary(UsageRange::Today, 1),
                summary(UsageRange::ThisMonth, 2),
                summary(UsageRange::ThisWeek, 3),
            ],
        ) {
            Ok(_) => panic!("summary range mismatch should fail"),
            Err(err) => err,
        };

        assert!(err.contains("ccstats returned ThisMonth for week cost range"));
    }

    #[test]
    fn applies_codex_priority_regional_costs_for_usd_ranges() {
        let pricing_policy = CodexPriorityPricingPolicy::from_litellm_json_str(
            r#"{
              "gpt-5.5": {
                "input_cost_per_token_priority": 0.00001,
                "output_cost_per_token_priority": 0.00006,
                "cache_read_input_token_cost_priority": 0.000001,
                "regional_processing_uplift_multiplier_us": 1.1
              }
            }"#,
        );
        let pricing_policy = match pricing_policy {
            Ok(policy) => policy,
            Err(err) => panic!("fixture should parse: {err}"),
        };
        let mut ranges = vec![CostRangeSummary {
            range: "today".to_string(),
            label: "Today".to_string(),
            since: None,
            until: None,
            currency: "USD".to_string(),
            cost: Some(0.0),
            cost_usd: Some(0.0),
            tokens: token_breakdown(1_000_000, 2_000_000, 3_000_000, 4_000_000),
            models: vec![CostModelSummary {
                model: "gpt-5.5".to_string(),
                cost: Some(0.0),
                cost_usd: Some(0.0),
                tokens: token_breakdown(1_000_000, 2_000_000, 3_000_000, 4_000_000),
            }],
            valid_entries: 1,
            skipped_entries: 0,
            elapsed_ms: 0.0,
        }];

        if let Err(err) = apply_codex_priority_costs(&mut ranges, &pricing_policy) {
            panic!("Codex priority costs should recalculate: {err}");
        }

        let cost = match ranges[0].cost_usd {
            Some(cost) => cost,
            None => panic!("cost should be recalculated"),
        };
        assert!((cost - 345.4).abs() < 0.001);
        assert_eq!(ranges[0].models[0].cost_usd, Some(cost));
    }

    #[test]
    fn priority_policy_is_required_only_for_known_codex_usd_models() {
        let mut ranges = vec![CostRangeSummary {
            range: "today".to_string(),
            label: "Today".to_string(),
            since: None,
            until: None,
            currency: "USD".to_string(),
            cost: Some(1.0),
            cost_usd: Some(1.0),
            tokens: token_breakdown(10, 0, 0, 0),
            models: vec![CostModelSummary {
                model: "other-model".to_string(),
                cost: Some(1.0),
                cost_usd: Some(1.0),
                tokens: token_breakdown(10, 0, 0, 0),
            }],
            valid_entries: 1,
            skipped_entries: 0,
            elapsed_ms: 0.0,
        }];
        assert!(!ranges_require_codex_priority_policy(&ranges));

        ranges[0].models[0].model = "gpt-5.5".to_string();
        assert!(ranges_require_codex_priority_policy(&ranges));

        ranges[0].currency = "EUR".to_string();
        assert!(!ranges_require_codex_priority_policy(&ranges));
    }
}
