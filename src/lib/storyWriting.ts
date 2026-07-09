/**
 * Shared story-writing utilities (client + API route).
 * Word-Gate, scene parsing/normalization, continue-tail truncation.
 */

import { formatProfileBibleLine, type NhanVatProfile } from './characterProfile';

export const DEFAULT_WORD_GOAL = 4250;
export const MIN_SCENE_COUNT = 3;
export const CONTINUE_TAIL_WORDS = 1200;
export const MAX_AUTO_CONTINUES = 2;

export function getWordCount(text: string): number {
  if (!text) return 0;
  const cleaned = text.normalize('NFC').replace(/\[[^\]]*\]/g, '').trim();
  if (!cleaned) return 0;
  return cleaned.split(/\s+/).filter(Boolean).length;
}

/** Normalize messy AI scene headings into [CẢNH N: ...] */
export function normalizeSceneTags(text: string): string {
  if (!text) return '';
  let t = text.normalize('NFC');

  // Fullwidth / decorative brackets: 【CẢNH 1: ...】
  t = t.replace(/【\s*CẢNH\s+(\d+)\s*[:：\-–—]\s*([^】]+)】/gi, (_, n, title) => {
    return `[CẢNH ${n}: ${String(title).trim()}]`;
  });

  // Line: optional markdown/brackets + CẢNH N: title
  t = t.replace(
    /^[ \t]*(?:#{1,4}[ \t]*)?(?:\[\s*)?CẢNH\s+(\d+)\s*[:：\-–—]\s*(.+?)\s*\]?[ \t]*$/gim,
    (_, n, title) => {
      const cleanTitle = String(title)
        .replace(/^\[+|\]+$/g, '')
        .replace(/^CẢNH\s+\d+\s*[:：\-–—]\s*/i, '')
        .trim();
      return `[CẢNH ${n}: ${cleanTitle || 'PHÂN CẢNH'}]`;
    },
  );

  // Already-correct tags: normalize spacing
  t = t.replace(
    /\[\s*CẢNH\s+(\d+)\s*[:：]\s*([^\]]+)\]/gi,
    (_, n, title) => `[CẢNH ${n}: ${String(title).trim()}]`,
  );

  return t;
}

export function parseScenes(text: string): { title: string; content: string }[] {
  if (!text) return [];
  const normalizedText = normalizeSceneTags(text);
  const regex = /(\[CẢNH\s+\d+\s*:[^\]\n]+\])/gi;
  const parts = normalizedText.split(regex);

  if (parts.length <= 1) {
    return [{ title: 'KỊCH BẢN', content: normalizedText }];
  }

  const scenes: { title: string; content: string }[] = [];
  if (parts[0].trim()) {
    scenes.push({ title: 'MỞ ĐẦU', content: parts[0].trim() });
  }

  for (let i = 1; i < parts.length; i += 2) {
    const title = parts[i].trim();
    const content = parts[i + 1] ? parts[i + 1].trim() : '';
    scenes.push({ title, content });
  }

  return scenes;
}

/** Count real scene tags (excludes synthetic MỞ ĐẦU / KỊCH BẢN). */
export function countSceneTags(text: string): number {
  if (!text) return 0;
  const normalized = normalizeSceneTags(text);
  const matches = normalized.match(/\[CẢNH\s+\d+\s*:[^\]]+\]/gi);
  return matches ? matches.length : 0;
}

export interface WordGateResult {
  wordCount: number;
  sceneCount: number;
  wordGoal: number;
  wordMin: number;
  wordsOk: boolean;
  scenesOk: boolean;
  needsContinue: boolean;
}

export function evaluateWordGate(
  text: string,
  wordGoal: number = DEFAULT_WORD_GOAL,
  minScenes: number = MIN_SCENE_COUNT,
): WordGateResult {
  const goal = wordGoal > 0 ? wordGoal : DEFAULT_WORD_GOAL;
  const wordMin = Math.round(goal * 0.92);
  const wordCount = getWordCount(text);
  const sceneCount = countSceneTags(text);
  const wordsOk = wordCount >= wordMin;
  const scenesOk = sceneCount >= minScenes;
  return {
    wordCount,
    sceneCount,
    wordGoal: goal,
    wordMin,
    wordsOk,
    scenesOk,
    needsContinue: !wordsOk || !scenesOk,
  };
}

export interface ContinueContext {
  /** Text for prompt: locked head summary + tail to continue from */
  promptBody: string;
  isTruncated: boolean;
  tailWordCount: number;
}

/**
 * For continue mode: do not dump full chapter into the prompt.
 * Send a short locked head + last N words as the live tail.
 */
export function buildContinueContext(
  fullText: string,
  tailWords: number = CONTINUE_TAIL_WORDS,
): ContinueContext {
  const text = (fullText || '').normalize('NFC').trim();
  if (!text) {
    return { promptBody: '', isTruncated: false, tailWordCount: 0 };
  }

  const words = text.split(/\s+/).filter(Boolean);
  if (words.length <= tailWords) {
    return {
      promptBody:
        '--- PHẦN NỘI DUNG ĐANG VIẾT DANG DỞ ---\n' +
        text +
        '\n\nBẠN ĐANG Ở CHẾ ĐỘ VIẾT TIẾP. HÃY ĐỌC PHẦN DANG DỞ TRÊN VÀ BẮT ĐẦU VIẾT NỐI TIẾP VÀO ĐÓ. KHÔNG lặp lại đoạn đã có.',
      isTruncated: false,
      tailWordCount: words.length,
    };
  }

  const headWords = words.slice(0, Math.min(180, words.length - tailWords));
  const tail = words.slice(-tailWords).join(' ');
  const lockedSummary = headWords.join(' ');

  return {
    promptBody:
      '--- PHẦN ĐÃ KHÓA (CHỈ ĐỌC, TUYỆT ĐỐI KHÔNG VIẾT LẠI / KHÔNG TÓM TẮT LẠI) ---\n' +
      lockedSummary +
      '\n...[phần giữa đã viết đủ, bị cắt để tiết kiệm ngữ cảnh]...\n\n' +
      '--- ĐUÔI NỘI DUNG CẦN NỐI TIẾP (VIẾT TIẾP NGAY SAU ĐOẠN NÀY) ---\n' +
      tail +
      '\n\nBẠN ĐANG Ở CHẾ ĐỘ VIẾT TIẾP. Chỉ sinh phần MỚI nối liền sau đuôi trên. Không lặp cảnh/câu đã có. Nếu chưa đủ số cảnh, tiếp tục thêm [CẢNH X: ...] mới.',
    isTruncated: true,
    tailWordCount: tailWords,
  };
}

export function truncateOutline(text: string, maxChars = 1800): string {
  const t = (text || '').normalize('NFC').trim();
  if (t.length <= maxChars) return t;
  return t.slice(0, maxChars) + '\n...[dàn ý đã rút gọn]...';
}

export function formatCharacterBible(
  nhan_vat: string[] | undefined,
  nhan_vat_prompts?: Record<string, Partial<NhanVatProfile>>,
): string {
  const names = Array.isArray(nhan_vat) ? nhan_vat.filter(Boolean) : [];
  if (names.length === 0 && (!nhan_vat_prompts || Object.keys(nhan_vat_prompts).length === 0)) {
    return 'Chưa có hồ sơ nhân vật.';
  }

  const lines: string[] = [];
  const seen = new Set<string>();

  for (const name of names) {
    seen.add(name);
    const p = nhan_vat_prompts?.[name];
    if (p) {
      lines.push(formatProfileBibleLine(name, p));
    } else {
      lines.push(`- ${name}: (chưa có hồ sơ chi tiết — giữ tên và vai trò ổn định).`);
    }
  }

  if (nhan_vat_prompts) {
    for (const [name, p] of Object.entries(nhan_vat_prompts)) {
      if (seen.has(name)) continue;
      lines.push(formatProfileBibleLine(name, p));
    }
  }

  return lines.join('\n');
}

export function formatSpentEntities(entities?: {
  dia_diem?: string[];
  vat_pham?: string[];
  motifs?: string[];
}): string {
  if (!entities) return 'Chưa ghi nhận.';
  const d = entities.dia_diem?.length ? entities.dia_diem.join(', ') : '(trống)';
  const v = entities.vat_pham?.length ? entities.vat_pham.join(', ') : '(trống)';
  const m = entities.motifs?.length ? entities.motifs.join(', ') : '(trống)';
  return `Địa điểm đã dùng: ${d}\nVật phẩm đã dùng: ${v}\nMotif đã dùng: ${m}\n→ Ưu tiên bối cảnh/motif MỚI, tránh lặp nguyên xi.`;
}

export function formatWorldState(ws?: {
  inventory?: string[];
  discovered_clues?: string[];
  current_location?: string;
}): string {
  if (!ws) return 'Chưa có.';
  return [
    `Vị trí hiện tại: ${ws.current_location || '(chưa rõ)'}`,
    `Inventory: ${(ws.inventory || []).join(', ') || '(trống)'}`,
    `Clues đã phát hiện: ${(ws.discovered_clues || []).join(', ') || '(trống)'}`,
  ].join('\n');
}

/** Keys in store media maps are `${chapter}_${scene}...` or `char_*`. */
export function isChapterAssetKey(key: string, chapterNum: number): boolean {
  const prefix = `${chapterNum}_`;
  return key === String(chapterNum) || key.startsWith(prefix);
}

export function filterOutChapterKeys<T>(
  record: Record<string, T> | undefined,
  chapterNum: number,
): Record<string, T> {
  if (!record) return {};
  const next: Record<string, T> = {};
  for (const [k, v] of Object.entries(record)) {
    if (!isChapterAssetKey(k, chapterNum)) next[k] = v;
  }
  return next;
}
