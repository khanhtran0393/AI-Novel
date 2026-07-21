/**
 * Shared story-writing utilities (client + API route).
 * Word-Gate, scene parsing/normalization, continue-tail truncation.
 */

import { assetKeyBelongsToChapter } from '@/contracts';
import { formatProfileBibleLine, type NhanVatProfile } from './characterProfile';

export const DEFAULT_WORD_GOAL = 4250;
export const MIN_SCENE_COUNT = 3;
/** Longer tail = better style continuity when auto-continue / word-gate bù. */
export const CONTINUE_TAIL_WORDS = 1600;
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

const CONTINUE_CRAFT =
  'BẠN ĐANG Ở CHẾ ĐỘ VIẾT TIẾP (nối mạch, không vá máy):\n' +
  '- Chỉ sinh phần MỚI ngay sau đuôi; KHÔNG lặp câu/cảnh/đoạn đã có.\n' +
  '- Bám GIỌNG đã có: độ dài câu, cách xưng hô, quirk thoại, nhịp im lặng — như cùng một cây bút.\n' +
  '- Nối bằng hệ quả / lựa chọn / thông tin mới; CẤM nhồi tính từ, CẤM tóm tắt lại, CẤM reset nhịp “bắt đầu lại từ đầu”.\n' +
  '- Nếu thiếu phân cảnh: thêm [CẢNH X: ...] mới với xung đột riêng, không cắt cảnh cũ giữa chừng vô lý.\n' +
  '- Câu đầu phần mới phải đọc liền sau câu cuối đuôi (cùng thời điểm/không gian hoặc chuyển cảnh có lý do).';

/**
 * For continue mode: do not dump full chapter into the prompt.
 * Send a short locked head + last N words as the live tail.
 * Longer tail + craft rules reduce “thô cứng” when word-gate auto-continues.
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
        '\n\n' +
        CONTINUE_CRAFT,
      isTruncated: false,
      tailWordCount: words.length,
    };
  }

  // More head words = better voice/style fingerprint without dumping full mid-chapter.
  const headCap = Math.min(280, Math.max(120, words.length - tailWords));
  const headWords = words.slice(0, headCap);
  const tail = words.slice(-tailWords).join(' ');
  const lockedSummary = headWords.join(' ');

  return {
    promptBody:
      '--- PHẦN ĐÃ KHÓA (CHỈ ĐỌC — fingerprint giọng; TUYỆT ĐỐI KHÔNG VIẾT LẠI / KHÔNG TÓM TẮT LẠI) ---\n' +
      lockedSummary +
      '\n...[phần giữa đã viết đủ, bị cắt để tiết kiệm ngữ cảnh]...\n\n' +
      '--- ĐUÔI NỘI DUNG CẦN NỐI TIẾP (VIẾT TIẾP NGAY SAU ĐOẠN NÀY) ---\n' +
      tail +
      '\n\n' +
      CONTINUE_CRAFT,
    isTruncated: true,
    tailWordCount: tailWords,
  };
}

/**
 * Prose craft (anti-stiff) — does NOT relax forbidden/fatigue word lists (IRON CẤM stays elsewhere).
 * Injected into WRITE/REVISE/expand so narration feels novelistic, not production checklist.
 */
export function buildProseCraftBlock(): string {
  return `
--- NGHỆ THUẬT VĂN XUÔI (CHỐNG THÔ CỨNG — BẮT BUỘC) ---
1) NHỊP CÂU: Xen câu ngắn (đấm) và câu vừa/dài vừa (thở). CẤM cả đoạn toàn câu đều 8–12 từ; CẤM checklist hành động “A. B. C.”.
2) ĐOẠN VĂN: Mỗi đoạn 1 ý cảm xúc/tình huống. Đổi đoạn khi đổi focus (nhân vật / không gian / nội tâm) — không tường thuật dàn đều một nhịp.
3) SUBTEXT: Thoại để lại khoảng trống; nhân vật che giấu, nói tránh, nói dối nhẹ. CẤM giải thích hết cảm xúc bằng lời kể (“hắn sợ vì…”, “cô ấy buồn vì…”).
4) NỘI TÂM TỰ NHIÊN: 1–3 câu nghĩ/cảm xen hành động — cụ thể, lệch, có tính cách; không monologue giảng giải.
5) CHI TIẾT ĐẮT: 1–2 chi tiết cụ thể/cảnh (vật, âm thanh, mùi, cử chỉ) thay vì liệt kê 5 giác quan.
6) CHUYỂN CẢNH: Mở cảnh mới bằng hệ quả hoặc đối lập với open loop cảnh trước — không reset “sáng hôm sau mọi thứ yên” (vẫn cấm time-skip tuần/tháng).
7) THOẠI ĐỜI: Ngắt quãng, lặp, nói dở, im lặng 1 nhịp. Mỗi NV giữ fingerprint riêng — không thoại “AI lịch sự”.
8) ĐỦ DÀI BẰNG CỐT: Thêm xung đột, lựa chọn, hậu quả, hội thoại có stakes — KHÔNG đệm tính từ / lặp mô tả.`;
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

/** Keys in store media maps — @see contracts/keys (scene/image/video/char). */
export function isChapterAssetKey(key: string, chapterNum: number): boolean {
  return assetKeyBelongsToChapter(key, chapterNum);
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

// ── Setup genre (chu_de + phong_cach) — B10: no silent "mạt thế" defaults ──

export type SetupGenreInput = {
  genre?: string;
  chu_de?: string;
  phong_cach?: string;
};

/** Join Setup fields into a single genre label. Empty if not configured. */
export function buildGenreLabelFromSetup(input: SetupGenreInput): string {
  const explicit = String(input.genre || '').trim();
  if (explicit) return explicit;
  return [input.chu_de, input.phong_cach]
    .map((s) => String(s || '').trim())
    .filter(Boolean)
    .join(' / ');
}

/**
 * Require Setup genre for write/prompt engines.
 * Throws Error with actionable message (callers map to 400 / toast).
 */
export function requireGenreLabelFromSetup(input: SetupGenreInput): string {
  const label = buildGenreLabelFromSetup(input);
  if (!label) {
    throw new Error(
      'Thieu Setup Chu de + Phong cach. Mo Setup chon truoc khi viet/gen. App khong tu gan mat the.',
    );
  }
  return label;
}

/**
 * Lorebook for system prompts — never invent "Luật thế giới mạt thế…".
 * Empty lore is allowed (blank project); AI must not fabricate a default world.
 */
export function lorebookForPrompt(lorebook?: string | null): string {
  const lb = String(lorebook || '').trim();
  if (lb) return lb;
  return (
    'Chưa có lorebook. Chỉ bám dàn ý + Setup (chủ đề/phong cách) đã cho — ' +
    'TUYỆT ĐỐI KHÔNG tự bịa luật thế giới mặc định (không ép mạt thế/sinh tồn nếu Setup khác).'
  );
}

/** Role line for LLM system prompts — genre-aware, no hard-coded mat-the. */
export function writeEngineRoleLine(
  genreLabel: string,
  kind:
    | 'writer'
    | 'editor'
    | 'reviewer'
    | 'memory'
    | 'hook_writer'
    | 'hook_editor'
    | 'scene_writer'
    | 'scene_editor',
): string {
  const g = genreLabel.trim() || 'theo Setup user';
  switch (kind) {
    case 'writer':
      return (
        `Bạn là nhà văn / biên kịch kể chuyện chuyên nghiệp — văn xuôi tiếng Việt mượt, có nhịp thở và chiều sâu nhân vật, ` +
        `vẫn đọc tốt khi narration. Thể loại Setup: ${g}. Ưu tiên cảm giác “truyện hay” hơn checklist sản xuất.`
      );
    case 'editor':
      return (
        `Bạn là biên tập viên văn học kiêm editor narration — trau chuốt nhịp câu, thoại đời, subtext; ` +
        `cắt thô cứng / sáo rỗng. Thể loại Setup: ${g}.`
      );
    case 'reviewer':
      return `Bạn là Tổng biên tập khắt khe (văn học + nhịp kể chuyện) — thể loại: ${g}.`;
    case 'memory':
      return `Bạn là Trợ lý Biên kịch kiêm Bộ Nén Ký Ức logic — thể loại: ${g}.`;
    case 'hook_writer':
      return (
        `Bạn là biên kịch cold-open (~30–45 giây đọc) — câu sắc, hình ảnh đắt, vẫn mượt như văn kể. Thể loại: ${g}.`
      );
    case 'hook_editor':
      return `Bạn là biên tập cold-open (~30 giây đọc) — giữ căng, bớt thô, bớt sáo. Thể loại: ${g}.`;
    case 'scene_writer':
      return (
        `Bạn là nhà văn / biên kịch phân cảnh — mở rộng bằng nội tâm, subtext và chi tiết đắt, không nhồi checklist. Thể loại: ${g}.`
      );
    case 'scene_editor':
      return `Bạn là biên tập phân cảnh — mượt hóa câu chữ, giữ cốt, chống thô cứng. Thể loại: ${g}.`;
    default:
      return `Bạn là nhà văn / biên kịch kể chuyện — thể loại: ${g}.`;
  }
}

/** Extract setup genre fields from a loose API payload. */
export function setupGenreFromPayload(payload: Record<string, unknown> | null | undefined): SetupGenreInput {
  const p = payload || {};
  return {
    genre: typeof p.genre === 'string' ? p.genre : undefined,
    chu_de: typeof p.chu_de === 'string' ? p.chu_de : undefined,
    phong_cach: typeof p.phong_cach === 'string' ? p.phong_cach : undefined,
  };
}
