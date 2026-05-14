export async function renderPromptCompare(deps) {
  const {
    state, api, setLoading, showError, escHtml, fmtCost, fmtTokens, fmtPct, fmtDateTime,
    modelBadgeHtml, agentBadgeHtml, COMP_LETTERS, renderPromptCompareBar,
    savePromptCompSelection, syncPromptCheckboxes,
  } = deps;

  setLoading();
  try {
    const ids = state.promptCompSelection.map(x => x.id);
    const { prompts } = ids.length
      ? await api.prompts({ ids: ids.join(',') })
      : { prompts: [] };
    const byId = new Map((prompts || []).map(p => [p.id, p]));
    const selected = ids.map(id => byId.get(id)).filter(Boolean);
    renderPromptComparePage({ ...deps, selected });
  } catch (e) {
    showError(e);
  }
}

function promptTotalTokens(p) {
  return p.totalTokens ?? (p.inputTokens + p.outputTokens + p.cacheCreationTokens + p.cacheReadTokens);
}

function removePrompt(deps, id) {
  const { state, savePromptCompSelection, syncPromptCheckboxes, renderPromptCompareBar } = deps;
  const idx = state.promptCompSelection.findIndex(x => x.id === id);
  if (idx === -1) return;
  state.promptCompSelection.splice(idx, 1);
  savePromptCompSelection();
  syncPromptCheckboxes();
  renderPromptCompareBar();
  renderPromptCompare(deps);
}

function rankPrompts(prompts, metrics) {
  const dims = prompts.map(p => ({
    p,
    cost: metrics.some(m => m.key === 'cost') ? p.cost : null,
    totalTokens: metrics.some(m => m.key === 'totalTokens') ? promptTotalTokens(p) : null,
    toolCalls: metrics.some(m => m.key === 'toolCalls') ? p.toolCalls : null,
  }));

  const norm = key => {
    const vs = dims.map(d => d[key]).filter(v => v !== null && v > 0);
    if (vs.length < 2) return dims.map(() => 0);
    const lo = Math.min(...vs), hi = Math.max(...vs);
    if (lo === hi) return dims.map(() => 0);
    return dims.map(d => d[key] !== null && d[key] > 0 ? (d[key] - lo) / (hi - lo) : 0.5);
  };

  const nc = norm('cost');
  const nt = norm('totalTokens');
  const ntc = norm('toolCalls');
  return dims
    .map((d, i) => ({ p: d.p, score: nc[i] + nt[i] + ntc[i] }))
    .sort((a, b) => a.score - b.score)
    .map(x => x.p);
}

function metricDefs(deps) {
  const { fmtCost, fmtTokens, fmtPct } = deps;
  return [
    { key: 'cost', label: 'Cost', val: p => p.cost, fmt: p => p.cost ? fmtCost(p.cost) : '—', lowerBetter: true },
    { key: 'totalTokens', label: 'Total Tokens', val: promptTotalTokens, fmt: p => fmtTokens(promptTotalTokens(p)), lowerBetter: true },
    { key: 'inputTokens', label: 'Input Tokens', val: p => p.inputTokens, fmt: p => fmtTokens(p.inputTokens), lowerBetter: true },
    { key: 'outputTokens', label: 'Output Tokens', val: p => p.outputTokens, fmt: p => fmtTokens(p.outputTokens), lowerBetter: true },
    { key: 'cacheRead', label: 'Cache Read', val: p => p.cacheReadTokens, fmt: p => fmtTokens(p.cacheReadTokens), lowerBetter: false },
    { key: 'cacheWrite', label: 'Cache Write', val: p => p.cacheCreationTokens, fmt: p => fmtTokens(p.cacheCreationTokens), lowerBetter: true },
    { key: 'cacheHitRate', label: 'Cache Hit Rate', val: p => p.cacheHitRate, fmt: p => fmtPct(p.cacheHitRate || 0), lowerBetter: false },
    { key: 'toolCalls', label: 'Tool Calls', val: p => p.toolCalls, fmt: p => (p.toolCalls || 0).toString(), lowerBetter: true },
    { key: 'thinking', label: 'Thinking', val: p => p.hasThinking ? 1 : 0, fmt: p => p.hasThinking ? 'yes' : 'no', lowerBetter: null },
  ];
}

function renderPromptComparePage(deps) {
  const { state, selected, escHtml } = deps;
  const content = document.getElementById('content');
  content.innerHTML = `
    <h1 class="page-title">Prompt Compare</h1>
    <p class="page-subtitle">Compare selected prompts and their responses across sessions</p>

    <div class="sc-toolbar">
      <div class="sc-view-toggle">
        <button class="sc-view-btn${state.pcView === 'table' ? ' sc-view-btn--on' : ''}" data-pc-view="table">
          <svg width="13" height="13" viewBox="0 0 14 14" fill="none"><rect x="1" y="1" width="12" height="3" rx="1" fill="currentColor" opacity=".5"/><rect x="1" y="6" width="12" height="2" rx="1" fill="currentColor"/><rect x="1" y="10" width="12" height="2" rx="1" fill="currentColor" opacity=".7"/></svg>
          Table
        </button>
        <button class="sc-view-btn${state.pcView === 'card' ? ' sc-view-btn--on' : ''}" data-pc-view="card">
          <svg width="13" height="13" viewBox="0 0 14 14" fill="none"><rect x="1" y="1" width="5.5" height="12" rx="1.5" fill="currentColor"/><rect x="7.5" y="1" width="5.5" height="12" rx="1.5" fill="currentColor" opacity=".7"/></svg>
          Cards
        </button>
      </div>

      <div class="sc-view-toggle">
        <button class="sc-view-btn${state.pcOrder === 'added' ? ' sc-view-btn--on' : ''}" data-pc-order="added">Added</button>
        <button class="sc-view-btn${state.pcOrder === 'ranked' ? ' sc-view-btn--on' : ''}" data-pc-order="ranked">
          <svg width="13" height="13" viewBox="0 0 14 14" fill="none"><path d="M2 12L5 7L8 9L12 3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
          Best Overall
        </button>
      </div>
    </div>

    <div id="prompt-comparison-result">
      ${renderPromptCompareResult(deps)}
    </div>
  `;

  content.querySelectorAll('[data-pc-view]').forEach(btn => {
    btn.addEventListener('click', () => {
      state.pcView = btn.dataset.pcView;
      localStorage.setItem('pc-view', state.pcView);
      renderPromptComparePage(deps);
    });
  });

  content.querySelectorAll('[data-pc-order]').forEach(btn => {
    btn.addEventListener('click', () => {
      state.pcOrder = btn.dataset.pcOrder;
      localStorage.setItem('pc-order', state.pcOrder);
      renderPromptComparePage(deps);
    });
  });

  content.querySelectorAll('[data-remove-prompt]').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      removePrompt(deps, btn.dataset.removePrompt);
    });
  });

  content.querySelectorAll('[data-prompt-full]').forEach(btn => {
    btn.addEventListener('click', () => {
      document.getElementById('prompt-modal-body').textContent = btn.dataset.promptFull;
      document.getElementById('prompt-modal').hidden = false;
    });
  });
}

function renderPromptCompareResult(deps) {
  const { state, selected } = deps;
  if (!selected.length) {
    return `<div class="empty-state" style="margin-top:24px"><div class="empty-icon">≋</div><div class="empty-msg">Select prompts from Projects or Sessions to compare</div></div>`;
  }
  const metrics = metricDefs(deps);
  const ordered = state.pcOrder === 'ranked' && selected.length >= 2
    ? rankPrompts([...selected], metrics)
    : [...selected];
  return state.pcView === 'card'
    ? renderPromptCards(deps, ordered, metrics)
    : renderPromptTable(deps, ordered, metrics);
}

function metricScores(items, metrics) {
  const scores = new Map();
  metrics.forEach(m => {
    if (m.lowerBetter === null) return;
    const vals = items.map(p => m.val(p)).filter(v => v > 0);
    if (vals.length < 2) return;
    const bestV = m.lowerBetter ? Math.min(...vals) : Math.max(...vals);
    const worstV = m.lowerBetter ? Math.max(...vals) : Math.min(...vals);
    scores.set(m.key, { bestV, worstV });
  });
  return scores;
}

function renderPromptTable(deps, items, metrics) {
  const { state, escHtml, fmtDateTime, modelBadgeHtml, agentBadgeHtml, COMP_LETTERS } = deps;
  const scores = metricScores(items, metrics);
  const headers = items.map((p, i) => {
    const label = state.pcOrder === 'ranked' ? String(i + 1) : COMP_LETTERS[i];
    return `<th class="sc-col-header">
      <button class="sc-remove-session-btn" data-remove-prompt="${escHtml(p.id)}" title="Remove prompt">×</button>
      <div class="sc-col-letter">${label}</div>
      <div class="sc-col-project">${escHtml(p.projectName)}</div>
      <div class="sc-col-date">${fmtDateTime(p.timestamp || p.sessionStartTime)}</div>
      <div class="prompt-compare-badges">${agentBadgeHtml(p.source || 'claude', { short: true })}${modelBadgeHtml(p.model, p.cost === 0 && promptTotalTokens(p) > 0)}</div>
      <div class="sc-col-prompt" title="${escHtml(p.prompt)}">${escHtml((p.prompt || '').slice(0, 60))}${(p.prompt || '').length > 60 ? '…' : ''}</div>
    </th>`;
  }).join('');

  const rows = metrics.map(m => {
    const cells = items.map(p => {
      const score = scores.get(m.key);
      const v = m.val(p);
      let cls = '';
      if (score && v === score.bestV && score.bestV !== score.worstV) cls = 'sc-cell-best';
      else if (score && v === score.worstV && score.bestV !== score.worstV) cls = 'sc-cell-worst';
      return `<td class="sc-cell ${cls}">${m.fmt(p)}</td>`;
    }).join('');
    return `<tr><td class="sc-metric-label">${escHtml(m.label)}</td>${cells}</tr>`;
  }).join('');

  return `
    <div class="sc-table-wrap">
      <table class="sc-table">
        <thead><tr><th class="sc-metric-label"></th>${headers}</tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    ${items.length >= 2 ? legend('sc-cell-best', 'sc-cell-worst') : ''}
  `;
}

function renderPromptCards(deps, items, metrics) {
  const { state, escHtml, fmtDateTime, modelBadgeHtml, agentBadgeHtml, COMP_LETTERS } = deps;
  const scores = metricScores(items, metrics);
  const cards = items.map((p, i) => {
    const label = state.pcOrder === 'ranked' ? String(i + 1) : COMP_LETTERS[i];
    const tiles = metrics.map(m => {
      const score = scores.get(m.key);
      const v = m.val(p);
      let cls = '';
      if (score && v === score.bestV && score.bestV !== score.worstV) cls = 'sc-tile--best';
      else if (score && v === score.worstV && score.bestV !== score.worstV) cls = 'sc-tile--worst';
      return `<div class="sc-tile ${cls}"><div class="sc-tile-label">${escHtml(m.label)}</div><div class="sc-tile-value">${m.fmt(p)}</div></div>`;
    }).join('');

    return `
      <div class="sc-card">
        <div class="sc-card-inner">
          <div class="sc-card-hero">
            <div class="sc-card-hero-letter">${label}</div>
            <div class="sc-card-hero-info">
              <div class="sc-card-project">${escHtml(p.projectName)}</div>
              <div class="sc-card-date">${fmtDateTime(p.timestamp || p.sessionStartTime)}</div>
              <div class="sc-card-model-row prompt-compare-badges">${agentBadgeHtml(p.source || 'claude', { short: true })}${modelBadgeHtml(p.model, p.cost === 0 && promptTotalTokens(p) > 0)}</div>
            </div>
            <button class="sc-remove-session-btn sc-card-remove" data-remove-prompt="${escHtml(p.id)}" title="Remove prompt">×</button>
          </div>
          <button class="sc-card-prompt prompt-compare-prompt" data-prompt-full="${escHtml(p.prompt || '')}" title="View full prompt">
            <span class="sc-card-prompt-text">${escHtml((p.prompt || '').slice(0, 100))}${(p.prompt || '').length > 100 ? '…' : ''}</span>
          </button>
          <div class="sc-card-tiles">${tiles}</div>
        </div>
      </div>
    `;
  }).join('');

  return `
    <div class="sc-cards-grid">${cards}</div>
    ${items.length >= 2 ? legend('sc-tile--best', 'sc-tile--worst') : ''}
  `;
}

function legend(bestClass, worstClass) {
  return `
    <div class="sc-legend" style="margin-top:16px">
      <span class="sc-legend-item"><span class="${bestClass} sc-legend-swatch"></span> Best</span>
      <span class="sc-legend-item"><span class="${worstClass} sc-legend-swatch"></span> Worst</span>
    </div>
  `;
}
