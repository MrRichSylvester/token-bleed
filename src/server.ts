import Fastify from 'fastify';
import FastifyStatic from '@fastify/static';
import FastifyCors from '@fastify/cors';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { getData, invalidateCache, parseSessionMessages } from './parser.js';
import { filterByDate, computeProjects, computeStats, computeDaily, computeModelStats } from './aggregator.js';

const CLAUDE_SETTINGS_PATH = path.join(os.homedir(), '.claude', 'settings.json');

function readClaudeSettings(): Record<string, unknown> {
  try {
    return JSON.parse(fs.readFileSync(CLAUDE_SETTINGS_PATH, 'utf-8'));
  } catch {
    return {};
  }
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

try {
  await app.listen({ port: PORT, host: HOST });
  console.log(`burn-rate running at http://${HOST}:${PORT}`);
  getData();
} catch (err) {
  console.error(err);
  process.exit(1);
}
