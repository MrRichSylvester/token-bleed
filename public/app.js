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
  async fetch(path) {
    const res = await fetch(path);
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

  const colorMap = { green: '#00FF87', blue: '#5B8DEF', violet: '#B985F4', amber: '#FFB547' };
  const colorVal = colorMap[color] || colorMap.green;
  const gradId = `bg-${valueKey}`;

  const bars = recent.map((d, i) => {
    const barH = Math.max(2, Math.floor((d[valueKey] / maxVal) * chartH));
    const x = i * (barW + BAR_GAP);
    const y = chartH - barH;
    const tip = `${d.date}  ${fmt(d[valueKey])}`;
    const delay = 80 + i * 15;
    return `<rect class="bar-chart-bar" x="${x}" y="${y}" width="${barW}" height="${barH}" rx="2" fill="url(#${gradId})" data-tip="${escHtml(tip)}" style="animation-delay:${delay}ms"></rect>`;
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

  const topPad = 14;
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
  const colorMap = {
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

// ── Overview ───────────────────────────────────────────────────

async function renderOverview() {
  setLoading();
  try {
    const [stats, daily, models] = await Promise.all([api.stats(), api.daily(), api.models()]);
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

    const content = document.getElementById('content');
    content.innerHTML = `
      <h1 class="page-title">Burn Rate</h1>
      <p class="page-subtitle">${periodLabel()} · ${stats.projectCount} project${stats.projectCount !== 1 ? 's' : ''}</p>

      <div class="metric-grid">
        <div class="metric-card accent-left" data-id="total-cost">
          <div class="metric-label">Total Cost</div>
          <div class="metric-value mono">${fmtCost(stats.totalCost)}</div>
          <div class="metric-sub">${daily.length > 0 ? fmtCost(stats.totalCost / daily.length) + '/day avg' : '—'}</div>
        </div>
        <div class="metric-card" data-id="sessions">
          <div class="metric-label">Sessions</div>
          <div class="metric-value mono">${stats.totalSessions.toLocaleString()}</div>
          <div class="metric-sub">${stats.projectCount} project${stats.projectCount !== 1 ? 's' : ''}</div>
        </div>
        <div class="metric-card" data-id="cache-hit-rate">
          <div class="metric-label">Cache Hit Rate</div>
          <div class="metric-value">${fmtPct(stats.cacheHitRate)}</div>
          <div class="metric-sub">${fmtTokens(stats.cacheReadTokens)} from cache</div>
        </div>
        <div class="metric-card accent-left" data-id="avg-cost-session">
          <div class="metric-label">Avg Cost / Session</div>
          <div class="metric-value mono">${stats.totalSessions > 0 ? fmtCost(stats.totalCost / stats.totalSessions) : '—'}</div>
          <div class="metric-sub">per paid session</div>
        </div>
        <div class="metric-card" data-id="total-tokens">
          <div class="metric-label">Total Tokens</div>
          <div class="metric-value mono">${fmtTokens(stats.totalTokens)}</div>
          <div class="metric-sub">${fmtTokens(stats.inputTokens)} input</div>
        </div>
        <div class="metric-card" data-id="output-tokens">
          <div class="metric-label">Output Tokens</div>
          <div class="metric-value mono">${fmtTokens(stats.outputTokens)}</div>
          <div class="metric-sub">${fmtPct(stats.outputTokens / (stats.totalTokens || 1))} of total</div>
        </div>
        <div class="metric-card" data-id="messages">
          <div class="metric-label">Messages</div>
          <div class="metric-value mono">${stats.totalMessages.toLocaleString()}</div>
          <div class="metric-sub">${stats.totalSessions > 0 ? '~' + Math.round(stats.totalMessages / stats.totalSessions) + ' per session' : '—'}</div>
        </div>
        <div class="metric-card" data-id="top-model">
          <div class="metric-label">Top Model</div>
          <div class="metric-value" style="font-size:15px">${shortModelName(stats.topModel)}</div>
          <div class="metric-sub">${stats.modelsUsed.length} model${stats.modelsUsed.length !== 1 ? 's' : ''} used</div>
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
  const panel = cardEl.querySelector('.project-sessions-panel');
  const isOpen = cardEl.classList.contains('expanded');

  if (isOpen) {
    cardEl.classList.remove('expanded');
    panel.style.display = 'none';
    return;
  }

  cardEl.classList.add('expanded');
  panel.style.display = 'block';
  panel.innerHTML = '<div class="loading-state" style="min-height:80px"><div class="spinner"></div></div>';

  try {
    const { sessions } = await api.sessions({ projectId, limit: 50, offset: 0 });
    if (sessions.length === 0) {
      panel.innerHTML = '<div class="empty-state" style="min-height:60px"><div class="empty-msg">No sessions found</div></div>';
    } else {
      panel.innerHTML = renderSessionsTable(sessions, { compact: true, selectable: true });
      bindSessionExpansion(panel);
      bindSelectableRows(panel, sessions);
    }
  } catch (e) {
    panel.innerHTML = `<div class="empty-state"><div class="empty-msg">Error: ${escHtml(e.message)}</div></div>`;
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
      <div class="project-sessions-panel" style="display:none"></div>
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

    return `<tr class="session-row" data-session-id="${escHtml(s.id)}" data-project-id="${escHtml(s.projectId)}">
      ${checkCell}
      <td class="muted nowrap" style="font-size:12px">${fmtDateTime(s.startTime)}</td>
      ${opts.compact ? '' : `<td class="secondary" style="font-size:12px;max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escHtml(s.projectName)}</td>`}
      <td class="prompt"><span title="${escHtml(s.firstPrompt)}">${escHtml(s.firstPrompt)}</span></td>
      <td>${modelBadgeHtml(s.primaryModel, local)}</td>
      <td class="right mono" style="font-size:12px">${fmtTokens(s.usage.inputTokens + s.usage.outputTokens + s.usage.cacheCreationTokens + s.usage.cacheReadTokens)}</td>
      <td class="right">${costCell}</td>
      <td class="right muted" style="font-size:12px">${fmtPct(s.cacheHitRate)}</td>
      <td class="right muted" style="font-size:12px">${s.messageCount}</td>
      <td class="right muted" style="font-size:12px">${fmtDuration(s.duration)}</td>
    </tr>
    <tr class="session-detail-row" data-for="${escHtml(s.id)}" style="display:none">
      <td colspan="${colCount}" class="session-detail-cell">
        <div class="session-messages-wrap"></div>
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
        if (state.compSelection.length >= 2) state.compSelection.shift();
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

  const [a, b] = state.compSelection;
  const canCompare = state.compSelection.length === 2;

  bar.className = 'compare-bar';
  bar.innerHTML = `
    <div class="compare-bar-inner">
      <div class="compare-bar-slots">
        ${slotHtml(a, 'A', 0)}
        <span class="compare-bar-vs">vs</span>
        ${b ? slotHtml(b, 'B', 1) : '<div class="compare-slot compare-slot--empty"><span class="compare-slot-placeholder">Pick a second session</span></div>'}
      </div>
      ${canCompare ? '<button class="compare-go-btn" id="compare-go-btn">Compare →</button>' : ''}
      <button class="compare-bar-dismiss" id="compare-bar-dismiss" title="Clear selection">✕</button>
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
      state.compSession1Id = state.compSelection[0].id;
      state.compSession2Id = state.compSelection[1].id;
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

function slotHtml(entry, letter, idx) {
  return `<div class="compare-slot compare-slot--filled">
    <span class="compare-slot-letter">${letter}</span>
    <span class="compare-slot-name">${escHtml(entry.label)}</span>
    <button class="compare-slot-clear" data-clear="${idx}" title="Remove">×</button>
  </div>`;
}

async function toggleSession(row, container) {
  const sessionId = row.dataset.sessionId;
  const detailRow = container.querySelector(`.session-detail-row[data-for="${CSS.escape(sessionId)}"]`);
  if (!detailRow) return;

  const isOpen = detailRow.style.display !== 'none';
  if (isOpen) {
    detailRow.style.display = 'none';
    row.classList.remove('expanded');
    return;
  }

  row.classList.add('expanded');
  detailRow.style.display = '';
  const wrap = detailRow.querySelector('.session-messages-wrap');
  if (wrap.dataset.loaded) return;

  wrap.innerHTML = '<div class="loading-state" style="min-height:60px"><div class="spinner"></div></div>';

  try {
    const messages = await api.fetch(`/api/sessions/${encodeURIComponent(sessionId)}/messages`);
    wrap.dataset.loaded = '1';
    if (!messages || messages.length === 0) {
      wrap.innerHTML = '<div class="empty-state" style="min-height:40px"><div class="empty-msg">No messages found</div></div>';
      return;
    }
    wrap.innerHTML = renderMessagesTable(messages);
  } catch (e) {
    wrap.innerHTML = `<div class="empty-state"><div class="empty-msg">Error: ${escHtml(e.message)}</div></div>`;
  }
}

function renderMessagesTable(messages) {
  const rows = messages.map((m, i) => {
    const totalTok = m.inputTokens + m.outputTokens + m.cacheCreationTokens + m.cacheReadTokens;
    return `<tr>
      <td class="muted" style="font-size:11px;width:24px;text-align:right">${i + 1}</td>
      <td class="muted nowrap" style="font-size:11px">${fmtDateTime(m.timestamp)}</td>
      <td class="msg-prompt">${escHtml(m.prompt)}</td>
      <td style="font-size:11px">${modelBadgeHtml(m.model, false)}</td>
      <td class="right mono muted" style="font-size:11px">${totalTok ? fmtTokens(totalTok) : '—'}</td>
      <td class="right mono" style="font-size:11px">${m.cost ? fmtCost(m.cost) : '—'}</td>
      <td class="right muted" style="font-size:11px">${m.toolCalls || '—'}</td>
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
    const sessions = state.data.allSessions;

    if (sessions.length === 0) {
      document.getElementById('content').innerHTML = `
        <h1 class="page-title">Session Compare</h1>
        <div class="empty-state"><div class="empty-icon">⇄</div><div class="empty-msg">No sessions found</div></div>
      `;
      return;
    }

    if (!state.compSession1Id && sessions[0]) state.compSession1Id = sessions[0].id;
    if (!state.compSession2Id && sessions[1]) state.compSession2Id = sessions[1].id;

    const content = document.getElementById('content');
    content.innerHTML = `
      <h1 class="page-title">Session Compare</h1>
      <p class="page-subtitle">Pick two sessions to compare cost and token usage side by side</p>

      <div class="comparison-selectors">
        <select id="sc-session1" class="session-picker-select">
          ${sessions.map(s => sessionOption(s, state.compSession1Id)).join('')}
        </select>
        <span class="comparison-vs-label">vs</span>
        <select id="sc-session2" class="session-picker-select">
          ${sessions.map(s => sessionOption(s, state.compSession2Id)).join('')}
        </select>
      </div>

      <div id="session-comparison-result"></div>
    `;

    document.getElementById('sc-session1').addEventListener('change', e => {
      state.compSession1Id = e.target.value;
      renderSessionComparisonResult();
    });
    document.getElementById('sc-session2').addEventListener('change', e => {
      state.compSession2Id = e.target.value;
      renderSessionComparisonResult();
    });

    renderSessionComparisonResult();
  } catch (e) {
    showError(e);
  }
}

function sessionOption(s, selectedId) {
  const label = `${fmtDate(s.startTime)} · ${s.projectName} · ${s.firstPrompt.slice(0, 60)}`;
  return `<option value="${escHtml(s.id)}" ${s.id === selectedId ? 'selected' : ''}>${escHtml(label)}</option>`;
}

function renderSessionComparisonResult() {
  const wrap = document.getElementById('session-comparison-result');
  if (!wrap) return;

  const sessions = state.data.allSessions ?? [];
  const s1 = sessions.find(s => s.id === state.compSession1Id);
  const s2 = sessions.find(s => s.id === state.compSession2Id);

  if (!s1 || !s2) {
    wrap.innerHTML = `<div class="empty-state"><div class="empty-icon">⇄</div><div class="empty-msg">Select two sessions to compare</div></div>`;
    return;
  }

  if (s1.id === s2.id) {
    wrap.innerHTML = `<div class="empty-state"><div class="empty-icon">⇄</div><div class="empty-msg">Pick two different sessions</div></div>`;
    return;
  }

  const local1 = s1.cost === 0 && (s1.usage.inputTokens + s1.usage.outputTokens) > 0;
  const local2 = s2.cost === 0 && (s2.usage.inputTokens + s2.usage.outputTokens) > 0;

  let winner = null;
  let pctDiff = 0;
  if (!local1 && !local2 && s1.cost > 0 && s2.cost > 0) {
    winner = s1.cost <= s2.cost ? 's1' : 's2';
    const cheaper = Math.min(s1.cost, s2.cost);
    const pricier = Math.max(s1.cost, s2.cost);
    pctDiff = ((pricier - cheaper) / pricier) * 100;
  }

  wrap.innerHTML = `
    <div class="comparison-arena">
      ${renderSessionCompCard(s1, winner === 's1', winner === 's2', local1, pctDiff)}
      <div class="vs-divider"><div class="vs-circle">VS</div></div>
      ${renderSessionCompCard(s2, winner === 's2', winner === 's1', local2, pctDiff)}
    </div>
    ${renderSessionDeltaRow(s1, s2, local1, local2)}
  `;
}

function renderSessionCompCard(s, isWinner, isLoser, isLocal, pctDiff) {
  const totalTok = s.usage.inputTokens + s.usage.outputTokens + s.usage.cacheCreationTokens + s.usage.cacheReadTokens;
  const costClass = isLocal ? 'local-cost' : isWinner ? 'winner-cost' : isLoser ? 'loser-cost' : '';
  const costDisplay = isLocal ? `${fmtTokens(totalTok)} tokens` : fmtCost(s.cost);

  const badge = isWinner
    ? '<span class="badge-winner">Cheaper</span>'
    : isLoser
    ? '<span class="badge-loser">More Expensive</span>'
    : isLocal
    ? '<span class="badge-local">Local</span>'
    : '';

  const savingsBlock = isWinner && pctDiff > 0 ? `
    <div class="comp-savings">
      <div class="comp-savings-pct">${pctDiff.toFixed(0)}% cheaper</div>
      <div class="comp-savings-label">vs the other session</div>
    </div>
  ` : '';

  return `
    <div class="comparison-card ${isWinner ? 'winner' : ''}">
      <div class="comp-header">
        <div>
          <div class="comp-session-date">${fmtDateTime(s.startTime)}</div>
          <div class="comp-model-name">${escHtml(s.projectName)}</div>
          <div style="margin-top:6px">${modelBadgeHtml(s.primaryModel, isLocal)}</div>
        </div>
        ${badge}
      </div>
      <div class="comp-body">
        <div class="comp-cost ${costClass}">${costDisplay}</div>

        <div class="comp-stats-grid">
          <div class="comp-stat">
            <div class="comp-stat-label">Total Tokens</div>
            <div class="comp-stat-value">${fmtTokens(totalTok)}</div>
          </div>
          <div class="comp-stat">
            <div class="comp-stat-label">Input</div>
            <div class="comp-stat-value">${fmtTokens(s.usage.inputTokens)}</div>
          </div>
          <div class="comp-stat">
            <div class="comp-stat-label">Output</div>
            <div class="comp-stat-value">${fmtTokens(s.usage.outputTokens)}</div>
          </div>
          <div class="comp-stat">
            <div class="comp-stat-label">Cache Read</div>
            <div class="comp-stat-value">${fmtTokens(s.usage.cacheReadTokens)}</div>
          </div>
        </div>

        <div class="comp-efficiency">
          <div class="comp-eff-item">
            <div class="comp-eff-label">Cache Hit</div>
            <div class="comp-eff-value">${fmtPct(s.cacheHitRate)}</div>
          </div>
          <div class="comp-eff-item">
            <div class="comp-eff-label">Duration</div>
            <div class="comp-eff-value">${fmtDuration(s.duration)}</div>
          </div>
          <div class="comp-eff-item">
            <div class="comp-eff-label">Messages</div>
            <div class="comp-eff-value">${s.messageCount}</div>
          </div>
          <div class="comp-eff-item">
            <div class="comp-eff-label">Tool Calls</div>
            <div class="comp-eff-value">${s.toolCallCount}</div>
          </div>
          <div class="comp-eff-item">
            <div class="comp-eff-label">Cache Write</div>
            <div class="comp-eff-value">${fmtTokens(s.usage.cacheCreationTokens)}</div>
          </div>
        </div>

        <div class="comp-prompt-preview">
          <div class="comp-eff-label" style="margin-bottom:6px">First Prompt</div>
          <div class="comp-prompt-text">${escHtml(s.firstPrompt.slice(0, 120))}${s.firstPrompt.length > 120 ? '…' : ''}</div>
        </div>

        ${savingsBlock}
      </div>
    </div>
  `;
}

function renderSessionDeltaRow(s1, s2, local1, local2) {
  const rows = [];

  const totalTok1 = s1.usage.inputTokens + s1.usage.outputTokens + s1.usage.cacheCreationTokens + s1.usage.cacheReadTokens;
  const totalTok2 = s2.usage.inputTokens + s2.usage.outputTokens + s2.usage.cacheCreationTokens + s2.usage.cacheReadTokens;

  function deltaHtml(val1, val2, fmtFn, higherIsBetter = false) {
    if (!val1 || !val2) return '<span class="delta-neutral">—</span>';
    const diff = val2 - val1;
    const pct = Math.abs(diff / val1) * 100;
    if (pct < 0.1) return '<span class="delta-neutral">equal</span>';
    const positive = higherIsBetter ? diff > 0 : diff < 0;
    const cls = positive ? 'delta-good' : 'delta-bad';
    const sign = diff > 0 ? '+' : '-';
    return `<span class="${cls}">${sign}${fmtFn(Math.abs(diff))} (${pct.toFixed(0)}%)</span>`;
  }

  if (!local1 && !local2) {
    rows.push({ label: 'Cost', delta: deltaHtml(s1.cost, s2.cost, fmtCost) });
  }
  rows.push({ label: 'Total Tokens',   delta: deltaHtml(totalTok1, totalTok2, fmtTokens) });
  rows.push({ label: 'Output Tokens',  delta: deltaHtml(s1.usage.outputTokens, s2.usage.outputTokens, fmtTokens) });
  rows.push({ label: 'Cache Hit Rate', delta: deltaHtml(s1.cacheHitRate, s2.cacheHitRate, v => fmtPct(v), true) });
  rows.push({ label: 'Duration',       delta: deltaHtml(s1.duration, s2.duration, fmtDuration) });
  rows.push({ label: 'Messages',       delta: deltaHtml(s1.messageCount, s2.messageCount, n => n.toString()) });

  return `
    <div class="session-delta-row">
      <div class="session-delta-title">Delta (A → B)</div>
      <div class="session-delta-grid">
        ${rows.map(r => `
          <div class="session-delta-item">
            <div class="comp-eff-label">${escHtml(r.label)}</div>
            <div class="session-delta-value">${r.delta}</div>
          </div>
        `).join('')}
      </div>
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

// ── Bootstrap ──────────────────────────────────────────────────

function init() {
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
