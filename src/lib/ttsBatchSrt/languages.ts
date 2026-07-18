/**
 * Popular languages for TTS Batch SRT (STT + translate + UI).
 * Codes align with Whisper / ISO-ish short codes used by python_core subtitle.
 */

export type BatchLangCode =
  | 'auto'
  | 'zh'
  | 'vi'
  | 'en'
  | 'ja'
  | 'ko'
  | 'th'
  | 'id'
  | 'ms'
  | 'hi'
  | 'es'
  | 'pt'
  | 'fr'
  | 'de'
  | 'it'
  | 'ru'
  | 'ar'
  | 'tr'
  | 'pl'
  | 'nl'
  | 'uk'
  | 'fil';

export type BatchLangOption = {
  code: BatchLangCode;
  label: string;
  /** English name for Gemini translate prompt */
  enName: string;
  /** Usable as STT language (false = only target translate) */
  stt?: boolean;
};

/** Source (STT) + target lists share catalog; auto only for source. */
export const BATCH_LANG_CATALOG: BatchLangOption[] = [
  { code: 'auto', label: 'Auto (STT tự nhận)', enName: 'auto-detect', stt: true },
  { code: 'zh', label: '中文 · Trung', enName: 'Chinese', stt: true },
  { code: 'vi', label: 'Tiếng Việt', enName: 'Vietnamese', stt: true },
  { code: 'en', label: 'English · Anh', enName: 'English', stt: true },
  { code: 'ja', label: '日本語 · Nhật', enName: 'Japanese', stt: true },
  { code: 'ko', label: '한국어 · Hàn', enName: 'Korean', stt: true },
  { code: 'th', label: 'ไทย · Thái', enName: 'Thai', stt: true },
  { code: 'id', label: 'Indonesia', enName: 'Indonesian', stt: true },
  { code: 'ms', label: 'Melayu · Mã Lai', enName: 'Malay', stt: true },
  { code: 'hi', label: 'हिन्दी · Hindi', enName: 'Hindi', stt: true },
  { code: 'es', label: 'Español · Tây Ban Nha', enName: 'Spanish', stt: true },
  { code: 'pt', label: 'Português · Bồ Đào Nha', enName: 'Portuguese', stt: true },
  { code: 'fr', label: 'Français · Pháp', enName: 'French', stt: true },
  { code: 'de', label: 'Deutsch · Đức', enName: 'German', stt: true },
  { code: 'it', label: 'Italiano · Ý', enName: 'Italian', stt: true },
  { code: 'ru', label: 'Русский · Nga', enName: 'Russian', stt: true },
  { code: 'ar', label: 'العربية · Ả Rập', enName: 'Arabic', stt: true },
  { code: 'tr', label: 'Türkçe · Thổ', enName: 'Turkish', stt: true },
  { code: 'pl', label: 'Polski · Ba Lan', enName: 'Polish', stt: true },
  { code: 'nl', label: 'Nederlands · Hà Lan', enName: 'Dutch', stt: true },
  { code: 'uk', label: 'Українська · Ukraine', enName: 'Ukrainian', stt: true },
  { code: 'fil', label: 'Filipino · Tagalog', enName: 'Filipino', stt: true },
];

export const SOURCE_LANG_OPTIONS = BATCH_LANG_CATALOG.filter(
  (l) => l.stt !== false,
);

export const TARGET_LANG_OPTIONS = BATCH_LANG_CATALOG.filter(
  (l) => l.code !== 'auto',
);

const ALIASES: Record<string, BatchLangCode> = {
  auto: 'auto',
  zh: 'zh',
  cn: 'zh',
  'zh-cn': 'zh',
  'zh-tw': 'zh',
  chinese: 'zh',
  trung: 'zh',
  vi: 'vi',
  vn: 'vi',
  vietnamese: 'vi',
  viet: 'vi',
  en: 'en',
  eng: 'en',
  english: 'en',
  anh: 'en',
  ja: 'ja',
  jp: 'ja',
  japanese: 'ja',
  nhat: 'ja',
  ko: 'ko',
  kr: 'ko',
  korean: 'ko',
  han: 'ko',
  th: 'th',
  thai: 'th',
  id: 'id',
  indonesian: 'id',
  ms: 'ms',
  malay: 'ms',
  hi: 'hi',
  hindi: 'hi',
  es: 'es',
  spa: 'es',
  spanish: 'es',
  pt: 'pt',
  portuguese: 'pt',
  fr: 'fr',
  french: 'fr',
  de: 'de',
  german: 'de',
  it: 'it',
  italian: 'it',
  ru: 'ru',
  russian: 'ru',
  ar: 'ar',
  arabic: 'ar',
  tr: 'tr',
  turkish: 'tr',
  pl: 'pl',
  polish: 'pl',
  nl: 'nl',
  dutch: 'nl',
  uk: 'uk',
  ukrainian: 'uk',
  fil: 'fil',
  tl: 'fil',
  tagalog: 'fil',
  filipino: 'fil',
};

export function normalizeBatchLang(raw?: string, fallback: BatchLangCode = 'zh'): BatchLangCode {
  const t = String(raw || '')
    .trim()
    .toLowerCase()
    .normalize('NFC');
  if (!t) return fallback;
  if (ALIASES[t]) return ALIASES[t];
  // Vietnamese diacritics / loose match
  if (t.includes('trung') || t.includes('chinese')) return 'zh';
  if (t.includes('việt') || t.includes('viet')) return 'vi';
  if (t.includes('anh') || t.includes('english')) return 'en';
  if (t.includes('nhật') || t.includes('japan')) return 'ja';
  if (t.includes('hàn') || t.includes('korea')) return 'ko';
  const two = t.slice(0, 2) as BatchLangCode;
  if (BATCH_LANG_CATALOG.some((l) => l.code === two)) return two;
  return fallback;
}

export function langEnName(code: string): string {
  const hit = BATCH_LANG_CATALOG.find((l) => l.code === code);
  return hit?.enName || code || 'the target language';
}

/** Whisper / nav gateway language payload */
export function toSttLanguage(code: BatchLangCode | string): string {
  const c = normalizeBatchLang(code, 'auto');
  if (c === 'auto') return 'auto';
  return c;
}
