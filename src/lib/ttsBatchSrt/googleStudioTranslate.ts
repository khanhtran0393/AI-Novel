/**
 * CapAssist translate_subtitles_engine — Gemini API (không DeepSeek, không RPA cookie).
 *
 * Method chuẩn Cap:
 * 1) Parse SRT — giữ timestamp, chỉ lấy text
 * 2) Chia ~50 cue/lô (mặc định)
 * 3) Nối text bằng neo " || "
 * 4) 1 request Gemini / lô (song song vài lô)
 * 5) Tách " || ", so khớp số đoạn; lệch → tách đôi lô và retry
 * 6) Gắn lại timestamp gốc → SRT
 */
import { parseSrt, formatSrtTimestamp } from './parseSrt';
import type { SrtCue } from './types';
import {
  callGoogleStudioText,
  studioLangLabel,
  warmupGoogleStudio,
} from './googleStudioClient';
import {
  clampTranslateChunk,
  DEFAULT_TRANSLATE_CHUNK,
  resolveTranslateRuleDescription,
} from './translateRules';
import {
  TRANSLATE_ANCHOR,
  buildTranslateBatchPrompt,
  translateSoftSplitPatternSource,
} from './translatePromptCrown';

const ANCHOR = TRANSLATE_ANCHOR;
/**
 * Cap thường chạy worker dịch tuần tự / vài luồng.
 * 3 lô song song: nhanh hơn 1, ít 429 hơn fan-out 6.
 */
const PARALLEL_BATCHES = 3;

export type StudioTranslateOpts = {
  srtText: string;
  apiKeys: string[];
  targetLang: string;
  ruleId?: string;
  /** Cap "chia" — số dòng/cue mỗi batch (default 50) */
  chunkSize?: number;
  onProgress?: (label: string, percent?: number) => void;
};

function chunkArray<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

async function mapPool<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  let fail: Error | null = null;
  const runners = Array.from(
    { length: Math.min(concurrency, Math.max(1, items.length)) },
    async () => {
      while (!fail) {
        const i = cursor++;
        if (i >= items.length) break;
        try {
          results[i] = await worker(items[i], i);
        } catch (e) {
          fail = e instanceof Error ? e : new Error(String(e));
        }
      }
    },
  );
  await Promise.all(runners);
  if (fail) throw fail;
  return results;
}

function splitOnAnchor(raw: string, expected: number): string[] | null {
  const cleaned = raw
    .replace(/```(?:text|plain|markdown)?/gi, '')
    .replace(/\r\n/g, '\n')
    .trim();

  let parts = cleaned.split(ANCHOR).map((p) => p.trim());
  if (parts.length === expected) return parts;

  // Cap-style soft: "||" with flexible spaces (pattern from crown module)
  parts = cleaned
    .split(new RegExp(translateSoftSplitPatternSource))
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
  if (parts.length === expected) return parts;

  return null;
}

/**
 * One Cap-style || batch call to Gemini.
 */
async function translateBatchTextsOnce(
  texts: string[],
  apiKeys: string[],
  langName: string,
  ruleDesc: string,
): Promise<string[]> {
  const prompt = buildTranslateBatchPrompt({
    langName,
    ruleDesc,
    texts,
    anchor: ANCHOR,
  });

  // ~50 câu: 8k–16k đủ; scale nhẹ theo batch
  const maxOut = Math.min(32768, Math.max(8192, Math.ceil(texts.length * 100)));
  const raw = await callGoogleStudioText({
    prompt,
    apiKeys,
    temperature: 0.45,
    maxOutputTokens: maxOut,
  });

  const parts = splitOnAnchor(raw, texts.length);
  if (!parts) {
    throw new Error(
      `Gemini translate: lệch số đoạn (in=${texts.length}). ` +
        `Thử giảm Chia (mặc định Cap 50).`,
    );
  }
  return parts;
}

/**
 * Cap-like: nếu lệch count → tách đôi lô và dịch lại (không đổi engine).
 */
async function translateBatchTexts(
  texts: string[],
  apiKeys: string[],
  langName: string,
  ruleDesc: string,
): Promise<string[]> {
  try {
    return await translateBatchTextsOnce(texts, apiKeys, langName, ruleDesc);
  } catch (e) {
    if (texts.length <= 8) throw e;
    const mid = Math.ceil(texts.length / 2);
    const left = await translateBatchTexts(
      texts.slice(0, mid),
      apiKeys,
      langName,
      ruleDesc,
    );
    const right = await translateBatchTexts(
      texts.slice(mid),
      apiKeys,
      langName,
      ruleDesc,
    );
    return [...left, ...right];
  }
}

/**
 * Dịch full SRT qua Gemini (Cap method). Không DeepSeek / không cookie RPA.
 */
export async function translateSrtViaGoogleStudio(
  opts: StudioTranslateOpts,
): Promise<string> {
  const apiKeys = (opts.apiKeys || []).filter(Boolean);
  if (!apiKeys.length) {
    throw new Error(
      'Dịch SRT cần API key Gemini (Cài đặt). Không DeepSeek / không cookie Studio cho path này.',
    );
  }
  void warmupGoogleStudio(apiKeys);

  const cues = parseSrt(opts.srtText);
  const langName = studioLangLabel(opts.targetLang);
  const ruleDesc = resolveTranslateRuleDescription(opts.ruleId);
  const batchSize = clampTranslateChunk(
    opts.chunkSize ?? DEFAULT_TRANSLATE_CHUNK,
  );

  const batches = chunkArray(cues, batchSize);
  opts.onProgress?.(
    `Gemini dịch ${cues.length} cue · ${batches.length} lô ×${batchSize} (|| neo, Cap-style)…`,
    38,
  );

  const translatedBatches = await mapPool(
    batches,
    PARALLEL_BATCHES,
    async (batch, bi) => {
      const texts = batch.map((c) => c.text.replace(/\n+/g, ' ').trim() || '…');
      const out = await translateBatchTexts(texts, apiKeys, langName, ruleDesc);
      opts.onProgress?.(
        `  · lô ${bi + 1}/${batches.length} OK (${batch.length} cue)`,
      );
      return out;
    },
  );

  const flat = translatedBatches.flat();
  if (flat.length !== cues.length) {
    throw new Error(
      `Gemini translate merge lệch ${flat.length} vs ${cues.length} cue.`,
    );
  }

  const outCues: SrtCue[] = cues.map((c, i) => ({
    ...c,
    text: flat[i] || c.text,
  }));

  return (
    outCues
      .map(
        (c) =>
          `${c.index}\n${formatSrtTimestamp(c.startMs)} --> ${formatSrtTimestamp(c.endMs)}\n${c.text}\n`,
      )
      .join('\n') + '\n'
  );
}

export const __test = { ANCHOR, DEFAULT_TRANSLATE_CHUNK, translateBatchTexts };
