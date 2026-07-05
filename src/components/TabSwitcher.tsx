import type { CSSProperties } from 'react';
import type { AppTabName, ProviderSummary } from '../services/provider_summary';
import ProviderIcon from './ProviderIcon';

export type TabName = AppTabName;

interface TabSwitcherProps {
  activeTab: TabName;
  onTabChange: (tab: TabName) => void;
  summaries: ProviderSummary[];
}

const TILE_GRADIENTS: Record<AppTabName, string> = {
  all: 'linear-gradient(145deg,#8e9bb3,#4a5568)',
  claude: 'linear-gradient(145deg,#E8916C,#C4552F)',
  codex: 'linear-gradient(145deg,#2ec59a,#0d8a6a)',
  cursor: 'linear-gradient(145deg,#52525e,#17171d)',
  antigravity: 'linear-gradient(145deg,#5a9cff,#8a63f0)',
};

const providerGridStyle: CSSProperties = {
  display: 'flex',
  background: 'var(--track,rgba(0,0,0,0.07))',
  borderRadius: '10px',
  padding: '2px',
};

const iconSvgStyle: CSSProperties = {
  width: '12px',
  height: '12px',
  fill: '#fff',
  display: 'block',
};

export default function TabSwitcher({
  activeTab,
  onTabChange,
  summaries,
}: TabSwitcherProps) {
  return (
    <div className="provider-grid" style={providerGridStyle} aria-label="Providers">
      {[
        {
          id: 'all' as const,
          label: 'Overview',
          shortLabel: 'All',
          accent: '#0A84FF',
          connected: summaries.some((summary) => summary.connected),
          usedPercent: summaries.reduce<number | null>((max, summary) => {
            if (summary.usedPercent == null) return max;
            return max == null ? summary.usedPercent : Math.max(max, summary.usedPercent);
          }, null),
        },
        ...summaries,
      ].map((summary) => {
        const isActive = activeTab === summary.id;
        const usageLabel = summary.usedPercent == null ? '—' : `${Math.round(summary.usedPercent)}%`;
        const rowStyle: CSSProperties = {
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          padding: '7px 0 6px',
          border: 0,
          borderRadius: '8px',
          cursor: 'pointer',
          background: isActive ? 'var(--seg)' : 'transparent',
          boxShadow: isActive ? '0 1px 4px rgba(0,0,0,0.14), 0 0 0 0.5px var(--line)' : 'none',
          opacity: isActive ? 1 : 0.75,
          transition: 'background 0.2s, box-shadow 0.2s, opacity 0.2s',
          appearance: 'none',
          color: 'var(--text)',
          font: 'inherit',
          margin: 0,
          minWidth: 0,
          textAlign: 'center',
        };
        const glyphStyle: CSSProperties = {
          width: '22px',
          height: '22px',
          borderRadius: '6px',
          background: TILE_GRADIENTS[summary.id],
          opacity: summary.connected ? 1 : 0.45,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: '#fff',
          flex: 'none',
          boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.3), 0 1px 2px rgba(0,0,0,0.15)',
        };
        const pctStyle: CSSProperties = {
          fontSize: '11px',
          fontWeight: 600,
          fontVariantNumeric: 'tabular-nums',
          marginTop: '5px',
        };

        return (
          <button
            key={summary.id}
            type="button"
            className={`provider-card ${isActive ? 'active' : ''}`}
            data-provider={summary.id}
            style={rowStyle}
            aria-current={isActive ? 'page' : undefined}
            title={summary.label}
            onClick={() => onTabChange(summary.id)}
          >
            <span className="provider-card-icon" style={glyphStyle} aria-hidden="true">
              {summary.id === 'all' ? (
                <svg className="provider-card-svg" style={iconSvgStyle} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                  <path d="M3 3h8v8H3Zm10 0h8v8h-8ZM3 13h8v8H3Zm10 0h8v8h-8Z" />
                </svg>
              ) : (
                <ProviderIcon service={summary.id} className="provider-card-svg" style={iconSvgStyle} />
              )}
            </span>
            <span className="provider-card-percent" style={pctStyle}>{usageLabel}</span>
          </button>
        );
      })}
    </div>
  );
}
