import { useEffect, useId, useRef, useState } from 'react';
import { t } from '../i18n';
import type { AnalysisReport } from '../services/backend';
import './ProjectPicker.css';

export function projectLabel(raw: string) {
  let path = raw;
  try { path = decodeURIComponent(raw); } catch { /* Keep malformed source paths readable and selectable. */ }
  const parts = path.split(/[\\/]/).filter(Boolean);
  const compact = path.replace(/^\/Users\/[^/]+(?=\/|$)/, '~').replace(/^\/home\/[^/]+(?=\/|$)/, '~').replace(/^[A-Za-z]:\\Users\\[^\\]+(?=\\|$)/, '~');
  return { name: parts[parts.length - 1] || path, path, compact: compact.length > 64 ? `${compact.slice(0, 26)}…${compact.slice(-35)}` : compact };
}

export default function ProjectPicker({ report, value, onChange }: {
  report?: AnalysisReport; value: string; onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const id = useId();
  const recent = useRef(new Map<string, number>());
  const activity = new Map(recent.current);
  for (const group of report?.projects ?? []) for (const project of group.projects) activity.delete(project.project_path);
  for (const group of report?.projects ?? []) for (const project of group.projects) {
    for (const session of project.sessions) {
      const time = Date.parse(session.last_timestamp);
      if (Number.isFinite(time)) activity.set(project.project_path, Math.max(activity.get(project.project_path) ?? 0, time));
    }
  }
  useEffect(() => { recent.current = activity; }, [report]);
  useEffect(() => {
    if (!open) return;
    function outside(event: PointerEvent) {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [open]);
  const paths = [...new Set([...(report?.available_projects ?? []), ...(value === 'all' ? [] : [value])])];
  const options = paths.map((raw) => ({ raw, ...projectLabel(raw) }))
    .filter((item) => item.path.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))
    .sort((a, b) => (activity.get(b.raw) ?? 0) - (activity.get(a.raw) ?? 0) || a.path.localeCompare(b.path));
  function choose(raw: string) { onChange(raw); setOpen(false); trigger.current?.focus(); }
  return <div className="project-picker" ref={root} onKeyDown={(event) => {
    if (event.key === 'Escape' && open) { event.preventDefault(); event.stopPropagation(); setOpen(false); trigger.current?.focus(); }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      if (!open) return;
      event.preventDefault();
      const items = Array.from(root.current?.querySelectorAll<HTMLButtonElement>('.project-picker-option') ?? []);
      const current = items.indexOf(document.activeElement as HTMLButtonElement);
      items[(current + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus();
    }
  }} onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false); }}>
    <button className="project-picker-trigger" ref={trigger} type="button" aria-label={t('Filter projects')} aria-expanded={open} aria-controls={open ? id : undefined} aria-haspopup="dialog" title={value === 'all' ? t('All projects') : projectLabel(value).path} disabled={!report} onClick={() => { setQuery(''); setOpen(!open); }}>
      <span>{value === 'all' ? t('All projects') : projectLabel(value).name}</span><span aria-hidden="true">⌄</span>
    </button>
    {open && <div className="project-picker-popover" role="dialog" aria-label={t('Filter projects')} id={id}>
      <input autoFocus aria-label={t('Search projects or paths')} placeholder={t('Search projects or paths')} value={query} onChange={(event) => setQuery(event.target.value)} />
      <button type="button" className="project-picker-option" aria-pressed={value === 'all'} onClick={() => choose('all')}><span aria-hidden="true">{value === 'all' ? '✓' : ''}</span><strong>{t('All projects')}</strong></button>
      <div className="project-picker-list">
        {options.map((item) => <button type="button" className="project-picker-option" key={item.raw} aria-pressed={item.raw === value} title={item.path} onClick={() => choose(item.raw)}><span aria-hidden="true">{item.raw === value ? '✓' : ''}</span><span><strong>{item.name}</strong><small>{item.compact}</small></span></button>)}
        {!options.length && <p className="project-picker-empty">{t('No matching projects')}</p>}
      </div>
    </div>}
  </div>;
}
