/**
 * Load project context from durable Zustand backup (server-side).
 * Engine native không đọc browser localStorage — dùng disk backup.
 */
import { readStoreBackup } from '@/lib/persistStore';

export interface ProjectContext {
  ten_tac_pham: string;
  dan_y_tong_the: string;
  lorebook: string;
  tom_tat_cuon_chieu: string;
  tri_nho_ngan_han: string[];
  nhan_vat: string[];
  nhan_vat_prompts: Record<string, unknown>;
  so_chuong: number;
  so_tu_chuong: number;
  ngon_ngu: string;
  /** Setup truyện — bắt buộc cho write/gen (B10, không ép mạt thế) */
  chu_de: string;
  phong_cach: string;
  /** visual DNA / media style for director formulas */
  visualDnaPrompt: string;
  mediaStylePreset: string;
  wpm: number;
  secondsPerBeat: number;
  apiKeys: string[];
  openaiApiKeys: string[];
  grokApiKeys: string[];
  aiMasterModel: string;
  danh_sach_chuong: Array<{
    so_chuong: number;
    tieu_de: string;
    dan_y: string;
    noi_dung: string;
    trang_thai?: string;
  }>;
  userRules?: { forbidden_words: string; fatigue_words: string };
}

/** Payload fields for /api/generate that need Setup genre (no silent mat-the). */
export function setupGenrePayload(ctx: ProjectContext): {
  chu_de: string;
  phong_cach: string;
  genre: string;
} {
  const chu_de = String(ctx.chu_de || '').trim();
  const phong_cach = String(ctx.phong_cach || '').trim();
  if (!chu_de && !phong_cach) {
    throw new Error(
      'Thieu Setup Chu de + Phong cach trong store. Mo Setup chon truoc khi chay AI Novel engine. App khong tu gan mat the.',
    );
  }
  return {
    chu_de,
    phong_cach,
    genre: [chu_de, phong_cach].filter(Boolean).join(' / '),
  };
}

export function styleHintFromContext(ctx: ProjectContext): string {
  return String(ctx.visualDnaPrompt || ctx.mediaStylePreset || '').trim();
}

function asArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : [];
}

export function loadProjectContext(): ProjectContext {
  const raw = readStoreBackup();
  let state: Record<string, unknown> = {};
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      state = (parsed?.state || parsed || {}) as Record<string, unknown>;
    } catch {
      state = {};
    }
  }

  const setup = (state.setup || {}) as Record<string, unknown>;
  const apiKeys = asArray(state.apiKeys);
  if (typeof state.apiKey === 'string' && state.apiKey && !apiKeys.includes(state.apiKey)) {
    apiKeys.unshift(state.apiKey);
  }
  const openaiApiKeys = asArray(state.openaiApiKeys);
  if (typeof state.openaiApiKey === 'string' && state.openaiApiKey) {
    openaiApiKeys.unshift(state.openaiApiKey);
  }
  const grokApiKeys = asArray(state.grokApiKeys);
  if (typeof state.grokApiKey === 'string' && state.grokApiKey) {
    grokApiKeys.unshift(state.grokApiKey);
  }

  const chapters = Array.isArray(state.danh_sach_chuong)
    ? (state.danh_sach_chuong as ProjectContext['danh_sach_chuong'])
    : [];

  return {
    ten_tac_pham: String(state.ten_tac_pham || 'Untitled'),
    dan_y_tong_the: String(state.dan_y_tong_the || ''),
    lorebook: String(state.lorebook || ''),
    tom_tat_cuon_chieu: String(state.tom_tat_cuon_chieu || ''),
    tri_nho_ngan_han: asArray(state.tri_nho_ngan_han),
    nhan_vat: asArray(state.nhan_vat),
    nhan_vat_prompts: (state.nhan_vat_prompts || {}) as Record<string, unknown>,
    so_chuong: Number(setup.so_chuong) || chapters.length || 10,
    so_tu_chuong: Number(setup.so_tu_chuong) || 4250,
    ngon_ngu: String(setup.ngon_ngu || 'Tiếng Việt'),
    chu_de: String(setup.chu_de || '').trim(),
    phong_cach: String(setup.phong_cach || '').trim(),
    visualDnaPrompt: String(state.visualDnaPrompt || '').trim(),
    mediaStylePreset: String(state.mediaStylePreset || '').trim(),
    wpm: Number(state.wpm) > 0 ? Number(state.wpm) : 0,
    secondsPerBeat: Number(state.secondsPerBeat) > 0 ? Number(state.secondsPerBeat) : 0,
    apiKeys,
    openaiApiKeys,
    grokApiKeys,
    aiMasterModel: String(state.aiMasterModel || 'gemini'),
    danh_sach_chuong: chapters,
    userRules: state.userRules as ProjectContext['userRules'],
  };
}

export function resolveGenerateKeys(ctx: ProjectContext): {
  keysToUse: string[];
  model: string;
} {
  const model = ctx.aiMasterModel || 'gemini';
  if (model === 'gpt4o') {
    return { keysToUse: ctx.openaiApiKeys, model };
  }
  if (model === 'llama') {
    return { keysToUse: ctx.grokApiKeys, model };
  }
  return { keysToUse: ctx.apiKeys, model };
}

export function generateBaseUrl(): string {
  const port = process.env.PORT || process.env.NEXT_PORT || '3000';
  return process.env.AI_NOVEL_INTERNAL_URL?.trim() || `http://127.0.0.1:${port}`;
}
