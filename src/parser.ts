import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import type { Session, ParsedData, RawEntry, TokenUsage, SessionMessage } from './types.js';
import { calculateCost } from './pricing.js';
import { computeProjects, computeStats, computeDaily, computeModelStats } from './aggregator.js';
import { parseCodexSessionMessages, parseCodexSessions } from './codexParser.js';

const CLAUDE_PROJECTS_DIR = path.join(os.homedir(), '.claude', 'projects');

let cache: ParsedData | null = null;
const CACHE_TTL_MS = 5 * 60 * 1000;

function extractText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((c: unknown) => {
        if (typeof c === 'string') return c;
        if (typeof c === 'object' && c !== null) {
          const obj = c as Record<string, unknown>;
          if (obj.type === 'text' && typeof obj.text === 'string') return obj.text;
        }
        return '';
      })
      .join(' ')
      .trim();
  }
  return '';
}

function folderNameToPath(folderName: string): string {
  // Claude Code replaces '/' with '-' and drops the leading '/'
  // So '-Users-richard-workspace-foo' -> '/Users/richard/workspace/foo'
  // This is ambiguous for hyphenated paths but best effort for display
  return '/' + folderName.slice(1).replace(/-/g, '/');
}

function parseSessionFile(sessionId: string, projectId: string, filePath: string): Session | null {
  let raw: string;
  try {
    raw = fs.readFileSync(filePath, 'utf-8');
  } catch {
    return null;
  }

  const lines = raw.split('\n').filter(Boolean);
  if (lines.length === 0) return null;

  let firstPrompt = '';
  let aiTitle = '';
  let startTime = '';
  let endTime = '';
  let messageCount = 0;
  let toolCallCount = 0;
  let thinkingBlocks = 0;
  let activeDuration = 0;
  let pendingUserTs = '';
  let lastAssistantTs = '';
  let cwd = '';
  let entrypoint = '';
  let gitBranch = '';
  let version = '';
  let permissionMode = '';
  const models = new Set<string>();
  const usage: TokenUsage = { inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0, cache5mTokens: 0, cache1hTokens: 0 };

  // Per-message deduplication: last entry wins (thinking blocks can report output=0 even when
  // later entries for the same message_id carry the real output count).
  type MsgData = { u: NonNullable<NonNullable<RawEntry['message']>['usage']>; contentChars: number };
  const perMessage = new Map<string, MsgData>();

  for (const line of lines) {
    let entry: RawEntry;
    try {
      entry = JSON.parse(line) as RawEntry;
    } catch {
      continue;
    }

    if (!startTime && entry.timestamp) startTime = entry.timestamp;
    if (entry.timestamp) endTime = entry.timestamp;
    if (entry.cwd && !cwd) cwd = entry.cwd;
    if (entry.entrypoint && !entrypoint) entrypoint = entry.entrypoint;
    if (entry.gitBranch && !gitBranch) gitBranch = entry.gitBranch;
    if (entry.version && !version) version = entry.version;
    if (entry.permissionMode && !permissionMode) permissionMode = entry.permissionMode;

    if (entry.type === 'ai-title' && entry.aiTitle) {
      aiTitle = entry.aiTitle;
    }

    if (entry.type === 'user') {
      if (entry.isSidechain) continue;
      messageCount++;
      if (pendingUserTs && lastAssistantTs) {
        const turnMs = new Date(lastAssistantTs).getTime() - new Date(pendingUserTs).getTime();
        if (turnMs > 0) activeDuration += turnMs;
      }
      if (entry.timestamp) pendingUserTs = entry.timestamp;
      lastAssistantTs = '';
      if (!firstPrompt && entry.message?.content) {
        const text = extractText(entry.message.content)
          .replace(/<[^>]+>/g, ' ')
          .replace(/\s+/g, ' ')
          .trim();
        // Skip injected system content (caveats, command invocations, hook output)
        const isSystemInjected = /^(Caveat:|The messages below|<command|hook output|DO NOT respond)/i.test(text);
        if (text && text.length > 2 && !isSystemInjected) firstPrompt = text.slice(0, 200);
      }
    }

    if (entry.type === 'assistant' && entry.message?.usage) {
      const msgId = entry.message.id;
      if (entry.message.model) models.add(entry.message.model);
      if (entry.timestamp) lastAssistantTs = entry.timestamp;

      if (msgId) {
        // Accumulate content chars across all blocks for this message (used to estimate output
        // when the API reports output_tokens=0 for every entry of the message).
        let chars = 0;
        if (Array.isArray(entry.message.content)) {
          for (const block of entry.message.content as Array<Record<string, unknown>>) {
            if (block.type === 'text' && typeof block.text === 'string') chars += block.text.length;
            if (block.type === 'thinking' && typeof block.thinking === 'string') chars += block.thinking.length;
            if (block.type === 'tool_use' && block.input) chars += JSON.stringify(block.input).length;
          }
        }
        const prev = perMessage.get(msgId);
        // Last-wins for usage so that non-thinking entries (which carry the real output count)
        // overwrite the thinking entry's usage when they share the same message_id.
        perMessage.set(msgId, { u: entry.message.usage, contentChars: (prev?.contentChars ?? 0) + chars });
      } else {
        // No message_id — count directly.
        const u = entry.message.usage;
        usage.inputTokens += u.input_tokens ?? 0;
        usage.outputTokens += u.output_tokens ?? 0;
        usage.cacheCreationTokens += u.cache_creation_input_tokens ?? 0;
        usage.cacheReadTokens += u.cache_read_input_tokens ?? 0;
        usage.cache5mTokens += u.cache_creation?.ephemeral_5m_input_tokens ?? 0;
        usage.cache1hTokens += u.cache_creation?.ephemeral_1h_input_tokens ?? 0;
      }

      if (Array.isArray(entry.message.content)) {
        const content = entry.message.content as Array<{ type?: string }>;
        toolCallCount += content.filter((c) => c.type === 'tool_use').length;
        if (content.some((c) => c.type === 'thinking')) thinkingBlocks++;
      }
    }
  }

  // Flush final turn (last assistant response has no following user message)
  if (pendingUserTs && lastAssistantTs) {
    const turnMs = new Date(lastAssistantTs).getTime() - new Date(pendingUserTs).getTime();
    if (turnMs > 0) activeDuration += turnMs;
  }

  if (!startTime) return null;

  // Merge per-message usage into totals. When output_tokens is still 0 after last-wins
  // (local model APIs that never populate the field), estimate from content (~4 chars/token).
  for (const { u, contentChars } of perMessage.values()) {
    usage.inputTokens += u.input_tokens ?? 0;
    usage.cacheCreationTokens += u.cache_creation_input_tokens ?? 0;
    usage.cacheReadTokens += u.cache_read_input_tokens ?? 0;
    usage.cache5mTokens += u.cache_creation?.ephemeral_5m_input_tokens ?? 0;
    usage.cache1hTokens += u.cache_creation?.ephemeral_1h_input_tokens ?? 0;
    const reported = u.output_tokens ?? 0;
    usage.outputTokens += reported > 0 ? reported : Math.round(contentChars / 4);
  }

  const primaryModel = models.size > 0 ? [...models][0] : 'unknown';
  const cost = calculateCost(primaryModel, usage);
  const duration = startTime && endTime
    ? new Date(endTime).getTime() - new Date(startTime).getTime()
    : 0;

  const totalInput = usage.inputTokens + usage.cacheCreationTokens + usage.cacheReadTokens;
  const cacheHitRate = totalInput > 0 ? usage.cacheReadTokens / totalInput : 0;

  const projectPath = cwd || folderNameToPath(projectId);
  const projectName = projectPath.split('/').filter(Boolean).pop() ?? projectId;

  return {
    id: sessionId,
    source: 'claude',
    projectId,
    projectName,
    projectPath,
    startTime,
    endTime,
    duration,
    activeDuration,
    models: [...models],
    primaryModel,
    usage,
    cost,
    messageCount,
    toolCallCount,
    firstPrompt: firstPrompt || '(no prompt)',
    aiTitle,
    cacheHitRate,
    entrypoint,
    gitBranch,
    version,
    permissionMode,
    thinkingBlocks,
  };
}

function parseClaudeSessions(): Session[] {
  const sessions: Session[] = [];

  if (!fs.existsSync(CLAUDE_PROJECTS_DIR)) return sessions;

  const projectFolders = fs.readdirSync(CLAUDE_PROJECTS_DIR).filter((f) => {
    try {
      return fs.statSync(path.join(CLAUDE_PROJECTS_DIR, f)).isDirectory();
    } catch {
      return false;
    }
  });

  for (const projectId of projectFolders) {
    const projectDir = path.join(CLAUDE_PROJECTS_DIR, projectId);
    const entries = fs.readdirSync(projectDir);

    for (const entry of entries) {
      if (entry.endsWith('.jsonl')) {
        const sessionId = entry.replace('.jsonl', '');
        const session = parseSessionFile(sessionId, projectId, path.join(projectDir, entry));
        if (session) sessions.push(session);
        continue;
      }

      // Subagent sessions live at <projectDir>/<parentSessionId>/subagents/*.jsonl
      const subagentsDir = path.join(projectDir, entry, 'subagents');
      try {
        if (!fs.statSync(subagentsDir).isDirectory()) continue;
      } catch {
        continue;
      }
      for (const file of fs.readdirSync(subagentsDir).filter((f) => f.endsWith('.jsonl'))) {
        const sessionId = file.replace('.jsonl', '');
        const session = parseSessionFile(sessionId, projectId, path.join(subagentsDir, file));
        if (session) {
          if (!session.entrypoint) session.entrypoint = 'subagent';
          sessions.push(session);
        }
      }
    }
  }

  return sessions;
}

function parseAll(): ParsedData {
  const sessions = [...parseClaudeSessions(), ...parseCodexSessions()];

  sessions.sort((a, b) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime());

  const projects = computeProjects(sessions);
  const stats = computeStats(sessions, projects);
  const daily = computeDaily(sessions);
  const modelStats = computeModelStats(sessions);

  return { sessions, projects, stats, daily, modelStats, computedAt: Date.now() };
}

export function getData(force = false): ParsedData {
  if (!force && cache && Date.now() - cache.computedAt < CACHE_TTL_MS) {
    return cache;
  }
  cache = parseAll();
  return cache;
}

export function invalidateCache(): void {
  cache = null;
}

type PendingResponse = {
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  toolCalls: number;
  hasThinking: boolean;
  lastTs: string;
};

export function parseSessionMessages(sessionId: string, projectId: string, source: Session['source'] = 'claude'): SessionMessage[] {
  if (source === 'codex') return parseCodexSessionMessages(sessionId);

  const filePath = path.join(CLAUDE_PROJECTS_DIR, projectId, `${sessionId}.jsonl`);
  let raw: string;
  try {
    raw = fs.readFileSync(filePath, 'utf-8');
  } catch {
    return [];
  }

  const lines = raw.split('\n').filter(Boolean);
  const messages: SessionMessage[] = [];

  let pendingUser: { index: number; timestamp: string; prompt: string } | null = null;
  let pendingResponse: PendingResponse | null = null;
  let turnIndex = 0;

  function flushTurn(): void {
    if (!pendingUser) return;
    const r = pendingResponse;
    const responseTimeMs =
      r?.lastTs && pendingUser.timestamp
        ? Math.max(0, new Date(r.lastTs).getTime() - new Date(pendingUser.timestamp).getTime())
        : 0;
    const model = r?.model ?? 'unknown';
    const usage: TokenUsage = {
      inputTokens: r?.inputTokens ?? 0,
      outputTokens: r?.outputTokens ?? 0,
      cacheCreationTokens: r?.cacheCreationTokens ?? 0,
      cacheReadTokens: r?.cacheReadTokens ?? 0,
      cache5mTokens: 0,
      cache1hTokens: 0,
    };
    messages.push({
      ...pendingUser,
      model,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      cacheCreationTokens: usage.cacheCreationTokens,
      cacheReadTokens: usage.cacheReadTokens,
      cost: calculateCost(model, usage),
      toolCalls: r?.toolCalls ?? 0,
      hasThinking: r?.hasThinking ?? false,
      responseTimeMs,
    });
    pendingUser = null;
    pendingResponse = null;
  }

  for (const line of lines) {
    let entry: RawEntry;
    try {
      entry = JSON.parse(line) as RawEntry;
    } catch {
      continue;
    }

    if (entry.type === 'user' && !entry.isSidechain && entry.message?.content) {
      const text = extractText(entry.message.content)
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      const isSystemInjected = /^(Caveat:|The messages below|<command|hook output|DO NOT respond)/i.test(text);
      if (!text || text.length <= 2 || isSystemInjected) continue;

      flushTurn();
      pendingUser = { index: turnIndex++, timestamp: entry.timestamp ?? '', prompt: text.slice(0, 500) };
    }

    if (entry.type === 'assistant' && entry.message?.usage && pendingUser) {
      const u = entry.message.usage;
      const content = Array.isArray(entry.message.content)
        ? (entry.message.content as Array<{ type?: string }>)
        : [];
      // Last-wins: each streaming chunk overwrites with the latest usage + timestamp.
      // Read fields from pendingResponse via a non-narrowed reference to avoid TS over-narrowing.
      const cur: PendingResponse | null = pendingResponse;
      const nextResponse: PendingResponse = {
        model: entry.message.model ?? (cur !== null ? cur.model : 'unknown'),
        inputTokens: u.input_tokens ?? 0,
        outputTokens: u.output_tokens ?? (cur !== null ? cur.outputTokens : 0),
        cacheCreationTokens: u.cache_creation_input_tokens ?? 0,
        cacheReadTokens: u.cache_read_input_tokens ?? 0,
        toolCalls: (cur !== null ? cur.toolCalls : 0) + content.filter((c) => c.type === 'tool_use').length,
        hasThinking: (cur !== null ? cur.hasThinking : false) || content.some((c) => c.type === 'thinking'),
        lastTs: entry.timestamp ?? (cur !== null ? cur.lastTs : ''),
      };
      pendingResponse = nextResponse;
    }
  }

  flushTurn();

  return messages;
}
