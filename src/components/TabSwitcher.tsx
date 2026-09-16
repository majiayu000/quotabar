import { localizeLabel, t } from '../i18n';
import { useLocale } from '../i18n/react';
import { remainingPercent } from '../utils/quota_format';
import { useEffect, useRef, useState } from 'react';
import { getSavedProviderFavorites, saveProviderFavorites, MAX_PROVIDER_FAVORITES } from '../services/provider_favorites';
import type { TrayServiceName } from '../services/tray_visibility';
import type { AppTabName, ProviderSummary } from '../services/provider_summary';
import ProviderIcon from './ProviderIcon';

export type TabName = AppTabName;

interface TabSwitcherProps {
  activeTab: TabName;
  onTabChange: (tab: TabName) => void;
  summaries: ProviderSummary[];
}

export default function TabSwitcher({
  activeTab,
  onTabChange,
  summaries,
}: TabSwitcherProps) {
  useLocale();
  const [savedFavorites, setSavedFavorites] = useState(getSavedProviderFavorites);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [notice, setNotice] = useState('');
  const dialog = useRef<HTMLDialogElement>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const favorites = (savedFavorites ?? summaries.slice(0, MAX_PROVIDER_FAVORITES).map((summary) => summary.id))
    .filter((id) => summaries.some((summary) => summary.id === id));
  const favoriteSummaries = favorites.map((id) => summaries.find((summary) => summary.id === id)!);
  const activeOutsideFavorites = activeTab !== 'all' && !favorites.includes(activeTab);
  const query = search.trim().toLocaleLowerCase();
  const matches = summaries.filter((summary) => `${summary.label} ${summary.shortLabel} ${summary.id}`.toLocaleLowerCase().includes(query));

  useEffect(() => {
    if (pickerOpen) {
      dialog.current?.showModal();
      searchInput.current?.focus();
    }
  }, [pickerOpen]);

  function closePicker() {
    dialog.current?.close();
    setPickerOpen(false);
    trigger.current?.focus();
  }

  function toggleFavorite(id: TrayServiceName) {
    if (!favorites.includes(id) && favorites.length >= MAX_PROVIDER_FAVORITES) {
      setNotice("Favorites are full. Remove a favorite first.");
      return;
    }
    const next = favorites.includes(id) ? favorites.filter((favorite) => favorite !== id) : [...favorites, id];
    const saved = saveProviderFavorites(next);
    setSavedFavorites(next);
    setNotice(saved ? "Favorites updated." : "Favorites apply this session but could not be saved.");
  }

  return (<>
    <nav className="provider-grid" aria-label={t("Provider views")}>
      {[
        {
          id: 'all' as const,
          label: t("Overview"),
          shortLabel: t("Overview"),
          accent: '#0A84FF',
          connected: summaries.some((summary) => summary.connected),
          usedPercent: null,
        },
        ...favoriteSummaries,
      ].map((summary) => {
        const isActive = activeTab === summary.id;
        const usageLabel = summary.id === 'all' ? t("All services") : summary.usedPercent == null ? '—' : `${remainingPercent(summary.usedPercent)}%`;
        const quotaLabel = summary.usedPercent == null ? usageLabel : t("{p0} remaining{p1}", { p0: usageLabel, p1: 'usageLabel' in summary && summary.usageLabel ? ` · ${localizeLabel(summary.usageLabel)}` : '' });
        const statusText = 'statusText' in summary
          ? localizeLabel(summary.statusText)
          : summary.connected ? t("Providers connected") : t("No providers connected");

        return (
          <button
            key={summary.id}
            type="button"
            className={`provider-card ${isActive ? 'active' : ''} ${summary.connected ? 'connected' : 'disconnected'}`}
            data-provider={summary.id}
            aria-current={isActive ? 'page' : undefined}
            aria-label={`${summary.label}: ${quotaLabel} · ${statusText}`}
            title={`${summary.label} · ${quotaLabel} · ${statusText}`}
            onClick={() => onTabChange(summary.id)}
          >
            <span className="provider-card-topline">
              <span className="provider-card-icon" aria-hidden="true">
              {summary.id === 'all' ? (
                <svg className="provider-card-svg" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                  <path d="M3 3h8v8H3Zm10 0h8v8h-8ZM3 13h8v8H3Zm10 0h8v8h-8Z" />
                </svg>
              ) : (
                <ProviderIcon service={summary.id} className="provider-card-svg" />
              )}
              </span>
              <span className="provider-card-status" aria-hidden="true" />
            </span>
            <span className="provider-card-label">{summary.shortLabel}</span>
          </button>
        );
      })}
      <button ref={trigger} type="button" className={`provider-card provider-picker-trigger${activeOutsideFavorites ? ' active' : ''}`}
        aria-label={t("All services ({p0})", { p0: summaries.length })} aria-haspopup="dialog" aria-expanded={pickerOpen}
        aria-current={activeOutsideFavorites ? 'page' : undefined}
        title={activeOutsideFavorites ? t("Current: {p0}", { p0: summaries.find((summary) => summary.id === activeTab)?.label ?? activeTab }) : t("Search and favorite services")}
        onClick={() => { setSearch(''); setNotice(''); setPickerOpen(true); }}>
        <span className="provider-card-label">{t("All")}{" "}{summaries.length}</span><span aria-hidden="true">⌄</span>
      </button>
    </nav>
    {pickerOpen && <dialog ref={dialog} className="provider-picker" aria-labelledby="provider-picker-title"
      onCancel={(event) => { event.preventDefault(); closePicker(); }}
      onClick={(event) => { if (event.target === event.currentTarget) closePicker(); }}>
      <div className="provider-picker-content">
        <header><h2 id="provider-picker-title">{t("All services ·")}{" "}{summaries.length}</h2><button type="button" aria-label={t("Close provider picker")} onClick={closePicker}>×</button></header>
        <input ref={searchInput} type="search" aria-label={t("Search services")} placeholder={t("Search services…")} value={search} onChange={(event) => setSearch(event.target.value)} />
        <p className="provider-picker-help">{t("Favorites · Up to {count}", { count: MAX_PROVIDER_FAVORITES })}</p>
        <div className="provider-picker-list">
          {matches.map((summary) => <div className="provider-picker-row" key={summary.id}>
            <ProviderIcon service={summary.id} className="provider-picker-icon" />
            <button type="button" className="provider-picker-select" aria-current={activeTab === summary.id ? 'page' : undefined}
              onClick={() => { closePicker(); onTabChange(summary.id); }}>
              <strong>{summary.label}{activeTab === summary.id && <small>{t("Current")}</small>}</strong>
              <span>{summary.loading ? t("Loading…") : summary.failed ? t("Update failed · View details to recover") : summary.connected
                ? summary.usedPercent != null && Number.isFinite(summary.usedPercent) ? t("{p0}% remaining{p1}", { p0: remainingPercent(summary.usedPercent), p1: summary.usageLabel ? ` · ${localizeLabel(summary.usageLabel)}` : '' }) : t("Connected · No quota data yet")
                : summary.id === 'antigravity' ? t("Quota support pending") : t("Not connected · View sign-in steps")}</span>
            </button>
            <button type="button" className="provider-picker-star" aria-label={`${favorites.includes(summary.id) ? t("Remove favorite") : t("Favorite")} ${summary.label}`}
              aria-pressed={favorites.includes(summary.id)} onClick={() => toggleFavorite(summary.id)}>{favorites.includes(summary.id) ? '★' : '☆'}</button>
          </div>)}
          {matches.length === 0 && <p className="provider-picker-empty">{summaries.length ? t("No matching services") : t("No services enabled")}</p>}
        </div>
        <p className="provider-picker-notice" role="status">{localizeLabel(notice) || t("This list follows Settings → Accounts. Favorites only change the top shortcuts.")}</p>
      </div>
    </dialog>}
  </>);

}
