export async function renderPromptCompare(deps) {
  const {
    state, api, setLoading, showError, escHtml, fmtCost, fmtTokens, fmtPct, fmtDateTime, fmtDuration,
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
  const { fmtCost, fmtTokens, fmtPct, fmtDuration } = deps;
  return [
    { key: 'cost', label: 'Cost', val: p => p.cost, fmt: p => p.cost ? fmtCost(p.cost) : '—', lowerBetter: true },
    { key: 'totalTokens', label: 'Total Tokens', val: promptTotalTokens, fmt: p => fmtTokens(promptTotalTokens(p)), lowerBetter: true },
    { key: 'inputTokens', label: 'Input Tokens', val: p => p.inputTokens, fmt: p => fmtTokens(p.inputTokens), lowerBetter: true },
    { key: 'outputTokens', label: 'Output Tokens', val: p => p.outputTokens, fmt: p => fmtTokens(p.outputTokens), lowerBetter: true },
    { key: 'cacheRead', label: 'Cache Read', val: p => p.cacheReadTokens, fmt: p => fmtTokens(p.cacheReadTokens), lowerBetter: false },
    { key: 'cacheWrite', label: 'Cache Write', val: p => p.cacheCreationTokens, fmt: p => fmtTokens(p.cacheCreationTokens), lowerBetter: true },
    { key: 'cacheHitRate', label: 'Cache Hit Rate', val: p => p.cacheHitRate, fmt: p => fmtPct(p.cacheHitRate || 0), lowerBetter: false },
    { key: 'responseTime', label: 'Response Time', val: p => p.responseTimeMs || 0, fmt: p => p.responseTimeMs > 0 ? fmtDuration(p.responseTimeMs) : '—', lowerBetter: true },
    { key: 'toolCalls', label: 'Tool Calls', val: p => p.toolCalls, fmt: p => (p.toolCalls || 0).toString(), lowerBetter: true },
    { key: 'thinking', label: 'Thinking', val: p => p.hasThinking ? 1 : 0, fmt: p => p.hasThinking ? 'yes' : 'no', lowerBetter: null },
  ];
}

function getPcOrderedMetrics(state, allMetrics) {
  if (!state.pcMetricsOrder || state.pcMetricsOrder.length === 0) return allMetrics;
  const pos = new Map(state.pcMetricsOrder.map((k, i) => [k, i]));
  return [...allMetrics].sort((a, b) => {
    const ai = pos.has(a.key) ? pos.get(a.key) : 999;
    const bi = pos.has(b.key) ? pos.get(b.key) : 999;
    return ai - bi;
  });
}

function positionPcFieldsPanel(btn, panel) {
  const r = btn.getBoundingClientRect();
  panel.style.top  = `${r.bottom + 6}px`;
  panel.style.left = `${r.left}px`;
}

function buildPcFieldsPanel(panel, deps, allMetrics, rerender) {
  const { state, escHtml } = deps;
  const ordered = getPcOrderedMetrics(state, allMetrics);
  panel.innerHTML = `
    <div class="sc-fields-list">
      ${ordered.map(m => {
        const on = !state.pcHiddenMetrics.has(m.key);
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
      <button class="sc-fields-reset" id="pc-fields-reset">Reset defaults</button>
    </div>
  `;

  panel.querySelectorAll('[data-toggle]').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const key = btn.dataset.toggle;
      if (state.pcHiddenMetrics.has(key)) state.pcHiddenMetrics.delete(key);
      else state.pcHiddenMetrics.add(key);
      localStorage.setItem('pc-hidden-metrics', JSON.stringify([...state.pcHiddenMetrics]));
      const hc = state.pcHiddenMetrics.size, tc = allMetrics.length;
      const fb = document.getElementById('pc-fields-btn');
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
      buildPcFieldsPanel(panel, deps, allMetrics, rerender);
      rerender();
    });
  });

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
      const keys = getPcOrderedMetrics(state, allMetrics).map(m => m.key);
      const from = keys.indexOf(dragKey), to = keys.indexOf(item.dataset.key);
      if (from === -1 || to === -1) return;
      keys.splice(from, 1);
      keys.splice(to, 0, dragKey);
      state.pcMetricsOrder = keys;
      localStorage.setItem('pc-metrics-order', JSON.stringify(keys));
      buildPcFieldsPanel(panel, deps, allMetrics, rerender);
      rerender();
    });
  });

  document.getElementById('pc-fields-reset')?.addEventListener('click', e => {
    e.stopPropagation();
    state.pcMetricsOrder = null;
    state.pcHiddenMetrics.clear();
    localStorage.removeItem('pc-metrics-order');
    localStorage.removeItem('pc-hidden-metrics');
    const fb = document.getElementById('pc-fields-btn');
    if (fb) {
      fb.querySelector('.sc-fields-count')?.remove();
      fb.classList.remove('sc-fields-btn--filtered');
    }
    buildPcFieldsPanel(panel, deps, allMetrics, rerender);
    rerender();
  });
}

function renderPromptComparePage(deps) {
  const { state, escHtml, selected } = deps;
  const allMetrics = metricDefs(deps);
  const hiddenCount = state.pcHiddenMetrics.size;
  const totalCount  = allMetrics.length;
  const fieldCount  = hiddenCount > 0 ? ` <span class="sc-fields-count">${totalCount - hiddenCount}/${totalCount}</span>` : '';

  const content = document.getElementById('content');
  content.innerHTML = `
    <h1 class="page-title">Prompt Compare</h1>
    <p class="page-subtitle">Compare selected prompts and their responses across sessions</p>

    <div class="sc-toolbar">
      <div class="sc-dropdown" id="pc-fields-dropdown">
        <button class="sc-view-btn sc-fields-btn${hiddenCount > 0 ? ' sc-fields-btn--filtered' : ''}" id="pc-fields-btn">
          <svg width="13" height="13" viewBox="0 0 14 14" fill="none"><path d="M1 3h12M3 7h8M5 11h4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
          Fields${fieldCount} <span class="sc-dropdown-chevron">▾</span>
        </button>
      </div>

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

      ${state.pcView === 'card' ? `
        <button class="sc-present-btn${state.pcPresent ? ' sc-present-btn--on' : ''}" id="pc-present-toggle" ${!selected.length ? 'disabled' : ''}>
          <svg width="13" height="13" viewBox="0 0 14 14" fill="none"><circle cx="7" cy="7" r="5.5" stroke="currentColor" stroke-width="1.4"/><circle cx="7" cy="7" r="2" fill="currentColor"/></svg>
          ${state.pcPresent ? 'Exit Present' : 'Present'}
        </button>
      ` : ''}
    </div>

    <div id="prompt-comparison-result"></div>
  `;

  function reRenderResult() {
    const wrap = document.getElementById('prompt-comparison-result');
    if (!wrap) return;
    wrap.innerHTML = renderPromptCompareResult(deps);
    bindResultListeners(wrap, deps);
  }

  content.querySelectorAll('[data-pc-view]').forEach(btn => {
    btn.addEventListener('click', () => {
      state.pcView = btn.dataset.pcView;
      localStorage.setItem('pc-view', state.pcView);
      if (state.pcView === 'table') {
        state.pcPresent = false;
        state.pcRevealed.clear();
      }
      renderPromptComparePage(deps);
    });
  });

  content.querySelectorAll('[data-pc-order]').forEach(btn => {
    btn.addEventListener('click', () => {
      state.pcOrder = btn.dataset.pcOrder;
      localStorage.setItem('pc-order', state.pcOrder);
      state.pcRevealed.clear();
      reRenderResult();
    });
  });

  document.getElementById('pc-present-toggle')?.addEventListener('click', () => {
    state.pcPresent = !state.pcPresent;
    state.pcRevealed.clear();
    renderPromptComparePage(deps);
  });

  const fieldsBtn = document.getElementById('pc-fields-btn');
  if (fieldsBtn) {
    fieldsBtn.addEventListener('click', e => {
      e.stopPropagation();
      const existing = document.getElementById('pc-fields-panel');
      if (existing) {
        existing.remove();
        fieldsBtn.classList.remove('sc-fields-btn--open');
        return;
      }
      const panel = document.createElement('div');
      panel.id = 'pc-fields-panel';
      panel.className = 'sc-dropdown-panel';
      document.body.appendChild(panel);
      buildPcFieldsPanel(panel, deps, allMetrics, reRenderResult);
      positionPcFieldsPanel(fieldsBtn, panel);
      fieldsBtn.classList.add('sc-fields-btn--open');
    });
  }

  document.addEventListener('click', function closePcPanel(e) {
    const panel = document.getElementById('pc-fields-panel');
    if (!panel) { document.removeEventListener('click', closePcPanel); return; }
    if (!panel.contains(e.target) && e.target.id !== 'pc-fields-btn') {
      panel.remove();
      document.getElementById('pc-fields-btn')?.classList.remove('sc-fields-btn--open');
      document.removeEventListener('click', closePcPanel);
    }
  });

  reRenderResult();
}

function bindResultListeners(wrap, deps) {
  const { state } = deps;

  wrap.querySelectorAll('[data-remove-prompt]').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      removePrompt(deps, btn.dataset.removePrompt);
    });
  });

  wrap.querySelectorAll('[data-prompt-full]').forEach(btn => {
    btn.addEventListener('click', () => {
      document.getElementById('prompt-modal-body').textContent = btn.dataset.promptFull;
      document.getElementById('prompt-modal').hidden = false;
    });
  });

  if (state.pcPresent) {
    const cards = wrap.querySelectorAll('.sc-card--present');
    cards.forEach(card => {
      card.addEventListener('click', () => {
        const id = card.dataset.presentId;
        if (state.pcRevealed.has(id)) return;
        state.pcRevealed.add(id);
        const veil = card.querySelector('.sc-card-veil');
        if (veil) {
          card.classList.add('sc-card--revealed');
          veil.classList.add('sc-card-veil--out');
          veil.addEventListener('transitionend', () => {
            veil.remove();
            if (state.pcRevealed.size >= cards.length) {
              setTimeout(() => {
                state.pcPresent = false;
                state.pcRevealed.clear();
                renderPromptComparePage(deps);
              }, 600);
            }
          }, { once: true });
        }
      });
    });
  }
}

function renderPromptCompareResult(deps) {
  const { state, selected } = deps;
  if (!selected.length) {
    return `<div class="empty-state" style="margin-top:24px"><div class="empty-icon">≋</div><div class="empty-msg">Select prompts from Projects or Sessions to compare</div></div>`;
  }
  const allMetrics = metricDefs(deps);
  const metrics = getPcOrderedMetrics(state, allMetrics).filter(m => !state.pcHiddenMetrics.has(m.key));
  const ordered = state.pcOrder === 'ranked' && selected.length >= 2
    ? rankPrompts([...selected], metrics)
    : [...selected];

  if (state.pcPresent) {
    return renderPromptCards(deps, ordered, metrics);
  }

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
    const revealed = state.pcRevealed.has(p.id);
    const presentCls = state.pcPresent
      ? (revealed ? ' sc-card--present sc-card--revealed' : ' sc-card--present')
      : '';
    const tiles = metrics.map(m => {
      const score = scores.get(m.key);
      const v = m.val(p);
      let cls = '';
      if (score && v === score.bestV && score.bestV !== score.worstV) cls = 'sc-tile--best';
      else if (score && v === score.worstV && score.bestV !== score.worstV) cls = 'sc-tile--worst';
      return `<div class="sc-tile ${cls}"><div class="sc-tile-label">${escHtml(m.label)}</div><div class="sc-tile-value">${m.fmt(p)}</div></div>`;
    }).join('');

    return `
      <div class="sc-card${presentCls}" data-present-id="${escHtml(p.id)}">
        ${state.pcPresent && !revealed ? `<div class="sc-card-veil"><span class="sc-veil-label">Click to reveal</span></div>` : ''}
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
