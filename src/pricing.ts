import type { TokenUsage } from './types.js';

interface ModelPricing {
  input: number;
  output: number;
  cacheWrite: number;
  cacheRead: number;
}

export const PRICING: Record<string, ModelPricing> = {
  // Current models
  'claude-opus-4-7':            { input: 15.00, output: 75.00, cacheWrite: 18.75, cacheRead: 1.50 },
  'claude-sonnet-4-6':          { input:  3.00, output: 15.00, cacheWrite:  3.75, cacheRead: 0.30 },
  'claude-haiku-4-5':           { input:  0.80, output:  4.00, cacheWrite:  1.00, cacheRead: 0.08 },
  'claude-haiku-4-5-20251001':  { input:  0.80, output:  4.00, cacheWrite:  1.00, cacheRead: 0.08 },
  // Legacy models — kept for historical session cost accuracy
  'claude-3-5-sonnet-20241022': { input:  3.00, output: 15.00, cacheWrite:  3.75, cacheRead: 0.30 },
  'claude-3-5-sonnet-20240620': { input:  3.00, output: 15.00, cacheWrite:  3.75, cacheRead: 0.30 },
  'claude-3-5-haiku-20241022':  { input:  0.80, output:  4.00, cacheWrite:  1.00, cacheRead: 0.08 },
  'claude-3-opus-20240229':     { input: 15.00, output: 75.00, cacheWrite: 18.75, cacheRead: 1.50 },
  'claude-3-sonnet-20240229':   { input:  3.00, output: 15.00, cacheWrite:  3.75, cacheRead: 0.30 },
  'claude-3-haiku-20240307':    { input:  0.25, output:  1.25, cacheWrite:  0.30, cacheRead: 0.03 },

  // OpenAI Codex models. OpenAI cached input maps to cacheRead; cache writes bill as regular input.
  'gpt-5.5':                    { input:  5.00, output: 30.00, cacheWrite:  5.00, cacheRead: 0.50 },
  'gpt-5.4':                    { input:  2.50, output: 15.00, cacheWrite:  2.50, cacheRead: 0.25 },
  'gpt-5.4-mini':               { input:  0.75, output:  4.50, cacheWrite:  0.75, cacheRead: 0.075 },
};

export const LEGACY_MODEL_KEYS = new Set([
  'claude-3-5-sonnet-20241022',
  'claude-3-5-sonnet-20240620',
  'claude-3-5-haiku-20241022',
  'claude-3-opus-20240229',
  'claude-3-sonnet-20240229',
  'claude-3-haiku-20240307',
]);

let _customPricing: Record<string, ModelPricing> = {};

export function setCustomPricing(overrides: Record<string, ModelPricing>): void {
  _customPricing = { ...overrides };
}

function pricingAliases(model: string): string[] {
  const stripped = model.replace(/^opencode\//i, '');
  return stripped === model ? [model, `opencode/${model}`] : [model, stripped];
}

export function getModelPricing(model: string): ModelPricing | null {
  const aliases = pricingAliases(model);
  for (const alias of aliases) {
    if (_customPricing[alias]) return _customPricing[alias];
    if (PRICING[alias]) return PRICING[alias];
  }
  // Prefix match for future versioned models
  for (const [key, pricing] of Object.entries(_customPricing)) {
    if (aliases.some((alias) => alias.startsWith(key) || key.startsWith(alias))) return pricing;
  }
  for (const [key, pricing] of Object.entries(PRICING)) {
    if (aliases.some((alias) => alias.startsWith(key) || key.startsWith(alias))) return pricing;
  }
  return null;
}

export function calculateCost(model: string, usage: TokenUsage): number {
  const pricing = getModelPricing(model);
  if (!pricing) return 0;
  const M = 1_000_000;
  return (
    (usage.inputTokens * pricing.input) / M +
    (usage.outputTokens * pricing.output) / M +
    (usage.cacheCreationTokens * pricing.cacheWrite) / M +
    (usage.cacheReadTokens * pricing.cacheRead) / M
  );
}

export function isLocalModel(model: string): boolean {
  if (getModelPricing(model) !== null) return false;
  const remotePrefixes = [
    'claude-',
    'anthropic/',
    'gpt-',
    'openai/',
    'codex-',
    'o1',
    'o3',
    'o4',
    'o5',
    'gemini',
    'google/',
  ];
  return !remotePrefixes.some((prefix) => model.startsWith(prefix));
}

export function getKnownModels(): string[] {
  return Object.keys(PRICING);
}
