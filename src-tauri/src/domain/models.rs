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
pub struct CodexStats {
    #[serde(rename = "totalSessions")]
    pub total_sessions: u32,
    #[serde(rename = "todaySessions")]
    pub today_sessions: u32,
    #[serde(rename = "lastActivity")]
    pub last_activity: Option<String>,
}

impl CodexStats {
    pub fn empty() -> Self {
        Self {
            total_sessions: 0,
            today_sessions: 0,
            last_activity: None,
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
