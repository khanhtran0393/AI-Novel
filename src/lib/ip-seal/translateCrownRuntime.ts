/**
 * Load Dịch SRT crown (rules + prompt kernel) from seal or live modules.
 */
import { crownSealExists } from '@/lib/ip-seal/paths';
import { loadSealedCjsModule } from '@/lib/ip-seal/loadSealedCjs';

export type TranslateCrownApi = {
  TRANSLATE_RULE_OPTIONS: Array<{ id: string; label: string; description: string }>;
  resolveTranslateRuleDescription: (ruleId?: string) => string;
  DEFAULT_TRANSLATE_CHUNK: number;
  MIN_TRANSLATE_CHUNK: number;
  MAX_TRANSLATE_CHUNK: number;
  clampTranslateChunk: (n: unknown) => number;
  TRANSLATE_ANCHOR: string;
  buildTranslateBatchPrompt: (input: {
    langName: string;
    ruleDesc: string;
    texts: string[];
    anchor?: string;
  }) => string;
  translateSoftSplitPatternSource: string;
};

let cached: TranslateCrownApi | null = null;

export function getTranslateCrown(): TranslateCrownApi {
  if (cached) return cached;

  if (crownSealExists('translate-crown')) {
    cached = loadSealedCjsModule<TranslateCrownApi>('translate-crown');
    return cached;
  }

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const rules = require('@/lib/ttsBatchSrt/translateRules') as TranslateCrownApi;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const prompt = require('@/lib/ttsBatchSrt/translatePromptCrown') as TranslateCrownApi;
  cached = { ...rules, ...prompt };
  return cached;
}

export function resetTranslateCrownCache(): void {
  cached = null;
}
