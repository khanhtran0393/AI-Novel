/**
 * CROWN STUB — prompt kernel in translate-crown.seal
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { getTranslateCrown } from '@/lib/ip-seal/translateCrownRuntime';

const T = () => getTranslateCrown() as any;
export const TRANSLATE_ANCHOR = T().TRANSLATE_ANCHOR;
export const translateSoftSplitPatternSource = T().translateSoftSplitPatternSource;
export function buildTranslateBatchPrompt(...a: any[]) {
  return T().buildTranslateBatchPrompt(...a);
}
