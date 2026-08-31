//! Local Grok period totals from ccstats' durable inference ledger.

use ccstats::{summarize_cost, ApiEquivalentCostCoverage, SummaryOptions, UsageRange, UsageSource};
use chrono::{DateTime, Utc};

#[derive(Debug, Clone, PartialEq)]
pub(super) struct LocalPeriodUsage {
    pub observed_cost_usd: f64,
    pub observed_tokens: i64,
    pub valid_entries: i64,
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
    .map_err(|error| format!("Could not summarize Grok inference usage: {error}"))?;

    validate_period_summary(
        summary.cost_usd,
        summary.tokens.total_tokens,
        summary.valid_entries,
        summary.parse_error_entries,
        summary.api_equivalent_cost_coverage.as_ref(),
    )
}

fn validate_period_summary(
    observed_cost_usd: Option<f64>,
    observed_tokens: i64,
    valid_entries: i64,
    parse_error_entries: usize,
    coverage: Option<&ApiEquivalentCostCoverage>,
) -> Result<LocalPeriodUsage, String> {
    if parse_error_entries > 0 {
        return Err(format!(
            "Grok API-equivalent usage contains {parse_error_entries} malformed record(s)"
        ));
    }
    let coverage = coverage.ok_or_else(|| {
        "Grok API-equivalent inference coverage is unavailable for the active billing period"
            .to_string()
    })?;
    if !coverage.complete {
        return Err(format!(
            "Grok API-equivalent inference coverage is incomplete ({:.1}%) for the active billing period",
            coverage.percent
        ));
    }
    let observed_cost_usd = observed_cost_usd
        .filter(|cost| cost.is_finite() && *cost > 0.0)
        .ok_or_else(|| {
            "no positive API-equivalent cost was available for the active Grok period".to_string()
        })?;
    if observed_tokens <= 0 || valid_entries <= 0 {
        return Err("no Grok token usage matched the active billing period".to_string());
    }

    Ok(LocalPeriodUsage {
        observed_cost_usd,
        observed_tokens,
        valid_entries,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn complete_coverage() -> ApiEquivalentCostCoverage {
        ApiEquivalentCostCoverage {
            total_tokens: 150,
            priced_tokens: 150,
            percent: 100.0,
            complete: true,
            cost_is_lower_bound: false,
        }
    }

    #[test]
    fn accepts_complete_inference_pricing() {
        let coverage = complete_coverage();
        let usage = validate_period_summary(Some(1.25), 150, 2, 0, Some(&coverage))
            .expect("complete summary");

        assert_eq!(usage.observed_cost_usd, 1.25);
        assert_eq!(usage.observed_tokens, 150);
        assert_eq!(usage.valid_entries, 2);
    }

    #[test]
    fn rejects_partial_inference_pricing() {
        let coverage = ApiEquivalentCostCoverage {
            total_tokens: 200,
            priced_tokens: 150,
            percent: 75.0,
            complete: false,
            cost_is_lower_bound: true,
        };

        let error = validate_period_summary(Some(1.25), 200, 2, 0, Some(&coverage))
            .expect_err("partial coverage");
        assert!(error.contains("incomplete (75.0%)"));
    }

    #[test]
    fn rejects_parse_errors() {
        let coverage = complete_coverage();
        let error = validate_period_summary(Some(1.25), 150, 2, 1, Some(&coverage))
            .expect_err("malformed record");
        assert!(error.contains("1 malformed record"));
    }

    #[test]
    fn rejects_missing_usage() {
        let error = validate_period_summary(None, 0, 0, 0, None).expect_err("missing usage");
        assert!(error.contains("inference coverage is unavailable"));
    }
}
