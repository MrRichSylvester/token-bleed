import Fastify from 'fastify';
import FastifyStatic from '@fastify/static';
import FastifyCors from '@fastify/cors';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { getData, invalidateCache, parseSessionMessages } from './parser.js';
import { filterByDate, computeProjects, computeStats, computeDaily, computeModelStats } from './aggregator.js';
import { PRICING, setCustomPricing } from './pricing.js';
import { computeTips } from './tips.js';
import type { AppSettings } from './types.js';

const CLAUDE_SETTINGS_PATH = path.join(os.homedir(), '.claude', 'settings.json');
const APP_SETTINGS_PATH = path.join(os.homedir(), '.burn-rate-settings.json');

const DEFAULT_APP_SETTINGS: AppSettings = {
  plan: 'api',
  customPricing: {},
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
      customPricing: raw.customPricing ?? {},
    };
  } catch {
    return { ...DEFAULT_APP_SETTINGS };
  }
}

function writeAppSettings(settings: AppSettings): void {
  fs.writeFileSync(APP_SETTINGS_PATH, JSON.stringify(settings, null, 2) + '\n');
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, '..', 'public');

const app = Fastify({ logger: false });

await app.register(FastifyCors, { origin: true });
await app.register(FastifyStatic, { root: PUBLIC_DIR, prefix: '/' });

function getSessions(since?: string) {
  const { sessions } = getData();
  return filterByDate(sessions, since);
}

app.get('/api/refresh', async () => {
  invalidateCache();
  getData(true);
  return { ok: true };
});

app.get('/api/stats', async (req) => {
  const { since } = req.query as Record<string, string>;
  const sessions = getSessions(since);
  const projects = computeProjects(sessions);
  return computeStats(sessions, projects);
});

app.get('/api/daily', async (req) => {
  const { since } = req.query as Record<string, string>;
  return computeDaily(getSessions(since));
});

app.get('/api/projects', async (req) => {
  const { since } = req.query as Record<string, string>;
  return computeProjects(getSessions(since));
});

app.get('/api/sessions', async (req) => {
  const query = req.query as Record<string, string>;
  const sessions = getSessions(query.since);

  let filtered = sessions;
  if (query.projectId) filtered = filtered.filter((s) => s.projectId === query.projectId);
  if (query.model) filtered = filtered.filter((s) => s.primaryModel === query.model);

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
  return parseSessionMessages(id, session.projectId);
});

app.get('/api/models', async (req) => {
  const { since } = req.query as Record<string, string>;
  return computeModelStats(getSessions(since));
});

app.get('/api/meta', async () => {
  const { sessions } = getData();
  const sorted = [...sessions].sort((a, b) => a.startTime.localeCompare(b.startTime));
  const earliestDate = sorted.length > 0 ? sorted[0].startTime.slice(0, 10) : null;
  const latestDate = sorted.length > 0 ? sorted[sorted.length - 1].startTime.slice(0, 10) : null;
  const settings = readClaudeSettings();
  const cleanupPeriodDays = typeof settings.cleanupPeriodDays === 'number' ? settings.cleanupPeriodDays : 30;
  return { earliestDate, latestDate, cleanupPeriodDays };
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
    customPricing: appSettings.customPricing,
    builtinPricing: PRICING,
    detectedModels: [...detectedModels].sort(),
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

  const headers = [
    'id', 'project', 'date', 'model', 'cost',
    'input_tokens', 'output_tokens', 'cache_read_tokens', 'cache_creation_tokens',
    'cache_hit_rate', 'duration_ms', 'messages', 'tool_calls',
  ];

  function csvVal(v: string | number): string {
    if (typeof v === 'string' && (v.includes(',') || v.includes('"') || v.includes('\n'))) {
      return `"${v.replace(/"/g, '""')}"`;
    }
    return String(v);
  }

  const rows = sessions.map((s) =>
    [
      s.id, s.projectName, s.startTime.slice(0, 10), s.primaryModel,
      s.cost.toFixed(6), s.usage.inputTokens, s.usage.outputTokens,
      s.usage.cacheReadTokens, s.usage.cacheCreationTokens,
      s.cacheHitRate.toFixed(4), s.duration, s.messageCount, s.toolCallCount,
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

const PORT = parseInt(process.env.PORT ?? '3000', 10);
const HOST = process.env.HOST ?? '127.0.0.1';

// Load custom pricing from saved settings before first parse
const initialSettings = readAppSettings();
if (Object.keys(initialSettings.customPricing).length > 0) {
  setCustomPricing(initialSettings.customPricing);
}

try {
  await app.listen({ port: PORT, host: HOST });
  console.log(`burn-rate running at http://${HOST}:${PORT}`);
  getData();
} catch (err) {
  console.error(err);
  process.exit(1);
}
