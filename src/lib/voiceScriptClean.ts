/**
 * Làm sạch kịch bản thô cho bộ đọc giọng nói AI.
 * (Di chuyển từ src/app/workspace/utils/stringUtils.ts khi GUI cũ bị xóa.)
 */
export function cleanVoiceScript(text: string): string {
  let cleaned = text;
  cleaned = cleaned.replace(/\[?CẢNH\s+\d+:[^\]\n]+\]?/gi, '');
  cleaned = cleaned.replace(/CẢNH\s+\d+:\s*[^\n]+/gi, '');
  cleaned = cleaned.replace(/\([^)]*\)/g, '');
  cleaned = cleaned.replace(/\[[^\]]*\]/g, '');
  cleaned = cleaned.replace(/[\*_`#]/g, '');
  cleaned = cleaned.replace(/^[a-zA-ZÀ-ỹ\s\d\-]+:/gm, '');
  cleaned = cleaned.replace(/^[a-zA-ZÀ-ỹ\s\d\-]+\([^)]*\):/gm, '');

  return cleaned
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .join('\n\n')
    .trim();
}
