/**
 * CapAssist sanitize_text_for_tts — strip emoji / control chars so TTS doesn't choke.
 */
export function sanitizeTextForTts(raw: string): string {
  let s = String(raw || '').normalize('NFC');
  // HTML tags
  s = s.replace(/<[^>]+>/g, ' ');
  // Emoji & symbols (broad BMP + surrogate pairs)
  s = s.replace(
    /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE00}-\u{FE0F}\u{200D}\u{20E3}]/gu,
    '',
  );
  // Zero-width / bidi controls
  s = s.replace(/[\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF]/g, '');
  // Keep letters, numbers, common punctuation for VI/EN/CJK
  s = s.replace(/[^\p{L}\p{N}\p{P}\p{Zs}\n.,!?;:'"()\-–—…%/]/gu, ' ');
  // Collapse whitespace
  s = s.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  return s;
}
