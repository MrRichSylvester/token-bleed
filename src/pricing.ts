import type { TokenUsage } from './types.js';

interface ModelPricing {
  input: number;
  output: number;
  cacheWrite: number;
  cacheRead: number;
}

export const PRICING: Record<string, ModelPricing> = {
  'claude-opus-4-7':            { input: 15.00, output: 75.00, cacheWrite: 18.75, cacheRead: 1.50 },
  'claude-sonnet-4-6':          { input:  3.00, output: 15.00, cacheWrite:  3.75, cacheRead: 0.30 },
  'claude-haiku-4-5':           { input:  0.80, output:  4.00, cacheWrite:  1.00, cacheRead: 0.08 },
  'claude-haiku-4-5-20251001':  { input:  0.80, output:  4.00, cacheWrite:  1.00, cacheRead: 0.08 },
  'claude-3-5-sonnet-20241022': { input:  3.00, output: 15.00, cacheWrite:  3.75, cacheRead: 0.30 },
  'claude-3-5-sonnet-20240620': { input:  3.00, output: 15.00, cacheWrite:  3.75, cacheRead: 0.30 },
  'claude-3-5-haiku-20241022':  { input:  0.80, output:  4.00, cacheWrite:  1.00, cacheRead: 0.08 },
  'claude-3-opus-20240229':     { input: 15.00, output: 75.00, cacheWrite: 18.75, cacheRead: 1.50 },
  'claude-3-sonnet-20240229':   { input:  3.00, output: 15.00, cacheWrite:  3.75, cacheRead: 0.30 },
  'claude-3-haiku-20240307':    { input:  0.25, output:  1.25, cacheWrite:  0.30, cacheRead: 0.03 },
};

let _customPricing: Record<string, ModelPricing> = {};

export function setCustomPricing(overrides: Record<string, ModelPricing>): void {
  _customPricing = { ...overrides };
}

export function getModelPricing(model: string): ModelPricing | null {
  if (_customPricing[model]) return _customPricing[model];
  if (PRICING[model]) return PRICING[model];
  // Prefix match for future versioned models
  for (const [key, pricing] of Object.entries(_customPricing)) {
    if (model.startsWith(key) || key.startsWith(model)) return pricing;
  }
  for (const [key, pricing] of Object.entries(PRICING)) {
    if (model.startsWith(key) || key.startsWith(model)) return pricing;
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
  return getModelPricing(model) === null;
}

export function getKnownModels(): string[] {
  return Object.keys(PRICING);
}
