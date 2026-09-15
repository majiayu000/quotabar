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
      setNotice('常用入口已满，请先取消一个收藏。');
      return;
    }
    const next = favorites.includes(id) ? favorites.filter((favorite) => favorite !== id) : [...favorites, id];
    const saved = saveProviderFavorites(next);
    setSavedFavorites(next);
    setNotice(saved ? '常用入口已更新。' : '收藏仅在本次使用中生效，未能保存。');
  }

  return (<>
    <nav className="provider-grid" aria-label="Provider views">
      {[
        {
          id: 'all' as const,
          label: 'Overview',
          shortLabel: '总览',
          accent: '#0A84FF',
          connected: summaries.some((summary) => summary.connected),
          usedPercent: null,
        },
        ...favoriteSummaries,
      ].map((summary) => {
        const isActive = activeTab === summary.id;
        const usageLabel = summary.id === 'all' ? '全部服务' : summary.usedPercent == null ? '—' : `${remainingPercent(summary.usedPercent)}%`;
        const quotaLabel = summary.usedPercent == null ? usageLabel : `${usageLabel} 剩余${'usageLabel' in summary && summary.usageLabel ? ` · ${summary.usageLabel}` : ''}`;
        const statusText = 'statusText' in summary
          ? summary.statusText
          : summary.connected ? 'Providers connected' : 'No providers connected';

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
        aria-label={`全部服务（${summaries.length}）`} aria-haspopup="dialog" aria-expanded={pickerOpen}
        aria-current={activeOutsideFavorites ? 'page' : undefined}
        title={activeOutsideFavorites ? `当前：${summaries.find((summary) => summary.id === activeTab)?.label ?? activeTab}` : '搜索和收藏服务'}
        onClick={() => { setSearch(''); setNotice(''); setPickerOpen(true); }}>
        <span className="provider-card-label">全部 {summaries.length}</span><span aria-hidden="true">⌄</span>
      </button>
    </nav>
    {pickerOpen && <dialog ref={dialog} className="provider-picker" aria-labelledby="provider-picker-title"
      onCancel={(event) => { event.preventDefault(); closePicker(); }}
      onClick={(event) => { if (event.target === event.currentTarget) closePicker(); }}>
      <div className="provider-picker-content">
        <header><h2 id="provider-picker-title">全部服务 · {summaries.length}</h2><button type="button" aria-label="关闭服务选择器" onClick={closePicker}>×</button></header>
        <input ref={searchInput} type="search" aria-label="搜索服务" placeholder="搜索服务…" value={search} onChange={(event) => setSearch(event.target.value)} />
        <p className="provider-picker-help">收藏常用 · 最多 {MAX_PROVIDER_FAVORITES} 个</p>
        <div className="provider-picker-list">
          {matches.map((summary) => <div className="provider-picker-row" key={summary.id}>
            <ProviderIcon service={summary.id} className="provider-picker-icon" />
            <button type="button" className="provider-picker-select" aria-current={activeTab === summary.id ? 'page' : undefined}
              onClick={() => { closePicker(); onTabChange(summary.id); }}>
              <strong>{summary.label}{activeTab === summary.id && <small>当前</small>}</strong>
              <span>{summary.loading ? '正在读取…' : summary.failed ? '更新失败 · 查看详情恢复' : summary.connected
                ? summary.usedPercent != null && Number.isFinite(summary.usedPercent) ? `剩余 ${remainingPercent(summary.usedPercent)}%${summary.usageLabel ? ` · ${summary.usageLabel}` : ''}` : '已连接 · 暂无额度数据'
                : summary.id === 'antigravity' ? '额度接入待支持' : '未连接 · 查看连接方式'}</span>
            </button>
            <button type="button" className="provider-picker-star" aria-label={`${favorites.includes(summary.id) ? '取消收藏' : '收藏'} ${summary.label}`}
              aria-pressed={favorites.includes(summary.id)} onClick={() => toggleFavorite(summary.id)}>{favorites.includes(summary.id) ? '★' : '☆'}</button>
          </div>)}
          {matches.length === 0 && <p className="provider-picker-empty">{summaries.length ? '没有匹配的服务' : '尚未启用服务'}</p>}
        </div>
        <p className="provider-picker-notice" role="status">{notice || '列表遵循“设置 → 账户”的显示选择，收藏只改变顶部入口。'}</p>
      </div>
    </dialog>}
  </>);

}
