/**
 * Client-safe Dịch SRT catalog — id + label only.
 * Rule descriptions + Gemini prompt kernel stay crown-sealed (server).
 */

export type TranslateRulePublic = {
  id: string;
  label: string;
};

/** Labels for UI dropdown — no style-instruction payloads. */
export const TRANSLATE_RULE_PUBLIC_OPTIONS: TranslateRulePublic[] = [
  { id: 'xianxia', label: 'Tu tiên / Huyền huyễn' },
  { id: 'romance', label: 'Lãng mạn' },
  { id: 'wuxia', label: 'Võ hiệp' },
  { id: 'palace', label: 'Cung đấu' },
  { id: 'rich', label: 'Tổng tài / Giới siêu giàu' },
  { id: 'school', label: 'Học đường' },
  { id: 'comedy', label: 'Hài hước' },
  { id: 'horror', label: 'Kinh dị / Phá án' },
  { id: 'action', label: 'Hành động' },
  { id: 'scifi', label: 'Khoa học viễn tưởng' },
  { id: 'history', label: 'Lịch sử / Chiến tranh' },
  { id: 'modern', label: 'Hiện đại / Đời thường' },
  { id: 'strict', label: 'Strict 1-1 (Light Novel)' },
  { id: 'auto', label: 'Tự động (AI đoán ngữ cảnh)' },
];

/** Chunk UX bounds (not prompt IP). */
export const DEFAULT_TRANSLATE_CHUNK = 50;
export const MIN_TRANSLATE_CHUNK = 5;
export const MAX_TRANSLATE_CHUNK = 100;

export function clampTranslateChunk(n: unknown): number {
  const v = typeof n === 'number' ? n : parseInt(String(n ?? ''), 10);
  if (!Number.isFinite(v)) return DEFAULT_TRANSLATE_CHUNK;
  return Math.max(MIN_TRANSLATE_CHUNK, Math.min(MAX_TRANSLATE_CHUNK, Math.trunc(v)));
}
