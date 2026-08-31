use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct UsageInfo {
    pub used: f64,
    pub limit: f64,
    pub percentage: f64,
    #[serde(rename = "resetTime")]
    pub reset_time: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct QuotaData {
    pub connected: bool,
    pub session: Option<UsageInfo>,
    #[serde(rename = "weeklyTotal")]
    pub weekly_total: Option<UsageInfo>,
    #[serde(rename = "weeklyOpus")]
    pub weekly_opus: Option<UsageInfo>,
    #[serde(rename = "weeklySonnet")]
    pub weekly_sonnet: Option<UsageInfo>,
    #[serde(rename = "weeklyDesign")]
    pub weekly_design: Option<UsageInfo>,
    #[serde(rename = "weeklyFable5")]
    pub weekly_fable5: Option<UsageInfo>,
    pub error: Option<String>,
}

impl QuotaData {
    pub fn disconnected(error: impl Into<String>) -> Self {
        Self {
            connected: false,
            session: None,
            weekly_total: None,
            weekly_opus: None,
            weekly_sonnet: None,
            weekly_design: None,
            weekly_fable5: None,
            error: Some(error.into()),
        }
    }

    pub fn connected(
        session: Option<UsageInfo>,
        weekly_total: Option<UsageInfo>,
        weekly_opus: Option<UsageInfo>,
        weekly_sonnet: Option<UsageInfo>,
        weekly_design: Option<UsageInfo>,
        weekly_fable5: Option<UsageInfo>,
    ) -> Self {
        Self {
            connected: true,
            session,
            weekly_total,
            weekly_opus,
            weekly_sonnet,
            weekly_design,
            weekly_fable5,
            error: None,
        }
    }
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct CodexData {
    pub connected: bool,
    #[serde(rename = "planType")]
    pub plan_type: Option<String>,
    #[serde(rename = "accountId")]
    pub account_id: Option<String>,
    #[serde(rename = "subscriptionUntil")]
    pub subscription_until: Option<String>,
    pub email: Option<String>,
    pub error: Option<String>,
}

impl CodexData {
    pub fn disconnected(error: impl Into<String>) -> Self {
        Self {
            connected: false,
            plan_type: None,
            account_id: None,
            subscription_until: None,
            email: None,
            error: Some(error.into()),
        }
    }
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct CodexRateLimitWindow {
    #[serde(rename = "usedPercent")]
    pub used_percent: f64,
    #[serde(rename = "windowMinutes")]
    pub window_minutes: Option<i64>,
    #[serde(rename = "resetsAt")]
    pub resets_at: Option<i64>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct CodexCredits {
    #[serde(rename = "hasCredits")]
    pub has_credits: bool,
    pub unlimited: bool,
    pub balance: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct CodexRateLimits {
    pub connected: bool,
    #[serde(rename = "planType")]
    pub plan_type: Option<String>,
    pub primary: Option<CodexRateLimitWindow>,
    pub secondary: Option<CodexRateLimitWindow>,
    pub credits: Option<CodexCredits>,
    pub error: Option<String>,
}

impl CodexRateLimits {
    pub fn disconnected(error: impl Into<String>) -> Self {
        Self {
            connected: false,
            plan_type: None,
            primary: None,
            secondary: None,
            credits: None,
            error: Some(error.into()),
        }
    }
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct CodexResetCredit {
    pub status: String,
    pub title: Option<String>,
    #[serde(rename = "grantedAt")]
    pub granted_at: Option<String>,
    #[serde(rename = "expiresAt")]
    pub expires_at: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct CodexResetCredits {
    pub connected: bool,
    #[serde(rename = "availableCount")]
    pub available_count: u32,
    pub credits: Vec<CodexResetCredit>,
    pub error: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct CodexWeeklyQuota {
    #[serde(rename = "observedAt")]
    pub observed_at: String,
    #[serde(rename = "resetsAt")]
    pub resets_at: String,
    #[serde(rename = "estimatedDepletionAt")]
    pub estimated_depletion_at: Option<String>,
    #[serde(rename = "windowMinutes")]
    pub window_minutes: i64,
    #[serde(rename = "usedPct")]
    pub used_pct: f64,
    #[serde(rename = "remainingPct")]
    pub remaining_pct: f64,
    #[serde(rename = "projectedPctAtReset")]
    pub projected_pct_at_reset: f64,
    pub status: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct CodexWeeklyValueEstimate {
    #[serde(rename = "observedAt")]
    pub observed_at: String,
    #[serde(rename = "windowStartedAt")]
    pub window_started_at: String,
    #[serde(rename = "resetsAt")]
    pub resets_at: String,
    #[serde(rename = "usedPct")]
    pub used_pct: f64,
    #[serde(rename = "observedCostUsd")]
    pub observed_cost_usd: f64,
    #[serde(rename = "estimatedWeeklyValueUsd")]
    pub estimated_weekly_value_usd: f64,
    #[serde(rename = "observedTokens")]
    pub observed_tokens: i64,
    #[serde(rename = "estimatedWeeklyTokens")]
    pub estimated_weekly_tokens: f64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct CodexWeeklyQuotaData {
    pub quota: Option<CodexWeeklyQuota>,
    #[serde(rename = "valueEstimate")]
    pub value_estimate: Option<CodexWeeklyValueEstimate>,
    #[serde(rename = "valueEstimateError")]
    pub value_estimate_error: Option<String>,
    pub error: Option<String>,
}

impl CodexWeeklyQuotaData {
    pub fn available(
        quota: ccstats_quota::CodexWeeklyQuota,
        value_estimate: Result<ccstats_quota::CodexWeeklyValueEstimate, String>,
    ) -> Self {
        let (value_estimate, value_estimate_error) = match value_estimate {
            Ok(estimate) => (Some(CodexWeeklyValueEstimate::from(estimate)), None),
            Err(error) => (None, Some(error.to_string())),
        };
        Self {
            quota: Some(CodexWeeklyQuota::from(quota)),
            value_estimate,
            value_estimate_error,
            error: None,
        }
    }

    pub fn unavailable(error: impl Into<String>) -> Self {
        Self {
            quota: None,
            value_estimate: None,
            value_estimate_error: None,
            error: Some(error.into()),
        }
    }
}

impl From<ccstats_quota::CodexWeeklyValueEstimate> for CodexWeeklyValueEstimate {
    fn from(estimate: ccstats_quota::CodexWeeklyValueEstimate) -> Self {
        Self {
            observed_at: estimate.observed_at.to_rfc3339(),
            window_started_at: estimate.window_started_at.to_rfc3339(),
            resets_at: estimate.resets_at.to_rfc3339(),
            used_pct: estimate.used_pct,
            observed_cost_usd: estimate.observed_cost_usd,
            estimated_weekly_value_usd: estimate.estimated_weekly_value_usd,
            observed_tokens: estimate.observed_tokens,
            estimated_weekly_tokens: estimate.estimated_weekly_tokens,
        }
    }
}

impl From<ccstats_quota::CodexWeeklyQuota> for CodexWeeklyQuota {
    fn from(quota: ccstats_quota::CodexWeeklyQuota) -> Self {
        Self {
            observed_at: quota.observed_at.to_rfc3339(),
            resets_at: quota.resets_at.to_rfc3339(),
            estimated_depletion_at: quota.estimated_depletion_at.map(|value| value.to_rfc3339()),
            window_minutes: quota.window_minutes,
            used_pct: quota.used_pct,
            remaining_pct: quota.remaining_pct,
            projected_pct_at_reset: quota.projected_pct_at_reset,
            status: quota.status.as_str().to_string(),
        }
    }
}

impl CodexResetCredits {
    pub fn disconnected(error: impl Into<String>) -> Self {
        Self {
            connected: false,
            available_count: 0,
            credits: Vec::new(),
            error: Some(error.into()),
        }
    }
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct CursorData {
    pub connected: bool,
    #[serde(rename = "planType")]
    pub plan_type: Option<String>,
    pub email: Option<String>,
    #[serde(rename = "fastUsed")]
    pub fast_used: Option<i64>,
    #[serde(rename = "fastLimit")]
    pub fast_limit: Option<i64>,
    pub percentage: Option<f64>,
    #[serde(rename = "autoPercent")]
    pub auto_percent: Option<f64>,
    #[serde(rename = "apiPercent")]
    pub api_percent: Option<f64>,
    #[serde(rename = "onDemandEnabled")]
    pub on_demand_enabled: Option<bool>,
    #[serde(rename = "onDemandUsedCents")]
    pub on_demand_used_cents: Option<f64>,
    #[serde(rename = "slowUsed")]
    pub slow_used: Option<i64>,
    #[serde(rename = "resetAt")]
    pub reset_at: Option<String>,
    pub error: Option<String>,
}

impl CursorData {
    pub fn disconnected(error: impl Into<String>) -> Self {
        Self {
            connected: false,
            plan_type: None,
            email: None,
            fast_used: None,
            fast_limit: None,
            percentage: None,
            auto_percent: None,
            api_percent: None,
            on_demand_enabled: None,
            on_demand_used_cents: None,
            slow_used: None,
            reset_at: None,
            error: Some(error.into()),
        }
    }
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AntigravityData {
    pub connected: bool,
    pub status: String,
    pub error: Option<String>,
}

impl AntigravityData {
    pub fn placeholder() -> Self {
        Self {
            connected: false,
            status: "preview".to_string(),
            error: Some("Quota tracking arrives when Google ships a stable usage API.".to_string()),
        }
    }
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct GrokProductUsage {
    pub product: String,
    pub label: String,
    #[serde(rename = "usagePercent")]
    pub usage_percent: f64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct GrokExtraCredits {
    #[serde(rename = "onDemandUsedCents")]
    pub on_demand_used_cents: i64,
    #[serde(rename = "onDemandCapCents")]
    pub on_demand_cap_cents: i64,
    #[serde(rename = "prepaidBalanceCents")]
    pub prepaid_balance_cents: i64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct GrokValueEstimate {
    #[serde(rename = "observedAt")]
    pub observed_at: String,
    #[serde(rename = "windowStartedAt")]
    pub window_started_at: String,
    #[serde(rename = "resetsAt")]
    pub resets_at: String,
    #[serde(rename = "usedPct")]
    pub used_pct: f64,
    #[serde(rename = "observedCostUsd")]
    pub observed_cost_usd: f64,
    #[serde(rename = "estimatedPeriodValueUsd")]
    pub estimated_period_value_usd: f64,
    #[serde(rename = "observedTokens")]
    pub observed_tokens: i64,
    #[serde(rename = "estimatedPeriodTokens")]
    pub estimated_period_tokens: f64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct GrokData {
    pub connected: bool,
    #[serde(rename = "planType")]
    pub plan_type: Option<String>,
    pub email: Option<String>,
    pub percentage: Option<f64>,
    #[serde(rename = "resetAt")]
    pub reset_at: Option<String>,
    #[serde(rename = "periodStartedAt")]
    pub period_started_at: Option<String>,
    #[serde(rename = "periodType")]
    pub period_type: Option<String>,
    #[serde(rename = "periodLabel")]
    pub period_label: Option<String>,
    pub products: Vec<GrokProductUsage>,
    pub extra: Option<GrokExtraCredits>,
    #[serde(rename = "valueEstimate")]
    pub value_estimate: Option<GrokValueEstimate>,
    #[serde(rename = "valueEstimateError")]
    pub value_estimate_error: Option<String>,
    pub error: Option<String>,
}

impl GrokData {
    pub fn disconnected(error: impl Into<String>) -> Self {
        Self {
            connected: false,
            plan_type: None,
            email: None,
            percentage: None,
            reset_at: None,
            period_started_at: None,
            period_type: None,
            period_label: None,
            products: Vec::new(),
            extra: None,
            value_estimate: None,
            value_estimate_error: None,
            error: Some(error.into()),
        }
    }
}
