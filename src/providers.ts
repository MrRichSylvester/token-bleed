import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const TOKEN_BLEED_DIR = path.join(os.homedir(), '.token-bleed');
export const PROVIDERS_PATH = path.join(TOKEN_BLEED_DIR, 'providers.json');
const CLAUDE_SETTINGS_PATH = path.join(os.homedir(), '.claude', 'settings.json');

export interface ProviderConfig {
  configured: boolean;
  key?: string;
  model?: string;
}

export interface ProvidersFile {
  openai: ProviderConfig;
  gemini: ProviderConfig;
  ollama: ProviderConfig;
}

function ensureDir(): void {
  if (!fs.existsSync(TOKEN_BLEED_DIR)) {
    fs.mkdirSync(TOKEN_BLEED_DIR, { recursive: true });
  }
}

export function readProviders(): ProvidersFile {
  try {
    ensureDir();
    const raw = JSON.parse(fs.readFileSync(PROVIDERS_PATH, 'utf-8')) as Partial<ProvidersFile>;
    return {
      openai: raw.openai ?? { configured: false },
      gemini: raw.gemini ?? { configured: false },
      ollama: raw.ollama ?? { configured: false },
    };
  } catch {
    return {
      openai: { configured: false },
      gemini: { configured: false },
      ollama: { configured: false },
    };
  }
}

export function writeProviders(data: ProvidersFile): void {
  ensureDir();
  fs.writeFileSync(PROVIDERS_PATH, JSON.stringify(data, null, 2) + '\n');
}

export function pidFilePath(provider: string): string {
  return path.join(TOKEN_BLEED_DIR, `litellm-${provider}.pid`);
}

export function readPid(provider: string): number | null {
  try {
    const raw = fs.readFileSync(pidFilePath(provider), 'utf-8').trim();
    const pid = parseInt(raw, 10);
    return Number.isFinite(pid) ? pid : null;
  } catch {
    return null;
  }
}

export function writePid(provider: string, pid: number): void {
  ensureDir();
  fs.writeFileSync(pidFilePath(provider), String(pid));
}

export function clearPid(provider: string): void {
  try {
    fs.unlinkSync(pidFilePath(provider));
  } catch {
    /* ignore */
  }
}

export function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

const PORT_MAP: Record<number, string> = {
  4001: 'GPT-4o',
  4002: 'Gemini Flash',
  11434: 'Ollama',
};

export function getActiveProvider(): string {
  try {
    const raw = fs.readFileSync(CLAUDE_SETTINGS_PATH, 'utf-8');
    const settings = JSON.parse(raw) as Record<string, unknown>;
    const env = settings.env as Record<string, string> | undefined;
    const baseUrl = env?.ANTHROPIC_BASE_URL;
    if (!baseUrl || baseUrl.includes('api.anthropic.com')) return 'Claude (native)';
    const url = new URL(baseUrl);
    const port = url.port ? parseInt(url.port, 10) : (url.protocol === 'https:' ? 443 : 80);
    return PORT_MAP[port] ?? 'Claude (native)';
  } catch {
    return 'Claude (native)';
  }
}

export function proxyStatus(provider: 'openai' | 'gemini'): 'connected' | 'stopped' | 'not-configured' {
  const providers = readProviders();
  if (!providers[provider].configured) return 'not-configured';
  const pid = readPid(provider);
  if (pid !== null && isProcessRunning(pid)) return 'connected';
  return 'stopped';
}
