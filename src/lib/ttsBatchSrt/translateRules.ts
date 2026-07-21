/**
 * CROWN STUB — rule descriptions from translate-crown.seal; chunk UX public.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { getTranslateCrown } from '@/lib/ip-seal/translateCrownRuntime';
export {
  DEFAULT_TRANSLATE_CHUNK,
  MIN_TRANSLATE_CHUNK,
  MAX_TRANSLATE_CHUNK,
  clampTranslateChunk,
} from './publicTranslateCatalog';

const T = () => getTranslateCrown() as any;
export type TranslateRuleOption = { id: string; label: string; description: string };
export const TRANSLATE_RULE_OPTIONS: TranslateRuleOption[] = T().TRANSLATE_RULE_OPTIONS;
export function resolveTranslateRuleDescription(ruleId?: string): string {
  return String(T().resolveTranslateRuleDescription(ruleId));
}
