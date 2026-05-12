import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import type { Session, ParsedData, RawEntry, TokenUsage } from './types.js';
import { calculateCost } from './pricing.js';
import { computeProjects, computeStats, computeDaily, computeModelStats } from './aggregator.js';

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
  let startTime = '';
  let endTime = '';
  let messageCount = 0;
  let toolCallCount = 0;
  let cwd = '';
  const models = new Set<string>();
  const usage: TokenUsage = { inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0 };

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

    if (entry.type === 'user') {
      if (entry.isSidechain) continue;
      messageCount++;
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
      const u = entry.message.usage;
      usage.inputTokens += u.input_tokens ?? 0;
      usage.outputTokens += u.output_tokens ?? 0;
      usage.cacheCreationTokens += u.cache_creation_input_tokens ?? 0;
      usage.cacheReadTokens += u.cache_read_input_tokens ?? 0;

      if (entry.message.model) models.add(entry.message.model);

      if (Array.isArray(entry.message.content)) {
        toolCallCount += (entry.message.content as Array<{ type?: string }>).filter(
          (c) => c.type === 'tool_use'
        ).length;
      }
    }
  }

  if (!startTime) return null;

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
    projectId,
    projectName,
    projectPath,
    startTime,
    endTime,
    duration,
    models: [...models],
    primaryModel,
    usage,
    cost,
    messageCount,
    toolCallCount,
    firstPrompt: firstPrompt || '(no prompt)',
    cacheHitRate,
  };
}

function parseAll(): ParsedData {
  const sessions: Session[] = [];

  const projectFolders = fs.readdirSync(CLAUDE_PROJECTS_DIR).filter((f) => {
    try {
      return fs.statSync(path.join(CLAUDE_PROJECTS_DIR, f)).isDirectory();
    } catch {
      return false;
    }
  });

  for (const projectId of projectFolders) {
    const projectDir = path.join(CLAUDE_PROJECTS_DIR, projectId);
    const files = fs.readdirSync(projectDir).filter((f) => f.endsWith('.jsonl'));

    for (const file of files) {
      const sessionId = file.replace('.jsonl', '');
      const session = parseSessionFile(sessionId, projectId, path.join(projectDir, file));
      if (session) sessions.push(session);
    }
  }

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
