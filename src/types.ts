export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  cache5mTokens: number;
  cache1hTokens: number;
}

export interface Session {
  id: string;
  source: 'claude' | 'codex';
  projectId: string;
  projectName: string;
  projectPath: string;
  startTime: string;
  endTime: string;
  duration: number;
  activeDuration: number;
  models: string[];
  primaryModel: string;
  usage: TokenUsage;
  cost: number;
  messageCount: number;
  toolCallCount: number;
  firstPrompt: string;
  aiTitle: string;
  cacheHitRate: number;
  entrypoint: string;
  gitBranch: string;
  version: string;
  permissionMode: string;
  thinkingBlocks: number;
}

export interface ProjectSummary {
  id: string;
  source: 'claude' | 'codex';
  sources: Array<'claude' | 'codex'>;
  path: string;
  name: string;
  sessionCount: number;
  totalCost: number;
  totalTokens: number;
  cacheHitRate: number;
  topModel: string;
  lastActivity: string;
  usage: TokenUsage;
}

export interface ModelStats {
  model: string;
  isLocal: boolean;
  sessionCount: number;
  totalCost: number;
  totalTokens: number;
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  cacheHitRate: number;
  avgCostPerSession: number;
  avgTokensPerSession: number;
  totalMessages: number;
  totalToolCalls: number;
  avgDuration: number;
}

export interface GlobalStats {
  totalCost: number;
  totalSessions: number;
  totalMessages: number;
  totalTokens: number;
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  cacheHitRate: number;
  topModel: string;
  modelsUsed: string[];
  projectCount: number;
  entrypointCounts: Record<string, number>;
  thinkingSessionCount: number;
}

export interface DailyActivity {
  date: string;
  cost: number;
  sessions: number;
  messages: number;
  tokens: number;
}

export interface ParsedData {
  sessions: Session[];
  projects: ProjectSummary[];
  stats: GlobalStats;
  daily: DailyActivity[];
  modelStats: ModelStats[];
  computedAt: number;
}

export interface SessionMessage {
  index: number;
  timestamp: string;
  prompt: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  cost: number;
  toolCalls: number;
  hasThinking: boolean;
}

export interface AppSettings {
  plan: 'api' | 'pro' | 'max' | 'max5x' | 'max20x';
  customPricing: Record<string, { input: number; output: number; cacheWrite: number; cacheRead: number }>;
  durationMode: 'active' | 'wallclock';
}

export interface Tip {
  id: string;
  severity: 'warn' | 'info' | 'good';
  title: string;
  body: string;
  value?: number;
}

export interface RawEntry {
  type?: string;
  parentUuid?: string;
  uuid?: string;
  timestamp?: string;
  sessionId?: string;
  cwd?: string;
  isSidechain?: boolean;
  entrypoint?: string;
  gitBranch?: string;
  version?: string;
  permissionMode?: string;
  aiTitle?: string;
  message?: {
    id?: string;
    role?: string;
    model?: string;
    content?: unknown;
    stop_reason?: string;
    usage?: {
      input_tokens?: number;
      output_tokens?: number;
      cache_creation_input_tokens?: number;
      cache_read_input_tokens?: number;
      cache_creation?: {
        ephemeral_5m_input_tokens?: number;
        ephemeral_1h_input_tokens?: number;
      };
    };
  };
  userType?: string;
}
