// Illustrative Tauri IPC mock used only by scripts/capture_demo_screenshots.mjs.
// It is injected into a dev-server page with Playwright's addInitScript and is
// never imported by src/, so it cannot reach the production bundle.
// Every value below is invented for README screenshots: no provider accounts,
// emails, account ids, tokens, cookies or local records are read or shown.

/**
 * Installs window.__TAURI_INTERNALS__ with deterministic illustrative data.
 * Must stay self-contained: Playwright serializes this function into the page.
 * @param {{ nowIso: string }} options
 */
export function installMockBackend({ nowIso }) {
  const now = Date.parse(nowIso);
  const HOUR = 3600_000;
  const DAY = 24 * HOUR;
  const iso = (ms) => new Date(ms).toISOString();
  const epochSeconds = (ms) => Math.floor(ms / 1000);
  const dateOnly = (ms) => iso(ms).slice(0, 10);

  const usage = (percentage, resetInMs) => ({
    used: percentage,
    limit: 100,
    percentage,
    resetTime: iso(now + resetInMs),
  });

  const quota = {
    connected: true,
    session: usage(38, 2 * HOUR + 14 * 60_000),
    weeklyTotal: usage(61, 3 * DAY + 5 * HOUR),
    weeklyOpus: usage(72, 3 * DAY + 5 * HOUR),
    weeklySonnet: usage(24, 3 * DAY + 5 * HOUR),
  };

  const codexInfo = { connected: true, planType: 'plus' };
  const codexRateLimits = {
    connected: true,
    planType: 'plus',
    primary: { usedPercent: 27, windowMinutes: 300, resetsAt: epochSeconds(now + 3 * HOUR + 40 * 60_000) },
    secondary: { usedPercent: 46, windowMinutes: 10080, resetsAt: epochSeconds(now + 4 * DAY + 2 * HOUR) },
    credits: { hasCredits: false, unlimited: false },
  };
  const codexResetCredits = { connected: true, availableCount: 0, credits: [] };
  const codexWeeklyQuota = {
    quota: {
      observedAt: iso(now),
      resetsAt: iso(now + 4 * DAY + 2 * HOUR),
      windowMinutes: 10080,
      usedPct: 46,
      remainingPct: 54,
      projectedPctAtReset: 81,
      status: 'on_track',
    },
  };

  const cursorInfo = {
    connected: true,
    planType: 'pro',
    fastUsed: 212,
    fastLimit: 500,
    percentage: 42,
    autoPercent: 31,
    apiPercent: 18,
    onDemandEnabled: false,
    resetAt: iso(now + 17 * DAY),
  };

  const grokInfo = {
    connected: true,
    planType: 'SuperGrok',
    percentage: 19,
    resetAt: iso(now + 11 * DAY),
    periodType: 'monthly',
    periodLabel: 'Monthly',
    products: [
      { product: 'chat', label: 'Chat', usagePercent: 19 },
      { product: 'imagine', label: 'Imagine', usagePercent: 7 },
    ],
  };

  const antigravityInfo = { connected: false, status: 'not_configured' };

  // Deterministic pseudo-random daily volume for charts.
  const wave = (index, base, spread) => Math.round(base + spread * (0.5 + 0.5 * Math.sin(index * 1.7) * Math.cos(index * 0.6)));

  const tokens = (total) => ({
    inputTokens: Math.round(total * 0.18),
    outputTokens: Math.round(total * 0.07),
    reasoningTokens: Math.round(total * 0.02),
    cacheCreationTokens: Math.round(total * 0.08),
    cacheReadTokens: Math.round(total * 0.65),
    totalTokens: total,
  });

  const costRange = (range, label, days, scale, model) => {
    const total = 4_200_000 * days * scale;
    const cost = Math.round(9.4 * days * scale * 100) / 100;
    return {
      range,
      label,
      since: dateOnly(now - (days - 1) * DAY),
      until: dateOnly(now),
      currency: 'USD',
      cost,
      costUsd: cost,
      costKind: 'estimated',
      estimatedCost: cost,
      estimatedCostUsd: cost,
      tokens: tokens(total),
      models: [{ model, cost, costUsd: cost, tokens: tokens(total) }],
      validEntries: 180 * days,
      skippedEntries: 0,
      parseErrorEntries: 0,
      elapsedMs: 42,
    };
  };

  const costOverview = (source) => {
    const scale = source === 'claude' ? 1 : source === 'codex' ? 0.6 : 0.3;
    const model = source === 'claude' ? 'claude-sonnet-4-5' : source === 'codex' ? 'gpt-5-codex' : 'cursor-auto';
    return {
      source,
      displayName: source === 'claude' ? 'Claude Code' : source === 'codex' ? 'Codex' : 'Cursor',
      currency: 'USD',
      generatedAt: iso(now),
      cached: false,
      ranges: [
        costRange('today', 'Today', 1, scale, model),
        costRange('week', 'This week', 7, scale, model),
        costRange('month', 'This month', 30, scale, model),
      ],
    };
  };

  const costDaily = (source, days) => {
    const scale = source === 'claude' ? 1 : source === 'codex' ? 0.6 : 0.3;
    return {
      source,
      currency: 'USD',
      generatedAt: iso(now),
      cached: false,
      days: Array.from({ length: days }, (_, offset) => {
        const index = days - 1 - offset;
        const total = wave(offset, 2_400_000, 4_800_000) * scale;
        const cost = Math.round(total / 450_000 * 100) / 100;
        return { date: dateOnly(now - index * DAY), cost, costUsd: cost, totalTokens: Math.round(total) };
      }),
    };
  };

  const ANALYSIS_SOURCES = [
    { name: 'claude', display_name: 'Claude Code', model: 'claude-sonnet-4-5', scale: 1 },
    { name: 'codex', display_name: 'Codex', model: 'gpt-5-codex', scale: 0.6 },
  ];
  const PROJECTS = [
    ['/Users/demo/projects/menubar-app', 'menubar-app', ['Tighten tray height math', 'Add dark theme tokens']],
    ['/Users/demo/projects/docs-site', 'docs-site', ['Rewrite install guide', 'Fix broken anchors']],
  ];

  const metrics = (total, cost) => ({
    currency: 'USD',
    cost,
    cost_usd: cost,
    cost_kind: 'estimated',
    pricing_source: 'reference',
    api_equivalent_cost_coverage: { percent: 100, cost_is_lower_bound: false },
    tokens: {
      reasoning_tokens: Math.round(total * 0.02),
      reported_total_adjustment: 0,
      total_tokens: total,
      input_tokens: Math.round(total * 0.18),
      output_tokens: Math.round(total * 0.07),
      cache_creation_tokens: Math.round(total * 0.08),
      cache_read_tokens: Math.round(total * 0.65),
      cache_hit_rate: 71.4,
    },
  });

  const analysisReport = (range) => {
    const days = range === 'today' ? 1 : range === 'last_7_days' ? 7 : 30;
    const since = dateOnly(now - (days - 1) * DAY);
    const until = dateOnly(now);
    const history = ANALYSIS_SOURCES.map((source) => ({
      source_name: source.name,
      display_name: source.display_name,
      currency: 'USD',
      points: Array.from({ length: days }, (_, offset) => {
        const index = days - 1 - offset;
        const total = Math.round(wave(offset + (source.name === 'codex' ? 3 : 0), 1_800_000, 5_200_000) * source.scale);
        const cost = Math.round(total / 450_000 * 100) / 100;
        return {
          date: dateOnly(now - index * DAY),
          tokens: { total_tokens: total },
          cost,
          cost_usd: cost,
          cost_status: 'complete',
          cost_kind: 'estimated',
          pricing_source: 'reference',
          api_equivalent_cost_coverage: { percent: 100, cost_is_lower_bound: false },
          records: Math.round(total / 24_000),
        };
      }),
    }));
    const summaries = ANALYSIS_SOURCES.map((source, sourceIndex) => {
      const points = history[sourceIndex].points;
      const total = points.reduce((sum, point) => sum + point.tokens.total_tokens, 0);
      const cost = Math.round(points.reduce((sum, point) => sum + point.cost, 0) * 100) / 100;
      return {
        source: source.name,
        summary: {
          ...metrics(total, cost),
          valid_entries: points.reduce((sum, point) => sum + point.records, 0),
          parse_error_entries: 0,
          skipped_entries: 0,
          models: [{ ...metrics(total, cost), model: source.model }],
        },
      };
    });
    const projects = ANALYSIS_SOURCES.map((source, sourceIndex) => {
      const session_titles = {};
      const groupProjects = PROJECTS.map(([project_path, project_name, titles], projectIndex) => {
        const sessions = titles.map((title, titleIndex) => {
          const session_id = `demo-${source.name}-${projectIndex}-${titleIndex}`;
          session_titles[session_id] = { text: title, origin: 'source_title' };
          const end = now - (sourceIndex * 3 + projectIndex * 2 + titleIndex) * 5 * HOUR;
          const total = Math.round((2_600_000 - projectIndex * 700_000 - titleIndex * 400_000) * source.scale);
          return {
            session_id,
            first_timestamp: iso(end - 90 * 60_000),
            last_timestamp: iso(end),
            metrics: metrics(total, Math.round(total / 450_000 * 100) / 100),
          };
        });
        const total = sessions.reduce((sum, session) => sum + session.metrics.tokens.total_tokens, 0);
        return { project_path, project_name, session_count: sessions.length, metrics: metrics(total, Math.round(total / 450_000 * 100) / 100), sessions };
      });
      return { source_name: source.name, display_name: source.display_name, projects: groupProjects, session_titles, session_titles_error: null };
    });
    return {
      cache_error: null,
      since,
      until,
      timezone: 'UTC',
      generated_at: iso(now),
      available_models: ANALYSIS_SOURCES.map((source) => source.model),
      available_projects: PROJECTS.map(([path]) => path),
      hourly: [],
      summaries,
      projects,
      history,
      errors: [],
    };
  };

  const analysisCatalog = {
    sources: ANALYSIS_SOURCES.map(({ name, display_name }) => ({ name, display_name, has_projects: true, has_cache_read: true })),
    diagnostics: ANALYSIS_SOURCES.map(({ name, display_name }) => ({
      name,
      display_name,
      status: 'detected',
      files: 12,
      detail: 'Illustrative demo source',
      setup: '',
    })),
  };

  const handlers = {
    get_quota: () => quota,
    get_codex_info: () => codexInfo,
    get_codex_rate_limits: () => codexRateLimits,
    get_codex_reset_credits: () => codexResetCredits,
    get_codex_weekly_quota: () => codexWeeklyQuota,
    get_cursor_info: () => cursorInfo,
    get_grok_info: () => grokInfo,
    get_antigravity_info: () => antigravityInfo,
    get_cost_overview: (args) => costOverview(args.source),
    get_cost_daily: (args) => costDaily(args.source, args.days),
    analysis_catalog: () => analysisCatalog,
    analysis_source: () => 'all',
    analysis_report: (args) => analysisReport(args.range),
    cached_analysis_report: () => null,
    get_dock_visibility: () => true,
    'plugin:window|is_visible': () => true,
  };

  const callbacks = new Map();
  let nextCallbackId = 1;
  window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} };
  window.__TAURI_INTERNALS__ = {
    metadata: {
      currentWindow: { label: 'main' },
      currentWebview: { windowLabel: 'main', label: 'main' },
    },
    transformCallback(callback, once = false) {
      const id = nextCallbackId++;
      callbacks.set(id, (data) => {
        if (once) callbacks.delete(id);
        return callback && callback(data);
      });
      return id;
    },
    unregisterCallback(id) {
      callbacks.delete(id);
    },
    convertFileSrc(path) {
      return path;
    },
    async invoke(cmd, args = {}) {
      const handler = handlers[cmd];
      if (handler) return structuredClone(handler(args));
      // Window, webview, event and plugin calls (resize, zoom, listen, tray
      // icon updates) have no visible effect in a browser capture.
      return null;
    },
  };
}
