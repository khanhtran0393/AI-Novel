/**
 * Crown seal entry — Tool Dịch SRT rules + Cap-style Gemini prompt kernel.
 */
export {
  TRANSLATE_RULE_OPTIONS,
  resolveTranslateRuleDescription,
  DEFAULT_TRANSLATE_CHUNK,
  MIN_TRANSLATE_CHUNK,
  MAX_TRANSLATE_CHUNK,
  clampTranslateChunk,
} from '../../src/lib/ttsBatchSrt/translateRules';

export {
  TRANSLATE_ANCHOR,
  buildTranslateBatchPrompt,
  translateSoftSplitPatternSource,
} from '../../src/lib/ttsBatchSrt/translatePromptCrown';
