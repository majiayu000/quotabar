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

export interface CodexStats {
  totalSessions: number;
  todaySessions: number;
  lastActivity?: string;
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

export type CostSource = 'claude' | 'codex';

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
