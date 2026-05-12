export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
}

export interface Session {
  id: string;
  projectId: string;
  projectName: string;
  projectPath: string;
  startTime: string;
  endTime: string;
  duration: number;
  models: string[];
  primaryModel: string;
  usage: TokenUsage;
  cost: number;
  messageCount: number;
  toolCallCount: number;
  firstPrompt: string;
  cacheHitRate: number;
}

export interface ProjectSummary {
  id: string;
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
}

export interface RawEntry {
  type?: string;
  parentUuid?: string;
  uuid?: string;
  timestamp?: string;
  sessionId?: string;
  cwd?: string;
  isSidechain?: boolean;
  message?: {
    role?: string;
    model?: string;
    content?: unknown;
    stop_reason?: string;
    usage?: {
      input_tokens?: number;
      output_tokens?: number;
      cache_creation_input_tokens?: number;
      cache_read_input_tokens?: number;
    };
  };
  userType?: string;
}
