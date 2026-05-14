import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import type { Session, SessionMessage, TokenUsage } from './types.js';
import { calculateCost } from './pricing.js';

const CODEX_HOME = path.join(os.homedir(), '.codex');
const CODEX_SESSIONS_DIR = path.join(CODEX_HOME, 'sessions');
const CODEX_SESSION_INDEX = path.join(CODEX_HOME, 'session_index.jsonl');

interface CodexEntry {
  timestamp?: string;
  type?: string;
  payload?: unknown;
}

interface CodexTokenUsage {
  input_tokens?: number;
  cached_input_tokens?: number;
  output_tokens?: number;
  reasoning_output_tokens?: number;
  total_tokens?: number;
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? value as Record<string, unknown> : {};
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function asNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function elapsedMs(startIso: string, endIso: string): number {
  const start = new Date(startIso).getTime();
  const end = new Date(endIso).getTime();
  return Number.isFinite(start) && Number.isFinite(end) ? Math.max(0, end - start) : 0;
}

function isTurnSetupEntry(entry: CodexEntry, payload: Record<string, unknown>): boolean {
  if (entry.type === 'turn_context') return true;
  if (entry.type === 'event_msg' && payload.type === 'task_started') return true;
  if (entry.type === 'response_item' && payload.type === 'message') {
    const role = asString(payload.role);
    return role === 'user' || role === 'developer' || role === 'system';
  }
  return false;
}

function isTurnActivityEntry(entry: CodexEntry, payload: Record<string, unknown>): boolean {
  if (entry.type !== 'event_msg' && entry.type !== 'response_item') return false;
  if (entry.type === 'event_msg' && payload.type === 'user_message') return false;
  return !isTurnSetupEntry(entry, payload);
}

function parseJsonLine(line: string): CodexEntry | null {
  try {
    return JSON.parse(line) as CodexEntry;
  } catch {
    return null;
  }
}

function readLines(filePath: string): string[] {
  try {
    return fs.readFileSync(filePath, 'utf-8').split('\n').filter(Boolean);
  } catch {
    return [];
  }
}

function findJsonlFiles(dir: string): string[] {
  let files: string[] = [];
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return files;
  }

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files = files.concat(findJsonlFiles(fullPath));
    } else if (entry.isFile() && entry.name.endsWith('.jsonl')) {
      files.push(fullPath);
    }
  }
  return files;
}

function readThreadTitles(): Map<string, string> {
  const titles = new Map<string, string>();
  for (const line of readLines(CODEX_SESSION_INDEX)) {
    const entry = parseJsonLine(line);
    const payload = asRecord(entry);
    const id = asString(payload.id);
    const title = asString(payload.thread_name);
    if (id && title) titles.set(id, title);
  }
  return titles;
}

function projectIdFromPath(projectPath: string): string {
  return `codex:${projectPath.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'unknown'}`;
}

function projectNameFromPath(projectPath: string): string {
  return projectPath.split('/').filter(Boolean).pop() || 'Codex';
}

function extractMessageText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map((part) => {
      if (typeof part === 'string') return part;
      const obj = asRecord(part);
      return asString(obj.text);
    })
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenUsageFromCodex(raw: CodexTokenUsage | undefined): TokenUsage {
  const input = asNumber(raw?.input_tokens);
  const cached = asNumber(raw?.cached_input_tokens);
  const output = asNumber(raw?.output_tokens);
  return {
    inputTokens: Math.max(0, input - cached),
    outputTokens: output,
    cacheCreationTokens: 0,
    cacheReadTokens: cached,
    cache5mTokens: 0,
    cache1hTokens: 0,
  };
}

function getTokenUsagePayload(payload: unknown): CodexTokenUsage | undefined {
  const info = asRecord(asRecord(payload).info);
  const total = asRecord(info.total_token_usage);
  if (Object.keys(total).length > 0) return total as CodexTokenUsage;
  const last = asRecord(info.last_token_usage);
  return Object.keys(last).length > 0 ? last as CodexTokenUsage : undefined;
}

function getLastTokenUsagePayload(payload: unknown): CodexTokenUsage | undefined {
  const info = asRecord(asRecord(payload).info);
  const last = asRecord(info.last_token_usage);
  return Object.keys(last).length > 0 ? last as CodexTokenUsage : undefined;
}

function rawIdFromFile(filePath: string): string {
  const base = path.basename(filePath, '.jsonl');
  const match = base.match(/(019[a-z0-9-]+)$/i);
  return match?.[1] ?? base;
}

function parseCodexSessionFile(filePath: string, titles: Map<string, string>): Session | null {
  const lines = readLines(filePath);
  if (lines.length === 0) return null;

  let rawId = rawIdFromFile(filePath);
  let startTime = '';
  let endTime = '';
  let projectPath = '';
  let entrypoint = 'codex';
  let version = '';
  let gitBranch = '';
  let primaryModel = '';
  let firstPrompt = '';
  let messageCount = 0;
  let assistantMessages = 0;
  let toolCallCount = 0;
  let thinkingBlocks = 0;
  let activeDuration = 0;
  let pendingUserTs = '';
  let lastTurnActivityTs = '';
  let usage: TokenUsage = tokenUsageFromCodex(undefined);

  function flushActiveTurn(): void {
    if (!pendingUserTs || !lastTurnActivityTs) return;
    const turnMs = elapsedMs(pendingUserTs, lastTurnActivityTs);
    if (turnMs > 0) activeDuration += turnMs;
  }

  for (const line of lines) {
    const entry = parseJsonLine(line);
    if (!entry) continue;

    if (!startTime && entry.timestamp) startTime = entry.timestamp;
    if (entry.timestamp) endTime = entry.timestamp;

    const payload = asRecord(entry.payload);
    if (entry.type === 'session_meta') {
      rawId = asString(payload.id) || rawId;
      projectPath = asString(payload.cwd) || projectPath;
      version = asString(payload.cli_version) || version;
      const source = asString(payload.source);
      entrypoint = source ? `codex-${source}` : entrypoint;
      const git = asRecord(payload.git);
      gitBranch = asString(git.branch) || gitBranch;
    }

    if (entry.type === 'turn_context') {
      projectPath = asString(payload.cwd) || projectPath;
      primaryModel = asString(payload.model) || primaryModel;
    }

    if (entry.type === 'event_msg') {
      if (payload.type === 'user_message') {
        flushActiveTurn();
        pendingUserTs = entry.timestamp ?? '';
        lastTurnActivityTs = '';
        messageCount++;
        const text = asString(payload.message).replace(/\s+/g, ' ').trim();
        if (!firstPrompt && text) firstPrompt = text.slice(0, 200);
      } else if (pendingUserTs && entry.timestamp && isTurnActivityEntry(entry, payload)) {
        lastTurnActivityTs = entry.timestamp;
      }
      if (payload.type === 'token_count') {
        usage = tokenUsageFromCodex(getTokenUsagePayload(payload));
      }
    }

    if (entry.type === 'response_item') {
      if (pendingUserTs && entry.timestamp && isTurnActivityEntry(entry, payload)) lastTurnActivityTs = entry.timestamp;
      if (payload.type === 'function_call') toolCallCount++;
      if (payload.type === 'reasoning') thinkingBlocks++;
      if (payload.type === 'message') {
        if (payload.role === 'assistant') assistantMessages++;
        if (payload.role === 'user' && !firstPrompt) {
          const text = extractMessageText(payload.content);
          if (text) firstPrompt = text.slice(0, 200);
        }
      }
    }
  }

  flushActiveTurn();

  if (!startTime) return null;

  const model = primaryModel || 'unknown';
  const models = model === 'unknown' ? [] : [model];
  const project = projectPath || 'Codex';
  const totalInput = usage.inputTokens + usage.cacheCreationTokens + usage.cacheReadTokens;
  const title = titles.get(rawId) || '';

  return {
    id: `codex:${rawId}`,
    source: 'codex',
    projectId: projectIdFromPath(project),
    projectName: projectNameFromPath(project),
    projectPath: project,
    startTime,
    endTime,
    duration: endTime ? elapsedMs(startTime, endTime) : 0,
    activeDuration,
    models,
    primaryModel: model,
    usage,
    cost: calculateCost(model, usage),
    messageCount: messageCount || assistantMessages,
    toolCallCount,
    firstPrompt: firstPrompt || title || '(no prompt)',
    aiTitle: title,
    cacheHitRate: totalInput > 0 ? usage.cacheReadTokens / totalInput : 0,
    entrypoint,
    gitBranch,
    version,
    permissionMode: '',
    thinkingBlocks,
  };
}

export function parseCodexSessions(): Session[] {
  if (!fs.existsSync(CODEX_SESSIONS_DIR)) return [];
  const titles = readThreadTitles();
  return findJsonlFiles(CODEX_SESSIONS_DIR)
    .map((filePath) => parseCodexSessionFile(filePath, titles))
    .filter((session): session is Session => session !== null);
}

function findCodexSessionFile(sessionId: string): string | null {
  const rawId = sessionId.startsWith('codex:') ? sessionId.slice('codex:'.length) : sessionId;
  return findJsonlFiles(CODEX_SESSIONS_DIR).find((filePath) => path.basename(filePath).includes(rawId)) ?? null;
}

export function parseCodexSessionMessages(sessionId: string): SessionMessage[] {
  const filePath = findCodexSessionFile(sessionId);
  if (!filePath) return [];

  const messages: SessionMessage[] = [];
  let currentModel = 'unknown';
  let pending: {
    index: number;
    timestamp: string;
    prompt: string;
    usage: TokenUsage;
    toolCalls: number;
    hasThinking: boolean;
    lastActivityTs: string;
  } | null = null;

  function flushPending(): void {
    if (!pending) return;
    const responseTimeMs =
      pending.lastActivityTs && pending.timestamp
        ? elapsedMs(pending.timestamp, pending.lastActivityTs)
        : 0;
    messages.push({
      index: pending.index,
      timestamp: pending.timestamp,
      prompt: pending.prompt,
      model: currentModel,
      inputTokens: pending.usage.inputTokens,
      outputTokens: pending.usage.outputTokens,
      cacheCreationTokens: pending.usage.cacheCreationTokens,
      cacheReadTokens: pending.usage.cacheReadTokens,
      cost: calculateCost(currentModel, pending.usage),
      toolCalls: pending.toolCalls,
      hasThinking: pending.hasThinking,
      responseTimeMs,
    });
    pending = null;
  }

  for (const line of readLines(filePath)) {
    const entry = parseJsonLine(line);
    if (!entry) continue;
    const payload = asRecord(entry.payload);

    if (entry.type === 'turn_context') {
      currentModel = asString(payload.model) || currentModel;
    }

    if (entry.type === 'event_msg' && payload.type === 'user_message') {
      flushPending();
      const prompt = asString(payload.message).replace(/\s+/g, ' ').trim();
      pending = {
        index: messages.length,
        timestamp: entry.timestamp ?? '',
        prompt: prompt.slice(0, 500),
        usage: tokenUsageFromCodex(undefined),
        toolCalls: 0,
        hasThinking: false,
        lastActivityTs: '',
      };
      continue;
    }

    if (!pending) continue;

    if (entry.timestamp && isTurnActivityEntry(entry, payload)) pending.lastActivityTs = entry.timestamp;

    if (entry.type === 'event_msg' && payload.type === 'token_count') {
      pending.usage = tokenUsageFromCodex(getLastTokenUsagePayload(payload));
    }

    if (entry.type === 'response_item') {
      if (payload.type === 'function_call') pending.toolCalls++;
      if (payload.type === 'reasoning') pending.hasThinking = true;
    }
  }

  flushPending();
  return messages;
}
