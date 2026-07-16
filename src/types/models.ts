export interface UsageInfo {
  used: number;
  limit: number;
  percentage: number;
  resetTime?: string;
}

export interface QuotaData {
  connected: boolean;
  session?: UsageInfo;
  weeklyTotal?: UsageInfo;
  weeklyOpus?: UsageInfo;
  weeklySonnet?: UsageInfo;
  weeklyDesign?: UsageInfo;
  weeklyFable5?: UsageInfo;
  error?: string;
}

export interface CodexData {
  connected: boolean;
  planType?: string;
  accountId?: string;
  subscriptionUntil?: string;
  email?: string;
  error?: string;
}

export interface CodexRateLimitWindow {
  usedPercent: number;
  windowMinutes?: number;
  resetsAt?: number;
}

export interface CodexCredits {
  hasCredits: boolean;
  unlimited: boolean;
  balance?: string;
}

export interface CodexRateLimits {
  connected: boolean;
  planType?: string;
  primary?: CodexRateLimitWindow;
  secondary?: CodexRateLimitWindow;
  credits?: CodexCredits;
  error?: string;
}

export interface CodexResetCredit {
  status: string;
  title?: string;
  grantedAt?: string;
  expiresAt?: string;
}

export interface CodexResetCredits {
  connected: boolean;
  availableCount: number;
  credits: CodexResetCredit[];
  error?: string;
}

export interface CursorData {
  connected: boolean;
  planType?: string;
  email?: string;
  fastUsed?: number;
  fastLimit?: number;
  percentage?: number;
  slowUsed?: number;
  resetAt?: string;
  error?: string;
}

export interface AntigravityData {
  connected: boolean;
  status: string;
  error?: string;
}

export type CostSource = 'claude' | 'codex' | 'cursor';

export interface CostTokenBreakdown {
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  totalTokens: number;
}

export interface CostModelSummary {
  model: string;
  cost?: number | null;
  costUsd?: number | null;
  tokens: CostTokenBreakdown;
}

export interface CostRangeSummary {
  range: string;
  label: string;
  since?: string | null;
  until?: string | null;
  currency: string;
  cost?: number | null;
  costUsd?: number | null;
  tokens: CostTokenBreakdown;
  models: CostModelSummary[];
  validEntries: number;
  skippedEntries: number;
  elapsedMs: number;
}

export interface CostOverview {
  source: string;
  displayName: string;
  currency: string;
  generatedAt: string;
  cached: boolean;
  ranges: CostRangeSummary[];
}

export interface CostDailyPoint {
  date: string;
  cost?: number | null;
  costUsd?: number | null;
  totalTokens: number;
}

export interface CostDailySeries {
  source: string;
  currency: string;
  generatedAt: string;
  cached: boolean;
  days: CostDailyPoint[];
}
