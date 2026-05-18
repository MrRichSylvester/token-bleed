import Fastify from 'fastify';
import FastifyStatic from '@fastify/static';
import FastifyCors from '@fastify/cors';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { exec, spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { getData, invalidateCache, parseSessionMessages } from './parser.js';
import { filterByDate, computeProjects, computeStats, computeDaily, computeModelStats, sessionDuration } from './aggregator.js';
import { PRICING, LEGACY_MODEL_KEYS, setCustomPricing } from './pricing.js';
import { computeTips } from './tips.js';
import type { AppSettings, PromptTurn, Session } from './types.js';
import {
  readProviders, writeProviders,
  readPid, writePid, clearPid, isProcessRunning,
  getActiveProvider, proxyStatus,
} from './providers.js';

const CLAUDE_SETTINGS_PATH = path.join(os.homedir(), '.claude', 'settings.json');
const CODEX_HOME = path.join(os.homedir(), '.codex');
const CODEX_CONFIG_PATH = path.join(CODEX_HOME, 'config.toml');
const CODEX_HISTORY_PATH = path.join(CODEX_HOME, 'history.jsonl');
const CODEX_SESSIONS_DIR = path.join(CODEX_HOME, 'sessions');
const APP_SETTINGS_PATH = path.join(os.homedir(), '.burn-rate-settings.json');

type CodexHistoryPersistence = 'save-all' | 'none';

interface CodexHistorySettings {
  persistence: CodexHistoryPersistence;
  maxBytes: number | null;
  historyBytes: number;
  sessionsBytes: number;
}

const DEFAULT_APP_SETTINGS: AppSettings = {
  plan: 'api',
  codexPlan: 'api',
  customPricing: {},
  durationMode: 'active',
  showNoPromptSessions: false,
};

function readClaudeSettings(): Record<string, unknown> {
  try {
    return JSON.parse(fs.readFileSync(CLAUDE_SETTINGS_PATH, 'utf-8'));
  } catch {
    return {};
  }
}

function readAppSettings(): AppSettings {
  try {
    const raw = JSON.parse(fs.readFileSync(APP_SETTINGS_PATH, 'utf-8'));
    return {
      plan: raw.plan ?? DEFAULT_APP_SETTINGS.plan,
      codexPlan: raw.codexPlan ?? DEFAULT_APP_SETTINGS.codexPlan,
      customPricing: raw.customPricing ?? {},
      durationMode: raw.durationMode ?? DEFAULT_APP_SETTINGS.durationMode,
      showNoPromptSessions: raw.showNoPromptSessions === true,
    };
  } catch {
    return { ...DEFAULT_APP_SETTINGS };
  }
}

function writeAppSettings(settings: AppSettings): void {
  fs.writeFileSync(APP_SETTINGS_PATH, JSON.stringify(settings, null, 2) + '\n');
}

function fileSize(filePath: string): number {
  try {
    return fs.statSync(filePath).size;
  } catch {
    return 0;
  }
}

function dirSize(dirPath: string): number {
  let total = 0;
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dirPath, { withFileTypes: true });
  } catch {
    return 0;
  }

  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) total += dirSize(fullPath);
    if (entry.isFile()) total += fileSize(fullPath);
  }
  return total;
}

function stripTomlComment(value: string): string {
  let inString = false;
  let escaped = false;
  for (let i = 0; i < value.length; i++) {
    const ch = value[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === '\\') {
      escaped = true;
      continue;
    }
    if (ch === '"') inString = !inString;
    if (ch === '#' && !inString) return value.slice(0, i).trim();
  }
  return value.trim();
}

function readCodexHistorySettings(): CodexHistorySettings {
  let persistence: CodexHistoryPersistence = 'save-all';
  let maxBytes: number | null = null;

  try {
    const lines = fs.readFileSync(CODEX_CONFIG_PATH, 'utf-8').split(/\r?\n/);
    const sectionStart = lines.findIndex((line) => /^\s*\[history\]\s*(#.*)?$/.test(line));
    if (sectionStart !== -1) {
      for (let i = sectionStart + 1; i < lines.length; i++) {
        const line = lines[i];
        if (/^\s*\[[^\]]+\]\s*(#.*)?$/.test(line)) break;
        const match = line.match(/^\s*([A-Za-z0-9_-]+)\s*=\s*(.+?)\s*$/);
        if (!match) continue;
        const [, key, rawValue] = match;
        const value = stripTomlComment(rawValue);
        if (key === 'persistence') {
          const parsed = value.replace(/^"|"$/g, '');
          if (parsed === 'save-all' || parsed === 'none') persistence = parsed;
        }
        if (key === 'max_bytes') {
          const parsed = Number(value);
          maxBytes = Number.isFinite(parsed) && parsed >= 0 ? Math.round(parsed) : null;
        }
      }
    }
  } catch {
    // Defaults match Codex when no config file or [history] section exists.
  }

  return {
    persistence,
    maxBytes,
    historyBytes: fileSize(CODEX_HISTORY_PATH),
    sessionsBytes: dirSize(CODEX_SESSIONS_DIR),
  };
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, '..', 'public');

const app = Fastify({ logger: false });

await app.register(FastifyCors, { origin: true });
await app.register(FastifyStatic, { root: PUBLIC_DIR, prefix: '/' });

function getSessions(since?: string, source?: string) {
  const { sessions } = getData();
  let filtered = filterByDate(sessions, since);
  if (source) {
    const sources = new Set(source.split(',').filter(Boolean));
    filtered = filtered.filter((s) => sources.has(s.source));
  }
  return filtered;
}

function isNoPromptSession(session: Session): boolean {
  return !session.aiTitle && session.firstPrompt.trim().toLowerCase() === '(no prompt)';
}

function promptTurnId(sessionId: string, index: number): string {
  return `${sessionId}::${index}`;
}

function parsePromptTurnId(id: string): { sessionId: string; index: number } | null {
  const sep = id.lastIndexOf('::');
  if (sep === -1) return null;
  const index = Number(id.slice(sep + 2));
  if (!Number.isInteger(index) || index < 0) return null;
  return { sessionId: id.slice(0, sep), index };
}

function promptTurnsForSession(session: Session): PromptTurn[] {
  return parseSessionMessages(session.id, session.projectId, session.source).map((message) => {
    const totalTokens = message.inputTokens + message.outputTokens + message.cacheCreationTokens + message.cacheReadTokens;
    const cacheDenom = message.inputTokens + message.cacheCreationTokens + message.cacheReadTokens;
    return {
      ...message,
      id: promptTurnId(session.id, message.index),
      sessionId: session.id,
      projectId: session.projectId,
      projectName: session.projectName,
      source: session.source,
      sessionStartTime: session.startTime,
      totalTokens,
      cacheHitRate: cacheDenom > 0 ? message.cacheReadTokens / cacheDenom : 0,
    };
  });
}

app.get('/api/refresh', async () => {
  invalidateCache();
  getData(true);
  return { ok: true };
});

app.get('/api/stats', async (req) => {
  const { since, source } = req.query as Record<string, string>;
  const sessions = getSessions(since, source);
  const projects = computeProjects(sessions);
  return computeStats(sessions, projects);
});

app.get('/api/daily', async (req) => {
  const { since, source } = req.query as Record<string, string>;
  return computeDaily(getSessions(since, source));
});

app.get('/api/projects', async (req) => {
  const { since, source, rollup } = req.query as Record<string, string>;
  return computeProjects(getSessions(since, source), rollup === 'name' ? 'name' : 'id');
});

app.get('/api/sessions', async (req) => {
  const query = req.query as Record<string, string>;
  const sessions = getSessions(query.since);
  const appSettings = readAppSettings();
  const durationMode = appSettings.durationMode;
  const includeNoPrompt = query.includeNoPrompt === undefined
    ? appSettings.showNoPromptSessions
    : query.includeNoPrompt === 'true';

  let filtered = sessions;
  if (!includeNoPrompt) filtered = filtered.filter((s) => !isNoPromptSession(s));
  if (query.source) {
    const sources = new Set(query.source.split(',').filter(Boolean));
    filtered = filtered.filter((s) => sources.has(s.source));
  }
  if (query.projectId) filtered = filtered.filter((s) => s.projectId === query.projectId);
  if (query.projectName) filtered = filtered.filter((s) => s.projectName.localeCompare(query.projectName, undefined, { sensitivity: 'base' }) === 0);
  if (query.model) filtered = filtered.filter((s) => s.primaryModel === query.model);

  const sort = query.sort ?? 'startTime';
  const dir = query.dir === 'asc' ? 1 : -1;
  const sortable = new Set([
    'startTime', 'projectName', 'prompt', 'source', 'primaryModel',
    'totalTokens', 'cost', 'cacheHitRate', 'messageCount', 'duration',
  ]);
  if (sortable.has(sort)) {
    const totalTokens = (s: typeof sessions[number]) =>
      s.usage.inputTokens + s.usage.outputTokens + s.usage.cacheCreationTokens + s.usage.cacheReadTokens;
    const value = (s: typeof sessions[number]): string | number => {
      switch (sort) {
        case 'projectName': return s.projectName;
        case 'prompt': return s.aiTitle || s.firstPrompt;
        case 'source': return s.source;
        case 'primaryModel': return s.primaryModel;
        case 'totalTokens': return totalTokens(s);
        case 'cost': return s.cost;
        case 'cacheHitRate': return s.cacheHitRate;
        case 'messageCount': return s.messageCount;
        case 'duration': return sessionDuration(s, durationMode);
        case 'startTime':
        default: return new Date(s.startTime).getTime();
      }
    };

    filtered = [...filtered].sort((a, b) => {
      const av = value(a);
      const bv = value(b);
      let cmp = typeof av === 'string' || typeof bv === 'string'
        ? String(av).localeCompare(String(bv), undefined, { sensitivity: 'base' })
        : Number(av) - Number(bv);
      if (cmp === 0) cmp = new Date(a.startTime).getTime() - new Date(b.startTime).getTime();
      return cmp * dir;
    });
  }

  const limit = Math.min(parseInt(query.limit ?? '100', 10), 500);
  const offset = parseInt(query.offset ?? '0', 10);

  return { sessions: filtered.slice(offset, offset + limit), total: filtered.length, limit, offset };
});

app.get('/api/sessions/:id', async (req, reply) => {
  const { id } = req.params as { id: string };
  const { sessions } = getData();
  const session = sessions.find((s) => s.id === id);
  if (!session) { reply.status(404); return { error: 'Session not found' }; }
  return session;
});

app.get('/api/sessions/:id/messages', async (req, reply) => {
  const { id } = req.params as { id: string };
  const { sessions } = getData();
  const session = sessions.find((s) => s.id === id);
  if (!session) { reply.status(404); return { error: 'Session not found' }; }
  return parseSessionMessages(id, session.projectId, session.source);
});

app.get('/api/prompts', async (req) => {
  const query = req.query as Record<string, string>;
  const { sessions } = getData();
  const sessionMap = new Map(sessions.map((s) => [s.id, s]));

  if (query.ids) {
    const turns: PromptTurn[] = [];
    for (const id of query.ids.split(',').filter(Boolean)) {
      const parsed = parsePromptTurnId(id);
      if (!parsed) continue;
      const session = sessionMap.get(parsed.sessionId);
      if (!session) continue;
      const turn = promptTurnsForSession(session).find((m) => m.index === parsed.index);
      if (turn) turns.push(turn);
    }
    return { prompts: turns };
  }

  let filtered = getSessions(query.since, query.source);
  if (query.projectId) filtered = filtered.filter((s) => s.projectId === query.projectId);
  if (query.sessionId) filtered = filtered.filter((s) => s.id === query.sessionId);
  return { prompts: filtered.flatMap(promptTurnsForSession) };
});

app.get('/api/models', async (req) => {
  const { since, source } = req.query as Record<string, string>;
  return computeModelStats(getSessions(since, source), readAppSettings().durationMode);
});

app.get('/api/meta', async () => {
  const { sessions } = getData();
  const sorted = [...sessions].sort((a, b) => a.startTime.localeCompare(b.startTime));
  const earliestDate = sorted.length > 0 ? sorted[0].startTime.slice(0, 10) : null;
  const latestDate = sorted.length > 0 ? sorted[sorted.length - 1].startTime.slice(0, 10) : null;
  const settings = readClaudeSettings();
  const cleanupPeriodDays = typeof settings.cleanupPeriodDays === 'number' ? settings.cleanupPeriodDays : 30;
  return { earliestDate, latestDate, cleanupPeriodDays, codexHistory: readCodexHistorySettings() };
});

app.post('/api/settings', async (req, reply) => {
  const body = req.body as Record<string, unknown>;
  const raw = Number(body.cleanupPeriodDays);
  if (!Number.isFinite(raw)) { reply.status(400); return { error: 'cleanupPeriodDays must be a number' }; }
  const corrected = raw === 0;
  const value = Math.max(1, Math.round(raw));
  const existing = readClaudeSettings();
  existing.cleanupPeriodDays = value;
  fs.writeFileSync(CLAUDE_SETTINGS_PATH, JSON.stringify(existing, null, 2) + '\n');
  return { ok: true, cleanupPeriodDays: value, corrected };
});

app.get('/api/app-settings', async () => {
  const appSettings = readAppSettings();
  const { sessions } = getData();

  // Collect all model names seen in sessions
  const detectedModels = new Set<string>();
  for (const s of sessions) {
    s.models.forEach((m) => detectedModels.add(m));
  }

  return {
    plan: appSettings.plan,
    codexPlan: appSettings.codexPlan,
    customPricing: appSettings.customPricing,
    durationMode: appSettings.durationMode,
    showNoPromptSessions: appSettings.showNoPromptSessions,
    builtinPricing: PRICING,
    detectedModels: [...detectedModels].sort(),
    legacyModelKeys: [...LEGACY_MODEL_KEYS],
  };
});

app.post('/api/app-settings', async (req, reply) => {
  const body = req.body as Record<string, unknown>;
  const current = readAppSettings();

  const validPlans = ['api', 'pro', 'max', 'max5x', 'max20x'];
  if (body.plan !== undefined) {
    if (!validPlans.includes(body.plan as string)) {
      reply.status(400); return { error: 'Invalid plan' };
    }
    current.plan = body.plan as AppSettings['plan'];
  }

  const validCodexPlans = ['api', 'go', 'plus', 'pro'];
  if (body.codexPlan !== undefined) {
    if (!validCodexPlans.includes(body.codexPlan as string)) {
      reply.status(400); return { error: 'Invalid codexPlan' };
    }
    current.codexPlan = body.codexPlan as AppSettings['codexPlan'];
  }

  if (body.durationMode !== undefined) {
    if (body.durationMode !== 'wallclock' && body.durationMode !== 'active') {
      reply.status(400); return { error: 'Invalid durationMode' };
    }
    current.durationMode = body.durationMode as AppSettings['durationMode'];
  }

  if (body.showNoPromptSessions !== undefined) {
    if (typeof body.showNoPromptSessions !== 'boolean') {
      reply.status(400); return { error: 'showNoPromptSessions must be a boolean' };
    }
    current.showNoPromptSessions = body.showNoPromptSessions;
  }

  if (body.customPricing !== undefined) {
    if (typeof body.customPricing !== 'object' || body.customPricing === null) {
      reply.status(400); return { error: 'customPricing must be an object' };
    }
    // Validate each entry has numeric price fields
    const cp = body.customPricing as Record<string, unknown>;
    for (const [model, pricing] of Object.entries(cp)) {
      if (typeof pricing !== 'object' || pricing === null) {
        reply.status(400); return { error: `Invalid pricing for model ${model}` };
      }
      const p = pricing as Record<string, unknown>;
      for (const field of ['input', 'output', 'cacheWrite', 'cacheRead']) {
        if (typeof p[field] !== 'number' || !Number.isFinite(p[field] as number) || (p[field] as number) < 0) {
          reply.status(400); return { error: `${field} for ${model} must be a non-negative number` };
        }
      }
    }
    current.customPricing = cp as AppSettings['customPricing'];
    setCustomPricing(current.customPricing);
    invalidateCache();
  }

  writeAppSettings(current);
  return { ok: true, settings: current };
});

app.get('/api/tips', async (req) => {
  const { since } = req.query as Record<string, string>;
  return computeTips(getSessions(since));
});

app.get('/api/export/sessions.csv', async (req, reply) => {
  const { since } = req.query as Record<string, string>;
  const sessions = getSessions(since);
  const durationMode = readAppSettings().durationMode;

  const headers = [
    'id', 'source', 'project', 'date', 'model', 'cost',
    'input_tokens', 'output_tokens', 'cache_read_tokens', 'cache_creation_tokens',
    'cache_hit_rate', 'duration_mode', 'duration_ms', 'messages', 'tool_calls',
  ];

  function csvVal(v: string | number): string {
    if (typeof v === 'string' && (v.includes(',') || v.includes('"') || v.includes('\n'))) {
      return `"${v.replace(/"/g, '""')}"`;
    }
    return String(v);
  }

  const rows = sessions.map((s) =>
    [
      s.id, s.source, s.projectName, s.startTime.slice(0, 10), s.primaryModel,
      s.cost.toFixed(6), s.usage.inputTokens, s.usage.outputTokens,
      s.usage.cacheReadTokens, s.usage.cacheCreationTokens,
      s.cacheHitRate.toFixed(4), durationMode, sessionDuration(s, durationMode), s.messageCount, s.toolCallCount,
    ].map(csvVal).join(','),
  );

  reply.header('Content-Type', 'text/csv; charset=utf-8');
  reply.header('Content-Disposition', 'attachment; filename="token-bleed-sessions.csv"');
  return [headers.join(','), ...rows].join('\n');
});

app.get('/api/models/comparison', async (req) => {
  const query = req.query as Record<string, string>;
  const modelStats = computeModelStats(getSessions(query.since));

  if (query.model1 && query.model2) {
    return {
      model1: modelStats.find((m) => m.model === query.model1) ?? null,
      model2: modelStats.find((m) => m.model === query.model2) ?? null,
    };
  }

  const top2 = modelStats.slice(0, 2);
  return { model1: top2[0] ?? null, model2: top2[1] ?? null };
});

// ── Provider helpers ────────────────────────────────────────────

const spawnedProxies = new Map<string, ChildProcess>();

function execPromise(cmd: string): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    exec(cmd, (err, stdout, stderr) => {
      if (err) reject(Object.assign(err, { stdout, stderr }));
      else resolve({ stdout, stderr });
    });
  });
}

async function checkOllamaReachable(): Promise<boolean> {
  try {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 1500);
    const res = await fetch('http://localhost:11434', { signal: controller.signal });
    clearTimeout(t);
    return res.status < 500;
  } catch {
    return false;
  }
}

// ── Provider API routes ─────────────────────────────────────────

app.get('/api/providers', async () => {
  const configs = readProviders();
  const ollamaReachable = configs.ollama.configured ? await checkOllamaReachable() : false;

  return {
    providers: {
      claude: { status: 'connected' },
      openai: {
        status: proxyStatus('openai'),
        configured: configs.openai.configured,
      },
      gemini: {
        status: proxyStatus('gemini'),
        configured: configs.gemini.configured,
      },
      ollama: {
        status: configs.ollama.configured
          ? (ollamaReachable ? 'connected' : 'stopped')
          : 'not-configured',
        configured: configs.ollama.configured,
        model: configs.ollama.model ?? null,
      },
    },
    activeProvider: getActiveProvider(),
  };
});

app.post('/api/providers/check', async (req, reply) => {
  const { check } = req.body as { check: string };

  if (check === 'python') {
    try {
      const { stdout } = await execPromise('python3 --version');
      const version = stdout.trim().replace('Python ', '') || '3.x';
      return { found: true, version };
    } catch {
      return { found: false };
    }
  }

  if (check === 'litellm') {
    try {
      const { stdout } = await execPromise('pip3 show litellm');
      const match = stdout.match(/^Version:\s*(.+)/m);
      return { found: true, version: match?.[1]?.trim() ?? 'unknown' };
    } catch {
      return { found: false };
    }
  }

  if (check === 'ollama') {
    try {
      const { stdout } = await execPromise('ollama --version');
      const version = stdout.trim().replace(/^ollama version /i, '');
      return { found: true, version };
    } catch {
      return { found: false };
    }
  }

  reply.status(400);
  return { error: 'Unknown check' };
});

app.get('/api/providers/install-litellm', (req, reply) => {
  reply.hijack();
  const raw = reply.raw;
  raw.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  });

  const child = spawn('pip3', ['install', 'litellm'], { shell: false });
  const send = (data: object) => raw.write(`data: ${JSON.stringify(data)}\n\n`);

  child.stdout.on('data', (chunk: Buffer) => send({ line: chunk.toString() }));
  child.stderr.on('data', (chunk: Buffer) => send({ line: chunk.toString() }));
  child.on('close', (code: number | null) => {
    send({ done: true, success: code === 0 });
    raw.end();
  });
  req.raw.on('close', () => child.kill());
});

app.post('/api/providers/save-key', async (req, reply) => {
  const { provider, key } = req.body as { provider: string; key: string };
  if (!['openai', 'gemini'].includes(provider) || !key) {
    reply.status(400); return { error: 'Invalid request' };
  }
  const configs = readProviders();
  configs[provider as 'openai' | 'gemini'].key = Buffer.from(key).toString('base64');
  writeProviders(configs);
  return { ok: true };
});

const PROXY_CONFIGS: Record<string, { model: string; port: number; apiKey: string }> = {
  openai: { model: 'gpt-4o', port: 4001, apiKey: 'token-bleed-proxy' },
  gemini: { model: 'gemini/gemini-2.0-flash', port: 4002, apiKey: 'token-bleed-proxy' },
};

app.post('/api/providers/start-proxy', async (req, reply) => {
  const { provider } = req.body as { provider: string };
  const cfg = PROXY_CONFIGS[provider];
  if (!cfg) { reply.status(400); return { error: 'Unknown provider' }; }

  const existing = spawnedProxies.get(provider);
  if (existing) { try { existing.kill(); } catch { /* ignore */ } }

  const providers = readProviders();
  const encodedKey = providers[provider as 'openai' | 'gemini']?.key;
  if (!encodedKey) { reply.status(400); return { error: 'No API key saved' }; }
  const apiKey = Buffer.from(encodedKey, 'base64').toString('utf-8');

  const child = spawn('litellm', [
    '--model', cfg.model,
    '--api_key', apiKey,
    '--port', String(cfg.port),
  ], { shell: false, detached: false });

  spawnedProxies.set(provider, child);
  writePid(provider, child.pid!);

  child.on('exit', () => {
    spawnedProxies.delete(provider);
  });

  return { ok: true, pid: child.pid };
});

app.get('/api/providers/proxy-health', async (req) => {
  const { port } = req.query as { port: string };
  const portNum = parseInt(port, 10);
  if (!portNum) return { ok: false };
  try {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 2000);
    const res = await fetch(`http://localhost:${portNum}/health`, { signal: controller.signal });
    clearTimeout(t);
    return { ok: res.ok || res.status < 500 };
  } catch {
    return { ok: false };
  }
});

app.post('/api/providers/mark-configured', async (req, reply) => {
  const { provider, model } = req.body as { provider: string; model?: string };
  if (!['openai', 'gemini', 'ollama'].includes(provider)) {
    reply.status(400); return { error: 'Unknown provider' };
  }
  const configs = readProviders();
  configs[provider as 'openai' | 'gemini' | 'ollama'].configured = true;
  if (model) configs[provider as 'openai' | 'gemini' | 'ollama'].model = model;
  writeProviders(configs);
  return { ok: true };
});

app.post('/api/providers/stop-proxy', async (req) => {
  const { provider } = req.body as { provider: string };
  const child = spawnedProxies.get(provider);
  if (child) { try { child.kill(); } catch { /* ignore */ } spawnedProxies.delete(provider); }
  const pid = readPid(provider);
  if (pid && isProcessRunning(pid)) { try { process.kill(pid, 'SIGTERM'); } catch { /* ignore */ } }
  clearPid(provider);
  return { ok: true };
});

app.post('/api/providers/restart-proxy', async (req, reply) => {
  const { provider } = req.body as { provider: string };
  const cfg = PROXY_CONFIGS[provider];
  if (!cfg) { reply.status(400); return { error: 'Unknown provider' }; }

  const child = spawnedProxies.get(provider);
  if (child) { try { child.kill(); } catch { /* ignore */ } }
  const pid = readPid(provider);
  if (pid && isProcessRunning(pid)) { try { process.kill(pid, 'SIGTERM'); } catch { /* ignore */ } }

  const providers = readProviders();
  const encodedKey = providers[provider as 'openai' | 'gemini']?.key;
  if (!encodedKey) { reply.status(400); return { error: 'No API key saved' }; }
  const apiKey = Buffer.from(encodedKey, 'base64').toString('utf-8');

  const newChild = spawn('litellm', [
    '--model', cfg.model,
    '--api_key', apiKey,
    '--port', String(cfg.port),
  ], { shell: false, detached: false });

  spawnedProxies.set(provider, newChild);
  writePid(provider, newChild.pid!);
  newChild.on('exit', () => spawnedProxies.delete(provider));

  return { ok: true, pid: newChild.pid };
});

app.get('/api/providers/ollama-models', async () => {
  try {
    const { stdout } = await execPromise('ollama list');
    const lines = stdout.trim().split('\n').slice(1);
    const models = lines
      .map(line => line.trim().split(/\s+/)[0])
      .filter(Boolean)
      .map(name => ({ name }));
    return { models };
  } catch {
    return { models: [] };
  }
});

app.get('/api/open-file', async () => {
  const CLAUDE_SETTINGS = path.join(os.homedir(), '.claude', 'settings.json');
  if (!fs.existsSync(CLAUDE_SETTINGS)) {
    fs.writeFileSync(CLAUDE_SETTINGS, '{}\n');
  }
  exec(`open "${CLAUDE_SETTINGS}"`);
  return { ok: true };
});

// ── Shutdown cleanup ────────────────────────────────────────────

function cleanupProxies() {
  for (const [provider, child] of spawnedProxies) {
    try { child.kill(); } catch { /* ignore */ }
    clearPid(provider);
  }
  spawnedProxies.clear();
  for (const provider of ['openai', 'gemini']) {
    const pid = readPid(provider);
    if (pid && isProcessRunning(pid)) {
      try { process.kill(pid, 'SIGTERM'); } catch { /* ignore */ }
    }
    clearPid(provider);
  }
}

process.on('SIGINT', () => { cleanupProxies(); process.exit(0); });
process.on('SIGTERM', () => { cleanupProxies(); process.exit(0); });

// ── Server startup ──────────────────────────────────────────────

const PORT = parseInt(process.env.PORT ?? '3000', 10);
const HOST = process.env.HOST ?? '127.0.0.1';

// Load custom pricing from saved settings before first parse
const initialSettings = readAppSettings();
if (Object.keys(initialSettings.customPricing).length > 0) {
  setCustomPricing(initialSettings.customPricing);
}

try {
  await app.listen({ port: PORT, host: HOST });
  console.log(`token-bleed running at http://${HOST}:${PORT}`);
  getData();
} catch (err) {
  console.error(err);
  process.exit(1);
}
