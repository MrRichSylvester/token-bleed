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
  if (isLocal) {
    return `<span class="model-badge local">${model}</span>`;
  }
  return `<span class="model-badge claude">${model}</span>`;
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
      _tt.style.display = 'block';
    } else {
      _tt.style.display = 'none';
    }
  });
  content.addEventListener('mousemove', e => {
    if (_tt.style.display === 'block') {
      const x = Math.min(e.clientX + 14, window.innerWidth - 260);
      const y = Math.max(e.clientY - 44, 8);
      _tt.style.left = x + 'px';
      _tt.style.top = y + 'px';
    }
  });
  content.addEventListener('mouseleave', () => { _tt.style.display = 'none'; });
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
  stats: () => api.fetch(api.withSince('/api/stats')),
  daily: () => api.fetch(api.withSince('/api/daily')),
  projects: () => api.fetch(api.withSince('/api/projects')),
  sessions: (params = {}) => api.fetch(api.withSince('/api/sessions', params)),
  models: () => api.fetch(api.withSince('/api/models')),
  comparison: (m1, m2) => {
    const extra = m1 && m2 ? { model1: m1, model2: m2 } : {};
    return api.fetch(api.withSince('/api/models/comparison', extra));
  },
  refresh: () => api.fetch('/api/refresh'),
  meta: () => api.fetch('/api/meta'),
  saveSetting: (key, value) => api.fetch(`/api/settings`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ [key]: value }) }),
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
  sessionsPage: 0,
  sessionsLimit: 50,
  sessionsFilter: { projectId: '', model: '' },
  compModel1: '',
  compModel2: '',
  compSession1Id: '',
  compSession2Id: '',
  compSelection: [], // [{id, label}] max 2
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

// ── Overview ───────────────────────────────────────────────────

async function renderOverview() {
  setLoading();
  try {
    const [stats, daily, models, dailyAll] = await Promise.all([
      api.stats(), api.daily(), api.models(),
      api.fetch('/api/daily'),
    ]);
    state.data.stats = stats;
    state.data.daily = daily;
    state.data.models = models;

    // Usage by model — all models, session count as universal bar metric
    const modelRows = models.slice(0, 8).map(m => ({
      label: shortModelName(m.model),
      value: m.sessionCount,
      sub: m.isLocal ? 'local' : fmtCost(m.totalCost),
      color: m.isLocal ? 'amber' : 'blue',
    }));

    // Token breakdown rows — each type gets its own color
    const tokenRows = [
      { label: 'Cache Read',  value: stats.cacheReadTokens,     sub: fmtPct(stats.cacheReadTokens / (stats.totalTokens || 1)),     color: 'violet' },
      { label: 'Cache Write', value: stats.cacheCreationTokens, sub: fmtPct(stats.cacheCreationTokens / (stats.totalTokens || 1)), color: 'blue'   },
      { label: 'Output',      value: stats.outputTokens,        sub: fmtPct(stats.outputTokens / (stats.totalTokens || 1)),        color: 'green'  },
      { label: 'Input',       value: stats.inputTokens,         sub: fmtPct(stats.inputTokens / (stats.totalTokens || 1)),         color: 'amber'  },
    ].filter(r => r.value > 0);

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
      <p class="page-subtitle">${periodLabel()} · ${stats.projectCount} project${stats.projectCount !== 1 ? 's' : ''}</p>

      <div class="overview-top">
        <div class="metric-card accent-left">
          <div class="metric-label">Total Cost</div>
          <div class="metric-value mono">${fmtCost(stats.totalCost)}</div>
          <div class="metric-sub">${daily.length > 0 ? fmtCost(stats.totalCost / daily.length) + '/day avg' : '—'}</div>
        </div>
        <div class="metric-card accent-left">
          <div class="metric-label">Avg Cost / Session</div>
          <div class="metric-value mono">${stats.totalSessions > 0 ? fmtCost(stats.totalCost / stats.totalSessions) : '—'}</div>
          <div class="metric-sub">per paid session</div>
        </div>
        <div class="metric-card">
          <div class="metric-label">Sessions</div>
          <div class="metric-value mono">${stats.totalSessions.toLocaleString()}</div>
          <div class="metric-sub">${stats.projectCount} project${stats.projectCount !== 1 ? 's' : ''}</div>
        </div>
        <div class="metric-card overview-activity">
          ${renderUsageGrid(dailyAll)}
        </div>
        <div class="metric-card">
          <div class="metric-label">Total Prompts</div>
          <div class="metric-value mono">${stats.totalMessages.toLocaleString()}</div>
          <div class="metric-sub">${stats.totalSessions > 0 ? '~' + Math.round(stats.totalMessages / stats.totalSessions) + ' per session' : '—'}</div>
        </div>
        <div class="metric-card">
          <div class="metric-label">Total Tokens</div>
          <div class="metric-value mono">${fmtTokens(stats.totalTokens)}</div>
          <div class="metric-sub">across all sessions</div>
        </div>
        <div class="metric-card">
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
          <div class="chart-title">Token Breakdown</div>
          <div class="hbar-wrap">${renderHorizBars(tokenRows, { fmtVal: fmtTokens })}</div>
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
          <div class="section-title">Recent Sessions</div>
          <a href="#sessions" class="secondary" style="font-size:12px;text-decoration:none">View all →</a>
        </div>
        <div id="recent-sessions-wrap">
          <div class="loading-state"><div class="spinner"></div></div>
        </div>
      </div>
    `;

    initDraggableCards(content);
    animateHbars(content);
    requestAnimationFrame(() => {
      scaleUsageGrid();
      // Scroll activity grid to the most recent weeks (rightmost)
      const gridRight = content.querySelector('.overview-activity .usage-grid-right');
      if (gridRight) gridRight.scrollLeft = gridRight.scrollWidth;
    });
    showOnboardingIfNeeded();

    // Load recent sessions async
    const { sessions } = await api.sessions({ limit: 10, offset: 0 });
    const recentWrap = document.getElementById('recent-sessions-wrap');
    recentWrap.innerHTML = renderSessionsTable(sessions, { compact: true });
    bindSessionExpansion(recentWrap);
  } catch (e) {
    showError(e);
  }
}

// ── Projects ───────────────────────────────────────────────────

async function renderProjects() {
  setLoading();
  try {
    const projects = await api.projects();
    state.data.projects = projects;

    const content = document.getElementById('content');
    content.innerHTML = `
      <h1 class="page-title">Projects</h1>
      <p class="page-subtitle">${periodLabel()} · ${projects.length} project${projects.length !== 1 ? 's' : ''}</p>
      <div class="project-list">${projects.map(renderProjectCard).join('')}</div>
    `;

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
  const isLocal = !p.totalCost;
  return `
    <div class="project-card" data-project="${escHtml(p.id)}">
      <div class="project-card-header">
        <div>
          <div class="project-name">${escHtml(p.name)}</div>
          <div class="project-path">${escHtml(p.path)}</div>
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
    const [{ sessions, total }, projects, models] = await Promise.all([
      api.sessions({
        limit: state.sessionsLimit,
        offset: state.sessionsPage * state.sessionsLimit,
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
        <span class="filter-count">${total.toLocaleString()} session${total !== 1 ? 's' : ''}</span>
      </div>

      <div class="table-wrap" id="sessions-table-wrap">
        ${renderSessionsTable(sessions, { selectable: true })}
        ${totalPages > 1 ? renderPagination(curPage, totalPages) : ''}
      </div>
    `;

    const tableWrap = document.getElementById('sessions-table-wrap');
    bindSessionExpansion(tableWrap);
    bindSelectableRows(tableWrap, sessions);

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
  const colCount = (opts.compact ? 8 : 9) + checkCol;

  const rows = sessions.map(s => {
    const local = s.cost === 0 && s.usage.inputTokens + s.usage.outputTokens > 0;
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

    return `<tr class="session-row" data-session-id="${escHtml(s.id)}" data-project-id="${escHtml(s.projectId)}"
      data-entrypoint="${escHtml(s.entrypoint || '')}"
      data-git-branch="${escHtml(s.gitBranch || '')}"
      data-version="${escHtml(s.version || '')}"
      data-permission-mode="${escHtml(s.permissionMode || '')}"
      data-thinking-blocks="${s.thinkingBlocks || 0}"
      data-cache5m="${s.usage.cache5mTokens || 0}"
      data-cache1h="${s.usage.cache1hTokens || 0}">
      ${checkCell}
      <td class="muted nowrap" style="font-size:12px">${fmtDateTime(s.startTime)}</td>
      ${opts.compact ? '' : `<td class="secondary" style="font-size:12px;max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escHtml(s.projectName)}</td>`}
      <td class="prompt">${thinkingBadge}<span title="${escHtml(s.firstPrompt)}">${escHtml(displayTitle)}</span></td>
      <td>${modelBadgeHtml(s.primaryModel, local)}</td>
      <td class="right mono" style="font-size:12px">${fmtTokens(s.usage.inputTokens + s.usage.outputTokens + s.usage.cacheCreationTokens + s.usage.cacheReadTokens)}</td>
      <td class="right">${costCell}</td>
      <td class="right muted" style="font-size:12px">${fmtPct(s.cacheHitRate)}</td>
      <td class="right muted" style="font-size:12px">${s.messageCount}</td>
      <td class="right muted" style="font-size:12px">${fmtDuration(s.duration)}</td>
    </tr>
    <tr class="session-detail-row" data-for="${escHtml(s.id)}">
      <td colspan="${colCount}" class="session-detail-cell">
        <div class="session-detail-inner">
          <div class="session-messages-wrap"></div>
        </div>
      </td>
    </tr>`;
  }).join('');

  const projectCol = opts.compact ? '' : '<th>Project</th>';
  const checkHead = opts.selectable ? '<th class="check-cell"></th>' : '';

  return `<table>
    <thead>
      <tr>
        ${checkHead}
        <th>Started</th>
        ${projectCol}
        <th>Prompt</th>
        <th>Model</th>
        <th class="right">Tokens</th>
        <th class="right">Cost</th>
        <th class="right">Cache%</th>
        <th class="right">Msgs</th>
        <th class="right">Duration</th>
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
      syncAllCheckboxes();
      renderCompareBar();
    });
  });
}

function syncAllCheckboxes() {
  document.querySelectorAll('.session-check').forEach(cb => {
    cb.checked = state.compSelection.some(x => x.id === cb.dataset.sessionId);
  });
}

const COMP_LETTERS = ['A', 'B', 'C', 'D', 'E', 'F'];

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
      syncAllCheckboxes();
      renderCompareBar();
    });
  });

  const goBtn = bar.querySelector('#compare-go-btn');
  if (goBtn) {
    goBtn.addEventListener('click', () => {
      state.data.allSessions = null;
      navigate('session-compare');
    });
  }

  bar.querySelector('#compare-bar-dismiss').addEventListener('click', () => {
    state.compSelection = [];
    syncAllCheckboxes();
    renderCompareBar();
  });
}

function renderSessionMeta(row) {
  const d = row.dataset;
  const entrypoint = d.entrypoint || '';
  const branch = d.gitBranch || '';
  const version = d.version || '';
  const perm = d.permissionMode || '';
  const thinking = parseInt(d.thinkingBlocks || '0', 10);
  const cache5m = parseInt(d.cache5m || '0', 10);
  const cache1h = parseInt(d.cache1h || '0', 10);

  const entrypointLabel = { 'claude-vscode': 'VS Code', 'cli': 'CLI', 'claude-desktop': 'Desktop' }[entrypoint] || entrypoint;
  const permLabel = perm === 'bypassPermissions' ? 'auto-approve' : perm;

  const chips = [
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
    wrap.insertAdjacentHTML('beforeend', renderMessagesTable(messages));
  } catch (e) {
    loader.remove();
    wrap.insertAdjacentHTML('beforeend', `<div class="empty-state"><div class="empty-msg">Error: ${escHtml(e.message)}</div></div>`);
  }
}

function renderMessagesTable(messages) {
  const rows = messages.map((m, i) => {
    const totalTok = m.inputTokens + m.outputTokens + m.cacheCreationTokens + m.cacheReadTokens;
    const thinkCell = m.hasThinking
      ? `<td class="right" style="font-size:11px" title="Extended thinking">💭</td>`
      : `<td class="right muted" style="font-size:11px">—</td>`;
    return `<tr>
      <td class="muted" style="font-size:11px;width:24px;text-align:right">${i + 1}</td>
      <td class="muted nowrap" style="font-size:11px">${fmtDateTime(m.timestamp)}</td>
      <td class="msg-prompt">${escHtml(m.prompt)}</td>
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

// ── Model Comparison ───────────────────────────────────────────

async function renderComparison() {
  setLoading();
  try {
    const models = await api.models();
    state.data.models = models;

    if (models.length === 0) {
      document.getElementById('content').innerHTML = `
        <h1 class="page-title">Model Comparison</h1>
        <div class="empty-state"><div class="empty-icon">⟷</div><div class="empty-msg">No model data found</div></div>
      `;
      return;
    }

    if (!state.compModel1 && models[0]) state.compModel1 = models[0].model;
    if (!state.compModel2 && models[1]) state.compModel2 = models[1].model;

    const content = document.getElementById('content');
    content.innerHTML = `
      <h1 class="page-title">Model Comparison</h1>
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
            <div class="comp-stat-label">Input Tokens</div>
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

// ── Session Comparison ─────────────────────────────────────────

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

function renderSessionComparePage() {
  const allSessions = state.data.allSessions ?? [];
  const selectedIds = new Set(state.compSelection.map(x => x.id));
  const atCap = state.compSelection.length >= 6;

  const addOptions = allSessions
    .filter(s => !selectedIds.has(s.id))
    .map(s => `<option value="${escHtml(s.id)}">${escHtml(sessionDropdownLabel(s))}</option>`)
    .join('');

  const chips = state.compSelection.map((entry, i) => `
    <div class="sc-chip">
      <span class="sc-chip-letter">${COMP_LETTERS[i]}</span>
      <span class="sc-chip-name">${escHtml(entry.label)}</span>
      <button class="sc-chip-remove" data-remove="${i}" title="Remove">×</button>
    </div>
  `).join('');

  const content = document.getElementById('content');
  content.innerHTML = `
    <h1 class="page-title">Session Compare</h1>
    <p class="page-subtitle">Compare cost and token usage across up to 6 sessions</p>

    <div class="sc-selector">
      <div class="sc-chips">${chips || '<span class="sc-empty-hint">Add sessions to compare</span>'}</div>
      ${!atCap ? `
        <div class="sc-add-row">
          <select id="sc-add-select" class="session-picker-select">
            <option value="">— add a session —</option>
            ${addOptions}
          </select>
        </div>
      ` : ''}
    </div>

    <div id="session-comparison-result"></div>
  `;

  content.querySelectorAll('[data-remove]').forEach(btn => {
    btn.addEventListener('click', () => {
      state.compSelection.splice(parseInt(btn.dataset.remove), 1);
      syncAllCheckboxes();
      renderCompareBar();
      renderSessionComparePage();
    });
  });

  const addSelect = document.getElementById('sc-add-select');
  if (addSelect) {
    addSelect.addEventListener('change', () => {
      const id = addSelect.value;
      if (!id) return;
      const s = allSessions.find(x => x.id === id);
      if (!s) return;
      state.compSelection.push({ id, label: sessionChipLabel(s) });
      syncAllCheckboxes();
      renderCompareBar();
      renderSessionComparePage();
    });
  }

  renderSessionComparisonTable();
}

function renderSessionComparisonTable() {
  const wrap = document.getElementById('session-comparison-result');
  if (!wrap) return;

  const allSessions = state.data.allSessions ?? [];
  const selected = state.compSelection
    .map(x => allSessions.find(s => s.id === x.id))
    .filter(Boolean);

  if (selected.length < 2) {
    wrap.innerHTML = `<div class="empty-state" style="margin-top:24px"><div class="empty-icon">⇄</div><div class="empty-msg">Add at least 2 sessions to compare</div></div>`;
    return;
  }

  const metrics = [
    { label: 'Cost',            val: s => s.cost,                                                                                                  fmt: s => { const local = isLocal(s); return local ? '<span class="amber">local</span>' : fmtCost(s.cost); }, lowerBetter: true,  skipLocal: true },
    { label: 'Total Tokens',    val: s => s.usage.inputTokens + s.usage.outputTokens + s.usage.cacheCreationTokens + s.usage.cacheReadTokens,      fmt: s => fmtTokens(s.usage.inputTokens + s.usage.outputTokens + s.usage.cacheCreationTokens + s.usage.cacheReadTokens), lowerBetter: true  },
    { label: 'Input Tokens',    val: s => s.usage.inputTokens,    fmt: s => fmtTokens(s.usage.inputTokens),    lowerBetter: true  },
    { label: 'Output Tokens',   val: s => s.usage.outputTokens,   fmt: s => fmtTokens(s.usage.outputTokens),   lowerBetter: true  },
    { label: 'Cache Read',      val: s => s.usage.cacheReadTokens, fmt: s => fmtTokens(s.usage.cacheReadTokens), lowerBetter: false },
    { label: 'Cache Write',     val: s => s.usage.cacheCreationTokens, fmt: s => fmtTokens(s.usage.cacheCreationTokens), lowerBetter: true },
    { label: 'Cache Hit Rate',  val: s => s.cacheHitRate,         fmt: s => fmtPct(s.cacheHitRate),            lowerBetter: false },
    { label: 'Duration',        val: s => s.duration,             fmt: s => fmtDuration(s.duration),           lowerBetter: true  },
    { label: 'Messages',        val: s => s.messageCount,         fmt: s => s.messageCount.toString(),         lowerBetter: null  },
    { label: 'Tool Calls',      val: s => s.toolCallCount,        fmt: s => s.toolCallCount.toString(),        lowerBetter: null  },
    { label: 'Thinking Turns',  val: s => s.thinkingBlocks || 0,  fmt: s => (s.thinkingBlocks || 0).toString(), lowerBetter: null  },
  ];

  function isLocal(s) { return s.cost === 0 && (s.usage.inputTokens + s.usage.outputTokens) > 0; }

  const colHeaders = selected.map((s, i) => {
    const local = isLocal(s);
    return `<th class="sc-col-header">
      <div class="sc-col-letter">${COMP_LETTERS[i]}</div>
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
    <div class="sc-legend">
      <span class="sc-legend-item"><span class="sc-cell-best sc-legend-swatch"></span> Best</span>
      <span class="sc-legend-item"><span class="sc-cell-worst sc-legend-swatch"></span> Worst</span>
    </div>
  `;
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
  updateNav();
  switch (state.view) {
    case 'overview':        return renderOverview();
    case 'projects':        return renderProjects();
    case 'sessions':        return renderSessions();
    case 'comparison':      return renderComparison();
    case 'session-compare': return renderSessionCompare();
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
      renderCompareBar();
      renderPeriodSelector();
      renderView();
    });
  });
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

// ── Theme ──────────────────────────────────────────────────────

function initTheme() {
  const stored = localStorage.getItem('br-theme');
  const theme = stored === 'light' ? 'light' : 'dark';
  applyTheme(theme);
}

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  const btn = document.getElementById('theme-toggle-btn');
  if (btn) {
    btn.textContent = theme === 'light' ? '☾' : '☀';
    btn.title = theme === 'light' ? 'Switch to dark' : 'Switch to light';
  }
  localStorage.setItem('br-theme', theme);
  // Re-render so charts pick up the new color palette
  if (state.data.stats) renderView();
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

  // Nav clicks
  document.querySelectorAll('.nav-item[data-view]').forEach(el => {
    el.addEventListener('click', (e) => {
      e.preventDefault();
      state.sessionsFilter = { projectId: '', model: '' };
      state.sessionsPage = 0;
      navigate(el.dataset.view);
    });
  });

  // Theme toggle
  document.getElementById('theme-toggle-btn').addEventListener('click', () => {
    const current = document.documentElement.getAttribute('data-theme');
    applyTheme(current === 'light' ? 'dark' : 'light');
  });

  // About button
  document.getElementById('about-btn').addEventListener('click', showAboutModal);

  // Global settings button
  document.getElementById('global-settings-btn').addEventListener('click', async () => {
    const meta = await api.meta();
    showSettingsModal(meta);
  });

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

  word.style.cursor = 'pointer';
  word.addEventListener('click', () => {
    eggCount++;

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
