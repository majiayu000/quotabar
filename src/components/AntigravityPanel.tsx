import { useEffect, useState, useCallback } from 'react';
import { backend } from '../services/backend';
import type { AntigravityData } from '../types/models';
import ProviderDetailHeader from './ProviderDetailHeader';
import { useLatestRequestGeneration } from '../hooks/use_latest_request_generation';

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
  const request_generation = useLatestRequestGeneration();

  const fetchData = useCallback(async () => {
    const generation = request_generation.begin();
    try {
      setLoading(true);
      const info = await backend.getAntigravityInfo();
      if (!request_generation.isCurrent(generation)) return;
      setData(info);
      onConnectionChange?.(info.connected);
    } catch (err) {
      if (!request_generation.isCurrent(generation)) return;
      const message = err instanceof Error ? err.message : 'Failed to load Antigravity status';
      setData({ connected: false, status: 'error', error: message });
      onConnectionChange?.(false);
    } finally {
      if (request_generation.isCurrent(generation)) {
        setLoading(false);
      }
    }
  }, [onConnectionChange, request_generation]);

  useEffect(() => {
    fetchData();
    if (autoRefreshIntervalMs <= 0) return;
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

  const isConnected = data?.connected === true;
  const isPreview = data?.status === 'preview' && !isConnected;
  const hasError = data?.status === 'error' && Boolean(data.error) && !loading;
  const headerStatus = loading && !data
    ? 'Checking'
    : hasError
      ? 'Unavailable'
      : isConnected
        ? 'CLI detected'
        : isPreview
          ? 'Preview'
        : 'Not connected';
  const panelTitle = hasError
    ? 'Unable to check Antigravity'
    : isConnected
      ? 'Antigravity is connected'
      : isPreview
        ? 'Quota tracking is in preview'
      : 'Antigravity is not connected';
  const panelHint = hasError
    ? 'Quota tracking status could not be refreshed. Try again from the footer.'
    : isConnected
      ? 'The CLI session is available. Quota tracking is waiting for provider support.'
      : isPreview
        ? data?.error ?? 'Quota tracking is waiting for a stable provider usage API.'
      : 'Sign in to Antigravity, then check the CLI status below.';

  return (
    <div className="codex-panel">
      <ProviderDetailHeader
        service="antigravity"
        status={headerStatus}
        plan="Quota preview"
        usedPercent={null}
        tone={hasError ? 'error' : loading && !data || isPreview ? 'pending' : isConnected ? 'online' : 'offline'}
      />

      <div className={`offline-panel${isConnected ? ' connected' : ''}`}>
        <div className="offline-tile">Ag</div>
        <div className="offline-title">{panelTitle}</div>
        <div className="offline-hint">{panelHint}</div>
        {!isConnected && !hasError && !isPreview && <code className="offline-command">antigravity status</code>}
      </div>

      {hasError && (
        <div className="error-banner antigravity-error" role="alert">
          <span className="error-icon">!</span>
          <span className="error-text">{data?.error}</span>
        </div>
      )}
    </div>
  );
}
