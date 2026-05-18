import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import type { Session, SessionMessage, TokenUsage } from './types.js';

const OPENCODE_HOME = path.join(os.homedir(), '.local', 'share', 'opencode');
const OPENCODE_DB = path.join(OPENCODE_HOME, 'opencode.db');

type OpenCodeSessionRow = {
  id?: string;
  project_id?: string;
  parent_id?: string | null;
  title?: string;
  directory?: string;
  version?: string;
  time_created?: number;
  time_updated?: number;
  agent?: string;
  model?: string;
  cost?: number;
  tokens_input?: number;
  tokens_output?: number;
  tokens_reasoning?: number;
  tokens_cache_read?: number;
  tokens_cache_write?: number;
  project_worktree?: string;
  project_name?: string | null;
};

type OpenCodeMessageRow = {
  id?: string;
  session_id?: string;
  time_created?: number;
  time_updated?: number;
  data?: string;
};

type OpenCodePartRow = {
  id?: string;
  message_id?: string;
  session_id?: string;
  time_created?: number;
  time_updated?: number;
  data?: string;
};

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? value as Record<string, unknown> : {};
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function asNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function isoFromMs(value: unknown): string {
  const ms = asNumber(value);
  if (ms <= 0) return '';
  return new Date(ms).toISOString();
}

function elapsedMs(startIso: string, endIso: string): number {
  const start = new Date(startIso).getTime();
  const end = new Date(endIso).getTime();
  return Number.isFinite(start) && Number.isFinite(end) ? Math.max(0, end - start) : 0;
}

function sqliteLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function readSqliteJson<T>(sql: string): T[] {
  if (!fs.existsSync(OPENCODE_DB)) return [];
  const result = spawnSync('sqlite3', ['-json', OPENCODE_DB, sql], {
    encoding: 'utf8',
    timeout: 5000,
    maxBuffer: 20 * 1024 * 1024,
  });
  if (result.status !== 0 || !result.stdout.trim()) return [];
  try {
    return JSON.parse(result.stdout) as T[];
  } catch {
    return [];
  }
}

function parseJsonObject(raw: unknown): Record<string, unknown> {
  if (typeof raw !== 'string') return {};
  try {
    return asRecord(JSON.parse(raw));
  } catch {
    return {};
  }
}

function modelName(value: unknown): string {
  const parsed = typeof value === 'string' ? parseJsonObject(value) : asRecord(value);
  const id = asString(parsed.id) || asString(parsed.modelID);
  const provider = asString(parsed.providerID);
  if (provider === 'opencode' && id) return id;
  if (provider && id && !id.includes('/')) return `${provider}/${id}`;
  return id || asString(value) || 'unknown';
}

function modelNameFromMessage(data: Record<string, unknown>): string {
  const modelID = asString(data.modelID);
  const providerID = asString(data.providerID);
  if (providerID === 'opencode' && modelID) return modelID;
  if (providerID && modelID && !modelID.includes('/')) return `${providerID}/${modelID}`;
  const model = asRecord(data.model);
  const nestedModel = asString(model.modelID) || asString(model.id);
  const nestedProvider = asString(model.providerID);
  if (nestedProvider === 'opencode' && nestedModel) return nestedModel;
  if (nestedProvider && nestedModel && !nestedModel.includes('/')) return `${nestedProvider}/${nestedModel}`;
  return modelID || nestedModel || 'unknown';
}

function projectIdFromRow(row: OpenCodeSessionRow): string {
  return `opencode:${row.directory || row.project_worktree || row.project_id || 'unknown'}`;
}

function projectNameFromPath(projectPath: string): string {
  return projectPath.split('/').filter(Boolean).pop() || 'OpenCode';
}

function usageFromSession(row: OpenCodeSessionRow): TokenUsage {
  return {
    inputTokens: asNumber(row.tokens_input),
    outputTokens: asNumber(row.tokens_output) + asNumber(row.tokens_reasoning),
    cacheCreationTokens: asNumber(row.tokens_cache_write),
    cacheReadTokens: asNumber(row.tokens_cache_read),
    cache5mTokens: 0,
    cache1hTokens: 0,
  };
}

function usageFromMessage(data: Record<string, unknown>): TokenUsage {
  const tokens = asRecord(data.tokens);
  const cache = asRecord(tokens.cache);
  return {
    inputTokens: asNumber(tokens.input),
    outputTokens: asNumber(tokens.output) + asNumber(tokens.reasoning),
    cacheCreationTokens: asNumber(cache.write),
    cacheReadTokens: asNumber(cache.read),
    cache5mTokens: 0,
    cache1hTokens: 0,
  };
}

function addUsage(target: TokenUsage, usage: TokenUsage): void {
  target.inputTokens += usage.inputTokens;
  target.outputTokens += usage.outputTokens;
  target.cacheCreationTokens += usage.cacheCreationTokens;
  target.cacheReadTokens += usage.cacheReadTokens;
  target.cache5mTokens += usage.cache5mTokens;
  target.cache1hTokens += usage.cache1hTokens;
}

function totalInput(usage: TokenUsage): number {
  return usage.inputTokens + usage.cacheCreationTokens + usage.cacheReadTokens;
}

function textFromParts(parts: OpenCodePartRow[]): string {
  return parts
    .map((part) => {
      const data = parseJsonObject(part.data);
      return data.type === 'text' ? asString(data.text) : '';
    })
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function readSessionRows(): OpenCodeSessionRow[] {
  return readSqliteJson<OpenCodeSessionRow>(`
    select
      s.id, s.project_id, s.parent_id, s.title, s.directory, s.version,
      s.time_created, s.time_updated, s.agent, s.model, s.cost,
      s.tokens_input, s.tokens_output, s.tokens_reasoning,
      s.tokens_cache_read, s.tokens_cache_write,
      p.worktree as project_worktree, p.name as project_name
    from session s
    left join project p on p.id = s.project_id
    order by s.time_updated desc;
  `);
}

function readMessages(sessionId: string): OpenCodeMessageRow[] {
  return readSqliteJson<OpenCodeMessageRow>(`
    select id, session_id, time_created, time_updated, data
    from message
    where session_id = ${sqliteLiteral(sessionId)}
    order by time_created, id;
  `);
}

function readParts(sessionId: string): OpenCodePartRow[] {
  return readSqliteJson<OpenCodePartRow>(`
    select id, session_id, message_id, time_created, time_updated, data
    from part
    where session_id = ${sqliteLiteral(sessionId)}
    order by time_created, id;
  `);
}

function groupPartsByMessage(parts: OpenCodePartRow[]): Map<string, OpenCodePartRow[]> {
  const map = new Map<string, OpenCodePartRow[]>();
  for (const part of parts) {
    const messageId = asString(part.message_id);
    if (!messageId) continue;
    const list = map.get(messageId) ?? [];
    list.push(part);
    map.set(messageId, list);
  }
  return map;
}

function parseOpenCodeSessionRow(row: OpenCodeSessionRow): Session | null {
  const rawId = asString(row.id);
  if (!rawId) return null;

  const messages = readMessages(rawId);
  const parts = readParts(rawId);
  const partsByMessage = groupPartsByMessage(parts);
  const models = new Set<string>();
  let firstPrompt = '';
  let messageCount = 0;
  let toolCallCount = 0;
  let thinkingBlocks = 0;
  let activeDuration = 0;

  for (const message of messages) {
    const data = parseJsonObject(message.data);
    const role = asString(data.role);
    if (role === 'user') {
      messageCount++;
      if (!firstPrompt) firstPrompt = textFromParts(partsByMessage.get(asString(message.id)) ?? []).slice(0, 200);
    }
    if (role === 'assistant') {
      const model = modelNameFromMessage(data);
      if (model !== 'unknown') models.add(model);
      const time = asRecord(data.time);
      activeDuration += elapsedMs(isoFromMs(time.created ?? message.time_created), isoFromMs(time.completed ?? message.time_updated));
    }
  }

  for (const part of parts) {
    const data = parseJsonObject(part.data);
    if (data.type === 'tool') toolCallCount++;
    if (data.type === 'reasoning') thinkingBlocks++;
  }

  const primaryModel = modelName(row.model);
  if (primaryModel !== 'unknown') models.add(primaryModel);
  const usage = usageFromSession(row);
  const projectPath = asString(row.directory) || asString(row.project_worktree) || 'OpenCode';
  const startTime = isoFromMs(row.time_created);
  const endTime = isoFromMs(row.time_updated) || startTime;

  return {
    id: `opencode:${rawId}`,
    source: 'opencode',
    projectId: projectIdFromRow(row),
    projectName: asString(row.project_name) || projectNameFromPath(projectPath),
    projectPath,
    startTime,
    endTime,
    duration: elapsedMs(startTime, endTime),
    activeDuration,
    models: [...models],
    primaryModel,
    usage,
    cost: asNumber(row.cost),
    messageCount,
    toolCallCount,
    firstPrompt: firstPrompt || asString(row.title) || '(no prompt)',
    aiTitle: asString(row.title),
    cacheHitRate: totalInput(usage) > 0 ? usage.cacheReadTokens / totalInput(usage) : 0,
    entrypoint: asString(row.agent) ? `opencode-${row.agent}` : 'opencode',
    gitBranch: '',
    version: asString(row.version),
    permissionMode: '',
    thinkingBlocks,
  };
}

export function parseOpenCodeSessions(): Session[] {
  return readSessionRows()
    .map(parseOpenCodeSessionRow)
    .filter((session): session is Session => session !== null);
}

export function parseOpenCodeSessionMessages(sessionId: string): SessionMessage[] {
  const rawId = sessionId.startsWith('opencode:') ? sessionId.slice('opencode:'.length) : sessionId;
  const messages = readMessages(rawId);
  const parts = readParts(rawId);
  const partsByMessage = groupPartsByMessage(parts);
  const turns: SessionMessage[] = [];
  const pending = new Map<string, SessionMessage>();

  for (const message of messages) {
    const data = parseJsonObject(message.data);
    const role = asString(data.role);
    const id = asString(message.id);

    if (role === 'user') {
      const prompt = textFromParts(partsByMessage.get(id) ?? []);
      const turn: SessionMessage = {
        index: turns.length,
        timestamp: isoFromMs(message.time_created),
        prompt: (prompt || '(no prompt)').slice(0, 500),
        model: modelNameFromMessage(data),
        inputTokens: 0,
        outputTokens: 0,
        cacheCreationTokens: 0,
        cacheReadTokens: 0,
        cost: 0,
        toolCalls: 0,
        hasThinking: false,
        responseTimeMs: 0,
      };
      pending.set(id, turn);
      turns.push(turn);
      continue;
    }

    if (role !== 'assistant') continue;
    const parentId = asString(data.parentID);
    const turn = pending.get(parentId);
    if (!turn) continue;

    const usage = usageFromMessage(data);
    turn.model = modelNameFromMessage(data);
    turn.inputTokens += usage.inputTokens;
    turn.outputTokens += usage.outputTokens;
    turn.cacheCreationTokens += usage.cacheCreationTokens;
    turn.cacheReadTokens += usage.cacheReadTokens;
    turn.cost += asNumber(data.cost);

    const msgParts = partsByMessage.get(id) ?? [];
    turn.toolCalls += msgParts.filter((part) => parseJsonObject(part.data).type === 'tool').length;
    turn.hasThinking = turn.hasThinking || msgParts.some((part) => parseJsonObject(part.data).type === 'reasoning');

    const time = asRecord(data.time);
    const completed = isoFromMs(time.completed ?? message.time_updated);
    turn.responseTimeMs = Math.max(turn.responseTimeMs, elapsedMs(turn.timestamp, completed));
  }

  return turns;
}
