import { renderPromptCompare } from './promptCompare.js';

// ── Formatters ────────────────────────────────────────────────

function fmtCost(n) {
  if (n === 0) return '$0.00';
  if (n < 0.001) return `$${n.toFixed(5)}`;
  if (n < 0.01) return `$${n.toFixed(4)}`;
  if (n < 1) return `$${n.toFixed(3)}`;
  if (n < 100) return `$${n.toFixed(2)}`;
  return `$${n.toFixed(0)}`;
}

function fmtTokens(n) {
  if (n === 0) return '0';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return n.toString();
}

function fmtPct(n) {
  return `${(n * 100).toFixed(1)}%`;
}

function sessionDuration(s) {
  return (state.appSettings?.durationMode ?? 'active') === 'active' ? (s.activeDuration ?? s.duration) : s.duration;
}

function fmtDuration(ms) {
  if (ms < 1000) return '<1s';
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  if (m < 60) return `${m}m ${rem}s`;
  const h = Math.floor(m / 60);
  const remMin = m % 60;
  return `${h}h ${remMin}m`;
}

function fmtDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function fmtDateTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function modelBadgeHtml(model, isLocal) {
  if (!model || model === 'unknown') {
    return `<span class="model-badge unknown">unknown</span>`;
  }
  const safeModel = escHtml(model);
  if (isLocal) {
    return `<span class="model-badge local" title="${safeModel}">${safeModel}</span>`;
  }
  if (/^(claude-|anthropic\/)/i.test(model)) {
    return `<span class="model-badge claude" title="${safeModel}">${safeModel}</span>`;
  }
  if (/^(gpt-|openai\/|codex-|o[1345])/i.test(model)) {
    return `<span class="model-badge codex" title="${safeModel}">${safeModel}</span>`;
  }
  return `<span class="model-badge unknown" title="${safeModel}">${safeModel}</span>`;
}

function sourceMeta(source) {
  if (source === 'codex') return { label: 'Codex', icon: 'Cx', cls: 'codex' };
  return { label: 'Claude Code', icon: 'Cc', cls: 'claude' };
}

function agentBadgeHtml(source, opts = {}) {
  const meta = sourceMeta(source);
  const label = opts.short ? meta.label.replace(' Code', '') : meta.label;
  return `<span class="agent-badge agent-badge--${meta.cls}" title="Agent: ${escHtml(meta.label)}">
    <span class="agent-badge-icon">${escHtml(meta.icon)}</span>
    <span class="agent-badge-label">${escHtml(label)}</span>
  </span>`;
}

function isRemoteModelName(model) {
  if (!model) return false;
  return /^(claude-|anthropic\/|gpt-|openai\/|codex-|o[1345]|gemini|google\/)/i.test(model);
}

function isLocalSession(s) {
  const hasUsage = s && s.usage && (s.usage.inputTokens + s.usage.outputTokens + s.usage.cacheReadTokens + s.usage.cacheCreationTokens) > 0;
  return !!hasUsage && s.cost === 0 && !isRemoteModelName(s.primaryModel);
}

function shortModelName(model) {
  // claude-opus-4-7 → Opus 4.7
  // claude-sonnet-4-6 → Sonnet 4.6
  // claude-haiku-4-5-20251001 → Haiku 4.5
  return model
    .replace('claude-', '')
    .replace(/-(\d{8})$/, '')
    .replace(/-/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase());
}

// ── Tooltip ────────────────────────────────────────────────────

let _tt = null;

function _initTooltip() {
  _tt = document.createElement('div');
  _tt.id = 'chart-tooltip';
  document.body.appendChild(_tt);

  const content = document.getElementById('content');
  content.addEventListener('mouseover', e => {
    const el = e.target.closest('[data-tip]');
    if (el) {
      _tt.textContent = el.dataset.tip;
      _tt.classList.add('visible');
    } else {
      _tt.classList.remove('visible');
    }
  });
  content.addEventListener('mousemove', e => {
    if (_tt.classList.contains('visible')) {
      const x = Math.min(e.clientX + 14, window.innerWidth - 260);
      const y = Math.max(e.clientY - 44, 8);
      _tt.style.left = x + 'px';
      _tt.style.top = y + 'px';
    }
  });
  content.addEventListener('mouseleave', () => { _tt.classList.remove('visible'); });
}

// ── API client ─────────────────────────────────────────────────

const api = {
  async fetch(path, init) {
    const res = await fetch(path, init);
    if (!res.ok) throw new Error(`API error ${res.status}`);
    return res.json();
  },
  withSince(base, extra = {}) {
    const params = { ...extra };
    const since = periodToSince(state.periodMode, state.period);
    if (since) params.since = since;
    const qs = new URLSearchParams(params).toString();
    return `${base}${qs ? '?' + qs : ''}`;
  },
  stats: (params = {}) => api.fetch(api.withSince('/api/stats', params)),
  daily: (params = {}) => api.fetch(api.withSince('/api/daily', params)),
  projects: (params = {}) => api.fetch(api.withSince('/api/projects', params)),
  sessions: (params = {}) => api.fetch(api.withSince('/api/sessions', params)),
  prompts: (params = {}) => api.fetch(api.withSince('/api/prompts', params)),
  models: (params = {}) => api.fetch(api.withSince('/api/models', params)),
  comparison: (m1, m2) => {
    const extra = m1 && m2 ? { model1: m1, model2: m2 } : {};
    return api.fetch(api.withSince('/api/models/comparison', extra));
  },
  refresh: () => api.fetch('/api/refresh'),
  meta: () => api.fetch('/api/meta'),
  saveSetting: (key, value) => api.fetch(`/api/settings`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ [key]: value }) }),
  appSettings: () => api.fetch('/api/app-settings'),
  saveAppSettings: (patch) => api.fetch('/api/app-settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch) }),
  tips: () => api.fetch('/api/tips'),
  providers: () => api.fetch('/api/providers'),
  providerCheck: (check) => api.fetch('/api/providers/check', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ check }) }),
  providerSaveKey: (provider, key) => api.fetch('/api/providers/save-key', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ provider, key }) }),
  providerStartProxy: (provider) => api.fetch('/api/providers/start-proxy', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ provider }) }),
  providerProxyHealth: (port) => api.fetch(`/api/providers/proxy-health?port=${port}`),
  providerMarkConfigured: (provider, model) => api.fetch('/api/providers/mark-configured', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ provider, model }) }),
  providerStopProxy: (provider) => api.fetch('/api/providers/stop-proxy', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ provider }) }),
  providerRestartProxy: (provider) => api.fetch('/api/providers/restart-proxy', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ provider }) }),
  ollamaModels: () => api.fetch('/api/providers/ollama-models'),
  openFile: () => api.fetch('/api/open-file'),
};

// ── Period helpers ─────────────────────────────────────────────

const PERIOD_MODES = {
  calendar: {
    label: 'Cal',
    periods: [
      { key: 'today', label: 'Today' },
      { key: 'week',  label: 'This Week' },
      { key: 'month', label: 'This Month' },
      { key: 'all',   label: 'All Time' },
    ],
  },
  rolling: {
    label: 'Rolling',
    periods: [
      { key: '1d',  label: '1 Day' },
      { key: '7d',  label: '7 Days' },
      { key: '30d', label: '30 Days' },
      { key: '90d', label: '90 Days' },
      { key: 'all', label: 'All Time' },
    ],
  },
};

function periodToSince(mode, period) {
  if (period === 'all') return undefined;
  const now = new Date();

  if (mode === 'calendar') {
    if (period === 'today') return new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
    if (period === 'week') {
      const d = new Date(now);
      d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); // back to Monday
      d.setHours(0, 0, 0, 0);
      return d.toISOString();
    }
    if (period === 'month') return new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
  }

  if (mode === 'rolling') {
    const days = { '1d': 1, '7d': 7, '30d': 30, '90d': 90 }[period];
    if (days) {
      const d = new Date(now);
      d.setDate(d.getDate() - days);
      d.setHours(0, 0, 0, 0);
      return d.toISOString();
    }
  }

  return undefined;
}

// ── State ──────────────────────────────────────────────────────

const state = {
  view: 'overview',
  periodMode: 'calendar',
  period: 'all',
  overviewSessionSort: 'cost',
  overviewFilter: { sources: ['claude', 'codex'] },
  sessionsPage: 0,
  sessionsLimit: 50,
  sessionsFilter: { projectId: '', model: '', sources: ['claude', 'codex'] },
  sessionsSort: { key: 'startTime', dir: 'desc' },
  projectsFilter: { sources: ['claude', 'codex'] },
  projectsSort: { key: 'lastActivity', dir: 'desc' },
  promptCompSelection: [], // [{id, label}] max 6
  pcView: 'table',
  pcOrder: 'added',
  appSettings: null,
  compModel1: '',
  compModel2: '',
  compSession1Id: '',
  compSession2Id: '',
  compSelection: [], // [{id, label}] max 6
  scHiddenMetrics: new Set(),
  scView: 'table',
  scOrder: 'added',        // 'added' | 'ranked'
  scMetricsOrder: null,   // null = default; array of keys when user has reordered
  scPresent: false,
  scRevealed: new Set(),  // set of session IDs revealed in present mode
  data: {
    stats: null,
    daily: null,
    projects: null,
    sessions: null,
    sessionTotal: 0,
    models: null,
    comparison: null,
    allSessions: null,
  },
};

// ── Router ─────────────────────────────────────────────────────

function getView() {
  return location.hash.slice(1) || 'overview';
}

function navigate(view, params = {}) {
  if (params.projectId) state.sessionsFilter.projectId = params.projectId;
  location.hash = view;
}

window.addEventListener('hashchange', () => {
  state.view = getView();
  renderView();
});

// ── Nav ────────────────────────────────────────────────────────

function updateNav() {
  document.querySelectorAll('.nav-item').forEach(el => {
    const v = el.dataset.view;
    el.classList.toggle('active', v === state.view);
  });
}

// ── Charts ─────────────────────────────────────────────────────

function renderBarChart(daily, { valueKey = 'cost', fmt = fmtCost, height = 160, color = 'green' } = {}) {
  if (!daily || daily.length === 0) return '<p class="muted" style="padding:20px 0">No activity data yet.</p>';

  const recent = daily.slice(-60);
  const maxVal = Math.max(...recent.map(d => d[valueKey]), 0.001);
  const BAR_GAP = 2;
  const svgW = 560;
  const barW = Math.max(3, Math.floor((svgW - (recent.length - 1) * BAR_GAP) / recent.length));
  const chartH = height - 24;

  const isLight = document.documentElement.getAttribute('data-theme') === 'light';
  const colorMap = isLight
    ? { green: '#00a85e', blue: '#2f6fd4', violet: '#7c3aed', amber: '#b45309' }
    : { green: '#00FF87', blue: '#5B8DEF', violet: '#B985F4', amber: '#FFB547' };
  const colorVal = colorMap[color] || colorMap.green;
  const gradId = `bg-${valueKey}`;
  const topPad = 14;

  const bars = recent.map((d, i) => {
    const barH = Math.max(2, Math.floor((d[valueKey] / maxVal) * chartH));
    const x = i * (barW + BAR_GAP);
    const y = chartH - barH;
    const tip = `${d.date}  ${fmt(d[valueKey])}`;
    const delay = 80 + i * 15;
    const labelY = Math.max(topPad - 2, y - 6);
    return `
    <g class="bar-col">
      <rect class="bar-col-bg" x="${x}" y="0" width="${barW}" height="${chartH}" rx="2"/>
      <rect class="bar-chart-bar" x="${x}" y="${y}" width="${barW}" height="${barH}" rx="2" fill="url(#${gradId})" data-tip="${escHtml(tip)}" style="animation-delay:${delay}ms"/>
      <text class="bar-col-val" x="${x + barW / 2}" y="${labelY}" text-anchor="middle">${escHtml(fmt(d[valueKey]))}</text>
    </g>`;
  }).join('');

  const step = Math.max(1, Math.floor(recent.length / 8));
  const labels = recent.map((d, i) => {
    if (i % step !== 0) return '';
    const x = i * (barW + BAR_GAP) + barW / 2;
    return `<text class="chart-axis-label" x="${x}" y="${chartH + 16}" text-anchor="middle">${d.date.slice(5)}</text>`;
  }).join('');

  const gridlines = [0.25, 0.5, 0.75, 1].map(frac => {
    const y = chartH - Math.floor(frac * chartH);
    return `<line class="chart-gridline" x1="0" y1="${y}" x2="${svgW}" y2="${y}" stroke-dasharray="3,3"/>
    <text class="chart-axis-label" x="-4" y="${y + 3}" text-anchor="end">${fmt(maxVal * frac)}</text>`;
  }).join('');

  return `<svg viewBox="0 ${-topPad} ${svgW + 40} ${height + topPad}" width="100%" height="${height + topPad}" style="display:block;overflow:visible">
    <defs>
      <linearGradient id="${gradId}" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="${colorVal}" stop-opacity="0.9"/>
        <stop offset="100%" stop-color="${colorVal}" stop-opacity="0.25"/>
      </linearGradient>
    </defs>
    <g transform="translate(36,0)">${gridlines}${bars}${labels}</g>
  </svg>`;
}

function renderHorizBars(rows, { fmtVal = (v) => v, color = 'border' } = {}) {
  if (!rows || rows.length === 0) return '<p class="muted" style="padding:8px 0">No data.</p>';
  const maxVal = Math.max(...rows.map(r => r.value), 0.001);
  const isLight = document.documentElement.getAttribute('data-theme') === 'light';
  const colorMap = isLight ? {
    green:  ['rgba(0,168,94,0.13)',    '#00a85e'],
    blue:   ['rgba(47,111,212,0.13)',  '#2f6fd4'],
    violet: ['rgba(124,58,237,0.13)',  '#7c3aed'],
    amber:  ['rgba(180,83,9,0.13)',    '#b45309'],
    border: ['rgba(0,0,0,0.06)',       '#8899aa'],
  } : {
    green:  ['rgba(0,255,135,0.12)',   '#00FF87'],
    blue:   ['rgba(91,141,239,0.12)',  '#5B8DEF'],
    violet: ['rgba(185,133,244,0.12)', '#B985F4'],
    amber:  ['rgba(255,181,71,0.12)',  '#FFB547'],
    border: ['rgba(255,255,255,0.04)', '#262F45'],
  };
  return rows.map(r => {
    const pct = Math.max(2, (r.value / maxVal) * 100);
    const [fillColor, barColor] = colorMap[r.color || color] || colorMap.border;
    const tip = `${r.label}: ${fmtVal(r.value)}${r.sub ? `  (${r.sub})` : ''}`;
    return `<div class="hbar-row" data-tip="${escHtml(tip)}">
      <div class="hbar-label">${escHtml(r.label)}</div>
      <div class="hbar-track">
        <div class="hbar-fill" style="width:0;background:${fillColor};border-right:2px solid ${barColor}" data-w="${pct}%"></div>
      </div>
      <div class="hbar-right">
        <div class="hbar-value">${fmtVal(r.value)}</div>
        ${r.sub ? `<div class="hbar-sub">${escHtml(r.sub)}</div>` : ''}
      </div>
    </div>`;
  }).join('');
}

function animateHbars(container) {
  container.querySelectorAll('.hbar-fill[data-w]').forEach((el, i) => {
    setTimeout(() => { el.style.width = el.dataset.w; }, 120 + i * 110);
  });
}

function renderProjectTokenComparison(projects, limit = 6) {
  const rows = (projects || [])
    .slice(0, limit)
    .map(p => ({
      name: p.name || 'Untitled project',
      lastActivity: p.lastActivity,
      input: p.usage?.inputTokens || 0,
      output: p.usage?.outputTokens || 0,
      cacheRead: p.usage?.cacheReadTokens || 0,
      cacheWrite: p.usage?.cacheCreationTokens || 0,
    }))
    .filter(p => p.input + p.output + p.cacheRead + p.cacheWrite > 0);

  if (rows.length === 0) return '<p class="muted" style="padding:8px 0">No data.</p>';

  return `<div class="project-token-wrap">
    ${rows.map(p => {
      const primaryTotal = p.input + p.output;
      const inputPct = primaryTotal > 0 ? (p.input / primaryTotal) * 100 : 0;
      const outputPct = primaryTotal > 0 ? (p.output / primaryTotal) * 100 : 0;
      const dominant = outputPct >= inputPct
        ? { label: 'Output', pct: outputPct, className: 'output' }
        : { label: 'Input', pct: inputPct, className: 'input' };
      const secondary = outputPct >= inputPct
        ? { label: 'Input', pct: inputPct }
        : { label: 'Output', pct: outputPct };
      const tip = `${p.name}: input ${fmtTokens(p.input)} (${fmtPct(inputPct / 100)}) · output ${fmtTokens(p.output)} (${fmtPct(outputPct / 100)}) · cache read ${fmtTokens(p.cacheRead)} · cache write ${fmtTokens(p.cacheWrite)}`;

      return `<div class="project-token-row" data-tip="${escHtml(tip)}">
        <div class="project-token-label">
          <div class="project-token-name">${escHtml(p.name)}</div>
          <div class="project-token-date">${fmtDate(p.lastActivity)}</div>
        </div>
        <div class="project-token-bars">
          <div class="project-token-values">
            <span class="project-token-kind input">Input <strong>${fmtTokens(p.input)}</strong></span>
            <span class="project-token-kind output">Output <strong>${fmtTokens(p.output)}</strong></span>
          </div>
          <div class="project-token-track">
            <div class="project-token-fill input ${p.input > 0 ? 'active' : ''}" style="width:0" data-w="${inputPct}%"></div>
            <div class="project-token-fill output ${p.output > 0 ? 'active' : ''}" style="width:0" data-w="${outputPct}%"></div>
          </div>
          <div class="project-token-total">${fmtTokens(primaryTotal)} input + output</div>
        </div>
        <div class="project-token-mix ${dominant.className}">
          <span>Mix</span>
          <strong>${fmtPct(dominant.pct / 100)} ${dominant.label}</strong>
          <em>${fmtPct(secondary.pct / 100)} ${secondary.label}</em>
        </div>
      </div>`;
    }).join('')}
  </div>`;
}

function animateProjectTokenBars(container) {
  container.querySelectorAll('.project-token-fill[data-w]').forEach((el, i) => {
    setTimeout(() => { el.style.width = el.dataset.w; }, 120 + i * 70);
  });
}

// ── Metric card drag-and-drop ──────────────────────────────────

function initDraggableCards(container) {
  const grid = container.querySelector('.metric-grid');
  if (!grid) return;

  let dragSrc = null;

  grid.querySelectorAll('.metric-card[data-id]').forEach(card => {
    card.draggable = true;

    card.addEventListener('dragstart', e => {
      dragSrc = card;
      card.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
    });

    card.addEventListener('dragend', () => {
      dragSrc = null;
      grid.querySelectorAll('.metric-card').forEach(c => {
        c.classList.remove('dragging', 'drag-over');
      });
      const order = [...grid.querySelectorAll('.metric-card[data-id]')].map(c => c.dataset.id);
      localStorage.setItem('metric-card-order', JSON.stringify(order));
    });

    card.addEventListener('dragover', e => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      if (dragSrc && card !== dragSrc) {
        grid.querySelectorAll('.metric-card').forEach(c => c.classList.remove('drag-over'));
        card.classList.add('drag-over');
      }
    });

    card.addEventListener('dragleave', () => card.classList.remove('drag-over'));

    card.addEventListener('drop', e => {
      e.preventDefault();
      if (!dragSrc || dragSrc === card) return;
      const cards = [...grid.querySelectorAll('.metric-card')];
      const srcIdx = cards.indexOf(dragSrc);
      const tgtIdx = cards.indexOf(card);
      grid.insertBefore(dragSrc, srcIdx < tgtIdx ? card.nextSibling : card);
    });
  });

  // Restore saved order
  const saved = localStorage.getItem('metric-card-order');
  if (saved) {
    try {
      JSON.parse(saved).forEach(id => {
        const card = grid.querySelector(`[data-id="${id}"]`);
        if (card) grid.appendChild(card);
      });
    } catch {}
  }
}

// ── Usage Grid (GitHub-style) ──────────────────────────────────

function renderUsageGrid(dailyAll) {
  if (!dailyAll || dailyAll.length === 0) return '';

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Always show full 365-day grid — cells with no data render as empty (gray)
  const gridStart = new Date(today);
  gridStart.setDate(today.getDate() - 364);
  gridStart.setHours(0, 0, 0, 0);

  const byDate = {};
  for (const d of dailyAll) byDate[d.date] = d;

  const maxCost = Math.max(...dailyAll.map(d => d.cost), 0.001);
  const activeDays = dailyAll.filter(d => d.cost > 0).length;

  // Align back to the Sunday of the week containing gridStart
  const alignedStart = new Date(gridStart);
  alignedStart.setDate(gridStart.getDate() - gridStart.getDay());

  const WEEKS = Math.ceil((Math.floor((today - alignedStart) / 86400000) + 1) / 7);
  const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

  function getLevel(cost) {
    if (cost === 0) return 0;
    const pct = cost / maxCost;
    if (pct < 0.1) return 1;
    if (pct < 0.3) return 2;
    if (pct < 0.6) return 3;
    return 4;
  }

  const weekCols = [];
  const monthSpans = [];
  let lastMonth = -1;

  for (let w = 0; w < WEEKS; w++) {
    const cells = [];
    for (let d = 0; d < 7; d++) {
      const date = new Date(alignedStart);
      date.setDate(alignedStart.getDate() + w * 7 + d);
      const isFuture = date > today;
      const dateStr = date.toISOString().slice(0, 10);

      if (d === 0 && !isFuture && date.getMonth() !== lastMonth) {
        lastMonth = date.getMonth();
        if (monthSpans.length > 0) monthSpans[monthSpans.length - 1].endWeek = w - 1;
        monthSpans.push({ label: MONTHS[date.getMonth()], startWeek: w, endWeek: WEEKS - 1 });
      }

      if (isFuture) {
        cells.push(`<div class="usage-cell" data-future></div>`);
      } else {
        const data = byDate[dateStr];
        const cost = data?.cost || 0;
        const sessions = data?.sessions || 0;
        const tip = cost > 0
          ? `${dateStr}  ${fmtCost(cost)}  ${sessions} session${sessions !== 1 ? 's' : ''}`
          : `${dateStr}  no activity`;
        const level = getLevel(cost);
        const delayAttr = level > 0 ? ` style="--cd:${Math.floor(Math.random() * 2400)}ms"` : '';
        cells.push(`<div class="usage-cell" data-level="${level}" data-tip="${escHtml(tip)}"${delayAttr}></div>`);
      }
    }
    weekCols.push(`<div class="usage-week">${cells.join('')}</div>`);
  }

  // Positions use CSS calc so they track --cell-size when scaleUsageGrid updates it
  const monthRow = monthSpans.map(m => {
    const spanWeeks = m.endWeek - m.startWeek + 1;
    const left = `calc(${m.startWeek} * (var(--cell-size, 10px) + 1px))`;
    const width = `calc(${spanWeeks} * (var(--cell-size, 10px) + 1px) - 1px)`;
    return `<span class="usage-month-label" style="left:${left};width:${width}">${m.label}</span>`;
  }).join('');

  return `
    <div class="usage-grid-wrap" data-weeks="${WEEKS}">
      <div class="usage-grid-top">
        <span class="usage-grid-title">Activity</span>
        <span class="usage-grid-meta">${activeDays} active day${activeDays !== 1 ? 's' : ''} · 365d</span>
      </div>
      <div class="usage-grid-layout">
        <div class="usage-day-col">
          <span></span><span>Mon</span><span></span><span>Wed</span><span></span><span>Fri</span><span></span>
        </div>
        <div class="usage-grid-right">
          <div class="usage-month-row">${monthRow}</div>
          <div class="usage-weeks">${weekCols.join('')}</div>
        </div>
      </div>
    </div>
  `;
}

function scaleUsageGrid() {
  const wrap = document.querySelector('.usage-grid-wrap');
  if (!wrap) return;
  const numWeeks = parseInt(wrap.dataset.weeks || '4', 10);
  const topEl = wrap.querySelector('.usage-grid-top');
  const monthEl = wrap.querySelector('.usage-month-row');
  const rightEl = wrap.querySelector('.usage-grid-right');
  if (!topEl || !monthEl || !rightEl) return;

  const cs = getComputedStyle(wrap);
  const padV = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
  const innerH = wrap.clientHeight - padV;
  const topUsed = topEl.offsetHeight + 10;
  const monthUsed = monthEl.offsetHeight + 2;

  const gridH = innerH - topUsed - monthUsed;
  const cellFromH = Math.floor((gridH - 6) / 7); // 7 rows, 6 gaps

  // Embedded card: height-only sizing, grid scrolls horizontally
  if (wrap.closest('.overview-activity')) {
    wrap.style.setProperty('--cell-size', Math.max(8, cellFromH) + 'px');
    return;
  }

  const cellFromW = Math.floor((rightEl.clientWidth - (numWeeks - 1)) / numWeeks);
  wrap.style.setProperty('--cell-size', Math.max(10, Math.min(cellFromH, cellFromW)) + 'px');
}

const PROJECT_SORT_OPTIONS = [
  { key: 'name', label: 'Project' },
  { key: 'topModel', label: 'Model' },
  { key: 'lastActivity', label: 'Last Active' },
  { key: 'totalCost', label: 'Total Cost' },
  { key: 'totalTokens', label: 'Tokens' },
  { key: 'sessionCount', label: 'Sessions' },
  { key: 'cacheHitRate', label: 'Cache Hit' },
];

function projectSortDefaultDir(key) {
  return key === 'name' || key === 'topModel' ? 'asc' : 'desc';
}

function sortProjects(projects) {
  const { key, dir } = state.projectsSort;
  const mult = dir === 'asc' ? 1 : -1;

  return [...projects].sort((a, b) => {
    let cmp = 0;
    if (key === 'name' || key === 'topModel') {
      cmp = (a[key] || '').localeCompare(b[key] || '', undefined, { sensitivity: 'base' });
    } else if (key === 'lastActivity') {
      cmp = new Date(a.lastActivity || 0).getTime() - new Date(b.lastActivity || 0).getTime();
    } else {
      cmp = (a[key] || 0) - (b[key] || 0);
    }

    if (cmp === 0) {
      cmp = new Date(a.lastActivity || 0).getTime() - new Date(b.lastActivity || 0).getTime();
    }
    return cmp * mult;
  });
}

function sortButtonHtml(scope, key, label, sort, extraClass = '') {
  const active = sort.key === key;
  const icon = active ? (sort.dir === 'asc' ? '↑' : '↓') : '';
  return `
    <button class="sort-header-btn${active ? ' sort-header-btn--active' : ''}${extraClass ? ` ${extraClass}` : ''}" data-${scope}-sort="${key}">
      <span>${label}</span>${icon ? `<span class="sort-header-icon">${icon}</span>` : ''}
    </button>
  `;
}

function renderProjectSortHeader() {
  return `
    <div class="project-list-sort-header" aria-label="Project sort controls">
      <div class="project-sort-title-cell">
        ${sortButtonHtml('project', 'name', 'Project', state.projectsSort)}
      </div>
      <div class="project-sort-meta">
        ${sortButtonHtml('project', 'topModel', 'Model', state.projectsSort, 'project-sort-model')}
        ${sortButtonHtml('project', 'totalCost', 'Total Cost', state.projectsSort, 'project-sort-stat')}
        ${sortButtonHtml('project', 'totalTokens', 'Tokens', state.projectsSort, 'project-sort-stat')}
        ${sortButtonHtml('project', 'sessionCount', 'Sessions', state.projectsSort, 'project-sort-stat')}
        ${sortButtonHtml('project', 'cacheHitRate', 'Cache Hit', state.projectsSort, 'project-sort-stat')}
        ${sortButtonHtml('project', 'lastActivity', 'Last Active', state.projectsSort, 'project-sort-date')}
        <span class="project-sort-chevron-spacer"></span>
      </div>
    </div>
  `;
}

function setProjectSort(key) {
  state.projectsSort = {
    key,
    dir: state.projectsSort.key === key
      ? (state.projectsSort.dir === 'asc' ? 'desc' : 'asc')
      : projectSortDefaultDir(key),
  };
  localStorage.setItem('projects-sort', JSON.stringify(state.projectsSort));
  renderProjects();
}

const SESSION_SORT_OPTIONS = [
  { key: 'startTime', label: 'Started' },
  { key: 'projectName', label: 'Project' },
  { key: 'prompt', label: 'Prompt' },
  { key: 'source', label: 'Agent' },
  { key: 'primaryModel', label: 'Model' },
  { key: 'totalTokens', label: 'Tokens' },
  { key: 'cost', label: 'Cost' },
  { key: 'cacheHitRate', label: 'Cache%' },
  { key: 'messageCount', label: 'Msgs' },
  { key: 'duration', label: 'Duration' },
];

function sessionSortDefaultDir(key) {
  return ['projectName', 'prompt', 'source', 'primaryModel'].includes(key) ? 'asc' : 'desc';
}

function setSessionSort(key) {
  state.sessionsSort = {
    key,
    dir: state.sessionsSort.key === key
      ? (state.sessionsSort.dir === 'asc' ? 'desc' : 'asc')
      : sessionSortDefaultDir(key),
  };
  state.sessionsPage = 0;
  localStorage.setItem('sessions-sort', JSON.stringify(state.sessionsSort));
  renderSessions();
}

// ── Overview ───────────────────────────────────────────────────

async function renderOverview() {
  setLoading();
  try {
    const activeSources = state.overviewFilter.sources;
    const sourceParams = activeSources.length === 1 ? { source: activeSources[0] } : {};
    const [stats, daily, models, projects, dailyAll] = await Promise.all([
      api.stats(sourceParams),
      api.daily(sourceParams),
      api.models(sourceParams),
      api.projects(sourceParams),
      api.fetch(`/api/daily${sourceParams.source ? `?source=${encodeURIComponent(sourceParams.source)}` : ''}`),
    ]);
    state.data.stats = stats;
    state.data.daily = daily;
    state.data.models = models;
    state.data.projects = projects;

    // Usage by model — all models, session count as universal bar metric
    const modelRows = models.slice(0, 8).map(m => ({
      label: shortModelName(m.model),
      value: m.sessionCount,
      sub: m.isLocal ? 'local' : fmtCost(m.totalCost),
      color: m.isLocal ? 'amber' : 'blue',
    }));

    // Entrypoint breakdown
    const epLabelMap = { 'claude-vscode': 'VS Code', 'cli': 'CLI', 'claude-desktop': 'Desktop' };
    const epColorMap = { 'claude-vscode': 'blue', 'cli': 'green', 'claude-desktop': 'violet' };
    const entrypointRows = Object.entries(stats.entrypointCounts || {})
      .sort((a, b) => b[1] - a[1])
      .map(([ep, count]) => ({
        label: epLabelMap[ep] || ep,
        value: count,
        sub: fmtPct(count / (stats.totalSessions || 1)),
        color: epColorMap[ep] || 'amber',
      }));

    const content = document.getElementById('content');
    content.innerHTML = `
      <h1 class="page-title">Overview</h1>
      <div class="page-subtitle-row">
        <p class="page-subtitle">${periodLabel()} · ${stats.projectCount} project${stats.projectCount !== 1 ? 's' : ''}</p>
        <div class="sc-view-toggle agent-source-toggle" aria-label="Overview agent filter">
          <button class="sc-view-btn agent-source-btn${activeSources.includes('claude') ? ' sc-view-btn--on' : ''}" data-overview-source="claude">Claude Code</button>
          <button class="sc-view-btn agent-source-btn${activeSources.includes('codex') ? ' sc-view-btn--on' : ''}" data-overview-source="codex">Codex</button>
        </div>
      </div>

      <div class="overview-top">
        <div class="metric-card accent-left">
          <span class="metric-help" data-tooltip="Sum of all token costs in the selected period. Calculated from input, output, cache write, and cache read tokens using Anthropic&#39;s published per-million-token rates.">?</span>
          <div class="metric-label">Total Cost</div>
          <div class="metric-value mono">${fmtCost(stats.totalCost)}</div>
          <div class="metric-sub">${daily.length > 0 ? fmtCost(stats.totalCost / daily.length) + '/day avg' : '—'}</div>
        </div>
        <div class="metric-card accent-left">
          <span class="metric-help" data-tooltip="Total cost divided by sessions that used a paid model. Sessions using local or custom models (which report $0) are excluded from the denominator.">?</span>
          <div class="metric-label">Avg Cost / Session</div>
          <div class="metric-value mono">${stats.totalSessions > 0 ? fmtCost(stats.totalCost / stats.totalSessions) : '—'}</div>
          <div class="metric-sub">per paid session</div>
        </div>
        <div class="metric-card">
          <span class="metric-help" data-tooltip="Number of Claude Code and Codex sessions in the selected period. Each session is one local conversation log.">?</span>
          <div class="metric-label">Sessions</div>
          <div class="metric-value mono">${stats.totalSessions.toLocaleString()}</div>
          <div class="metric-sub">${stats.projectCount} project${stats.projectCount !== 1 ? 's' : ''}</div>
        </div>
        <div class="metric-card overview-activity">
          ${renderUsageGrid(dailyAll)}
        </div>
        <div class="metric-card">
          <span class="metric-help" data-tooltip="Number of user messages sent across all sessions in the selected period. Each time you send a prompt to an agent counts as one.">?</span>
          <div class="metric-label">Total Prompts</div>
          <div class="metric-value mono">${stats.totalMessages.toLocaleString()}</div>
          <div class="metric-sub">${stats.totalSessions > 0 ? '~' + Math.round(stats.totalMessages / stats.totalSessions) + ' per session' : '—'}</div>
        </div>
        <div class="metric-card">
          <span class="metric-help" data-tooltip="Raw token volume across all sessions: input + output + cache writes + cache reads. This is not your billed amount — billing applies different per-token rates to each category.">?</span>
          <div class="metric-label">Total Tokens</div>
          <div class="metric-value mono">${fmtTokens(stats.totalTokens)}</div>
          <div class="metric-sub">across all sessions</div>
        </div>
        <div class="metric-card">
          <span class="metric-help" data-tooltip="Percentage of input tokens served from Claude&#39;s prompt cache instead of being re-processed. Calculated as cache_read ÷ (input + cache_write + cache_read). Higher means more savings.">?</span>
          <div class="metric-label">Cache Hit Rate</div>
          <div class="metric-value">${fmtPct(stats.cacheHitRate)}</div>
          <div class="metric-sub">${fmtTokens(stats.cacheReadTokens)} read tokens</div>
        </div>
      </div>

      <div class="chart-row-2">
        <div class="chart-wrap">
          <div class="chart-title">Daily Cost</div>
          <div class="chart-svg-wrap">${renderBarChart(daily, { valueKey: 'cost', fmt: fmtCost, color: 'green' })}</div>
        </div>
        <div class="chart-wrap">
          <div class="chart-title">Daily Sessions</div>
          <div class="chart-svg-wrap">${renderBarChart(daily, { valueKey: 'sessions', fmt: n => `${n} sessions`, color: 'blue' })}</div>
        </div>
      </div>

      <div class="chart-row-2">
        <div class="chart-wrap">
          <div class="chart-title">Usage by Model</div>
          <div class="hbar-wrap">${renderHorizBars(modelRows, { fmtVal: n => `${n}` })}</div>
        </div>
        <div class="chart-wrap">
          <div class="chart-title">Last 6 Projects: Input vs Output</div>
          ${renderProjectTokenComparison(projects, 6)}
        </div>
      </div>

      ${entrypointRows.length > 1 ? `
      <div class="chart-row-2">
        <div class="chart-wrap">
          <div class="chart-title">Sessions by Entrypoint</div>
          <div class="hbar-wrap">${renderHorizBars(entrypointRows, { fmtVal: n => `${n} sessions` })}</div>
        </div>
        <div class="chart-wrap">
          <div class="chart-title">Thinking Sessions</div>
          <div class="hbar-wrap">${renderHorizBars([
            { label: 'With thinking',    value: stats.thinkingSessionCount,                          color: 'violet', sub: fmtPct(stats.thinkingSessionCount / (stats.totalSessions || 1)) },
            { label: 'Without thinking', value: stats.totalSessions - stats.thinkingSessionCount,    color: 'border', sub: fmtPct((stats.totalSessions - stats.thinkingSessionCount) / (stats.totalSessions || 1)) },
          ].filter(r => r.value > 0), { fmtVal: n => `${n} sessions` })}</div>
        </div>
      </div>` : ''}

      <div class="section">
        <div class="section-header">
          <select id="overview-session-sort" class="section-title-select" aria-label="Dashboard sessions list">
            <option value="cost" ${state.overviewSessionSort === 'cost' ? 'selected' : ''}>Most Expensive Sessions</option>
            <option value="recent" ${state.overviewSessionSort === 'recent' ? 'selected' : ''}>Recent Sessions</option>
          </select>
          <a href="#sessions" class="secondary" style="font-size:12px;text-decoration:none">View all →</a>
        </div>
        <div id="recent-sessions-wrap">
          <div class="loading-state"><div class="spinner"></div></div>
        </div>
      </div>
    `;

    initDraggableCards(content);
    animateHbars(content);
    animateProjectTokenBars(content);
    requestAnimationFrame(() => {
      scaleUsageGrid();
      // Scroll activity grid to the most recent weeks (rightmost)
      const gridRight = content.querySelector('.overview-activity .usage-grid-right');
      if (gridRight) gridRight.scrollLeft = gridRight.scrollWidth;
    });
    showOnboardingIfNeeded();

    content.querySelectorAll('[data-overview-source]').forEach(btn => {
      btn.addEventListener('click', () => {
        const source = btn.dataset.overviewSource;
        const current = state.overviewFilter.sources;
        const isActive = current.includes(source);
        if (isActive && current.length === 1) return;
        state.overviewFilter.sources = isActive
          ? current.filter(s => s !== source)
          : [...current, source].sort();
        renderOverview();
      });
    });

    document.getElementById('overview-session-sort')?.addEventListener('change', async (e) => {
      state.overviewSessionSort = e.target.value;
      await loadOverviewSessions();
    });

    await loadOverviewSessions();
  } catch (e) {
    showError(e);
  }
}

async function loadOverviewSessions() {
  const sessionsParams = { limit: 10, offset: 0 };
  const activeSources = state.overviewFilter.sources;
  if (activeSources.length === 1) sessionsParams.source = activeSources[0];
  if (state.overviewSessionSort === 'cost') sessionsParams.sort = 'cost';

  const recentWrap = document.getElementById('recent-sessions-wrap');
  if (!recentWrap) return;

  recentWrap.innerHTML = '<div class="loading-state"><div class="spinner"></div></div>';
  const { sessions } = await api.sessions(sessionsParams);
  recentWrap.innerHTML = renderSessionsTable(sessions, { compact: true });
  bindSessionExpansion(recentWrap);
}

// ── Projects ───────────────────────────────────────────────────

async function renderProjects() {
  setLoading();
  try {
    const activeSources = state.projectsFilter.sources;
    const projectParams = activeSources.length === 1 ? { source: activeSources[0] } : {};
    const projects = await api.projects(projectParams);
    const sortedProjects = sortProjects(projects);
    state.data.projects = sortedProjects;

    const content = document.getElementById('content');
    content.innerHTML = `
      <h1 class="page-title">Projects</h1>
      <div class="page-subtitle-row">
        <p class="page-subtitle">${periodLabel()} · ${sortedProjects.length} project${sortedProjects.length !== 1 ? 's' : ''}</p>
        <div class="sc-view-toggle agent-source-toggle" aria-label="Project agent filter">
          <button class="sc-view-btn agent-source-btn${activeSources.includes('claude') ? ' sc-view-btn--on' : ''}" data-project-source="claude">Claude Code</button>
          <button class="sc-view-btn agent-source-btn${activeSources.includes('codex') ? ' sc-view-btn--on' : ''}" data-project-source="codex">Codex</button>
        </div>
      </div>
      ${renderProjectSortHeader()}
      <div class="project-list">${sortedProjects.map(renderProjectCard).join('')}</div>
    `;

    content.querySelectorAll('[data-project-sort]').forEach(btn => {
      btn.addEventListener('click', () => setProjectSort(btn.dataset.projectSort));
    });

    content.querySelectorAll('[data-project-source]').forEach(btn => {
      btn.addEventListener('click', () => {
        const source = btn.dataset.projectSource;
        const current = state.projectsFilter.sources;
        const isActive = current.includes(source);
        if (isActive && current.length === 1) return;
        state.projectsFilter.sources = isActive
          ? current.filter(s => s !== source)
          : [...current, source].sort();
        renderProjects();
      });
    });

    content.querySelectorAll('.project-card[data-project]').forEach(el => {
      el.querySelector('.project-card-header').addEventListener('click', () => {
        toggleProject(el.dataset.project, el);
      });
    });
  } catch (e) {
    showError(e);
  }
}

async function toggleProject(projectId, cardEl) {
  const inner = cardEl.querySelector('.project-sessions-panel-inner');
  const isOpen = cardEl.classList.contains('expanded');

  if (isOpen) {
    cardEl.classList.remove('expanded');
    return;
  }

  cardEl.classList.add('expanded');

  if (inner.dataset.loaded) return;
  inner.innerHTML = '<div class="loading-state" style="min-height:80px"><div class="spinner"></div></div>';

  try {
    const { sessions } = await api.sessions({ projectId, limit: 50, offset: 0 });
    inner.dataset.loaded = '1';
    if (sessions.length === 0) {
      inner.innerHTML = '<div class="empty-state" style="min-height:60px"><div class="empty-msg">No sessions found</div></div>';
    } else {
      inner.innerHTML = renderSessionsTable(sessions, { compact: true, selectable: true });
      bindSessionExpansion(inner);
      bindSelectableRows(inner, sessions);
    }
  } catch (e) {
    inner.innerHTML = `<div class="empty-state"><div class="empty-msg">Error: ${escHtml(e.message)}</div></div>`;
  }
}

function renderProjectCard(p) {
  const isLocal = !p.totalCost && !isRemoteModelName(p.topModel);
  const agentBadges = (p.sources && p.sources.length ? p.sources : [p.source]).map(source => agentBadgeHtml(source, { short: true })).join('');
  return `
    <div class="project-card" data-project="${escHtml(p.id)}">
      <div class="project-card-header">
        <div class="project-title-block">
          <div class="project-title-row">
            <div class="project-agent-stack">${agentBadges}</div>
            <div class="project-name">${escHtml(p.name)}</div>
            <div class="project-path">${escHtml(p.path)}</div>
          </div>
        </div>
        <div class="project-meta">
          ${modelBadgeHtml(p.topModel, isLocal)}
          <div class="project-stat">
            <div class="project-stat-value mono">${fmtCost(p.totalCost)}</div>
            <div class="project-stat-label">Total Cost</div>
          </div>
          <div class="project-stat">
            <div class="project-stat-value mono">${fmtTokens(p.totalTokens)}</div>
            <div class="project-stat-label">Tokens</div>
          </div>
          <div class="project-stat">
            <div class="project-stat-value">${p.sessionCount}</div>
            <div class="project-stat-label">Sessions</div>
          </div>
          <div class="project-stat">
            <div class="project-stat-value">${fmtPct(p.cacheHitRate)}</div>
            <div class="project-stat-label">Cache Hit</div>
          </div>
          <div class="project-stat">
            <div class="project-stat-value secondary" style="font-size:11px">${fmtDate(p.lastActivity)}</div>
            <div class="project-stat-label">Last Active</div>
          </div>
          <div class="project-chevron">›</div>
        </div>
      </div>
      <div class="project-sessions-panel"><div class="project-sessions-panel-inner"></div></div>
    </div>
  `;
}

// ── Sessions ───────────────────────────────────────────────────

async function renderSessions() {
  setLoading();
  try {
    const activeSources = state.sessionsFilter.sources;
    const sessionSourceParams = activeSources.length === 1 ? { source: activeSources[0] } : {};
    const [{ sessions, total }, projects, models] = await Promise.all([
      api.sessions({
        limit: state.sessionsLimit,
        offset: state.sessionsPage * state.sessionsLimit,
        sort: state.sessionsSort.key,
        dir: state.sessionsSort.dir,
        ...sessionSourceParams,
        ...(state.sessionsFilter.projectId ? { projectId: state.sessionsFilter.projectId } : {}),
        ...(state.sessionsFilter.model ? { model: state.sessionsFilter.model } : {}),
      }),
      api.projects(),
      api.models(),
    ]);

    state.data.sessions = sessions;
    state.data.sessionTotal = total;
    state.data.projects = projects;
    state.data.models = models;

    const totalPages = Math.ceil(total / state.sessionsLimit);
    const curPage = state.sessionsPage;

    const projectOptions = projects.map(p =>
      `<option value="${escHtml(p.id)}" ${state.sessionsFilter.projectId === p.id ? 'selected' : ''}>${escHtml(p.name)}</option>`
    ).join('');

    const modelOptions = models.map(m =>
      `<option value="${escHtml(m.model)}" ${state.sessionsFilter.model === m.model ? 'selected' : ''}>${escHtml(m.model)}</option>`
    ).join('');

    const content = document.getElementById('content');
    content.innerHTML = `
      <h1 class="page-title">Sessions</h1>
      <p class="page-subtitle">${periodLabel()}</p>

      <div class="filter-bar">
        <select id="filter-project">
          <option value="">All projects</option>
          ${projectOptions}
        </select>
        <select id="filter-model">
          <option value="">All models</option>
          ${modelOptions}
        </select>
        <a class="export-csv-btn" href="${api.withSince('/api/export/sessions.csv')}" download>↓ CSV</a>
        <span class="filter-count sessions-filter-count">${total.toLocaleString()} session${total !== 1 ? 's' : ''}</span>
        <div class="sc-view-toggle agent-source-toggle sessions-agent-toggle" aria-label="Session agent filter">
          <button class="sc-view-btn agent-source-btn${activeSources.includes('claude') ? ' sc-view-btn--on' : ''}" data-session-source="claude">Claude Code</button>
          <button class="sc-view-btn agent-source-btn${activeSources.includes('codex') ? ' sc-view-btn--on' : ''}" data-session-source="codex">Codex</button>
        </div>
      </div>

      <div class="table-wrap" id="sessions-table-wrap">
        ${renderSessionsTable(sessions, { selectable: true, sortable: true })}
        ${totalPages > 1 ? renderPagination(curPage, totalPages) : ''}
      </div>
    `;

    const tableWrap = document.getElementById('sessions-table-wrap');
    bindSessionExpansion(tableWrap);
    bindSelectableRows(tableWrap, sessions);

    content.querySelectorAll('[data-session-sort]').forEach(btn => {
      btn.addEventListener('click', () => setSessionSort(btn.dataset.sessionSort));
    });

    content.querySelectorAll('[data-session-source]').forEach(btn => {
      btn.addEventListener('click', () => {
        const source = btn.dataset.sessionSource;
        const current = state.sessionsFilter.sources;
        const isActive = current.includes(source);
        if (isActive && current.length === 1) return;
        state.sessionsFilter.sources = isActive
          ? current.filter(s => s !== source)
          : [...current, source].sort();
        state.sessionsPage = 0;
        renderSessions();
      });
    });

    document.getElementById('filter-project').addEventListener('change', e => {
      state.sessionsFilter.projectId = e.target.value;
      state.sessionsPage = 0;
      renderSessions();
    });

    document.getElementById('filter-model').addEventListener('change', e => {
      state.sessionsFilter.model = e.target.value;
      state.sessionsPage = 0;
      renderSessions();
    });

    content.querySelectorAll('.page-btn[data-page]').forEach(btn => {
      btn.addEventListener('click', () => {
        state.sessionsPage = parseInt(btn.dataset.page, 10);
        renderSessions();
      });
    });
  } catch (e) {
    showError(e);
  }
}

function renderSessionsTable(sessions, opts = {}) {
  if (!sessions || sessions.length === 0) {
    return `<div class="empty-state"><div class="empty-icon">◎</div><div class="empty-msg">No sessions found</div></div>`;
  }

  const checkCol = opts.selectable ? 1 : 0;
  const colCount = (opts.compact ? 9 : 10) + checkCol;

  const rows = sessions.map(s => {
    const local = isLocalSession(s);
    const costCell = local
      ? `<span class="amber mono">${fmtTokens(s.usage.inputTokens + s.usage.outputTokens)}</span>`
      : `<span class="mono">${fmtCost(s.cost)}</span>`;
    const isChecked = state.compSelection.some(x => x.id === s.id);
    const checkCell = opts.selectable
      ? `<td class="check-cell"><input type="checkbox" class="session-check" data-session-id="${escHtml(s.id)}" ${isChecked ? 'checked' : ''}></td>`
      : '';
    const displayTitle = s.aiTitle || s.firstPrompt;
    const thinkingBadge = s.thinkingBlocks > 0
      ? `<span class="thinking-badge" title="${s.thinkingBlocks} thinking turn${s.thinkingBlocks !== 1 ? 's' : ''}">💭</span>`
      : '';
    const subagentBadge = s.entrypoint === 'subagent'
      ? `<span class="subagent-badge" title="Subagent session">sub</span>`
      : '';

    return `<tr class="session-row" data-session-id="${escHtml(s.id)}" data-project-id="${escHtml(s.projectId)}"
      data-project-name="${escHtml(s.projectName)}"
      data-entrypoint="${escHtml(s.entrypoint || '')}"
      data-source="${escHtml(s.source || 'claude')}"
      data-start-time="${escHtml(s.startTime || '')}"
      data-git-branch="${escHtml(s.gitBranch || '')}"
      data-version="${escHtml(s.version || '')}"
      data-permission-mode="${escHtml(s.permissionMode || '')}"
      data-thinking-blocks="${s.thinkingBlocks || 0}"
      data-cache5m="${s.usage.cache5mTokens || 0}"
      data-cache1h="${s.usage.cache1hTokens || 0}">
      ${checkCell}
      <td class="muted nowrap" style="font-size:12px">${fmtDateTime(s.startTime)}</td>
      ${opts.compact ? '' : `<td class="secondary" style="font-size:12px;max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escHtml(s.projectName)}</td>`}
      <td class="prompt">${thinkingBadge}${subagentBadge}<span title="${escHtml(s.firstPrompt)}">${escHtml(displayTitle)}</span></td>
      <td>${agentBadgeHtml(s.source || 'claude', { short: opts.compact })}</td>
      <td>${modelBadgeHtml(s.primaryModel, local)}</td>
      <td class="right mono" style="font-size:12px">${fmtTokens(s.usage.inputTokens + s.usage.outputTokens + s.usage.cacheCreationTokens + s.usage.cacheReadTokens)}</td>
      <td class="right">${costCell}</td>
      <td class="right muted" style="font-size:12px">${fmtPct(s.cacheHitRate)}</td>
      <td class="right muted" style="font-size:12px">${s.messageCount}</td>
      <td class="right muted" style="font-size:12px">${fmtDuration(sessionDuration(s))}</td>
    </tr>
    <tr class="session-detail-row" data-for="${escHtml(s.id)}">
      <td colspan="${colCount}" class="session-detail-cell">
        <div class="session-detail-inner">
          <div class="session-messages-wrap"></div>
        </div>
      </td>
    </tr>`;
  }).join('');

  const sortHead = (key, label, cls = '') => opts.sortable
    ? `<th${cls ? ` class="${cls}"` : ''}>${sortButtonHtml('session', key, label, state.sessionsSort, cls.includes('right') ? 'table-sort-btn--right' : '')}</th>`
    : `<th${cls ? ` class="${cls}"` : ''}>${label}</th>`;
  const projectCol = opts.compact ? '' : sortHead('projectName', 'Project');
  const checkHead = opts.selectable ? '<th class="check-cell"></th>' : '';

  return `<table>
    <thead>
      <tr>
        ${checkHead}
        ${sortHead('startTime', 'Started')}
        ${projectCol}
        ${sortHead('prompt', 'Prompt')}
        ${sortHead('source', 'Agent')}
        ${sortHead('primaryModel', 'Model')}
        ${sortHead('totalTokens', 'Tokens', 'right')}
        ${sortHead('cost', 'Cost', 'right')}
        ${sortHead('cacheHitRate', 'Cache%', 'right')}
        ${sortHead('messageCount', 'Msgs', 'right')}
        ${sortHead('duration', 'Duration', 'right')}
      </tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>`;
}

function bindSessionExpansion(container) {
  container.querySelectorAll('.session-row').forEach(row => {
    row.addEventListener('click', e => {
      if (e.target.closest('.check-cell')) return;
      toggleSession(row, container);
    });
  });
}

function bindSelectableRows(container, sessions) {
  container.querySelectorAll('.session-check').forEach(cb => {
    cb.addEventListener('click', e => e.stopPropagation());
    cb.addEventListener('change', () => {
      const id = cb.dataset.sessionId;
      const s = sessions.find(x => x.id === id);
      if (!s) return;
      const label = `${s.projectName} · ${fmtDate(s.startTime)}`;
      const idx = state.compSelection.findIndex(x => x.id === id);
      if (cb.checked) {
        if (state.compSelection.length >= 6) { cb.checked = false; return; }
        state.compSelection.push({ id, label });
      } else {
        if (idx !== -1) state.compSelection.splice(idx, 1);
      }
      saveCompSelection();
      syncAllCheckboxes();
      renderCompareBar();
    });
  });
}

function saveCompSelection() {
  localStorage.setItem('sc-selection', JSON.stringify(state.compSelection));
}

function syncAllCheckboxes() {
  document.querySelectorAll('.session-check').forEach(cb => {
    cb.checked = state.compSelection.some(x => x.id === cb.dataset.sessionId);
  });
}

const COMP_LETTERS = ['A', 'B', 'C', 'D', 'E', 'F'];

function promptCompareLabel(prompt) {
  const text = (prompt.prompt || '').replace(/\s+/g, ' ').trim();
  return `${prompt.projectName || 'Prompt'} · ${text.slice(0, 36)}${text.length > 36 ? '…' : ''}`;
}

function savePromptCompSelection() {
  localStorage.setItem('pc-selection', JSON.stringify(state.promptCompSelection));
}

function syncPromptCheckboxes() {
  document.querySelectorAll('.prompt-check').forEach(cb => {
    cb.checked = state.promptCompSelection.some(x => x.id === cb.dataset.promptId);
  });
}

function renderPromptCompareBar() {
  let bar = document.getElementById('prompt-compare-bar');
  if (!bar) {
    bar = document.createElement('div');
    bar.id = 'prompt-compare-bar';
    document.body.appendChild(bar);
  }

  if (state.promptCompSelection.length === 0) {
    bar.className = 'compare-bar compare-bar--hidden';
    bar.innerHTML = '';
    return;
  }

  const n = state.promptCompSelection.length;
  const canCompare = n >= 2;
  const atCap = n >= COMP_LETTERS.length;
  const chips = state.promptCompSelection.map((entry, i) => `
    <div class="compare-chip compare-chip--prompt">
      <span class="compare-chip-letter">${COMP_LETTERS[i]}</span>
      <span class="compare-chip-name">${escHtml(entry.label)}</span>
      <button class="compare-chip-clear" data-clear-prompt="${i}" title="Remove">×</button>
    </div>
  `).join('');
  const hint = !atCap
    ? `<span class="compare-bar-hint">${canCompare ? '+ select more prompts' : 'pick one more prompt'}</span>`
    : '';

  bar.className = 'compare-bar';
  bar.innerHTML = `
    <div class="compare-bar-inner">
      <div class="compare-bar-chips">${chips}${hint}</div>
      ${canCompare ? `<button class="compare-go-btn" id="prompt-compare-go-btn">Compare Prompts (${n}) →</button>` : ''}
      <button class="compare-bar-dismiss" id="prompt-compare-dismiss" title="Clear all">✕</button>
    </div>
  `;

  bar.querySelectorAll('[data-clear-prompt]').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      state.promptCompSelection.splice(parseInt(btn.dataset.clearPrompt, 10), 1);
      savePromptCompSelection();
      syncPromptCheckboxes();
      renderPromptCompareBar();
    });
  });

  bar.querySelector('#prompt-compare-go-btn')?.addEventListener('click', () => {
    bar.className = 'compare-bar compare-bar--hidden';
    navigate('prompt-compare');
  });

  bar.querySelector('#prompt-compare-dismiss')?.addEventListener('click', () => {
    state.promptCompSelection = [];
    savePromptCompSelection();
    syncPromptCheckboxes();
    renderPromptCompareBar();
  });
}

function bindPromptSelectableRows(container) {
  container.querySelectorAll('.prompt-check').forEach(cb => {
    cb.addEventListener('click', e => e.stopPropagation());
    cb.addEventListener('change', () => {
      const id = cb.dataset.promptId;
      const idx = state.promptCompSelection.findIndex(x => x.id === id);
      if (cb.checked) {
        if (state.promptCompSelection.length >= COMP_LETTERS.length) {
          cb.checked = false;
          return;
        }
        if (idx === -1) {
          state.promptCompSelection.push({ id, label: cb.dataset.promptLabel || 'Prompt' });
        }
      } else if (idx !== -1) {
        state.promptCompSelection.splice(idx, 1);
      }
      savePromptCompSelection();
      syncPromptCheckboxes();
      renderPromptCompareBar();
    });
  });
}

function renderCompareBar() {
  let bar = document.getElementById('compare-bar');
  if (!bar) {
    bar = document.createElement('div');
    bar.id = 'compare-bar';
    document.body.appendChild(bar);
  }

  if (state.compSelection.length === 0) {
    bar.className = 'compare-bar compare-bar--hidden';
    bar.innerHTML = '';
    return;
  }

  const n = state.compSelection.length;
  const canCompare = n >= 2;
  const atCap = n >= 6;

  const chips = state.compSelection.map((entry, i) => `
    <div class="compare-chip">
      <span class="compare-chip-letter">${COMP_LETTERS[i]}</span>
      <span class="compare-chip-name">${escHtml(entry.label)}</span>
      <button class="compare-chip-clear" data-clear="${i}" title="Remove">×</button>
    </div>
  `).join('');

  const hint = !atCap
    ? `<span class="compare-bar-hint">${canCompare ? '+ add more' : 'pick one more to compare'}</span>`
    : '';

  bar.className = 'compare-bar';
  bar.innerHTML = `
    <div class="compare-bar-inner">
      <div class="compare-bar-chips">${chips}${hint}</div>
      ${canCompare ? `<button class="compare-go-btn" id="compare-go-btn">Compare (${n}) →</button>` : ''}
      <button class="compare-bar-dismiss" id="compare-bar-dismiss" title="Clear all">✕</button>
    </div>
  `;

  bar.querySelectorAll('[data-clear]').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      state.compSelection.splice(parseInt(btn.dataset.clear), 1);
      saveCompSelection();
      syncAllCheckboxes();
      renderCompareBar();
    });
  });

  const goBtn = bar.querySelector('#compare-go-btn');
  if (goBtn) {
    goBtn.addEventListener('click', () => {
      state.data.allSessions = null;
      bar.className = 'compare-bar compare-bar--hidden';
      navigate('session-compare');
    });
  }

  bar.querySelector('#compare-bar-dismiss').addEventListener('click', () => {
    state.compSelection = [];
    saveCompSelection();
    syncAllCheckboxes();
    renderCompareBar();
  });
}

function renderSessionMeta(row) {
  const d = row.dataset;
  const source = d.source || 'claude';
  const entrypoint = d.entrypoint || '';
  const branch = d.gitBranch || '';
  const version = d.version || '';
  const perm = d.permissionMode || '';
  const thinking = parseInt(d.thinkingBlocks || '0', 10);
  const cache5m = parseInt(d.cache5m || '0', 10);
  const cache1h = parseInt(d.cache1h || '0', 10);

  const entrypointLabel = { 'claude-vscode': 'VS Code', 'cli': 'CLI', 'claude-desktop': 'Desktop', 'subagent': 'Subagent' }[entrypoint] || entrypoint;
  const permLabel = perm === 'bypassPermissions' ? 'auto-approve' : perm;

  const chips = [
    `<span class="meta-chip meta-chip-agent">${agentBadgeHtml(source)}</span>`,
    entrypoint && `<span class="meta-chip">${escHtml(entrypointLabel)}</span>`,
    branch && `<span class="meta-chip">⎇ ${escHtml(branch)}</span>`,
    perm && perm !== 'default' && `<span class="meta-chip perm-chip">${escHtml(permLabel)}</span>`,
    thinking > 0 && `<span class="meta-chip thinking-chip">💭 ${thinking} thinking turn${thinking !== 1 ? 's' : ''}</span>`,
    (cache5m > 0 || cache1h > 0) && `<span class="meta-chip">cache: ${fmtTokens(cache5m)} 5m · ${fmtTokens(cache1h)} 1h</span>`,
    version && `<span class="meta-chip muted-chip">v${escHtml(version)}</span>`,
  ].filter(Boolean).join('');

  if (!chips) return '';
  return `<div class="session-meta-strip"><div class="session-meta-chips">${chips}</div></div>`;
}

async function toggleSession(row, container) {
  const sessionId = row.dataset.sessionId;
  const detailRow = container.querySelector(`.session-detail-row[data-for="${CSS.escape(sessionId)}"]`);
  if (!detailRow) return;

  const isOpen = row.classList.contains('expanded');
  if (isOpen) {
    row.classList.remove('expanded');
    detailRow.classList.remove('expanded');
    return;
  }

  row.classList.add('expanded');
  detailRow.classList.add('expanded');

  const wrap = detailRow.querySelector('.session-messages-wrap');
  if (wrap.dataset.loaded) return;

  // Inject metadata strip first (persists through message load)
  const metaHtml = renderSessionMeta(row);
  if (metaHtml) wrap.insertAdjacentHTML('afterbegin', metaHtml);

  // Append loading spinner after the meta strip rather than replacing wrap contents
  const loader = document.createElement('div');
  loader.className = 'loading-state';
  loader.style.minHeight = '60px';
  loader.innerHTML = '<div class="spinner"></div>';
  wrap.appendChild(loader);

  try {
    const messages = await api.fetch(`/api/sessions/${encodeURIComponent(sessionId)}/messages`);
    loader.remove();
    wrap.dataset.loaded = '1';
    if (!messages || messages.length === 0) {
      wrap.insertAdjacentHTML('beforeend', '<div class="empty-state" style="min-height:40px"><div class="empty-msg">No messages found</div></div>');
      return;
    }
    const sessionContext = {
      id: sessionId,
      projectId: row.dataset.projectId || '',
      projectName: row.dataset.projectName || '',
      source: row.dataset.source || 'claude',
      startTime: row.dataset.startTime || '',
    };
    wrap.insertAdjacentHTML('beforeend', renderMessagesTable(messages, { selectable: true, session: sessionContext }));
    bindPromptSelectableRows(wrap);
  } catch (e) {
    loader.remove();
    wrap.insertAdjacentHTML('beforeend', `<div class="empty-state"><div class="empty-msg">Error: ${escHtml(e.message)}</div></div>`);
  }
}

function renderMessagesTable(messages, opts = {}) {
  const selectable = Boolean(opts.selectable && opts.session);
  const rows = messages.map((m, i) => {
    const totalTok = m.inputTokens + m.outputTokens + m.cacheCreationTokens + m.cacheReadTokens;
    const thinkCell = m.hasThinking
      ? `<td class="right" style="font-size:11px" title="Extended thinking">💭</td>`
      : `<td class="right muted" style="font-size:11px">—</td>`;
    const TRUNC = 120;
    const prompt = m.prompt || '';
    const promptCell = prompt.length > TRUNC
      ? `<span class="msg-prompt-text">${escHtml(prompt.slice(0, TRUNC))}…</span><span class="msg-prompt-expand" data-prompt="${escHtml(prompt)}">show more</span>`
      : `<span class="msg-prompt-text">${escHtml(prompt)}</span>`;
    const promptId = selectable ? `${opts.session.id}::${m.index}` : '';
    const promptForLabel = selectable
      ? { prompt, projectName: opts.session.projectName }
      : null;
    const checked = selectable && state.promptCompSelection.some(x => x.id === promptId);
    const checkCell = selectable
      ? `<td class="check-cell"><input type="checkbox" class="prompt-check" data-prompt-id="${escHtml(promptId)}" data-prompt-label="${escHtml(promptCompareLabel(promptForLabel))}" ${checked ? 'checked' : ''}></td>`
      : '';
    return `<tr>
      ${checkCell}
      <td class="muted" style="font-size:11px;width:24px;text-align:right">${i + 1}</td>
      <td class="muted nowrap" style="font-size:11px">${fmtDateTime(m.timestamp)}</td>
      <td class="msg-prompt">${promptCell}</td>
      <td style="font-size:11px">${modelBadgeHtml(m.model, false)}</td>
      <td class="right mono muted" style="font-size:11px">${totalTok ? fmtTokens(totalTok) : '—'}</td>
      <td class="right mono" style="font-size:11px">${m.cost ? fmtCost(m.cost) : '—'}</td>
      <td class="right muted" style="font-size:11px">${m.toolCalls || '—'}</td>
      ${thinkCell}
    </tr>`;
  }).join('');

  return `<table class="messages-table">
    <thead>
      <tr>
        ${selectable ? '<th class="check-cell"></th>' : ''}
        <th style="width:24px">#</th>
        <th>Time</th>
        <th>Prompt</th>
        <th>Model</th>
        <th class="right">Tokens</th>
        <th class="right">Cost</th>
        <th class="right">Tools</th>
        <th class="right">Think</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>`;
}

function renderPagination(cur, total) {
  const pages = [];
  const range = 2;
  for (let i = 0; i < total; i++) {
    if (i === 0 || i === total - 1 || Math.abs(i - cur) <= range) {
      pages.push(i);
    }
  }

  let html = '<div class="pagination">';
  html += `<button class="page-btn" data-page="${cur - 1}" ${cur === 0 ? 'disabled' : ''}>← Prev</button>`;

  let prev = -1;
  for (const p of pages) {
    if (prev !== -1 && p - prev > 1) html += `<span class="muted" style="padding:0 4px">…</span>`;
    html += `<button class="page-btn ${p === cur ? 'active' : ''}" data-page="${p}">${p + 1}</button>`;
    prev = p;
  }

  html += `<button class="page-btn" data-page="${cur + 1}" ${cur === total - 1 ? 'disabled' : ''}>Next →</button>`;
  html += '</div>';
  return html;
}

// ── Model Compare ───────────────────────────────────────────

async function renderComparison() {
  setLoading();
  try {
    const models = await api.models();
    state.data.models = models;

    if (models.length === 0) {
      document.getElementById('content').innerHTML = `
        <h1 class="page-title">Model Compare</h1>
        <div class="empty-state"><div class="empty-icon">⟷</div><div class="empty-msg">No model data found</div></div>
      `;
      return;
    }

    if (!state.compModel1 && models[0]) state.compModel1 = models[0].model;
    if (!state.compModel2 && models[1]) state.compModel2 = models[1].model;

    const content = document.getElementById('content');
    content.innerHTML = `
      <h1 class="page-title">Model Compare</h1>
      <p class="page-subtitle">${periodLabel()} · side-by-side stats per model</p>

      <div class="comparison-selectors">
        <select id="comp-model1">
          ${models.map(m => `<option value="${escHtml(m.model)}" ${m.model === state.compModel1 ? 'selected' : ''}>${escHtml(m.model)}</option>`).join('')}
        </select>
        <span class="comparison-vs-label">vs</span>
        <select id="comp-model2">
          ${models.map(m => `<option value="${escHtml(m.model)}" ${m.model === state.compModel2 ? 'selected' : ''}>${escHtml(m.model)}</option>`).join('')}
        </select>
        <button class="compare-btn" id="compare-btn">Compare</button>
      </div>

      <div id="comparison-result"></div>
    `;

    document.getElementById('comp-model1').addEventListener('change', e => { state.compModel1 = e.target.value; });
    document.getElementById('comp-model2').addEventListener('change', e => { state.compModel2 = e.target.value; });
    document.getElementById('compare-btn').addEventListener('click', loadComparison);

    await loadComparison();
  } catch (e) {
    showError(e);
  }
}

async function loadComparison() {
  const wrap = document.getElementById('comparison-result');
  if (!wrap) return;
  wrap.innerHTML = '<div class="loading-state"><div class="spinner"></div></div>';

  try {
    const { model1, model2 } = await api.comparison(state.compModel1, state.compModel2);
    if (!model1 || !model2) {
      wrap.innerHTML = `<div class="empty-state"><div class="empty-icon">⟷</div><div class="empty-msg">Select two different models to compare</div></div>`;
      return;
    }

    // Determine winner (by cost, unless local)
    let winner = null;
    let savingsPct = 0;

    if (!model1.isLocal && !model2.isLocal && model1.totalCost > 0 && model2.totalCost > 0) {
      // Normalize by sessions count for fair comparison
      const costPer1 = model1.avgCostPerSession;
      const costPer2 = model2.avgCostPerSession;
      winner = costPer1 <= costPer2 ? 'm1' : 'm2';
      const cheaper = Math.min(costPer1, costPer2);
      const expensive = Math.max(costPer1, costPer2);
      savingsPct = expensive > 0 ? ((expensive - cheaper) / expensive) * 100 : 0;
    }

    wrap.innerHTML = `
      <div class="comparison-arena">
        ${renderCompCard(model1, winner === 'm1', winner === 'm2', !model1.isLocal && model2.isLocal ? null : savingsPct, model2.model)}
        <div class="vs-divider"><div class="vs-circle">VS</div></div>
        ${renderCompCard(model2, winner === 'm2', winner === 'm1', !model2.isLocal && model1.isLocal ? null : (winner === 'm2' ? savingsPct : null), model1.model)}
      </div>
    `;
  } catch (e) {
    wrap.innerHTML = `<div class="empty-state"><div class="empty-msg">Error loading comparison: ${escHtml(e.message)}</div></div>`;
  }
}

function renderCompCard(m, isWinner, isLoser, savingsPct, vsModel) {
  const totalTokens = m.inputTokens + m.outputTokens + m.cacheCreationTokens + m.cacheReadTokens;
  const costClass = m.isLocal ? 'local-cost' : isWinner ? 'winner-cost' : isLoser ? 'loser-cost' : '';
  const costDisplay = m.isLocal
    ? `${fmtTokens(totalTokens)} tokens`
    : fmtCost(m.totalCost);

  const winnerBadge = isWinner ? '<span class="badge-winner">Winner</span>' : '';
  const loserBadge = isLoser ? '<span class="badge-loser">More Expensive</span>' : '';
  const localBadge = m.isLocal ? '<span class="badge-local">Local</span>' : '';
  const badge = winnerBadge || loserBadge || localBadge;

  const savingsBlock = isWinner && savingsPct > 0 ? `
    <div class="comp-savings">
      <div class="comp-savings-pct">${savingsPct.toFixed(0)}% cheaper</div>
      <div class="comp-savings-label">per session vs ${shortModelName(vsModel)}</div>
    </div>
  ` : '';

  return `
    <div class="comparison-card ${isWinner ? 'winner' : ''}">
      <div class="comp-header">
        <div class="comp-model-name">${escHtml(m.model)}</div>
        ${badge}
      </div>
      <div class="comp-body">
        <div class="comp-cost ${costClass}">${costDisplay}</div>

        <div class="comp-stats-grid">
          <div class="comp-stat">
            <div class="comp-stat-label">Total Tokens</div>
            <div class="comp-stat-value">${fmtTokens(totalTokens)}</div>
          </div>
          <div class="comp-stat">
            <div class="comp-stat-label">Input Tokens${m.isLocal ? ` <span class="local-token-note" data-tip="${LOCAL_TOKEN_TIP}">*</span>` : ''}</div>
            <div class="comp-stat-value">${fmtTokens(m.inputTokens)}</div>
          </div>
          <div class="comp-stat">
            <div class="comp-stat-label">Output Tokens</div>
            <div class="comp-stat-value">${fmtTokens(m.outputTokens)}</div>
          </div>
          <div class="comp-stat">
            <div class="comp-stat-label">Cache Hits</div>
            <div class="comp-stat-value">${fmtTokens(m.cacheReadTokens)}</div>
          </div>
        </div>

        <div class="comp-efficiency">
          <div class="comp-eff-item">
            <div class="comp-eff-label">Cost / Session</div>
            <div class="comp-eff-value">${m.isLocal ? '—' : fmtCost(m.avgCostPerSession)}</div>
          </div>
          <div class="comp-eff-item">
            <div class="comp-eff-label">Tool Calls</div>
            <div class="comp-eff-value">${m.totalToolCalls.toLocaleString()}</div>
          </div>
          <div class="comp-eff-item">
            <div class="comp-eff-label">Avg Duration</div>
            <div class="comp-eff-value">${fmtDuration(m.avgDuration)}</div>
          </div>
          <div class="comp-eff-item">
            <div class="comp-eff-label">Cache Efficiency</div>
            <div class="comp-eff-value">${fmtPct(m.cacheHitRate)}</div>
          </div>
          <div class="comp-eff-item">
            <div class="comp-eff-label">Sessions</div>
            <div class="comp-eff-value">${m.sessionCount}</div>
          </div>
          <div class="comp-eff-item">
            <div class="comp-eff-label">Messages</div>
            <div class="comp-eff-value">${m.totalMessages.toLocaleString()}</div>
          </div>
        </div>

        ${savingsBlock}
      </div>
    </div>
  `;
}

const LOCAL_TOKEN_TIP = 'Local models send the full conversation context each turn rather than tracking cache reads separately. This inflates input counts vs. Claude sessions.';

// ── Session Comparison ─────────────────────────────────────────

const SESSION_COMPARE_METRICS = [
  { key: 'cost',          label: 'Cost'           },
  { key: 'totalTokens',   label: 'Total Tokens'   },
  { key: 'inputTokens',   label: 'Input Tokens'   },
  { key: 'outputTokens',  label: 'Output Tokens'  },
  { key: 'cacheRead',     label: 'Cache Read'     },
  { key: 'cacheWrite',    label: 'Cache Write'    },
  { key: 'cacheHitRate',  label: 'Cache Hit Rate' },
  { key: 'duration',      label: 'Duration'       },
  { key: 'messages',      label: 'Messages'       },
  { key: 'toolCalls',     label: 'Tool Calls'     },
  { key: 'thinkingTurns', label: 'Thinking Turns' },
];

function getOrderedMetrics() {
  if (!state.scMetricsOrder || state.scMetricsOrder.length === 0) return SESSION_COMPARE_METRICS;
  const pos = new Map(state.scMetricsOrder.map((k, i) => [k, i]));
  return [...SESSION_COMPARE_METRICS].sort((a, b) => {
    const ai = pos.has(a.key) ? pos.get(a.key) : 999;
    const bi = pos.has(b.key) ? pos.get(b.key) : 999;
    return ai - bi;
  });
}

async function renderSessionCompare() {
  setLoading();
  try {
    if (!state.data.allSessions) {
      const { sessions } = await api.sessions({ limit: 500, offset: 0 });
      state.data.allSessions = sessions;
    }
    const allSessions = state.data.allSessions;

    if (allSessions.length === 0) {
      document.getElementById('content').innerHTML = `
        <h1 class="page-title">Session Compare</h1>
        <div class="empty-state"><div class="empty-icon">⇄</div><div class="empty-msg">No sessions found</div></div>
      `;
      return;
    }

    renderSessionComparePage();
  } catch (e) {
    showError(e);
  }
}

function sessionChipLabel(s) {
  return `${s.projectName} · ${fmtDate(s.startTime)}`;
}

function sessionDropdownLabel(s) {
  return `${fmtDate(s.startTime)} · ${s.projectName} · ${s.firstPrompt.slice(0, 55)}`;
}

function compareAddOptionsHtml(allSessions) {
  const selectedIds = new Set(state.compSelection.map(x => x.id));
  return allSessions
    .filter(s => !selectedIds.has(s.id))
    .map(s => `<option value="${escHtml(s.id)}">${escHtml(sessionDropdownLabel(s))}</option>`)
    .join('');
}

function renderCompareAddSlot(allSessions, variant) {
  if (state.compSelection.length >= COMP_LETTERS.length) return '';
  const addOptions = compareAddOptionsHtml(allSessions);
  if (!addOptions) return '';

  return `
    <label class="sc-add-slot sc-add-slot--${variant}">
      <span class="sc-add-plus">
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M7 1v12M1 7h12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
      </span>
      <select class="sc-inline-add-select" aria-label="Add session to compare">
        <option value="">Add session…</option>
        ${addOptions}
      </select>
    </label>
  `;
}

function addCompareSession(id) {
  const allSessions = state.data.allSessions ?? [];
  if (!id || state.compSelection.some(x => x.id === id) || state.compSelection.length >= COMP_LETTERS.length) return;
  const s = allSessions.find(x => x.id === id);
  if (!s) return;

  state.compSelection.push({ id, label: sessionChipLabel(s) });
  saveCompSelection();
  syncAllCheckboxes();
  renderCompareBar();
  renderSessionComparePage();
}

function removeCompareSession(id) {
  const idx = state.compSelection.findIndex(x => x.id === id);
  if (idx === -1) return;

  state.compSelection.splice(idx, 1);
  saveCompSelection();
  syncAllCheckboxes();
  renderCompareBar();
  renderSessionComparePage();
}

function bindSessionCompareInlineControls(container) {
  container.querySelectorAll('.sc-inline-add-select').forEach(select => {
    select.addEventListener('change', () => addCompareSession(select.value));
  });

  container.querySelectorAll('[data-remove-session]').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      removeCompareSession(btn.dataset.removeSession);
    });
  });
}

function renderSessionComparePage() {
  const hiddenCount = state.scHiddenMetrics.size;
  const totalCount  = SESSION_COMPARE_METRICS.length;
  const fieldCount  = hiddenCount > 0 ? ` <span class="sc-fields-count">${totalCount - hiddenCount}/${totalCount}</span>` : '';

  const content = document.getElementById('content');
  content.innerHTML = `
    <h1 class="page-title">Session Compare</h1>
    <p class="page-subtitle">Compare cost and token usage across up to 6 sessions</p>

    <div class="sc-toolbar">
      <div class="sc-dropdown" id="sc-fields-dropdown">
        <button class="sc-view-btn sc-fields-btn${hiddenCount > 0 ? ' sc-fields-btn--filtered' : ''}" id="sc-fields-btn">
          <svg width="13" height="13" viewBox="0 0 14 14" fill="none"><path d="M1 3h12M3 7h8M5 11h4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
          Fields${fieldCount} <span class="sc-dropdown-chevron">▾</span>
        </button>
      </div>

      <div class="sc-view-toggle">
        <button class="sc-view-btn${state.scView === 'table' ? ' sc-view-btn--on' : ''}" data-view="table">
          <svg width="13" height="13" viewBox="0 0 14 14" fill="none"><rect x="1" y="1" width="12" height="3" rx="1" fill="currentColor" opacity=".5"/><rect x="1" y="6" width="12" height="2" rx="1" fill="currentColor"/><rect x="1" y="10" width="12" height="2" rx="1" fill="currentColor" opacity=".7"/></svg>
          Table
        </button>
        <button class="sc-view-btn${state.scView === 'card' ? ' sc-view-btn--on' : ''}" data-view="card">
          <svg width="13" height="13" viewBox="0 0 14 14" fill="none"><rect x="1" y="1" width="5.5" height="12" rx="1.5" fill="currentColor"/><rect x="7.5" y="1" width="5.5" height="12" rx="1.5" fill="currentColor" opacity=".7"/></svg>
          Cards
        </button>
      </div>

      <div class="sc-view-toggle">
        <button class="sc-view-btn${state.scOrder === 'added' ? ' sc-view-btn--on' : ''}" data-order="added">Added</button>
        <button class="sc-view-btn${state.scOrder === 'ranked' ? ' sc-view-btn--on' : ''}" data-order="ranked">
          <svg width="13" height="13" viewBox="0 0 14 14" fill="none"><path d="M2 12L5 7L8 9L12 3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
          Best Overall
        </button>
      </div>

      ${(() => {
        const allSessions = state.data?.allSessions ?? [];
        const selectedIds = new Set(state.compSelection.map(x => x.id));
        const opts = allSessions
          .filter(s => !selectedIds.has(s.id))
          .map(s => `<option value="${escHtml(s.id)}">${escHtml(sessionDropdownLabel(s))}</option>`)
          .join('');
        return opts && state.compSelection.length < COMP_LETTERS.length
          ? `<select class="sc-toolbar-add-select" id="sc-toolbar-add-select" aria-label="Add session to compare"><option value="">+ Add session</option>${opts}</select>`
          : '';
      })()}

      ${state.scView === 'card' ? `
        <button class="sc-present-btn${state.scPresent ? ' sc-present-btn--on' : ''}" id="sc-present-toggle">
          <svg width="13" height="13" viewBox="0 0 14 14" fill="none"><circle cx="7" cy="7" r="5.5" stroke="currentColor" stroke-width="1.4"/><circle cx="7" cy="7" r="2" fill="currentColor"/></svg>
          ${state.scPresent ? 'Exit Present' : 'Present'}
        </button>
      ` : ''}
    </div>

    <div id="session-comparison-result"></div>
  `;

  content.querySelectorAll('[data-view]').forEach(btn => {
    btn.addEventListener('click', () => {
      state.scView = btn.dataset.view;
      localStorage.setItem('sc-view', state.scView);
      if (state.scView === 'table') {
        state.scPresent = false;
        state.scRevealed.clear();
      }
      renderSessionComparePage();
    });
  });

  content.querySelectorAll('[data-order]').forEach(btn => {
    btn.addEventListener('click', () => {
      state.scOrder = btn.dataset.order;
      localStorage.setItem('sc-order', state.scOrder);
      state.scRevealed.clear();
      content.querySelectorAll('[data-order]').forEach(b => b.classList.toggle('sc-view-btn--on', b.dataset.order === state.scOrder));
      renderSessionComparisonResult();
    });
  });

  document.getElementById('sc-toolbar-add-select')?.addEventListener('change', e => {
    addCompareSession(e.target.value);
  });

  document.getElementById('sc-present-toggle')?.addEventListener('click', () => {
    state.scPresent = !state.scPresent;
    state.scRevealed.clear();
    renderSessionComparePage();
  });

  const fieldsBtn = document.getElementById('sc-fields-btn');
  if (fieldsBtn) {
    fieldsBtn.addEventListener('click', e => {
      e.stopPropagation();
      const existing = document.getElementById('sc-fields-panel');
      if (existing) {
        existing.remove();
        fieldsBtn.classList.remove('sc-fields-btn--open');
        return;
      }
      const panel = document.createElement('div');
      panel.id = 'sc-fields-panel';
      panel.className = 'sc-dropdown-panel';
      document.body.appendChild(panel);
      buildFieldsPanel(panel);
      positionFieldsPanel(fieldsBtn, panel);
      fieldsBtn.classList.add('sc-fields-btn--open');
    });
  }

  renderSessionComparisonResult();
}

function rankSessions(sessions) {
  const hidden = state.scHiddenMetrics;
  const useCost     = !hidden.has('cost');
  const useTokens   = !hidden.has('totalTokens');
  const useDuration = !hidden.has('duration');
  if (!useCost && !useTokens && !useDuration) return sessions; // nothing scoreable

  function isLocal(s) { return s.cost === 0 && (s.usage.inputTokens + s.usage.outputTokens) > 0; }

  const dims = sessions.map(s => ({
    s,
    cost:     useCost     ? (isLocal(s) ? null : s.cost) : null,
    tokens:   useTokens   ? s.usage.inputTokens + s.usage.outputTokens + s.usage.cacheCreationTokens + s.usage.cacheReadTokens : null,
    duration: useDuration ? s.duration : null,
  }));

  const norm = key => {
    const vs = dims.map(d => d[key]).filter(v => v !== null && v > 0);
    if (vs.length < 2) return dims.map(() => 0);
    const lo = Math.min(...vs), hi = Math.max(...vs);
    if (lo === hi) return dims.map(() => 0);
    return dims.map(d => d[key] !== null && d[key] > 0 ? (d[key] - lo) / (hi - lo) : 0.5);
  };

  const nc = norm('cost'), nt = norm('tokens'), nd = norm('duration');
  const scored = dims.map((d, i) => ({ s: d.s, score: nc[i] + nt[i] + nd[i] }));
  scored.sort((a, b) => a.score - b.score);
  return scored.map(x => x.s);
}

function positionFieldsPanel(btn, panel) {
  const r = btn.getBoundingClientRect();
  panel.style.top  = `${r.bottom + 6}px`;
  panel.style.left = `${r.left}px`;
}

function buildFieldsPanel(panel) {
  const ordered = getOrderedMetrics();
  panel.innerHTML = `
    <div class="sc-fields-list">
      ${ordered.map(m => {
        const on = !state.scHiddenMetrics.has(m.key);
        return `
          <div class="sc-fields-item${on ? '' : ' sc-fields-item--off'}" draggable="true" data-key="${escHtml(m.key)}">
            <span class="sc-fields-drag">⠿</span>
            <span class="sc-fields-name">${escHtml(m.label)}</span>
            <button class="sc-fields-toggle${on ? ' sc-fields-toggle--on' : ''}" data-toggle="${escHtml(m.key)}">
              ${on
                ? '<svg width="12" height="12" viewBox="0 0 14 14" fill="none"><path d="M2 7C2 7 4 3 7 3C10 3 12 7 12 7C12 7 10 11 7 11C4 11 2 7 2 7Z" stroke="currentColor" stroke-width="1.4"/><circle cx="7" cy="7" r="1.8" fill="currentColor"/></svg>'
                : '<svg width="12" height="12" viewBox="0 0 14 14" fill="none"><path d="M2 2L12 12M3.5 4.5C2.7 5.3 2 6.2 2 7C2 7 4 11 7 11C8.1 11 9.1 10.5 9.9 9.8M5.1 2.2C5.7 2.1 6.4 2 7 2C10 2 12 7 12 7C11.6 7.7 11.1 8.4 10.5 9" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>'}
            </button>
          </div>`;
      }).join('')}
    </div>
    <div class="sc-fields-footer">
      <button class="sc-fields-reset" id="sc-fields-reset">Reset defaults</button>
    </div>
  `;

  // Visibility toggles
  panel.querySelectorAll('[data-toggle]').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const key = btn.dataset.toggle;
      if (state.scHiddenMetrics.has(key)) state.scHiddenMetrics.delete(key);
      else state.scHiddenMetrics.add(key);
      localStorage.setItem('sc-hidden-metrics', JSON.stringify([...state.scHiddenMetrics]));
      // Refresh count badge on Fields button
      const hc = state.scHiddenMetrics.size, tc = SESSION_COMPARE_METRICS.length;
      const fb = document.getElementById('sc-fields-btn');
      if (fb) {
        fb.querySelector('.sc-fields-count')?.remove();
        if (hc > 0) {
          const badge = document.createElement('span');
          badge.className = 'sc-fields-count';
          badge.textContent = `${tc - hc}/${tc}`;
          fb.querySelector('.sc-dropdown-chevron').before(badge);
          fb.classList.add('sc-fields-btn--filtered');
        } else {
          fb.classList.remove('sc-fields-btn--filtered');
        }
      }
      buildFieldsPanel(panel);
      renderSessionComparisonResult();
    });
  });

  // Drag-to-reorder
  let dragKey = null;
  panel.querySelectorAll('.sc-fields-item').forEach(item => {
    item.addEventListener('dragstart', e => {
      dragKey = item.dataset.key;
      e.dataTransfer.effectAllowed = 'move';
      setTimeout(() => item.classList.add('sc-fields-item--dragging'), 0);
    });
    item.addEventListener('dragend', () => {
      panel.querySelectorAll('.sc-fields-item').forEach(el => {
        el.classList.remove('sc-fields-item--dragging', 'sc-fields-item--over');
      });
      dragKey = null;
    });
    item.addEventListener('dragover', e => {
      e.preventDefault();
      if (!dragKey || dragKey === item.dataset.key) return;
      panel.querySelectorAll('.sc-fields-item--over').forEach(el => el.classList.remove('sc-fields-item--over'));
      item.classList.add('sc-fields-item--over');
    });
    item.addEventListener('dragleave', () => item.classList.remove('sc-fields-item--over'));
    item.addEventListener('drop', e => {
      e.preventDefault();
      item.classList.remove('sc-fields-item--over');
      if (!dragKey || dragKey === item.dataset.key) return;
      const keys = getOrderedMetrics().map(m => m.key);
      const from = keys.indexOf(dragKey), to = keys.indexOf(item.dataset.key);
      if (from === -1 || to === -1) return;
      keys.splice(from, 1);
      keys.splice(to, 0, dragKey);
      state.scMetricsOrder = keys;
      localStorage.setItem('sc-metrics-order', JSON.stringify(keys));
      buildFieldsPanel(panel);
      renderSessionComparisonResult();
    });
  });

  // Reset
  document.getElementById('sc-fields-reset')?.addEventListener('click', e => {
    e.stopPropagation();
    state.scMetricsOrder = null;
    state.scHiddenMetrics.clear();
    localStorage.removeItem('sc-metrics-order');
    localStorage.removeItem('sc-hidden-metrics');
    const fb = document.getElementById('sc-fields-btn');
    if (fb) {
      fb.querySelector('.sc-fields-count')?.remove();
      fb.classList.remove('sc-fields-btn--filtered');
    }
    buildFieldsPanel(panel);
    renderSessionComparisonResult();
  });
}

function renderSessionComparisonResult() {
  if (state.scView === 'card') renderSessionComparisonCards();
  else renderSessionComparisonTable();
}

function renderSessionComparisonTable() {
  const wrap = document.getElementById('session-comparison-result');
  if (!wrap) return;

  const allSessions = state.data.allSessions ?? [];
  const selected = state.compSelection
    .map(x => allSessions.find(s => s.id === x.id))
    .filter(Boolean);

  if (selected.length === 0) {
    wrap.innerHTML = `<div class="empty-state" style="margin-top:24px"><div class="empty-icon">⇄</div><div class="empty-msg">Use + Add session above to get started</div></div>`;
    return;
  }

  function isLocal(s) { return isLocalSession(s); }

  if (state.scOrder === 'ranked' && selected.length >= 2) {
    selected.splice(0, selected.length, ...rankSessions(selected));
  }

  const localTooltip = LOCAL_TOKEN_TIP;

  const allMetrics = [
    { key: 'cost',          label: 'Cost',           val: s => s.cost,                                                                                             fmt: s => { const local = isLocal(s); return local ? '<span class="amber">local</span>' : fmtCost(s.cost); }, lowerBetter: true,  skipLocal: true },
    { key: 'totalTokens',   label: 'Total Tokens',   val: s => s.usage.inputTokens + s.usage.outputTokens + s.usage.cacheCreationTokens + s.usage.cacheReadTokens, fmt: s => fmtTokens(s.usage.inputTokens + s.usage.outputTokens + s.usage.cacheCreationTokens + s.usage.cacheReadTokens), lowerBetter: true  },
    { key: 'inputTokens',   label: 'Input Tokens',   val: s => s.usage.inputTokens,           fmt: s => isLocal(s) ? `${fmtTokens(s.usage.inputTokens)} <span class="sc-metric-info" data-tip="${escHtml(localTooltip)}">?</span>` : fmtTokens(s.usage.inputTokens), lowerBetter: true  },
    { key: 'outputTokens',  label: 'Output Tokens',  val: s => s.usage.outputTokens,          fmt: s => fmtTokens(s.usage.outputTokens),          lowerBetter: true  },
    { key: 'cacheRead',     label: 'Cache Read',     val: s => s.usage.cacheReadTokens,       fmt: s => fmtTokens(s.usage.cacheReadTokens),       lowerBetter: false },
    { key: 'cacheWrite',    label: 'Cache Write',    val: s => s.usage.cacheCreationTokens,   fmt: s => fmtTokens(s.usage.cacheCreationTokens),   lowerBetter: true  },
    { key: 'cacheHitRate',  label: 'Cache Hit Rate', val: s => s.cacheHitRate,                fmt: s => fmtPct(s.cacheHitRate),                   lowerBetter: false },
    { key: 'duration',      label: 'Duration',       val: s => sessionDuration(s),            fmt: s => fmtDuration(sessionDuration(s)),           lowerBetter: true  },
    { key: 'messages',      label: 'Messages',       val: s => s.messageCount,                fmt: s => s.messageCount.toString(),                lowerBetter: null  },
    { key: 'toolCalls',     label: 'Tool Calls',     val: s => s.toolCallCount,               fmt: s => s.toolCallCount.toString(),               lowerBetter: null  },
    { key: 'thinkingTurns', label: 'Thinking Turns', val: s => s.thinkingBlocks || 0,         fmt: s => (s.thinkingBlocks || 0).toString(),       lowerBetter: null  },
  ];
  const metrics = getOrderedMetrics()
    .map(om => allMetrics.find(m => m.key === om.key))
    .filter(m => m && !state.scHiddenMetrics.has(m.key));

  const colHeaders = selected.map((s, i) => {
    const local = isLocal(s);
    const label = state.scOrder === 'ranked' ? String(i + 1) : COMP_LETTERS[i];
    return `<th class="sc-col-header">
      <button class="sc-remove-session-btn" data-remove-session="${escHtml(s.id)}" title="Remove session">×</button>
      <div class="sc-col-letter">${label}</div>
      <div class="sc-col-project">${escHtml(s.projectName)}</div>
      <div class="sc-col-date">${fmtDateTime(s.startTime)}</div>
      <div style="margin-top:5px">${modelBadgeHtml(s.primaryModel, local)}</div>
      <div class="sc-col-prompt" title="${escHtml(s.firstPrompt)}">${escHtml(s.firstPrompt.slice(0, 60))}${s.firstPrompt.length > 60 ? '…' : ''}</div>
    </th>`;
  }).join('');

  const metricRows = metrics.map(m => {
    const vals = selected.map(s => ({ s, v: m.val(s), local: isLocal(s) }));

    // Find best/worst among non-local sessions when lowerBetter is defined
    let bestV = null, worstV = null;
    if (m.lowerBetter !== null) {
      const scoreable = vals.filter(x => !(m.skipLocal && x.local) && x.v > 0);
      if (scoreable.length >= 2) {
        const vs = scoreable.map(x => x.v);
        bestV  = m.lowerBetter ? Math.min(...vs) : Math.max(...vs);
        worstV = m.lowerBetter ? Math.max(...vs) : Math.min(...vs);
      }
    }

    const cells = vals.map(({ s, v, local }) => {
      let cls = '';
      if (bestV !== null && !(m.skipLocal && local)) {
        if (v === bestV && bestV !== worstV) cls = 'sc-cell-best';
        else if (v === worstV && bestV !== worstV) cls = 'sc-cell-worst';
      }
      return `<td class="sc-cell ${cls}">${m.fmt(s)}</td>`;
    }).join('');

    return `<tr><td class="sc-metric-label">${escHtml(m.label)}</td>${cells}</tr>`;
  }).join('');

  wrap.innerHTML = `
    <div class="sc-table-wrap">
      <table class="sc-table">
        <thead>
          <tr>
            <th class="sc-metric-label"></th>
            ${colHeaders}
          </tr>
        </thead>
        <tbody>${metricRows}</tbody>
      </table>
    </div>
    ${selected.length >= 2 ? `
      <div class="sc-legend">
        <span class="sc-legend-item"><span class="sc-cell-best sc-legend-swatch"></span> Best</span>
        <span class="sc-legend-item"><span class="sc-cell-worst sc-legend-swatch"></span> Worst</span>
      </div>
    ` : ''}
  `;

  bindSessionCompareInlineControls(wrap);
}

function renderSessionComparisonCards() {
  const wrap = document.getElementById('session-comparison-result');
  if (!wrap) return;

  const allSessions = state.data.allSessions ?? [];
  const selected = state.compSelection
    .map(x => allSessions.find(s => s.id === x.id))
    .filter(Boolean);

  if (selected.length === 0) {
    wrap.innerHTML = `<div class="empty-state" style="margin-top:24px"><div class="empty-icon">⇄</div><div class="empty-msg">Use + Add session above to get started</div></div>`;
    return;
  }

  function isLocal(s) { return isLocalSession(s); }

  // Sort by composite rank if requested
  if (state.scOrder === 'ranked' && selected.length >= 2) {
    selected.splice(0, selected.length, ...rankSessions(selected));
  }

  const allMetrics = [
    { key: 'cost',          label: 'Cost',           val: s => s.cost,                                                                                             fmt: s => isLocal(s) ? 'local' : fmtCost(s.cost),                    lowerBetter: true,  skipLocal: true },
    { key: 'totalTokens',   label: 'Total Tokens',   val: s => s.usage.inputTokens + s.usage.outputTokens + s.usage.cacheCreationTokens + s.usage.cacheReadTokens, fmt: s => fmtTokens(s.usage.inputTokens + s.usage.outputTokens + s.usage.cacheCreationTokens + s.usage.cacheReadTokens), lowerBetter: true  },
    { key: 'inputTokens',   label: 'Input Tokens',   val: s => s.usage.inputTokens,           fmt: s => fmtTokens(s.usage.inputTokens),   lowerBetter: true  },
    { key: 'outputTokens',  label: 'Output Tokens',  val: s => s.usage.outputTokens,          fmt: s => fmtTokens(s.usage.outputTokens),  lowerBetter: true  },
    { key: 'cacheRead',     label: 'Cache Read',     val: s => s.usage.cacheReadTokens,       fmt: s => fmtTokens(s.usage.cacheReadTokens),       lowerBetter: false },
    { key: 'cacheWrite',    label: 'Cache Write',    val: s => s.usage.cacheCreationTokens,   fmt: s => fmtTokens(s.usage.cacheCreationTokens),   lowerBetter: true  },
    { key: 'cacheHitRate',  label: 'Cache Hit Rate', val: s => s.cacheHitRate,                fmt: s => fmtPct(s.cacheHitRate),                   lowerBetter: false },
    { key: 'duration',      label: 'Duration',       val: s => sessionDuration(s),            fmt: s => fmtDuration(sessionDuration(s)),           lowerBetter: true  },
    { key: 'messages',      label: 'Messages',       val: s => s.messageCount,                fmt: s => s.messageCount.toString(),                lowerBetter: null  },
    { key: 'toolCalls',     label: 'Tool Calls',     val: s => s.toolCallCount,               fmt: s => s.toolCallCount.toString(),               lowerBetter: null  },
    { key: 'thinkingTurns', label: 'Thinking Turns', val: s => s.thinkingBlocks || 0,         fmt: s => (s.thinkingBlocks || 0).toString(),       lowerBetter: null  },
  ];
  const metrics = getOrderedMetrics()
    .map(om => allMetrics.find(m => m.key === om.key))
    .filter(m => m && !state.scHiddenMetrics.has(m.key));

  // Pre-compute best/worst per metric
  const metricScores = new Map();
  metrics.forEach(m => {
    if (m.lowerBetter === null) return;
    const scoreable = selected.filter(s => !(m.skipLocal && isLocal(s)) && m.val(s) > 0);
    if (scoreable.length < 2) return;
    const vs = scoreable.map(s => m.val(s));
    const bestV  = m.lowerBetter ? Math.min(...vs) : Math.max(...vs);
    const worstV = m.lowerBetter ? Math.max(...vs) : Math.min(...vs);
    metricScores.set(m.key, { bestV, worstV });
  });

  const cards = selected.map((s, i) => {
    const local = isLocal(s);
    const revealed = state.scRevealed.has(s.id);
    const presentCls = state.scPresent ? (revealed ? ' sc-card--present sc-card--revealed' : ' sc-card--present') : '';
    const label = state.scOrder === 'ranked' ? String(i + 1) : COMP_LETTERS[i];

    const tiles = metrics.map(m => {
      const v = m.val(s);
      const score = metricScores.get(m.key);
      let cls = '';
      if (score && !(m.skipLocal && local)) {
        if (v === score.bestV && score.bestV !== score.worstV) cls = 'sc-tile--best';
        else if (v === score.worstV && score.bestV !== score.worstV) cls = 'sc-tile--worst';
      }
      return `
        <div class="sc-tile ${cls}">
          <div class="sc-tile-label">${escHtml(m.label)}</div>
          <div class="sc-tile-value">${m.fmt(s)}</div>
        </div>`;
    }).join('');

    return `
      <div class="sc-card${presentCls}" data-present-id="${escHtml(s.id)}">
        <div class="sc-card-inner">
          <div class="sc-card-hero">
            <div class="sc-card-hero-letter">${label}</div>
            <div class="sc-card-hero-info">
              <div class="sc-card-project">${escHtml(s.projectName)}</div>
              <div class="sc-card-date">${fmtDateTime(s.startTime)}</div>
              <div class="sc-card-model-row">${modelBadgeHtml(s.primaryModel, local)}</div>
            </div>
            <button class="sc-remove-session-btn sc-card-remove" data-remove-session="${escHtml(s.id)}" title="Remove session">×</button>
          </div>
          <div class="sc-card-prompt" title="${escHtml(s.firstPrompt)}">
            <span class="sc-card-prompt-text">${escHtml(s.firstPrompt.slice(0, 80))}${s.firstPrompt.length > 80 ? '…' : ''}</span>
          </div>
          <div class="sc-card-tiles">${tiles}</div>
        </div>
        ${state.scPresent && !revealed ? `<div class="sc-card-veil"><span class="sc-veil-label">Click to reveal</span></div>` : ''}
      </div>`;
  }).join('');

  const presentHint = state.scPresent && selected.length > 0
    ? `<p class="sc-present-hint">${state.scRevealed.size} of ${selected.length} revealed &mdash; click a card to reveal it</p>`
    : '';

  wrap.innerHTML = `
    ${presentHint}
    <div class="sc-cards-grid">
      ${cards}
    </div>
    ${selected.length >= 2 ? `
      <div class="sc-legend" style="margin-top:16px">
        <span class="sc-legend-item"><span class="sc-tile--best sc-legend-swatch"></span> Best</span>
        <span class="sc-legend-item"><span class="sc-tile--worst sc-legend-swatch"></span> Worst</span>
      </div>
    ` : ''}
  `;

  bindSessionCompareInlineControls(wrap);

  if (state.scPresent) {
    wrap.querySelectorAll('.sc-card--present').forEach(card => {
      card.addEventListener('click', () => {
        const id = card.dataset.presentId;
        if (state.scRevealed.has(id)) return;
        state.scRevealed.add(id);
        renderSessionComparisonCards();
      });
    });
  }
}

function periodLabel() {
  const periods = PERIOD_MODES[state.periodMode]?.periods ?? [];
  return periods.find(p => p.key === state.period)?.label ?? 'All Time';
}

// ── Helpers ────────────────────────────────────────────────────

function escHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function setLoading() {
  document.getElementById('content').innerHTML =
    '<div class="loading-state"><div class="spinner"></div><p>Loading...</p></div>';
}

function showError(e) {
  document.getElementById('content').innerHTML =
    `<div class="empty-state"><div class="empty-icon">⚠</div><div class="empty-msg">Error: ${escHtml(e.message)}</div></div>`;
}

// ── Render dispatch ────────────────────────────────────────────

async function renderView() {
  // Close the Fields dropdown panel if it was left open from session compare
  document.getElementById('sc-fields-panel')?.remove();
  document.getElementById('sc-fields-btn')?.classList.remove('sc-fields-btn--open');
  updateNav();
  switch (state.view) {
    case 'overview':        return renderOverview();
    case 'projects':        return renderProjects();
    case 'sessions':        return renderSessions();
    case 'comparison':      return renderComparison();
    case 'session-compare': return renderSessionCompare();
    case 'prompt-compare':  return renderPromptCompare({
      state, api, setLoading, showError, escHtml, fmtCost, fmtTokens, fmtPct, fmtDateTime,
      modelBadgeHtml, agentBadgeHtml, COMP_LETTERS, renderPromptCompareBar, savePromptCompSelection,
      syncPromptCheckboxes, promptCompareLabel,
    });
    case 'tips':            return renderTips();
    case 'settings':        return renderSettings();
    default:                return renderOverview();
  }
}

// ── Period selector renderer ───────────────────────────────────

function renderPeriodSelector() {
  const wrap = document.getElementById('period-selector');
  if (!wrap) return;

  const modeDef = PERIOD_MODES[state.periodMode];

  const modeBtns = Object.entries(PERIOD_MODES).map(([key, def]) =>
    `<button class="period-mode-btn ${key === state.periodMode ? 'active' : ''}" data-mode="${key}">${def.label}</button>`
  ).join('');

  const periodBtns = modeDef.periods.map(p =>
    `<button class="period-btn ${p.key === state.period ? 'active' : ''}" data-period="${p.key}">${p.label}</button>`
  ).join('');

  wrap.className = 'period-selector';
  wrap.innerHTML = `
    <div class="period-mode-toggle">${modeBtns}</div>
    <div class="period-divider"></div>
    <div class="period-btns">${periodBtns}</div>
  `;

  wrap.querySelectorAll('.period-mode-btn[data-mode]').forEach(btn => {
    btn.addEventListener('click', () => {
      if (btn.dataset.mode === state.periodMode) return;
      state.periodMode = btn.dataset.mode;
      // Default to 'all' when switching modes to avoid invalid key crossover
      state.period = 'all';
      state.sessionsPage = 0;
      state.data.allSessions = null;
      state.compSelection = [];
      saveCompSelection();
      renderCompareBar();
      renderPeriodSelector();
      renderView();
    });
  });

  wrap.querySelectorAll('.period-btn[data-period]').forEach(btn => {
    btn.addEventListener('click', () => {
      if (btn.dataset.period === state.period) return;
      state.period = btn.dataset.period;
      state.sessionsPage = 0;
      state.data.allSessions = null;
      state.compSelection = [];
      saveCompSelection();
      renderCompareBar();
      renderPeriodSelector();
      renderView();
    });
  });
}

// ── Tips ───────────────────────────────────────────────────────

async function renderTips() {
  setLoading();
  try {
    const tips = await api.tips();

    const content = document.getElementById('content');

    if (!tips || tips.length === 0) {
      content.innerHTML = `
        <h1 class="page-title">Tips</h1>
        <p class="page-subtitle">Based on your last 30 days of usage</p>
        <div class="empty-state">
          <div class="empty-icon">◎</div>
          <div class="empty-msg">No issues found. Usage looks clean.</div>
        </div>`;
      return;
    }

    const iconMap = { warn: '⚠', info: 'ℹ', good: '✓' };

    content.innerHTML = `
      <h1 class="page-title">Tips</h1>
      <p class="page-subtitle">Based on your last 30 days of usage</p>
      <div class="tips-list">
        ${tips.map(t => `
          <div class="tip-card tip-${escHtml(t.severity)}">
            <div class="tip-header">
              <span class="tip-icon tip-icon-${escHtml(t.severity)}">${iconMap[t.severity] ?? 'ℹ'}</span>
              <span class="tip-title">${escHtml(t.title)}</span>
              ${t.value != null ? `<span class="tip-value">$${t.value.toFixed(2)} potential savings</span>` : ''}
            </div>
            <p class="tip-body">${escHtml(t.body)}</p>
          </div>
        `).join('')}
      </div>`;
  } catch (e) {
    showError(e);
  }
}

// ── Settings ────────────────────────────────────────────────────

const PLAN_OPTIONS = [
  { key: 'api',    label: 'API',      sub: 'Pay per token' },
  { key: 'pro',    label: 'Pro',      sub: '$20/mo' },
  { key: 'max5x',  label: 'Max 5x',   sub: '$100/mo' },
  { key: 'max20x', label: 'Max 20x',  sub: '$200/mo' },
];

async function renderSettings() {
  setLoading();
  try {
    const [appSettings, meta, providerData] = await Promise.all([api.appSettings(), api.meta(), api.providers()]);
    state.appSettings = appSettings;

    const { plan, customPricing, builtinPricing, detectedModels, legacyModelKeys = [] } = appSettings;
    const legacySet = new Set(legacyModelKeys);
    const cleanupDays = meta.cleanupPeriodDays ?? 30;

    // Models that appear in sessions but have no built-in pricing (custom/local/unknown)
    const unknownModels = detectedModels.filter(m => !builtinPricing[m] &&
      !Object.keys(builtinPricing).some(k => m.startsWith(k) || k.startsWith(m)));

    // Current models + any unknown/custom-only models in the main table
    const currentBuiltinKeys = Object.keys(builtinPricing).filter(k => !legacySet.has(k)).sort();
    const legacyBuiltinKeys  = Object.keys(builtinPricing).filter(k =>  legacySet.has(k)).sort();
    const extraModels = [...new Set([
      ...unknownModels,
      ...Object.keys(customPricing).filter(m => !builtinPricing[m]),
    ])].sort();
    const currentModelSet = new Set([...currentBuiltinKeys, ...extraModels]);
    const legacyModelSet  = new Set(legacyBuiltinKeys);

    function pricingRow(model) {
      const cp = customPricing[model];
      const bp = builtinPricing[model];
      const isBuiltin = !!bp;
      const hasCustom = !!cp;
      // Show custom price if overridden, otherwise show built-in price (or empty for unknown models)
      const vals = cp ?? bp ?? {};
      const atBuiltin = isBuiltin && !hasCustom;
      return `
        <tr class="pricing-row" data-model="${escHtml(model)}" data-builtin="${isBuiltin}" data-at-builtin="${atBuiltin}">
          <td class="pricing-model-cell">
            <span class="pricing-model-name">${escHtml(model)}</span>
            ${isBuiltin && !hasCustom ? '<span class="pricing-builtin-badge">built-in</span>' : ''}
            ${hasCustom ? '<span class="pricing-custom-badge">custom</span>' : ''}
          </td>
          <td><input class="pricing-input" type="number" min="0" step="0.01" data-field="input"
            value="${vals.input ?? ''}"></td>
          <td><input class="pricing-input" type="number" min="0" step="0.01" data-field="output"
            value="${vals.output ?? ''}"></td>
          <td><input class="pricing-input" type="number" min="0" step="0.01" data-field="cacheWrite"
            value="${vals.cacheWrite ?? ''}"></td>
          <td><input class="pricing-input" type="number" min="0" step="0.01" data-field="cacheRead"
            value="${vals.cacheRead ?? ''}"></td>
          <td>
            ${isBuiltin
              ? `<button class="pricing-reset-btn" data-model="${escHtml(model)}" title="Reset to built-in price" ${atBuiltin ? 'disabled' : ''}>↺</button>`
              : `<button class="pricing-clear-btn" data-model="${escHtml(model)}" title="Remove custom pricing">✕</button>`
            }
          </td>
        </tr>`;
    }

    const content = document.getElementById('content');
    content.innerHTML = `
      <h1 class="page-title">Settings</h1>

      <div class="settings-section">
        <div class="settings-section-title">Plan</div>
        <div class="settings-section-desc">
          Select the plan you are on. Token Bleed always calculates costs at API rates regardless of your plan.
          On Pro and Max plans this shows the equivalent market value of your usage, so you can see whether the subscription is paying off.
        </div>
        <div class="plan-selector">
          ${PLAN_OPTIONS.map(p => `
            <button class="plan-btn ${plan === p.key ? 'active' : ''}" data-plan="${p.key}">
              <span class="plan-btn-label">${p.label}</span>
              <span class="plan-btn-sub">${p.sub}</span>
            </button>`).join('')}
        </div>
        <div id="plan-save-status" class="settings-save-status"></div>
      </div>

      <div class="settings-section">
        <div class="settings-section-title">Model Pricing</div>
        <div class="settings-section-desc">
          Built-in prices are shown below. Override any of them or add rates for local and custom models.
          Prices are per million tokens. Hit ↺ to reset a model back to its built-in rate.
          Changes take effect on next data refresh.
        </div>
        <div class="table-wrap pricing-table-wrap">
          <table class="pricing-table">
            <thead>
              <tr>
                <th>Model</th>
                <th class="right">Input $/M</th>
                <th class="right">Output $/M</th>
                <th class="right">Cache W $/M</th>
                <th class="right">Cache R $/M</th>
                <th></th>
              </tr>
            </thead>
            <tbody id="pricing-tbody">
              ${[...currentModelSet].map(pricingRow).join('')}
            </tbody>
            <tbody id="pricing-legacy-tbody" hidden>
              ${[...legacyModelSet].map(pricingRow).join('')}
            </tbody>
          </table>
        </div>
        <button class="pricing-legacy-toggle" id="pricing-legacy-toggle">
          Show legacy models (${legacyModelSet.size})
        </button>

        <div class="pricing-add-row">
          <input id="pricing-new-model" class="pricing-new-model-input" type="text" placeholder="model name (e.g. my-local-llm)">
          <button id="pricing-add-btn" class="pricing-add-btn">+ Add model</button>
        </div>

        <div id="pricing-save-row" class="pricing-save-row" style="display:none">
          <button id="pricing-save-btn" class="btn-primary">Save pricing</button>
          <span id="pricing-save-status" class="settings-save-status"></span>
        </div>
      </div>

      <div class="settings-section">
        <div class="settings-section-title">Log Retention</div>
        <div class="settings-section-desc">
          Token Bleed reads local Claude Code session logs.
          Those logs are currently kept for <strong>${cleanupDays} days</strong>.
          After that Claude Code deletes them and they disappear from this dashboard too.
          90 days is a good default.
        </div>
        <div class="retention-row">
          <span class="settings-label">Keep logs for</span>
          <input class="settings-number-input" id="retention-days-input" type="number" min="1" max="3650" value="${cleanupDays}">
          <span class="settings-label">days</span>
          <button class="btn-primary" id="retention-save-btn">Save</button>
          <span id="retention-save-status" class="settings-save-status"></span>
        </div>
        <div class="usage-retention-warning" id="retention-zero-warning" style="display:none">
          ⚠ Setting to 0 disables transcript writing entirely. Using 1 instead.
        </div>
      </div>

      <div class="settings-section">
        <div class="settings-section-title">Session Duration</div>
        <div class="settings-section-desc">
          Choose how session duration is calculated. <strong>Wall clock</strong> is the total time from first to last log entry, including idle time between your messages. <strong>Active AI time</strong> sums only the time the model was actually running — from when you sent each message to when the response completed.
        </div>
        <div class="retention-row">
          <button class="plan-btn${appSettings.durationMode !== 'active' ? ' active' : ''}" id="duration-wallclock-btn">Wall clock</button>
          <button class="plan-btn${appSettings.durationMode === 'active' ? ' active' : ''}" id="duration-active-btn">Active AI time</button>
          <span id="duration-save-status" class="settings-save-status"></span>
        </div>
      </div>

      ${renderProvidersSectionHtml(providerData)}
    `;

    // Plan selector
    content.querySelectorAll('.plan-btn[data-plan]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const planStatus = document.getElementById('plan-save-status');
        content.querySelectorAll('.plan-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        planStatus.textContent = 'Saving…';
        try {
          await api.saveAppSettings({ plan: btn.dataset.plan });
          state.appSettings.plan = btn.dataset.plan;
          planStatus.textContent = 'Saved';
          setTimeout(() => { planStatus.textContent = ''; }, 2000);
        } catch {
          planStatus.textContent = 'Error saving';
        }
      });
    });

    // Pricing save
    function collectCustomPricing() {
      const result = {};
      document.querySelectorAll('#pricing-tbody .pricing-row, #pricing-legacy-tbody .pricing-row').forEach(row => {
        // Skip built-in rows that haven't been overridden
        if (row.dataset.atBuiltin === 'true') return;
        const model = row.dataset.model;
        const fields = {};
        let hasAny = false;
        row.querySelectorAll('.pricing-input').forEach(input => {
          const v = parseFloat(input.value);
          if (Number.isFinite(v) && v >= 0) {
            fields[input.dataset.field] = v;
            hasAny = true;
          }
        });
        if (hasAny) {
          result[model] = {
            input: fields.input ?? 0,
            output: fields.output ?? 0,
            cacheWrite: fields.cacheWrite ?? 0,
            cacheRead: fields.cacheRead ?? 0,
          };
        }
      });
      return result;
    }

    document.getElementById('pricing-save-btn')?.addEventListener('click', async () => {
      const status = document.getElementById('pricing-save-status');
      const btn = document.getElementById('pricing-save-btn');
      btn.disabled = true;
      status.textContent = 'Saving…';
      try {
        const cp = collectCustomPricing();
        await api.saveAppSettings({ customPricing: cp });
        state.appSettings.customPricing = cp;
        status.textContent = 'Saved — refresh data to apply';
        setTimeout(() => { status.textContent = ''; }, 3000);
      } catch {
        status.textContent = 'Error saving';
      } finally {
        btn.disabled = false;
      }
    });

    // Clear custom-only pricing row
    content.addEventListener('click', e => {
      const clearBtn = e.target.closest('.pricing-clear-btn');
      if (!clearBtn) return;
      clearBtn.closest('.pricing-row').remove();
      document.getElementById('pricing-save-row').style.display = '';
    });

    // Reset built-in row to its default price
    content.addEventListener('click', e => {
      const resetBtn = e.target.closest('.pricing-reset-btn');
      if (!resetBtn || resetBtn.disabled) return;
      const model = resetBtn.dataset.model;
      const row = resetBtn.closest('.pricing-row');
      const bp = builtinPricing[model];
      if (!row || !bp) return;
      row.querySelector('[data-field="input"]').value = bp.input;
      row.querySelector('[data-field="output"]').value = bp.output;
      row.querySelector('[data-field="cacheWrite"]').value = bp.cacheWrite;
      row.querySelector('[data-field="cacheRead"]').value = bp.cacheRead;
      row.dataset.atBuiltin = 'true';
      resetBtn.disabled = true;
      const cell = row.querySelector('.pricing-model-cell');
      cell.querySelector('.pricing-custom-badge')?.remove();
      if (!cell.querySelector('.pricing-builtin-badge')) {
        const badge = document.createElement('span');
        badge.className = 'pricing-builtin-badge';
        badge.textContent = 'built-in';
        cell.appendChild(badge);
      }
      document.getElementById('pricing-save-row').style.display = '';
    });

    // Legacy models toggle
    document.getElementById('pricing-legacy-toggle')?.addEventListener('click', () => {
      const tbody = document.getElementById('pricing-legacy-tbody');
      const btn = document.getElementById('pricing-legacy-toggle');
      if (!tbody || !btn) return;
      tbody.hidden = !tbody.hidden;
      btn.textContent = tbody.hidden
        ? `Show legacy models (${legacyModelSet.size})`
        : `Hide legacy models`;
    });

    // Pricing table inputs — show save row on edit; mark built-in rows as modified
    content.addEventListener('input', e => {
      if (!e.target.classList.contains('pricing-input')) return;
      document.getElementById('pricing-save-row').style.display = '';
      const row = e.target.closest('.pricing-row');
      if (!row || row.dataset.builtin !== 'true' || row.dataset.atBuiltin !== 'true') return;
      row.dataset.atBuiltin = 'false';
      const cell = row.querySelector('.pricing-model-cell');
      cell.querySelector('.pricing-builtin-badge')?.remove();
      if (!cell.querySelector('.pricing-custom-badge')) {
        const badge = document.createElement('span');
        badge.className = 'pricing-custom-badge';
        badge.textContent = 'custom';
        cell.appendChild(badge);
      }
      const resetBtn = row.querySelector('.pricing-reset-btn');
      if (resetBtn) resetBtn.disabled = false;
    });

    // Add new model row
    document.getElementById('pricing-add-btn').addEventListener('click', () => {
      const input = document.getElementById('pricing-new-model');
      const model = input.value.trim();
      if (!model) return;
      input.value = '';

      let tbody = document.getElementById('pricing-tbody');
      if (!tbody) {
        // Table didn't exist yet — re-render would be complex; just append a table
        const wrap = content.querySelector('.settings-section:nth-child(2)');
        const noModelsMsg = wrap.querySelector('.muted');
        if (noModelsMsg) noModelsMsg.remove();
        const tableWrap = document.createElement('div');
        tableWrap.className = 'table-wrap pricing-table-wrap';
        tableWrap.innerHTML = `
          <table class="pricing-table">
            <thead><tr>
              <th>Model</th>
              <th class="right">Input $/M</th><th class="right">Output $/M</th>
              <th class="right">Cache Write $/M</th><th class="right">Cache Read $/M</th>
              <th></th>
            </tr></thead>
            <tbody id="pricing-tbody"></tbody>
          </table>`;
        wrap.querySelector('.pricing-add-row').before(tableWrap);
        tbody = document.getElementById('pricing-tbody');
      }

      // Don't add duplicates
      if (tbody.querySelector(`[data-model="${CSS.escape(model)}"]`)) return;

      const tmp = document.createElement('tbody');
      tmp.innerHTML = pricingRow(model);
      tbody.appendChild(tmp.firstElementChild);
      document.getElementById('pricing-save-row').style.display = '';
    });

    // Log retention save
    const retentionInput = document.getElementById('retention-days-input');
    const retentionWarning = document.getElementById('retention-zero-warning');
    retentionInput.addEventListener('input', () => {
      retentionWarning.style.display = parseInt(retentionInput.value, 10) === 0 ? 'block' : 'none';
    });
    document.getElementById('retention-save-btn').addEventListener('click', async () => {
      let v = parseInt(retentionInput.value, 10);
      if (!Number.isFinite(v) || v < 0) return;
      if (v === 0) { retentionWarning.style.display = 'block'; retentionInput.value = '1'; return; }
      const btn = document.getElementById('retention-save-btn');
      const status = document.getElementById('retention-save-status');
      btn.disabled = true;
      status.textContent = 'Saving…';
      try {
        await api.saveSetting('cleanupPeriodDays', v);
        status.textContent = 'Saved';
        setTimeout(() => { status.textContent = ''; }, 2000);
      } catch {
        status.textContent = 'Error saving';
      } finally {
        btn.disabled = false;
      }
    });

    // Duration mode buttons
    ['duration-wallclock-btn', 'duration-active-btn'].forEach(id => {
      document.getElementById(id)?.addEventListener('click', async () => {
        const mode = id === 'duration-active-btn' ? 'active' : 'wallclock';
        const status = document.getElementById('duration-save-status');
        document.getElementById('duration-wallclock-btn').classList.toggle('active', mode === 'wallclock');
        document.getElementById('duration-active-btn').classList.toggle('active', mode === 'active');
        status.textContent = 'Saving…';
        try {
          await api.saveAppSettings({ durationMode: mode });
          state.appSettings.durationMode = mode;
          status.textContent = 'Saved';
          setTimeout(() => { status.textContent = ''; }, 2000);
        } catch {
          status.textContent = 'Error saving';
        }
      });
    });

    // Provider setup buttons
    for (const provider of ['openai', 'gemini', 'ollama']) {
      document.getElementById(`setup-btn-${provider}`)?.addEventListener('click', () => openProviderFlow(provider));
      document.getElementById(`restart-btn-${provider}`)?.addEventListener('click', () => restartProviderProxy(provider));
    }

  } catch (e) {
    showError(e);
  }
}

// ── Provider indicator ─────────────────────────────────────────

async function updateProviderIndicator() {
  const el = document.querySelector('#header .header-left');
  if (el) el.innerHTML = '';
}

// ── Provider settings section HTML ─────────────────────────────

function renderProvidersSectionHtml(providerData) {
  const { providers: provs } = providerData;

  function providerRow(id, name, model, status) {
    const dotClass = status === 'connected' ? 'connected' : status === 'stopped' ? 'stopped' : 'not-configured';
    const statusText = status === 'connected' ? 'connected' : status === 'stopped' ? 'stopped' : 'not configured';
    const showSetup = id !== 'claude';
    const showRestart = (id === 'openai' || id === 'gemini') && status === 'stopped';
    return `
      <div class="provider-row">
        <span class="provider-dot ${dotClass}" id="provider-dot-${id}"></span>
        <span class="provider-name">${escHtml(name)}</span>
        ${model ? `<span class="provider-model-note">${escHtml(model)}</span>` : '<span class="provider-model-note"></span>'}
        <span class="provider-status-text" id="provider-status-${id}">${statusText}</span>
        ${showRestart ? `<button class="provider-setup-btn" id="restart-btn-${id}">Restart</button>` : ''}
        ${showSetup ? `<button class="provider-setup-btn" id="setup-btn-${id}">${status === 'connected' ? 'Manage' : 'Setup →'}</button>` : ''}
      </div>`;
  }

  return `
    <div class="settings-section">
      <div class="settings-section-title">Model Providers</div>
      <div class="settings-section-desc">
        Connect alternative providers through LiteLLM to use with Claude Code.
        Claude Code provider settings are read from <code>~/.claude/settings.json</code>.
      </div>

      ${providerRow('claude', 'Claude (native)', null, 'connected')}

      ${providerRow('openai', 'OpenAI', 'GPT-4o', provs.openai.status)}
      <div class="provider-flow" id="provider-flow-openai">
        <div class="provider-flow-inner" id="provider-flow-openai-inner"></div>
      </div>

      ${providerRow('gemini', 'Google', 'Gemini Flash', provs.gemini.status)}
      <div class="provider-flow" id="provider-flow-gemini">
        <div class="provider-flow-inner" id="provider-flow-gemini-inner"></div>
      </div>

      ${providerRow('ollama', 'Ollama', 'local models', provs.ollama.status)}
      <div class="provider-flow" id="provider-flow-ollama">
        <div class="provider-flow-inner" id="provider-flow-ollama-inner"></div>
      </div>

      <p class="step-note" style="margin-top:14px">Windows support: coming soon.</p>
    </div>`;
}

// ── Provider flow helpers ───────────────────────────────────────

function updateProviderRowStatus(provider, status) {
  const dot = document.getElementById(`provider-dot-${provider}`);
  const txt = document.getElementById(`provider-status-${provider}`);
  if (dot) {
    dot.className = `provider-dot ${status === 'connected' ? 'connected' : status === 'stopped' ? 'stopped' : 'not-configured'}`;
  }
  if (txt) {
    txt.textContent = status === 'connected' ? 'connected' : status === 'stopped' ? 'stopped' : 'not configured';
  }
}

function openProviderFlow(provider) {
  // Collapse any other open flow first
  document.querySelectorAll('.provider-flow.open').forEach(el => {
    if (el.id !== `provider-flow-${provider}`) {
      el.classList.remove('open');
      const otherId = el.id.replace('provider-flow-', '');
      const btn = document.getElementById(`setup-btn-${otherId}`);
      if (btn && btn.textContent === 'Close ✕') btn.textContent = 'Setup →';
    }
  });

  const flow = document.getElementById(`provider-flow-${provider}`);
  if (!flow) return;

  const isOpen = flow.classList.contains('open');
  flow.classList.toggle('open');
  const btn = document.getElementById(`setup-btn-${provider}`);
  if (btn) btn.textContent = isOpen ? 'Setup →' : 'Close ✕';

  if (!isOpen && !flow.dataset.initialized) {
    flow.dataset.initialized = '1';
    if (provider === 'openai') initKeyedProviderFlow({ provider: 'openai', keyLabel: 'OpenAI API Key', keyPlaceholder: 'sk-...', keyValidate: k => k.startsWith('sk-') && k.length >= 40, proxyPort: 4001, proxyKey: 'token-bleed-proxy' });
    else if (provider === 'gemini') initKeyedProviderFlow({ provider: 'gemini', keyLabel: 'Google API Key', keyPlaceholder: 'AIza...', keyValidate: k => k.startsWith('AIza') && k.length >= 35, proxyPort: 4002, proxyKey: 'token-bleed-proxy' });
    else if (provider === 'ollama') initOllamaFlow();
  }
}

async function restartProviderProxy(provider) {
  const btn = document.getElementById(`restart-btn-${provider}`);
  if (btn) { btn.textContent = 'Restarting…'; btn.disabled = true; }
  try {
    await api.providerRestartProxy(provider);
    const port = provider === 'openai' ? 4001 : 4002;
    let attempts = 0;
    const poll = async () => {
      attempts++;
      try {
        const h = await api.providerProxyHealth(port);
        if (h.ok) { updateProviderRowStatus(provider, 'connected'); if (btn) { btn.textContent = 'Manage'; btn.disabled = false; } return; }
      } catch { /* still starting */ }
      if (attempts >= 15) { if (btn) { btn.textContent = 'Restart'; btn.disabled = false; } return; }
      setTimeout(poll, 1000);
    };
    setTimeout(poll, 1000);
  } catch {
    if (btn) { btn.textContent = 'Restart'; btn.disabled = false; }
  }
}

// ── Keyed provider flow (OpenAI / Gemini) ──────────────────────

function initKeyedProviderFlow({ provider, keyLabel, keyPlaceholder, keyValidate, proxyPort, proxyKey }) {
  const inner = document.getElementById(`provider-flow-${provider}-inner`);
  if (!inner) return;

  inner.innerHTML = `
    <div class="provider-step" id="${provider}-step-1">
      <div class="step-circle active" id="${provider}-s1-circle">1</div>
      <div class="step-body">
        <div class="step-label">Check Python</div>
        <div id="${provider}-s1-result" class="step-result">Checking…</div>
        <div id="${provider}-s1-actions"></div>
      </div>
    </div>
    <div class="provider-step faded" id="${provider}-step-2">
      <div class="step-circle pending" id="${provider}-s2-circle">2</div>
      <div class="step-body">
        <div class="step-label">Check LiteLLM</div>
        <div id="${provider}-s2-result" class="step-result"></div>
        <div id="${provider}-s2-actions"></div>
      </div>
    </div>
    <div class="provider-step faded" id="${provider}-step-3">
      <div class="step-circle pending" id="${provider}-s3-circle">3</div>
      <div class="step-body">
        <div class="step-label">${escHtml(keyLabel)}</div>
        <div id="${provider}-s3-result" class="step-result"></div>
        <div id="${provider}-s3-actions"></div>
      </div>
    </div>
    <div class="provider-step faded" id="${provider}-step-4">
      <div class="step-circle pending" id="${provider}-s4-circle">4</div>
      <div class="step-body">
        <div class="step-label">Start LiteLLM Proxy</div>
        <div id="${provider}-s4-result" class="step-result"></div>
        <div id="${provider}-s4-actions"></div>
      </div>
    </div>
    <div class="provider-step faded" id="${provider}-step-5">
      <div class="step-circle pending" id="${provider}-s5-circle">5</div>
      <div class="step-body">
        <div class="step-label">Claude Code Configuration</div>
        <div id="${provider}-s5-result" class="step-result"></div>
        <div id="${provider}-s5-actions"></div>
      </div>
    </div>`;

  function markDone(step) {
    const c = document.getElementById(`${provider}-s${step}-circle`);
    if (c) { c.className = 'step-circle done'; c.textContent = '✓'; }
    document.getElementById(`${provider}-step-${step}`)?.classList.remove('faded');
  }
  function markActive(step) {
    const c = document.getElementById(`${provider}-s${step}-circle`);
    if (c) { c.className = 'step-circle active'; c.textContent = String(step); }
    document.getElementById(`${provider}-step-${step}`)?.classList.remove('faded');
  }
  function setResult(step, msg, type = '') {
    const el = document.getElementById(`${provider}-s${step}-result`);
    if (el) { el.textContent = msg; el.className = `step-result ${type}`.trim(); }
  }
  function setActions(step, html) {
    const el = document.getElementById(`${provider}-s${step}-actions`);
    if (el) el.innerHTML = html;
  }

  // Step 1 — Python
  async function checkPython() {
    setActions(1, '');
    setResult(1, 'Checking…');
    try {
      const r = await api.providerCheck('python');
      if (r.found) {
        markDone(1); setResult(1, `Python ${r.version}`, 'ok'); checkLiteLLM();
      } else {
        setResult(1, 'Python 3 is required. Install it from python.org then click Retry.', 'err');
        setActions(1, `<button class="btn-secondary" id="${provider}-s1-retry">Retry</button>`);
        document.getElementById(`${provider}-s1-retry`)?.addEventListener('click', checkPython);
      }
    } catch {
      setResult(1, 'Check failed', 'err');
      setActions(1, `<button class="btn-secondary" id="${provider}-s1-retry">Retry</button>`);
      document.getElementById(`${provider}-s1-retry`)?.addEventListener('click', checkPython);
    }
  }

  // Step 2 — LiteLLM
  async function checkLiteLLM() {
    markActive(2); setResult(2, 'Checking…');
    try {
      const r = await api.providerCheck('litellm');
      if (r.found) {
        markDone(2); setResult(2, `LiteLLM ${r.version}`, 'ok'); showKeyStep();
      } else {
        setResult(2, 'LiteLLM is not installed.');
        setActions(2, `<button class="btn-secondary" id="${provider}-s2-install">Install LiteLLM</button>`);
        document.getElementById(`${provider}-s2-install`)?.addEventListener('click', installLiteLLM);
      }
    } catch {
      setResult(2, 'Check failed', 'err');
      setActions(2, `<button class="btn-secondary" id="${provider}-s2-retry">Retry</button>`);
      document.getElementById(`${provider}-s2-retry`)?.addEventListener('click', checkLiteLLM);
    }
  }

  function installLiteLLM() {
    setActions(2, `<div class="terminal-log" id="${provider}-install-log"></div>`);
    const logEl = document.getElementById(`${provider}-install-log`);
    const source = new EventSource('/api/providers/install-litellm');
    source.onmessage = (e) => {
      const data = JSON.parse(e.data);
      if (data.line && logEl) { logEl.textContent += data.line; logEl.scrollTop = logEl.scrollHeight; }
      if (data.done) {
        source.close();
        if (data.success) {
          markDone(2); setResult(2, 'LiteLLM installed', 'ok'); setActions(2, ''); showKeyStep();
        } else {
          setResult(2, 'Installation failed. See output above.', 'err');
          setActions(2, `<div class="terminal-log">${escHtml(logEl ? logEl.textContent : '')}</div><button class="btn-secondary" id="${provider}-s2-retry">Retry</button>`);
          document.getElementById(`${provider}-s2-retry`)?.addEventListener('click', checkLiteLLM);
        }
      }
    };
    source.onerror = () => {
      source.close();
      setResult(2, 'Install stream error', 'err');
      setActions(2, `<button class="btn-secondary" id="${provider}-s2-retry">Retry</button>`);
      document.getElementById(`${provider}-s2-retry`)?.addEventListener('click', checkLiteLLM);
    };
  }

  // Step 3 — API key
  function showKeyStep() {
    markActive(3);
    setActions(3, `
      <div class="step-key-input-wrap">
        <input class="step-key-input" type="password" id="${provider}-key-input" placeholder="${escHtml(keyPlaceholder)}" autocomplete="off">
        <button class="step-toggle-btn" id="${provider}-key-toggle">Show</button>
      </div>
      <div class="step-btn-row">
        <button class="btn-primary" id="${provider}-key-save">Save &amp; Continue</button>
        <span id="${provider}-key-status" class="step-result"></span>
      </div>`);
    document.getElementById(`${provider}-key-toggle`)?.addEventListener('click', () => {
      const inp = document.getElementById(`${provider}-key-input`);
      const btn = document.getElementById(`${provider}-key-toggle`);
      if (!inp) return;
      inp.type = inp.type === 'password' ? 'text' : 'password';
      if (btn) btn.textContent = inp.type === 'password' ? 'Show' : 'Hide';
    });
    document.getElementById(`${provider}-key-save`)?.addEventListener('click', async () => {
      const inp = document.getElementById(`${provider}-key-input`);
      const statusEl = document.getElementById(`${provider}-key-status`);
      const key = inp?.value?.trim() ?? '';
      if (!keyValidate(key)) {
        if (statusEl) { statusEl.textContent = 'Invalid key format'; statusEl.className = 'step-result err'; }
        return;
      }
      if (statusEl) { statusEl.textContent = 'Saving…'; statusEl.className = 'step-result'; }
      try {
        await api.providerSaveKey(provider, key);
        markDone(3); setResult(3, 'Key saved', 'ok'); setActions(3, ''); showProxyStep();
      } catch {
        if (statusEl) { statusEl.textContent = 'Failed to save'; statusEl.className = 'step-result err'; }
      }
    });
  }

  // Step 4 — Start proxy
  function showProxyStep() {
    markActive(4);
    setActions(4, `<button class="btn-primary" id="${provider}-start-proxy">Start Proxy</button>`);
    document.getElementById(`${provider}-start-proxy`)?.addEventListener('click', startProxy);
  }

  async function startProxy() {
    setActions(4, `<div class="proxy-progress"><div class="spinner" style="width:14px;height:14px;border-width:2px"></div> Starting proxy…</div>`);
    try {
      await api.providerStartProxy(provider);
    } catch {
      setResult(4, 'Failed to start proxy', 'err');
      setActions(4, `<button class="btn-secondary" id="${provider}-retry-proxy">Retry</button>`);
      document.getElementById(`${provider}-retry-proxy`)?.addEventListener('click', startProxy);
      return;
    }
    let attempts = 0;
    const poll = async () => {
      attempts++;
      try {
        const h = await api.providerProxyHealth(proxyPort);
        if (h.ok) {
          markDone(4); setResult(4, `Proxy running on port ${proxyPort}`, 'ok'); setActions(4, ''); showConfigStep(); return;
        }
      } catch { /* still starting */ }
      if (attempts >= 15) {
        setResult(4, 'Proxy did not respond in time.', 'err');
        setActions(4, `<button class="btn-secondary" id="${provider}-retry-proxy">Retry</button>`);
        document.getElementById(`${provider}-retry-proxy`)?.addEventListener('click', startProxy);
        return;
      }
      setTimeout(poll, 1000);
    };
    setTimeout(poll, 1000);
  }

  // Step 5 — Config block
  function showConfigStep() {
    markActive(5);
    const configJson = JSON.stringify({ env: { ANTHROPIC_BASE_URL: `http://localhost:${proxyPort}`, ANTHROPIC_API_KEY: proxyKey } }, null, 2);
    setActions(5, `
      <pre class="step-config-block">${escHtml(configJson)}</pre>
      <div class="step-btn-row">
        <button class="btn-secondary" id="${provider}-copy-config">Copy to clipboard</button>
        <button class="btn-secondary" id="${provider}-open-settings">Open settings.json</button>
      </div>
      <p class="step-note">Remove these env vars when you want to switch back to Claude.</p>
      <button class="btn-primary" id="${provider}-mark-done" style="margin-top:12px">Mark as configured</button>`);
    document.getElementById(`${provider}-copy-config`)?.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(configJson);
        const b = document.getElementById(`${provider}-copy-config`);
        if (b) { b.textContent = 'Copied!'; setTimeout(() => { b.textContent = 'Copy to clipboard'; }, 2000); }
      } catch { /* denied */ }
    });
    document.getElementById(`${provider}-open-settings`)?.addEventListener('click', () => api.openFile().catch(() => {}));
    document.getElementById(`${provider}-mark-done`)?.addEventListener('click', async () => {
      try {
        await api.providerMarkConfigured(provider);
        markDone(5); setResult(5, 'Provider configured', 'ok'); setActions(5, '');
        updateProviderRowStatus(provider, 'connected');
        setTimeout(() => {
          const flow = document.getElementById(`provider-flow-${provider}`);
          if (flow) flow.classList.remove('open');
          const btn = document.getElementById(`setup-btn-${provider}`);
          if (btn) btn.textContent = 'Manage';
        }, 1500);
      } catch {
        setResult(5, 'Failed to save', 'err');
      }
    });
  }

  checkPython();
}

// ── Ollama flow ─────────────────────────────────────────────────

function initOllamaFlow() {
  const inner = document.getElementById('provider-flow-ollama-inner');
  if (!inner) return;

  inner.innerHTML = `
    <div class="provider-step" id="ollama-step-1">
      <div class="step-circle active" id="ollama-s1-circle">1</div>
      <div class="step-body">
        <div class="step-label">Check Ollama</div>
        <div id="ollama-s1-result" class="step-result">Checking…</div>
        <div id="ollama-s1-actions"></div>
      </div>
    </div>
    <div class="provider-step faded" id="ollama-step-2">
      <div class="step-circle pending" id="ollama-s2-circle">2</div>
      <div class="step-body">
        <div class="step-label">Available Models</div>
        <div id="ollama-s2-result" class="step-result"></div>
        <div id="ollama-s2-actions"></div>
      </div>
    </div>
    <div class="provider-step faded" id="ollama-step-3">
      <div class="step-circle pending" id="ollama-s3-circle">3</div>
      <div class="step-body">
        <div class="step-label">Connect</div>
        <div id="ollama-s3-result" class="step-result"></div>
        <div id="ollama-s3-actions"></div>
      </div>
    </div>`;

  let selectedModel = null;

  function markDone(step) {
    const c = document.getElementById(`ollama-s${step}-circle`);
    if (c) { c.className = 'step-circle done'; c.textContent = '✓'; }
    document.getElementById(`ollama-step-${step}`)?.classList.remove('faded');
  }
  function markActive(step) {
    const c = document.getElementById(`ollama-s${step}-circle`);
    if (c) { c.className = 'step-circle active'; c.textContent = String(step); }
    document.getElementById(`ollama-step-${step}`)?.classList.remove('faded');
  }
  function setResult(step, msg, type = '') {
    const el = document.getElementById(`ollama-s${step}-result`);
    if (el) { el.textContent = msg; el.className = `step-result ${type}`.trim(); }
  }
  function setActions(step, html) {
    const el = document.getElementById(`ollama-s${step}-actions`);
    if (el) el.innerHTML = html;
  }

  async function checkOllama() {
    setResult(1, 'Checking…');
    try {
      const r = await api.providerCheck('ollama');
      if (r.found) {
        markDone(1); setResult(1, `Ollama ${r.version}`, 'ok'); checkModels();
      } else {
        setResult(1, 'Install Ollama from ollama.com', 'err');
        setActions(1, `<div class="step-btn-row">
          <button class="btn-secondary" id="ollama-open-site">Open ollama.com</button>
          <button class="btn-secondary" id="ollama-s1-retry">Retry</button>
        </div>`);
        document.getElementById('ollama-open-site')?.addEventListener('click', () => window.open('https://ollama.com', '_blank', 'noopener'));
        document.getElementById('ollama-s1-retry')?.addEventListener('click', checkOllama);
      }
    } catch {
      setResult(1, 'Check failed', 'err');
      setActions(1, `<button class="btn-secondary" id="ollama-s1-retry">Retry</button>`);
      document.getElementById('ollama-s1-retry')?.addEventListener('click', checkOllama);
    }
  }

  async function checkModels() {
    markActive(2); setResult(2, 'Loading models…');
    try {
      const r = await api.ollamaModels();
      if (r.models && r.models.length > 0) {
        const listHtml = r.models.map((m, i) => `
          <label class="ollama-model-item">
            <input type="radio" name="ollama-model" value="${escHtml(m.name)}" ${i === 0 ? 'checked' : ''}>
            <span class="ollama-model-label">${escHtml(m.name)}</span>
          </label>`).join('');
        setResult(2, '');
        setActions(2, `<div class="ollama-model-list">${listHtml}</div>
          <div class="step-btn-row"><button class="btn-secondary" id="ollama-refresh-models">↺ Refresh</button></div>`);
        selectedModel = r.models[0].name;
        inner.querySelectorAll('input[name="ollama-model"]').forEach(inp => {
          inp.addEventListener('change', (e) => { selectedModel = e.target.value; });
        });
        document.getElementById('ollama-refresh-models')?.addEventListener('click', checkModels);
        markDone(2); showConnectStep();
      } else {
        setResult(2, 'No models installed.');
        setActions(2, `<pre class="step-config-block">ollama pull qwen3</pre>
          <button class="btn-secondary" id="ollama-refresh-models">↺ Retry</button>`);
        document.getElementById('ollama-refresh-models')?.addEventListener('click', checkModels);
      }
    } catch {
      setResult(2, 'Failed to list models', 'err');
      setActions(2, `<button class="btn-secondary" id="ollama-refresh-models">Retry</button>`);
      document.getElementById('ollama-refresh-models')?.addEventListener('click', checkModels);
    }
  }

  function showConnectStep() {
    markActive(3);
    setActions(3, `<button class="btn-primary" id="ollama-connect">Use Selected Model</button>`);
    document.getElementById('ollama-connect')?.addEventListener('click', connectOllama);
  }

  async function connectOllama() {
    setActions(3, `<div class="proxy-progress"><div class="spinner" style="width:14px;height:14px;border-width:2px"></div> Checking Ollama…</div>`);
    try {
      const h = await api.providerProxyHealth(11434);
      if (h.ok) {
        await api.providerMarkConfigured('ollama', selectedModel);
        const configJson = JSON.stringify({ env: { ANTHROPIC_BASE_URL: 'http://localhost:11434', ANTHROPIC_API_KEY: 'token-bleed-ollama' } }, null, 2);
        markDone(3); setResult(3, `Connected — ${selectedModel || 'selected model'}`, 'ok');
        setActions(3, `
          <pre class="step-config-block">${escHtml(configJson)}</pre>
          <div class="step-btn-row">
            <button class="btn-secondary" id="ollama-copy-config">Copy to clipboard</button>
            <button class="btn-secondary" id="ollama-open-settings">Open settings.json</button>
          </div>
          <p class="step-note">Remove these env vars when you want to switch back to Claude.</p>`);
        document.getElementById('ollama-copy-config')?.addEventListener('click', async () => {
          try {
            await navigator.clipboard.writeText(configJson);
            const b = document.getElementById('ollama-copy-config');
            if (b) { b.textContent = 'Copied!'; setTimeout(() => { b.textContent = 'Copy to clipboard'; }, 2000); }
          } catch { /* denied */ }
        });
        document.getElementById('ollama-open-settings')?.addEventListener('click', () => api.openFile().catch(() => {}));
        updateProviderRowStatus('ollama', 'connected');
        setTimeout(() => {
          document.getElementById('provider-flow-ollama')?.classList.remove('open');
          const btn = document.getElementById('setup-btn-ollama');
          if (btn) btn.textContent = 'Manage';
        }, 2000);
      } else {
        setResult(3, 'Ollama is not running. Start the Ollama app or run: ollama serve', 'err');
        setActions(3, `<pre class="step-config-block">ollama serve</pre>
          <button class="btn-secondary" id="ollama-retry-connect">Retry</button>`);
        document.getElementById('ollama-retry-connect')?.addEventListener('click', connectOllama);
      }
    } catch {
      setResult(3, 'Connection failed', 'err');
      setActions(3, `<button class="btn-secondary" id="ollama-retry-connect">Retry</button>`);
      document.getElementById('ollama-retry-connect')?.addEventListener('click', connectOllama);
    }
  }

  checkOllama();
}

// ── Onboarding / Settings modal ────────────────────────────────

function showSettingsModal(meta) {
  if (document.getElementById('onboarding-overlay')) return;
  const cleanupDays = meta?.cleanupPeriodDays ?? 30;

  const overlay = document.createElement('div');
  overlay.id = 'onboarding-overlay';
  overlay.className = 'onboarding-overlay';
  overlay.innerHTML = `
    <div class="onboarding-card">
      <div class="onboarding-title">Log retention</div>
      <p class="onboarding-text">
        Token Bleed reads local Claude Code session logs.
        Those logs are currently kept for <strong>${cleanupDays} days</strong> —
        after that Claude Code deletes them and they're gone from this dashboard too.
      </p>
      <p class="onboarding-text">
        Set it to however far back you want history. 90 days is a good default.
      </p>
      <div class="onboarding-retention">
        <span class="usage-config-label">Keep logs for</span>
        <input class="usage-config-input" id="ob-days-input" type="number" min="1" max="3650" value="${cleanupDays}">
        <span class="usage-config-label">days</span>
        <button class="usage-config-save" id="ob-days-save">Save</button>
      </div>
      <div class="usage-retention-warning" id="ob-zero-warning" style="display:none">
        ⚠ 0 disables transcript writing entirely. Setting to 1 instead.
      </div>
      <div class="onboarding-footer">
        <button class="onboarding-dismiss" id="ob-dismiss">Close</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  const input = overlay.querySelector('#ob-days-input');
  const saveBtn = overlay.querySelector('#ob-days-save');
  const warning = overlay.querySelector('#ob-zero-warning');
  const dismissBtn = overlay.querySelector('#ob-dismiss');

  function dismiss() {
    overlay.classList.add('onboarding-out');
    overlay.addEventListener('animationend', () => overlay.remove(), { once: true });
  }

  overlay.addEventListener('click', e => { if (e.target === overlay) dismiss(); });

  input.addEventListener('input', () => {
    warning.style.display = parseInt(input.value, 10) === 0 ? 'block' : 'none';
  });

  saveBtn.addEventListener('click', async () => {
    let v = parseInt(input.value, 10);
    if (!Number.isFinite(v) || v < 0) return;
    if (v === 0) { warning.style.display = 'block'; input.value = '1'; return; }
    warning.style.display = 'none';
    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving…';
    try {
      await api.saveSetting('cleanupPeriodDays', v);
      dismiss();
      renderOverview();
    } finally {
      saveBtn.disabled = false;
      saveBtn.textContent = 'Save';
    }
  });

  dismissBtn.addEventListener('click', dismiss);
  input.addEventListener('keydown', e => { if (e.key === 'Enter') saveBtn.click(); });
}

function showAboutModal() {
  if (document.getElementById('about-overlay')) return;

  const overlay = document.createElement('div');
  overlay.id = 'about-overlay';
  overlay.className = 'onboarding-overlay';
  overlay.innerHTML = `
    <div class="onboarding-card about-card">

      <div class="about-hero">
        <div class="about-hero-title">Token <span class="about-logo-bleed">Bleed</span> <span class="about-version">open source · MIT</span></div>
        <p class="about-hero-tagline">
          Every time Claude Code writes a line of code, it burns tokens.
          Those tokens cost money, but Claude gives you almost no way to see where it's all going.
        </p>
      </div>

      <div class="about-body">
        <div class="about-features">
          <div class="about-feature">
            <div class="about-feature-icon">◈</div>
            <div class="about-feature-title">What burned</div>
            <div class="about-feature-text">Session logs turned into real dollar costs. Per prompt. Per session. Per project.</div>
          </div>
          <div class="about-feature">
            <div class="about-feature-icon">⟷</div>
            <div class="about-feature-title">Which model wins</div>
            <div class="about-feature-text">Compare models side-by-side. See which gives you the most output per dollar.</div>
          </div>
          <div class="about-feature">
            <div class="about-feature-icon">◎</div>
            <div class="about-feature-title">Stays local</div>
            <div class="about-feature-text">No cloud. No account. Reads logs on your machine. Nothing leaves.</div>
          </div>
          <div class="about-feature">
            <div class="about-feature-icon">⧉</div>
            <div class="about-feature-title">Session compare</div>
            <div class="about-feature-text">Pick up to 6 sessions and diff them. See exactly which one burned your budget and why.</div>
          </div>
        </div>

        <p class="about-attribution-line">
          Built and maintained by <strong>Richard Sylvester</strong> · Free forever ·
          Every line of code is on GitHub.
        </p>

        <div class="about-links-row">
          <a class="about-pill" href="https://github.com/mrrichsylvester/token-bleed" target="_blank" rel="noopener">GitHub →</a>
          <a class="about-pill" href="https://youtube.com/@MrRichSylvester" target="_blank" rel="noopener">YouTube →</a>
          <a class="about-pill" href="https://airevenueclub.com" target="_blank" rel="noopener">Community →</a>
        </div>

        <div class="onboarding-footer about-footer">
          <span class="onboarding-hint">Use ⚙ in the header to adjust log retention settings.</span>
          <button class="onboarding-dismiss" id="about-dismiss">Got it</button>
        </div>
      </div>

    </div>
  `;
  document.body.appendChild(overlay);

  function dismiss() {
    overlay.classList.add('onboarding-out');
    overlay.addEventListener('animationend', () => overlay.remove(), { once: true });
  }

  overlay.addEventListener('click', e => { if (e.target === overlay) dismiss(); });
  overlay.querySelector('#about-dismiss').addEventListener('click', dismiss);
}

function showOnboardingIfNeeded() {
  if (localStorage.getItem('br-seen-about')) return;
  localStorage.setItem('br-seen-about', '1');
  showAboutModal();
}

// ── Theme & Size ───────────────────────────────────────────────

function initTheme() {
  const theme = localStorage.getItem('br-theme') === 'light' ? 'light' : 'dark';
  const size  = ['small', 'medium', 'large'].includes(localStorage.getItem('br-size'))
    ? localStorage.getItem('br-size')
    : 'small';
  applyTheme(theme);
  applySize(size);
}

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem('br-theme', theme);
  document.querySelectorAll('#theme-opts .appr-opt').forEach(btn => {
    btn.classList.toggle('appr-opt--active', btn.dataset.theme === theme);
  });
  if (state.data.stats) renderView();
}

function applySize(size) {
  document.documentElement.setAttribute('data-size', size);
  localStorage.setItem('br-size', size);
  document.querySelectorAll('#size-opts .appr-opt').forEach(btn => {
    btn.classList.toggle('appr-opt--active', btn.dataset.size === size);
  });
}

function initAppearancePanel() {
  const btn   = document.getElementById('appr-btn');
  const panel = document.getElementById('appr-panel');

  btn.addEventListener('click', e => {
    e.stopPropagation();
    panel.hidden = !panel.hidden;
  });

  document.addEventListener('click', e => {
    if (!document.getElementById('appr-wrap').contains(e.target)) {
      panel.hidden = true;
    }
  });

  document.querySelectorAll('#theme-opts .appr-opt').forEach(b => {
    b.addEventListener('click', () => { applyTheme(b.dataset.theme); });
  });

  document.querySelectorAll('#size-opts .appr-opt').forEach(b => {
    b.addEventListener('click', () => { applySize(b.dataset.size); });
  });
}

// ── Bootstrap ──────────────────────────────────────────────────

function init() {
  initTheme();
  _initTooltip();

  const app = document.getElementById('app');
  const sidebar = document.getElementById('sidebar');
  const main = document.getElementById('main');

  // Move sidebar and main into a flex row below header
  const bodyGrid = document.createElement('div');
  bodyGrid.className = 'body-grid';
  bodyGrid.style.cssText = 'display:flex;flex:1;overflow:hidden;';
  app.appendChild(bodyGrid);
  bodyGrid.appendChild(sidebar);
  bodyGrid.appendChild(main);

  // Period selector — rendered dynamically
  renderPeriodSelector();
  renderCompareBar();
  renderPromptCompareBar();
  updateProviderIndicator();

  // Nav clicks
  document.querySelectorAll('.nav-item[data-view]').forEach(el => {
    el.addEventListener('click', (e) => {
      e.preventDefault();
      state.sessionsFilter = { projectId: '', model: '', sources: ['claude', 'codex'] };
      state.sessionsPage = 0;
      navigate(el.dataset.view);
    });
  });

  initAppearancePanel();

  // Restore session compare preferences
  try {
    const savedHidden = localStorage.getItem('sc-hidden-metrics');
    if (savedHidden) JSON.parse(savedHidden).forEach(k => state.scHiddenMetrics.add(k));
  } catch {}
  try {
    const savedSel = localStorage.getItem('sc-selection');
    if (savedSel) state.compSelection = JSON.parse(savedSel);
  } catch {}
  try {
    const savedPromptSel = localStorage.getItem('pc-selection');
    if (savedPromptSel) state.promptCompSelection = JSON.parse(savedPromptSel);
  } catch {}
  if (localStorage.getItem('sc-view') === 'card') state.scView = 'card';
  if (localStorage.getItem('sc-order') === 'ranked') state.scOrder = 'ranked';
  if (localStorage.getItem('pc-view') === 'card') state.pcView = 'card';
  if (localStorage.getItem('pc-order') === 'ranked') state.pcOrder = 'ranked';
  renderCompareBar();
  renderPromptCompareBar();
  try {
    const savedOrder = localStorage.getItem('sc-metrics-order');
    if (savedOrder) state.scMetricsOrder = JSON.parse(savedOrder);
  } catch {}
  try {
    const savedProjectSort = JSON.parse(localStorage.getItem('projects-sort') || 'null');
    const validProjectSort = PROJECT_SORT_OPTIONS.some(opt => opt.key === savedProjectSort?.key);
    if (validProjectSort && ['asc', 'desc'].includes(savedProjectSort.dir)) {
      state.projectsSort = savedProjectSort;
    }
  } catch {}
  try {
    const savedSessionSort = JSON.parse(localStorage.getItem('sessions-sort') || 'null');
    const validSessionSort = SESSION_SORT_OPTIONS.some(opt => opt.key === savedSessionSort?.key);
    if (validSessionSort && ['asc', 'desc'].includes(savedSessionSort.dir)) {
      state.sessionsSort = savedSessionSort;
    }
  } catch {}

  // Prompt modal
  const promptModal = document.getElementById('prompt-modal');
  const promptModalBody = document.getElementById('prompt-modal-body');
  document.getElementById('prompt-modal-close').addEventListener('click', () => { promptModal.hidden = true; });
  promptModal.addEventListener('click', e => { if (e.target === promptModal) promptModal.hidden = true; });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') promptModal.hidden = true; });
  document.addEventListener('click', e => {
    const el = e.target.closest('.msg-prompt-expand');
    if (!el) return;
    promptModalBody.textContent = el.dataset.prompt;
    promptModal.hidden = false;
  });

  // Close Fields dropdown on outside click
  document.addEventListener('click', e => {
    const panel = document.getElementById('sc-fields-panel');
    if (!panel) return;
    const dropdown = document.getElementById('sc-fields-dropdown');
    if (dropdown?.contains(e.target) || panel.contains(e.target)) return;
    panel.remove();
    document.getElementById('sc-fields-btn')?.classList.remove('sc-fields-btn--open');
  });

  // About button
  document.getElementById('about-btn').addEventListener('click', showAboutModal);

  // Refresh button
  document.getElementById('refresh-btn').addEventListener('click', async () => {
    const btn = document.getElementById('refresh-btn');
    btn.textContent = '↺ Refreshing…';
    btn.disabled = true;
    try {
      await api.refresh();
      await renderView();
    } finally {
      btn.textContent = '↺ Refresh';
      btn.disabled = false;
    }
  });

  state.view = getView();
  renderView();
  api.appSettings().then(s => { state.appSettings = s; }).catch(() => {});
}

init();

// Inject drip strands into the bleed word
(function initBleed() {
  const word = document.querySelector('.sidebar-token-bleed .bleed-word');
  if (!word) return;
  const drips = [
    { x: '18%', w: '2px', dur: '4.8s', delay: '0.3s',  len: '20px' },
    { x: '32%', w: '3px', dur: '3.2s', delay: '1.6s',  len: '28px' },
    { x: '48%', w: '2px', dur: '5.1s', delay: '0s',    len: '22px' },
    { x: '62%', w: '3px', dur: '3.7s', delay: '2.4s',  len: '30px' },
    { x: '75%', w: '2px', dur: '4.3s', delay: '0.9s',  len: '18px' },
    { x: '88%', w: '2px', dur: '5.6s', delay: '3.1s',  len: '24px' },
  ];
  drips.forEach(d => {
    const el = document.createElement('span');
    el.className = 'bleed-drip';
    el.style.cssText = `--drip-x:${d.x};--drip-w:${d.w};--drip-dur:${d.dur};--drip-delay:${d.delay};--drip-len:${d.len}`;
    word.appendChild(el);
  });
}());

// Easter egg: click "Bleed" to trigger a hemorrhage
(function initBleedEgg() {
  const word = document.querySelector('.sidebar-token-bleed .bleed-word');
  if (!word) return;

  const messages = [
    'CRITICAL: token hemorrhage detected',
    'skill issue',
    'have you tried prompting less?',
    'your context window is showing',
    'the model is judging you',
    'sending your wallet our condolences',
    'at least the output was good. probably.',
  ];

  let eggCount = 0;
  let audioCtx = null;

  async function playBleedSplat(count) {
    try {
      if (!audioCtx) audioCtx = new (window.AudioContext || /** @type {any} */ (window).webkitAudioContext)();
      if (audioCtx.state === 'suspended') await audioCtx.resume();
      const ctx = audioCtx;
      const now = ctx.currentTime;
      const intensity = Math.min(count, 6);

      // Low thud — impact body
      const thud = ctx.createOscillator();
      const thudGain = ctx.createGain();
      thud.type = 'sine';
      thud.frequency.setValueAtTime(110 + intensity * 12, now);
      thud.frequency.exponentialRampToValueAtTime(28, now + 0.22);
      thudGain.gain.setValueAtTime(0.65, now);
      thudGain.gain.exponentialRampToValueAtTime(0.001, now + 0.32);
      thud.connect(thudGain);
      thudGain.connect(ctx.destination);
      thud.start(now);
      thud.stop(now + 0.32);

      // Wet splat noise burst
      const bufLen = Math.floor(ctx.sampleRate * 0.18);
      const buf = ctx.createBuffer(1, bufLen, ctx.sampleRate);
      const ch = buf.getChannelData(0);
      for (let i = 0; i < bufLen; i++) {
        const t = i / bufLen;
        ch[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, 1.8);
      }
      const splat = ctx.createBufferSource();
      splat.buffer = buf;
      const splatFilter = ctx.createBiquadFilter();
      splatFilter.type = 'lowpass';
      splatFilter.frequency.value = 500 + intensity * 60;
      splatFilter.Q.value = 0.8;
      const splatGain = ctx.createGain();
      splatGain.gain.setValueAtTime(0.35 + intensity * 0.06, now);
      splatGain.gain.exponentialRampToValueAtTime(0.001, now + 0.18);
      splat.connect(splatFilter);
      splatFilter.connect(splatGain);
      splatGain.connect(ctx.destination);
      splat.start(now);
      splat.stop(now + 0.18);

      // Glitchy harmonic on higher counts
      if (count >= 3) {
        const buzz = ctx.createOscillator();
        const buzzGain = ctx.createGain();
        buzz.type = 'sawtooth';
        buzz.frequency.setValueAtTime(55 + Math.random() * 30, now + 0.02);
        buzz.frequency.exponentialRampToValueAtTime(20, now + 0.14);
        buzzGain.gain.setValueAtTime(0.18, now + 0.02);
        buzzGain.gain.exponentialRampToValueAtTime(0.001, now + 0.14);
        buzz.connect(buzzGain);
        buzzGain.connect(ctx.destination);
        buzz.start(now + 0.02);
        buzz.stop(now + 0.14);
      }

      // Alarm screech on count 5 (the "you need help" message)
      if (count === 5) {
        const screech = ctx.createOscillator();
        const screechGain = ctx.createGain();
        screech.type = 'square';
        screech.frequency.setValueAtTime(880, now);
        screech.frequency.setValueAtTime(1320, now + 0.07);
        screech.frequency.setValueAtTime(660, now + 0.14);
        screechGain.gain.setValueAtTime(0.12, now);
        screechGain.gain.exponentialRampToValueAtTime(0.001, now + 0.22);
        screech.connect(screechGain);
        screechGain.connect(ctx.destination);
        screech.start(now);
        screech.stop(now + 0.22);
      }
    } catch { /* AudioContext not available */ }
  }

  word.style.cursor = 'pointer';
  word.addEventListener('click', () => {
    eggCount++;
    playBleedSplat(eggCount);

    // Glitch shake the word
    word.classList.remove('bleed-hemorrhage');
    void word.offsetWidth;
    word.classList.add('bleed-hemorrhage');
    word.addEventListener('animationend', () => word.classList.remove('bleed-hemorrhage'), { once: true });

    // Burst of temporary drips
    const burstCount = 10 + Math.min(eggCount * 2, 20);
    for (let i = 0; i < burstCount; i++) {
      const el = document.createElement('span');
      el.className = 'bleed-drip bleed-burst-drip';
      const x = (5 + Math.random() * 90).toFixed(1) + '%';
      const w = (1.5 + Math.random() * 2.5).toFixed(1) + 'px';
      const dur = (0.6 + Math.random() * 1.0).toFixed(2) + 's';
      const delay = (Math.random() * 0.4).toFixed(2) + 's';
      const len = (16 + Math.random() * 28).toFixed(0) + 'px';
      el.style.cssText = `--drip-x:${x};--drip-w:${w};--drip-dur:${dur};--drip-delay:${delay};--drip-len:${len}`;
      word.appendChild(el);
      setTimeout(() => el.remove(), 2200);
    }

    // Toast
    const toast = document.createElement('div');
    toast.className = 'bleed-egg-toast';
    const msg = eggCount === 5
      ? 'you need help. and fewer tokens.'
      : messages[Math.floor(Math.random() * messages.length)];
    toast.textContent = msg;
    document.body.appendChild(toast);
    setTimeout(() => toast.classList.add('bleed-egg-toast-out'), 2000);
    setTimeout(() => toast.remove(), 2400);
  });
}());
