import { useEffect, useState, useCallback } from 'react';
import { backend } from '../services/backend';
import type { AntigravityData } from '../types/models';
import ProviderDetailHeader from './ProviderDetailHeader';

interface AntigravityPanelProps {
  onConnectionChange?: (connected: boolean) => void;
  autoRefreshIntervalMs?: number;
  manualRefreshNonce?: number;
  onLoadingChange?: (loading: boolean) => void;
}

export default function AntigravityPanel({
  onConnectionChange,
  autoRefreshIntervalMs = 5 * 60 * 1000,
  manualRefreshNonce = 0,
  onLoadingChange,
}: AntigravityPanelProps) {
  const [data, setData] = useState<AntigravityData | null>(null);
  const [loading, setLoading] = useState(true);
  const [openError, setOpenError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      const info = await backend.getAntigravityInfo();
      setData(info);
      onConnectionChange?.(info.connected);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load Antigravity status';
      setData({ connected: false, status: 'error', error: message });
      onConnectionChange?.(false);
    } finally {
      setLoading(false);
    }
  }, [onConnectionChange]);

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
      setOpenError(null);
      await backend.openAntigravityDashboard();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to open Antigravity dashboard';
      setOpenError(message);
    }
  };

  return (
    <div className="codex-panel">
      <ProviderDetailHeader
        service="antigravity"
        status={data?.connected ? 'Preview' : 'Pending'}
        plan="Antigravity"
        usedPercent={null}
      />

      <div className="section">
        <div className="section-title">
          ANTIGRAVITY
          <span className="plan-tag">Antigravity Preview</span>
        </div>
        <div className="quota-card">
          <div className="quota-header">
            <span className="quota-label">Quota tracking</span>
            <span className="quota-value">Pending</span>
          </div>
          <p className="hint" style={{ marginTop: 8, fontSize: 12, lineHeight: 1.45 }}>
            Antigravity is in public preview and Google hasn't shipped a stable
            usage API yet. The only signal we could surface is the 5-hour sprint
            window, which is decoupled from the weekly baseline that actually
            triggers rate limiting — so we'd be lying. Tracking arrives when
            the paid tier ships.
          </p>
        </div>
      </div>

      <div className="unsupported-state">
        Local cost and reset timeline are not available for Antigravity until a stable usage API exists.
      </div>

      <button className="open-dashboard-btn" onClick={handleOpenDashboard}>
        Open Antigravity
      </button>

      {(openError || (data?.error && !loading)) && (
        <p className="hint" style={{ marginTop: 12, fontSize: 11, opacity: 0.6 }}>
          Backend status: {openError ?? data?.error}
        </p>
      )}
    </div>
  );
}
