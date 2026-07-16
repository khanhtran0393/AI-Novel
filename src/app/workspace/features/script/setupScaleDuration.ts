/**
 * Ước lượng thời gian đọc theo WPM (tốc độ đọc trong cài đặt).
 * phút = số_từ / WPM
 */

export function resolveWpm(wpm?: number | null): number {
  const n = Number(wpm);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
}

/** Phút (có thể lẻ 0.1); làm tròn hợp lý cho UI */
export function wordsToMinutes(words: number, wpm?: number | null): number {
  const w = Math.max(0, Number(words) || 0);
  const rate = resolveWpm(wpm);
  if (w <= 0 || rate <= 0) return 0;
  return w / rate;
}

export function formatMinutesLabel(minutes: number): string {
  if (!Number.isFinite(minutes) || minutes <= 0) return '— phút';
  if (minutes < 1) {
    const sec = Math.max(1, Math.round(minutes * 60));
    return `~${sec} giây`;
  }
  if (minutes < 10) {
    // 1 decimal for short durations
    const m = Math.round(minutes * 10) / 10;
    return `~${m} phút`;
  }
  return `~${Math.round(minutes)} phút`;
}

export function chapterWordsMinutes(
  soTuChuong: number,
  wpm?: number | null,
): { words: number; minutes: number; label: string; wpm: number } {
  const words = Math.max(0, Number(soTuChuong) || 0);
  const rate = resolveWpm(wpm);
  const minutes = wordsToMinutes(words, rate);
  return {
    words,
    minutes,
    label: formatMinutesLabel(minutes),
    wpm: rate,
  };
}

export function totalScaleMinutes(
  soChuong: number,
  soTuChuong: number,
  wpm?: number | null,
): { totalWords: number; minutes: number; label: string; wpm: number } {
  const chapters = Math.max(0, Number(soChuong) || 0);
  const wordsPer = Math.max(0, Number(soTuChuong) || 0);
  const rate = resolveWpm(wpm);
  const totalWords = chapters * wordsPer;
  const minutes = wordsToMinutes(totalWords, rate);
  return {
    totalWords,
    minutes,
    label: formatMinutesLabel(minutes),
    wpm: rate,
  };
}
