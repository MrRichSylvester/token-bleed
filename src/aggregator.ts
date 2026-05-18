import type { AgentSource, Session, ProjectSummary, GlobalStats, DailyActivity, ModelStats, TokenUsage } from './types.js';
import { isLocalModel } from './pricing.js';

export type DurationMode = 'active' | 'wallclock';

function emptyUsage(): TokenUsage {
  return { inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0, cache5mTokens: 0, cache1hTokens: 0 };
}

function addUsage(acc: TokenUsage, s: TokenUsage): void {
  acc.inputTokens += s.inputTokens;
  acc.outputTokens += s.outputTokens;
  acc.cacheCreationTokens += s.cacheCreationTokens;
  acc.cacheReadTokens += s.cacheReadTokens;
  acc.cache5mTokens += s.cache5mTokens;
  acc.cache1hTokens += s.cache1hTokens;
}

function cacheHitRate(u: TokenUsage): number {
  const totalInput = u.inputTokens + u.cacheCreationTokens + u.cacheReadTokens;
  return totalInput > 0 ? u.cacheReadTokens / totalInput : 0;
}

function totalTokens(u: TokenUsage): number {
  return u.inputTokens + u.outputTokens + u.cacheCreationTokens + u.cacheReadTokens;
}

function localDateKey(iso: string): string {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return iso.slice(0, 10);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function sessionDuration(s: Session, mode: DurationMode): number {
  return mode === 'active' ? s.activeDuration : s.duration;
}

export type ProjectRollupMode = 'id' | 'name';

function normalizedProjectName(session: Session): string {
  return (session.projectName.trim() || session.projectPath.trim() || session.projectId).toLowerCase();
}

export function computeProjects(sessions: Session[], rollupMode: ProjectRollupMode = 'id'): ProjectSummary[] {
  const map = new Map<string, Session[]>();
  for (const s of sessions) {
    const key = rollupMode === 'name' ? normalizedProjectName(s) : s.projectId;
    const list = map.get(key) ?? [];
    list.push(s);
    map.set(key, list);
  }

  const projects: ProjectSummary[] = [];
  for (const [projectKey, pSessions] of map.entries()) {
    const usage = emptyUsage();
    let cost = 0;
    const modelCounts: Record<string, number> = {};
    const sourceCounts: Partial<Record<AgentSource, number>> = {};

    for (const s of pSessions) {
      addUsage(usage, s.usage);
      cost += s.cost;
      modelCounts[s.primaryModel] = (modelCounts[s.primaryModel] ?? 0) + 1;
      sourceCounts[s.source] = (sourceCounts[s.source] ?? 0) + 1;
    }

    const topModel = Object.entries(modelCounts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'unknown';
    const sources = (Object.entries(sourceCounts) as Array<[AgentSource, number]>)
      .filter(([, count]) => count > 0)
      .sort((a, b) => b[1] - a[1])
      .map(([source]) => source);
    const sortedSessions = [...pSessions].sort((a, b) => new Date(b.endTime).getTime() - new Date(a.endTime).getTime());
    const first = sortedSessions[0];
    const projectIds = [...new Set(pSessions.map((s) => s.projectId))];
    const projectPaths = [...new Set(pSessions.map((s) => s.projectPath).filter(Boolean))];
    const isNameRollup = rollupMode === 'name';

    projects.push({
      id: isNameRollup ? `name:${projectKey}` : projectKey,
      source: sources[0] ?? first?.source ?? 'claude',
      sources,
      projectIds,
      projectName: first?.projectName ?? projectKey,
      rollupMode,
      path: isNameRollup && projectPaths.length > 1 ? `${projectPaths.length} project paths` : first?.projectPath ?? projectKey,
      name: first?.projectName ?? projectKey,
      sessionCount: pSessions.length,
      totalCost: cost,
      totalTokens: totalTokens(usage),
      cacheHitRate: cacheHitRate(usage),
      topModel,
      lastActivity: first?.endTime ?? '',
      usage,
    });
  }

  return projects.sort((a, b) => new Date(b.lastActivity).getTime() - new Date(a.lastActivity).getTime());
}

export function computeStats(sessions: Session[], projects: ProjectSummary[]): GlobalStats {
  const usage = emptyUsage();
  let cost = 0;
  let messages = 0;
  let thinkingSessionCount = 0;
  const allModels = new Set<string>();
  const modelFreq: Record<string, number> = {};
  const entrypointCounts: Record<string, number> = {};

  for (const s of sessions) {
    addUsage(usage, s.usage);
    cost += s.cost;
    messages += s.messageCount;
    s.models.forEach((m) => allModels.add(m));
    modelFreq[s.primaryModel] = (modelFreq[s.primaryModel] ?? 0) + 1;
    if (s.entrypoint) entrypointCounts[s.entrypoint] = (entrypointCounts[s.entrypoint] ?? 0) + 1;
    if (s.thinkingBlocks > 0) thinkingSessionCount++;
  }

  const topModel = Object.entries(modelFreq).sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'unknown';

  return {
    totalCost: cost,
    totalSessions: sessions.length,
    totalMessages: messages,
    totalTokens: totalTokens(usage),
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    cacheCreationTokens: usage.cacheCreationTokens,
    cacheReadTokens: usage.cacheReadTokens,
    cacheHitRate: cacheHitRate(usage),
    topModel,
    modelsUsed: [...allModels],
    projectCount: projects.length,
    entrypointCounts,
    thinkingSessionCount,
  };
}

export function computeDaily(sessions: Session[]): DailyActivity[] {
  const map = new Map<string, DailyActivity>();
  for (const s of sessions) {
    const date = localDateKey(s.startTime);
    const entry = map.get(date) ?? {
      date,
      cost: 0,
      sessions: 0,
      messages: 0,
      tokens: 0,
      claudeCost: 0,
      codexCost: 0,
      opencodeCost: 0,
      claudeTokens: 0,
      codexTokens: 0,
      opencodeTokens: 0,
    };
    const tokens = totalTokens(s.usage);
    entry.cost += s.cost;
    entry.sessions += 1;
    entry.messages += s.messageCount;
    entry.tokens += tokens;
    if (s.source === 'claude') {
      entry.claudeCost += s.cost;
      entry.claudeTokens += tokens;
    } else if (s.source === 'codex') {
      entry.codexCost += s.cost;
      entry.codexTokens += tokens;
    } else if (s.source === 'opencode') {
      entry.opencodeCost += s.cost;
      entry.opencodeTokens += tokens;
    }
    map.set(date, entry);
  }
  return [...map.values()].sort((a, b) => a.date.localeCompare(b.date));
}

export function computeModelStats(sessions: Session[], durationMode: DurationMode = 'active'): ModelStats[] {
  const map = new Map<string, Session[]>();
  for (const s of sessions) {
    const list = map.get(s.primaryModel) ?? [];
    list.push(s);
    map.set(s.primaryModel, list);
  }

  const result: ModelStats[] = [];
  for (const [model, mSessions] of map.entries()) {
    const u = emptyUsage();
    let cost = 0;
    let msgs = 0;
    let tools = 0;
    let dur = 0;

    for (const s of mSessions) {
      addUsage(u, s.usage);
      cost += s.cost;
      msgs += s.messageCount;
      tools += s.toolCallCount;
      dur += sessionDuration(s, durationMode);
    }

    const count = mSessions.length;
    const tt = totalTokens(u);

    result.push({
      model,
      isLocal: isLocalModel(model),
      sessionCount: count,
      totalCost: cost,
      totalTokens: tt,
      inputTokens: u.inputTokens,
      outputTokens: u.outputTokens,
      cacheCreationTokens: u.cacheCreationTokens,
      cacheReadTokens: u.cacheReadTokens,
      cacheHitRate: cacheHitRate(u),
      avgCostPerSession: count > 0 ? cost / count : 0,
      avgTokensPerSession: count > 0 ? tt / count : 0,
      totalMessages: msgs,
      totalToolCalls: tools,
      avgDuration: count > 0 ? dur / count : 0,
    });
  }

  return result.sort((a, b) => b.sessionCount - a.sessionCount);
}

export function filterByDate(sessions: Session[], since: string | undefined): Session[] {
  if (!since) return sessions;
  const sinceMs = new Date(since).getTime();
  return sessions.filter((s) => new Date(s.startTime).getTime() >= sinceMs);
}
