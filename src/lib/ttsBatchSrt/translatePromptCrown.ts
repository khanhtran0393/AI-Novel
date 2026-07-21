/**
 * Cap-style Gemini translate prompt kernel (crown IP).
 * Sealed for customer packs — edit here, then `npm run crown:seal`.
 */

/** Cap neo giữa các cue trong một lô. */
export const TRANSLATE_ANCHOR = ' || ';

/**
 * Soft split pattern source (string) — sealed; runtime builds RegExp.
 * Matches Cap: flexible spaces around ||
 */
export const translateSoftSplitPatternSource = String.raw`\s*\|\|\s*`;

export type TranslateBatchPromptInput = {
  langName: string;
  ruleDesc: string;
  texts: string[];
  anchor?: string;
};

/**
 * Prompt bám Cap: văn phong tự nhiên + rule + neo cứng (không gửi timestamp).
 */
export function buildTranslateBatchPrompt(input: TranslateBatchPromptInput): string {
  const anchor = input.anchor ?? TRANSLATE_ANCHOR;
  const joined = input.texts.join(anchor);
  const n = input.texts.length;
  return `Bạn là chuyên gia dịch phụ đề chuyên nghiệp (Google Gemini / AI Studio).
Nhiệm vụ: Dịch TỪNG đoạn sang ${input.langName} — văn phong mềm mại, tự nhiên, không khô như máy.
Quy tắc đặc biệt (phong cách): ${input.ruleDesc}

INPUT: các đoạn được ngăn bằng đúng chuỗi ${JSON.stringify(anchor)}
OUTPUT: CÙNG SỐ đoạn, ngăn bằng đúng chuỗi đó.

HARD RULES:
1. Giữ đúng số đoạn = ${n}. Không gộp, không tách, không bỏ đoạn.
2. KHÔNG thêm số thứ tự, timestamp, markdown, giải thích.
3. Chỉ trả về các đoạn đã dịch, nối bằng ${JSON.stringify(anchor)}.
4. Giữ tên riêng / thuật ngữ quan trọng khi hợp lý với phong cách trên.

--- ĐOẠN ---
${joined}`;
}
