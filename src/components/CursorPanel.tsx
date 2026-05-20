import { useEffect, useState, useCallback } from 'react';
import { backend } from '../services/backend';
import CostSummarySection from './CostSummarySection';
import type { CursorData } from '../types/models';
import { formatPlanType, getProgressStyle } from '../utils/quota_format';

interface CursorPanelProps {
  onConnectionChange?: (connected: boolean) => void;
  onUsageChange?: (usedPercent: number | null) => void;
  autoRefreshIntervalMs?: number;
  manualRefreshNonce?: number;
  onLoadingChange?: (loading: boolean) => void;
  showCostSummary?: boolean;
}

function formatResetDate(resetAt?: string): string {
  if (!resetAt) return '';
  try {
    const date = new Date(resetAt);
    if (Number.isNaN(date.getTime())) return '';
    const now = new Date();
    const diff = date.getTime() - now.getTime();
    if (diff <= 0) return 'Resets soon';
    const days = Math.round(diff / (1000 * 60 * 60 * 24));
    if (days >= 2) return `Resets in ${days}d`;
    const hours = Math.round(diff / (1000 * 60 * 60));
    return `Resets in ${hours}h`;
  } catch {
    return '';
  }
}

export default function CursorPanel({
  onConnectionChange,
  onUsageChange,
  autoRefreshIntervalMs = 60 * 1000,
  manualRefreshNonce = 0,
  onLoadingChange,
  showCostSummary = true,
}: CursorPanelProps) {
  const [cursorData, setCursorData] = useState<CursorData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await backend.getCursorInfo();
      setCursorData(data);
      if (data.error) {
        setError(data.error);
      }
      onConnectionChange?.(data.connected);
      onUsageChange?.(data.percentage ?? null);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to fetch Cursor data';
      setError(message);
      onConnectionChange?.(false);
      onUsageChange?.(null);
    } finally {
      setLoading(false);
    }
  }, [onConnectionChange, onUsageChange]);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, autoRefreshIntervalMs);
    return () => clearInterval(interval);
  }, [fetchData, autoRefreshIntervalMs]);

  useEffect(() => {
    onLoadingChange?.(loading);
  }, [loading, onLoadingChange]);

  useEffect(() => {
    if (manualRefreshNonce > 0) {
      fetchData();
    }
  }, [manualRefreshNonce, fetchData]);

  const handleOpenDashboard = async () => {
    try {
      setError(null);
      await backend.openCursorDashboard();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to open Cursor dashboard';
      setError(message);
    }
  };

  if (loading && !cursorData) {
    return (
      <div className="codex-panel">
        <div className="loading-state">Loading Cursor info...</div>
      </div>
    );
  }

  const percentage = cursorData?.percentage ?? null;
  const resetLabel = formatResetDate(cursorData?.resetAt);

  return (
    <div className="codex-panel">
      {error && (
        <div className="error-banner">
          <span className="error-icon">!</span>
          <span className="error-text">{error}</span>
        </div>
      )}

      {cursorData?.connected && (
        <div className="codex-content">
          <div className="section">
            <div className="section-title">
              USAGE
              <span className="plan-tag">Cursor {formatPlanType(cursorData.planType, 'Unknown')}</span>
            </div>

            {cursorData.fastUsed != null && cursorData.fastLimit != null && (
              <div className="quota-card">
                <div className="quota-header">
                  <span className="quota-label">Fast requests</span>
                  <span className="quota-value">
                    {cursorData.fastUsed} / {cursorData.fastLimit}
                  </span>
                </div>
                {percentage != null && (
                  <div className="progress-bar">
                    <div className="progress-fill" style={getProgressStyle(percentage)} />
                  </div>
                )}
                {resetLabel && <div className="reset-time">{resetLabel}</div>}
              </div>
            )}

            {cursorData.slowUsed != null && cursorData.slowUsed > 0 && (
              <div className="quota-card credits-card">
                <div className="quota-header">
                  <span className="quota-label">Slow requests</span>
                  <span className="quota-value">{cursorData.slowUsed}</span>
                </div>
              </div>
            )}

            {cursorData.email && (
              <div className="quota-card credits-card">
                <div className="quota-header">
                  <span className="quota-label">Account</span>
                  <span className="quota-value email">{cursorData.email}</span>
                </div>
              </div>
            )}
          </div>

          {showCostSummary && (
            <CostSummarySection source="cursor" refreshKey={manualRefreshNonce} />
          )}

          <button className="open-dashboard-btn" onClick={handleOpenDashboard}>
            Open Dashboard
          </button>
        </div>
      )}

      {!cursorData?.connected && !error && (
        <div className="empty-state">
          <p>Cursor not connected</p>
          <p className="hint">Open Cursor and sign in, or set CURSOR_SESSION_TOKEN</p>
        </div>
      )}
    </div>
  );
}
