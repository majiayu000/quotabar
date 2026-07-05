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

  return (
    <div className="codex-panel">
      <ProviderDetailHeader
        service="antigravity"
        status={data?.connected ? 'Preview' : 'Pending'}
        plan="Antigravity"
        usedPercent={null}
      />

      <div className="offline-panel">
        <div className="offline-tile">Ag</div>
        <div className="offline-title">Antigravity is not connected</div>
        <div className="offline-hint">
          Antigravity quota tracking is pending provider support. Check sign-in status below.
        </div>
        <div className="offline-command">
          <span>antigravity status</span>
          <span className="offline-copy">⧉</span>
        </div>
      </div>

      {data?.error && !loading && (
        <p className="hint" style={{ marginTop: 12, fontSize: 11, opacity: 0.6 }}>
          Backend status: {data.error}
        </p>
      )}
    </div>
  );
}
