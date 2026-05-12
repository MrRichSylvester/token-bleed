import type { Session, Tip } from './types.js';
import { calculateCost } from './pricing.js';

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

function recentSessions(sessions: Session[]): Session[] {
  const cutoff = Date.now() - THIRTY_DAYS_MS;
  return sessions.filter((s) => new Date(s.startTime).getTime() >= cutoff);
}

function sonnetEquivalent(model: string): string {
  return model.includes('claude-3') ? 'claude-3-sonnet-20240229' : 'claude-sonnet-4-6';
}

export function computeTips(sessions: Session[]): Tip[] {
  const tips: Tip[] = [];
  const recent = recentSessions(sessions);
  if (recent.length === 0) return tips;

  // ── Cache hit rate ──────────────────────────────────────────
  let totalInput = 0;
  let totalCacheRead = 0;
  for (const s of recent) {
    totalInput += s.usage.inputTokens + s.usage.cacheCreationTokens + s.usage.cacheReadTokens;
    totalCacheRead += s.usage.cacheReadTokens;
  }
  const hitRate = totalInput > 0 ? totalCacheRead / totalInput : 0;

  if (totalInput > 50_000) {
    if (hitRate < 0.10) {
      tips.push({
        id: 'low-cache',
        severity: 'warn',
        title: 'Cache is barely being used',
        body: `Only ${(hitRate * 100).toFixed(1)}% of your input tokens were served from cache over the last 30 days. Repeating large context (system prompts, docs) across turns without caching burns full input rate every time.`,
      });
    } else if (hitRate < 0.40) {
      tips.push({
        id: 'low-cache',
        severity: 'info',
        title: 'Cache hit rate has room to improve',
        body: `Your cache hit rate is ${(hitRate * 100).toFixed(1)}% over the last 30 days. Keeping context stable between turns and using system prompts consistently will lower your effective cost per session.`,
      });
    } else if (hitRate >= 0.60) {
      tips.push({
        id: 'good-cache',
        severity: 'good',
        title: 'Cache discipline is solid',
        body: `${(hitRate * 100).toFixed(1)}% of your input tokens were served from cache over the last 30 days. That's meaningfully cutting your costs.`,
      });
    }
  }

  // ── Opus on short sessions ──────────────────────────────────
  const opusShort = recent.filter(
    (s) => s.primaryModel.includes('opus') && s.usage.outputTokens < 500,
  );
  if (opusShort.length >= 3) {
    let opusCost = 0;
    let sonnetCost = 0;
    for (const s of opusShort) {
      opusCost += s.cost;
      sonnetCost += calculateCost(sonnetEquivalent(s.primaryModel), s.usage);
    }
    const savings = opusCost - sonnetCost;
    const pct = opusCost > 0 ? Math.round((1 - sonnetCost / opusCost) * 100) : 0;
    tips.push({
      id: 'opus-short',
      severity: 'warn',
      title: `${opusShort.length} Opus sessions with short outputs`,
      body: `These sessions produced fewer than 500 output tokens on Opus. They'd cost ~${pct}% less on Sonnet. Potential 30-day savings: $${savings.toFixed(2)}.`,
      value: savings,
    });
  }

  // ── Overall Opus → Sonnet right-sizing ─────────────────────
  const opusSessions = recent.filter((s) => s.primaryModel.includes('opus'));
  if (opusSessions.length > 0) {
    let opusCost = 0;
    let sonnetCost = 0;
    for (const s of opusSessions) {
      opusCost += s.cost;
      sonnetCost += calculateCost(sonnetEquivalent(s.primaryModel), s.usage);
    }
    const savings = opusCost - sonnetCost;
    if (savings > 0.50) {
      tips.push({
        id: 'right-size-opus',
        severity: 'info',
        title: 'Right-sizing: Opus → Sonnet',
        body: `Your ${opusSessions.length} Opus sessions in the last 30 days cost $${opusCost.toFixed(2)}. Running the same workload on Sonnet would cost ~$${sonnetCost.toFixed(2)}, saving $${savings.toFixed(2)}.`,
        value: savings,
      });
    }
  }

  // ── No sessions (all local) ─────────────────────────────────
  const paidSessions = recent.filter((s) => s.cost > 0);
  if (paidSessions.length === 0 && recent.length > 0) {
    tips.push({
      id: 'all-local',
      severity: 'good',
      title: 'All sessions used local models',
      body: 'No API costs detected in the last 30 days. If you add pricing for your local models in Settings, Token Bleed can estimate their equivalent cost.',
    });
  }

  return tips;
}
