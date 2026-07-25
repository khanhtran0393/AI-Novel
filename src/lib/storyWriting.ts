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
  /** Full-chapter target = Setup so_tu_chuong (entire script body) */
  wordGoal: number;
  /** Floor 92% of goal — chapter still incomplete below this */
  wordMin: number;
  /** Hard ceiling +20% of goal — do not auto-continue / pad past this */
  wordMax: number;
  wordsOk: boolean;
  scenesOk: boolean;
  /**
   * Need more content only when under floor or under scenes,
   * AND still under hard ceiling (tránh 200%+ so_tu).
   */
  needsContinue: boolean;
  /** wordCount > wordMax — UI đỏ / quality warning */
  overSoftMax: boolean;
  /** wordCount >= wordGoal — đã đạt mục tiêu Setup */
  atOrOverGoal: boolean;
}

export function evaluateWordGate(
  text: string,
  wordGoal: number = DEFAULT_WORD_GOAL,
  minScenes: number = MIN_SCENE_COUNT,
): WordGateResult {
  // Goal = full chapter target (user so_tu_chuong). Fallback DEFAULT only if invalid.
  const goal = wordGoal > 0 ? Math.round(wordGoal) : DEFAULT_WORD_GOAL;
  const wordMin = Math.round(goal * 0.92);
  const wordMax = Math.round(goal * 1.2);
  const wordCount = getWordCount(text);
  const sceneCount = countSceneTags(text);
  const wordsOk = wordCount >= wordMin;
  const scenesOk = sceneCount >= minScenes;
  const overSoftMax = wordCount > wordMax;
  const atOrOverGoal = wordCount >= goal;
  /**
   * Continue only when chapter incomplete AND still room under hard max (+20%).
   * - Dưới sàn hoặc thiếu cảnh → bù (nếu < wordMax)
   * - Đã ≥ goal và đủ cảnh → xong
   * - Vượt wordMax → dừng (tránh 200%+ so_tu)
   */
  const needsContinue =
    !overSoftMax &&
    !(atOrOverGoal && scenesOk) &&
    (!wordsOk || !scenesOk);

  return {
    wordCount,
    sceneCount,
    wordGoal: goal,
    wordMin,
    wordMax,
    wordsOk,
    scenesOk,
    needsContinue,
    overSoftMax,
    atOrOverGoal,
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
 * short_manhua: Printfilm short-drama / manhua shot-thinking inside AI Novel [CẢNH] DNA.
 */
export function buildProseCraftBlock(
  scriptMode?: import('@/lib/scriptMode').ScriptMode | string,
): string {
  if (scriptMode === 'sang_van') {
    return `
--- NGHỆ THUẬT SẢNG VĂN (FAST-PACED DOPAMINE HIT — BẮT BUỘC) ---
1) TIẾT TẤU CỰC NHANH: Lược bỏ các miêu tả nội tâm rườm rà. Đi thẳng vào mâu thuẫn, giải quyết ân oán dứt khoát. Nhịp điệu dồn dập, liên tục có biến cố mới.
2) DOPAMINE HIT (THỎA MÃN TỨC THÌ): Bố trí các sự kiện nhận thưởng, thăng cấp, nhặt vật phẩm, hoặc bộc lộ sức mạnh một cách sảng khoái. Đừng để nhân vật chính chịu ủy khuất quá lâu.
3) VẢ MẶT (FACE-SLAPPING) & PHẢN SAI LỆCH: Kẻ thù/đám đông thường coi thường nhân vật chính lúc đầu, nhưng ngay sau đó bị sốc/khiếp sợ tột độ khi sức mạnh thật sự (Hệ thống/Ngón tay vàng) được bộc lộ.
4) BOUNDED OP (BÁ ĐẠO CÓ LOGIC): Nhân vật chính rất mạnh hoặc thăng tiến cực nhanh, nhưng sức mạnh đó phải đi kèm quy tắc/giới hạn rõ ràng (Ví dụ: cần thu thập đủ năng lượng, hệ thống có luật lệ riêng). Kẻ địch cũng phải có động cơ hợp lý chứ không ngu ngốc vô lý.
5) NGÔN TỪ HÀO SẢNG, CỰC NGẦU: Câu văn ngắn gọn, sắc bén. Nhấn mạnh vào hiệu ứng sức mạnh và sự ngỡ ngàng của quần chúng.`;
  }

  if (scriptMode === 'short_manhua') {
    return `
--- NGHỆ THUẬT SHORT / MANHUA (Printfilm-inspired — BẮT BUỘC, VẪN DNA AI NOVEL) ---
Mục tiêu: short drama / manhua / motion comic — sẵn storyboard, TTS, gen ảnh/video. KHÔNG viết tiểu thuyết dài thrift.
1) SHOT-THINKING: Mỗi [CẢNH] = 1–2 beat hình ảnh rõ (ai làm gì, máy/không gian gợi ý qua hành động). Hành động **nhìn được** — CẤM monologue nội tâm dài >3 câu.
2) THOẠI LÀ XƯƠNG: Ưu tiên hội thoại + phản ứng; narration tối giản (1–2 câu bối cảnh/cảnh). Thoại ngắn, dứt, fingerprint NV.
3) TAG CẢNH (giữ format AI Novel):
   [CẢNH N: NỘI/NGOẠI CẢNH. ĐỊA ĐIỂM CỤ THỂ - THỜI GIAN]
   Có thể thêm không khí ngắn trong title: "... - ĐÊM MƯA, CĂNG".
4) NHỊP SHORT: vào việc ngay 1–2 câu; cuối cảnh open loop/hệ quả (hook tập). CẤM time-skip tuần/tháng; real-time.
5) VISUAL ANCHOR: khi NV xuất hiện — 1 chi tiết trang phục/nhận dạng (wardrobe) để identity lock sau này.
6) PHÂN CẢNH: tối thiểu 3, có thể 5–8 cảnh ngắn (nhiều cut, ít tường thuật). Mỗi cảnh 1 xung đột/micro-goal.
7) CẤM: note đạo diễn thô [zoom in], (Cười), checklist A.B.C.; CẤM slogan SEO. Văn vẫn có tính người, subtext nhẹ.
8) ĐỦ TỪ BẰNG CỐT: đạt cổng từ bằng beat + thoại + stakes — KHÔNG đệm tính từ / lặp mô tả.`;
  }

  return `
--- NGHỆ THUẬT VĂN XUÔI SỐNG ĐỘNG (CHỐNG KHÔ KHAN, CÓ HỒN — BẮT BUỘC) ---
1) SHOW, DON'T TELL (CHI TIẾT ĐẮT): CẤM dùng các tính từ khái niệm sáo rỗng ("u ám, hoảng sợ, tuyệt vọng, nguy hiểm"). BẮT BUỘC dùng 1-2 chi tiết cụ thể nhìn thấy/nghe thấy/cảm thấy (Cử chỉ tay run, giọt mồ hôi lạnh, tiếng rít cửa mục, vệt khói ngột ngạt) để truyền tải cảm xúc.
2) SUBTEXT TRONG THOẠI (2 TẦNG NGHĨA): CẤM nhân vật thoại bộc lộ 100% mục đích trực diện kiểu AI lịch sự. Nhân vật phải nói mỉa, nói tránh, giấu ý định, hoặc ngập ngừng. Lời nói một đằng, hành động/ánh mắt một nẻo.
3) FINGERPRINT NHÂN VẬT & THOẠI ĐỜI: Mỗi nhân vật có cách xưng hô và nhịp thoại riêng (Main ngông/lạnh, Phản diện kiêu ngạo, Nữ chính sắc sảo). Thoại có ngắt quãng, im lặng một nhịp, mỉa mai, không thoại chuẩn mực như sách giáo khoa.
4) TIẾT TẤU ĐẤM & THỞ (PUNCH & BREATHE): Đan xen câu cực ngắn (1–4 từ: "Tối đen.", "Im lặng.", "Một tiếng nổ!") để đấm vào cảm xúc, sau đó dùng câu vừa (12–18 từ) để miêu tả nhịp thở. CẤM các câu dài đều đều 10-15 từ gây ru ngủ.
5) NỘI TÂM LỆCH TÍNH CÁCH: 1–2 câu suy nghĩ/nội tâm ngầm sắc bén, có tính người, không monologue giảng giải đạo lý hay tóm tắt lại cốt truyện.
6) CHUYỂN CẢNH CÓ HỆ QUẢ: Mở cảnh mới bằng hệ quả trực tiếp từ open loop cảnh trước. CẤM time-skip tuần/tháng hoặc tóm tắt dạng "sáng hôm sau mọi thứ bình yên".
7) BÁM SETUP & BẮT BÁO THÙ/VẢ MẶT KỊCH TÍNH: Giữ không khí kịch tính, tôn trọng bối cảnh thể loại Setup, dệt mâu thuẫn thành các stakes chạm vào cảm xúc người đọc.`;
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

// ── Setup genre (chu_de + phong_cach) — B10: no silent genre defaults ──

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
      'Thieu Setup Chu de + Phong cach. Mo Setup chon truoc khi viet/gen. App khong tu gan the loai mac dinh.',
    );
  }
  return label;
}

/**
 * Lorebook for system prompts — never invent "luật thế giới ngoài Setup…".
 * Empty lore is allowed (blank project); AI must not fabricate a default world.
 */
export function lorebookForPrompt(lorebook?: string | null): string {
  const lb = String(lorebook || '').trim();
  if (lb) return lb;
  return (
    'Chưa có lorebook. Chỉ bám dàn ý + Setup (chủ đề/phong cách) đã cho — ' +
    'TUYỆT ĐỐI KHÔNG tự bịa luật thế giới mặc định (không tự đổi thể loại ngoài Setup).'
  );
}

/** Role line for LLM system prompts — genre-aware, no hard-coded genre. */
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
