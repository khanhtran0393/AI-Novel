/**
 * YouTube-safe production: gates, humanize, audio/visual studio helpers,
 * export pack (chapters, cut plan, hook).
 */

export const DEFAULT_FORBIDDEN_WORDS =
  'đáng chú ý là, nhìn chung, có thể nói rằng, không thể phủ nhận, trong bối cảnh hiện nay, nói một cách dễ hiểu, tóm lại là, nói tóm lại';

export const DEFAULT_FATIGUE_WORDS =
  'không khỏi, dường như, bất chợt, bỗng nhiên, ánh mắt sâu thẳm, trái tim thắt lại, không khí như đông đặc, trong tích tắc, lướt qua tâm trí, một cảm giác khó tả, ánh lên quyết tâm, nuốt nước bọt, siết chặt nắm đấm';

export const HIGH_RISK_TTS_PLATFORMS = new Set(['tiktok_tts', 'edge_tts']);

export const SHOT_SCALE_CYCLE = [
  'wide establishing shot, full environment, subject small in frame',
  'medium shot, waist-up character, layered depth',
  'close-up face or hands, shallow depth of field, emotional detail',
  'extreme insert detail of object/prop/surface texture',
  'over-the-shoulder or dutch tension angle',
] as const;

export type EditorVerdict = 'accept' | 'rewrite' | 'polish' | string | undefined;

export interface YoutubeSafeConfig {
  enforceEditorGate: boolean;
  applyLoudnorm: boolean;
  humanizeScript: boolean;
  lockSeriesVoice: boolean;
  /** Require author checkbox "đã sửa tay" before TTS */
  requireHumanEdit: boolean;
  /** Insert breath pauses in script before TTS */
  injectBreathPauses: boolean;
  /** Pink-noise room tone under voice */
  roomTone: boolean;
  /** Mix optional BGM bed (needs bgmPath or auto low bed) */
  bgmMix: boolean;
  bgmPath: string;
  /** Offset pitch slightly from scene emotion */
  emotionTts: boolean;
  /** Auto AUDIO_READABILITY pass after polish/rewrite */
  autoAudioReadability: boolean;
  /** Enforce shot scale cycle on image prompts */
  enforceShotGraph: boolean;
  /** Block reusing same image file path across slots */
  enforceAntiReuse: boolean;
  /** Target % of beats that should be video (warn only) */
  motionBudgetPct: number;
}

export const DEFAULT_YOUTUBE_SAFE: YoutubeSafeConfig = {
  enforceEditorGate: true,
  applyLoudnorm: true,
  humanizeScript: true,
  lockSeriesVoice: true,
  requireHumanEdit: true,
  injectBreathPauses: true,
  roomTone: true,
  bgmMix: false,
  bgmPath: '',
  emotionTts: true,
  autoAudioReadability: true,
  enforceShotGraph: true,
  enforceAntiReuse: true,
  motionBudgetPct: 25,
};

export function mergeYoutubeSafe(
  partial?: Partial<YoutubeSafeConfig> | null,
): YoutubeSafeConfig {
  return { ...DEFAULT_YOUTUBE_SAFE, ...(partial || {}) };
}

export function resolveUserRules(userRules?: {
  forbidden_words?: string;
  fatigue_words?: string;
}): { forbidden_words: string; fatigue_words: string } {
  return {
    forbidden_words: (userRules?.forbidden_words || '').trim() || DEFAULT_FORBIDDEN_WORDS,
    fatigue_words: (userRules?.fatigue_words || '').trim() || DEFAULT_FATIGUE_WORDS,
  };
}

/**
 * Câu đùa “người nói với người” — giọng hội bạn đời (bẩn nhẹ / absurde / đề nghị vớ vẩn).
 * Bâng quơ với cốt truyện. CẤM setup–punchline kiểu AI: lương/crush/gym/Google/50%.
 * Chèn trong ngoặc đơn giữa nhịp thoại/kể (không phải note đạo diễn / SFX).
 */
export const DEFAULT_HUMAN_JOKE_ASIDES = [
  'Đề nghị mọi người đi vệ sinh nhớ chùi đít',
  'Thằng nào vừa ị hơi thì xin lỗi đi, hôi cả phòng',
  'Ai đang cắn móng tay nhả ra giúp cái, tao ghê quá',
  'Có ai cho mượn 50k không? Đùa đấy, đừng ai chuyển',
  'Tao đếm được mấy đứa đang gãi chỗ nhạy cảm lúc này',
  'Mẹ ơi con đói… à lộn, mẹ không có ở đây',
  'Xin phép tạm dừng 3 giây để tao tìm remote… thôi kệ',
  'Ai biết mật khẩu wifi nhà hàng xóm không? Tao đang thử dò',
  'Đề nghị cả lũ ngậm miệng nhai, tiếng lộp bộp văng cả mic',
  'Có đứa nào đang xem cùng bố mẹ thì… chúc may mắn',
  'Tao thề không cười — mẹ, cười sặc rồi',
  'Ai đang cầm đũa mà không có đồ ăn thì… chịu khó',
] as const;

/** Note đạo diễn / SFX — không tính là câu đùa người */
const DIRECTOR_NOTE_RE =
  /^(cười|cười khẩy|thở dài|im lặng|nghỉ|pause|nhạc|âm thanh|sfx|fx|cut|fade|zoom|close.?up|off|os|v\.o\.|nhấn mạnh|to|nhỏ|whisper)/i;

export function isHumanJokeAsideInner(inner: string): boolean {
  const t = (inner || '').normalize('NFC').trim();
  if (t.length < 8 || t.length > 120) return false;
  if (DIRECTOR_NOTE_RE.test(t)) return false;
  // pure stage direction like "Cười." / short FX
  if (/^[A-Za-zÀ-ỹ\s.]{1,12}$/.test(t) && t.split(/\s+/).length <= 2) return false;
  return true;
}

/** Đếm câu đùa dạng (... ) đã có trong kịch bản */
export function countHumanJokeAsides(script: string): number {
  const text = (script || '').normalize('NFC');
  let n = 0;
  const re = /\(([^)]{8,120})\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (isHumanJokeAsideInner(m[1])) n++;
  }
  return n;
}

function pickJokeAside(seed: string, used: Set<string>): string {
  const pool = DEFAULT_HUMAN_JOKE_ASIDES.filter((j) => !used.has(j));
  const list = pool.length ? pool : [...DEFAULT_HUMAN_JOKE_ASIDES];
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return list[h % list.length];
}

/**
 * Bảo đảm có ≥ minCount câu đùa người-nói-với-người trong kịch bản.
 * Chèn sau dấu câu, trước thoại tiếp theo — giống ví dụ:
 *   "...mình hơi mệt." (Đề nghị mọi người đi vệ sinh nhớ chùi đít) "Mệt hả?..."
 */
export function injectHumanJokeAsides(
  script: string,
  options?: { minCount?: number; enabled?: boolean },
): string {
  const enabled = options?.enabled !== false;
  const minCount = Math.max(0, options?.minCount ?? 1);
  if (!enabled || minCount === 0) return script || '';

  let text = (script || '').normalize('NFC');
  if (!text.trim()) return text;

  const existing = countHumanJokeAsides(text);
  if (existing >= minCount) return text;

  const need = minCount - existing;
  const used = new Set<string>();
  // Collect already-present joke inners
  const reExist = /\(([^)]{8,120})\)/g;
  let em: RegExpExecArray | null;
  while ((em = reExist.exec(text)) !== null) {
    if (isHumanJokeAsideInner(em[1])) used.add(em[1].trim());
  }

  /**
   * Điểm chèn lý tưởng (giống ví dụ user):
   *   "...mình hơi mệt." (câu đùa) "Mệt hả?..."
   * = sau dấu đóng thoại (" ” ») rồi khoảng trắng, trước dấu mở thoại tiếp.
   * Không chèn giữa `.` và `"` (tránh lọt joke vào trong ngoặc thoại).
   */
  type Slot = { insertPos: number; eatSpaces: number };
  const slots: Slot[] = [];

  // A) ...mệt."   "Mệt...  OR  ...mệt." Khánh ... "Mệt (chỉ khi sau narration ngắn có thoại)
  // Bridge: closing quote + whitespace + opening quote
  const closeOpen = /(["”»])(\s+)(["“«])/g;
  let bm: RegExpExecArray | null;
  while ((bm = closeOpen.exec(text)) !== null) {
    slots.push({ insertPos: bm.index + 1, eatSpaces: bm[2].length });
  }

  // B) ...mệt.". "Mệt  (period outside quote — rare but in user example)
  const periodOut = /(["”»])\.(\s+)(["“«])/g;
  while ((bm = periodOut.exec(text)) !== null) {
    slots.push({ insertPos: bm.index + 2, eatSpaces: bm[2].length });
  }

  // C) Fallback: after closing dialogue quote + space + capital narration start
  //    e.g.  ấy." Khánh Ân khoanh tay.
  if (slots.length === 0) {
    const afterDialogue = /(["”»])(\s+)(?=[A-ZÀÁẢÃẠĂẮẰẲẴẶÂẤẦẨẪẬĐÈÉẺẼẸÊẾỀỂỄỆÌÍỈĨỊÒÓỎÕỌÔỐỒỔỖỘƠỚỜỞỠỢÙÚỦŨỤƯỨỪỬỮỰỲÝỶỸỴ])/g;
    while ((bm = afterDialogue.exec(text)) !== null) {
      slots.push({ insertPos: bm.index + 1, eatSpaces: bm[2].length });
    }
  }

  // D) Last fallback: after sentence period + space (not inside quotes roughly)
  if (slots.length === 0) {
    const endRe = /[.!?…](\s+)(?=[^\s\[\"“«])/g;
    while ((bm = endRe.exec(text)) !== null) {
      slots.push({ insertPos: bm.index + 1, eatSpaces: bm[1].length });
    }
  }

  const insertAt: Slot[] = [];
  if (slots.length > 0) {
    for (let i = 0; i < need; i++) {
      const pick = slots[Math.floor(((i + 1) * slots.length) / (need + 1)) % slots.length];
      insertAt.push(pick);
    }
  } else {
    const para = text.indexOf('\n\n');
    insertAt.push({ insertPos: para > 40 ? para : Math.min(80, text.length), eatSpaces: 0 });
  }

  // Insert from end so indices stay valid
  const uniqueSorted = [...insertAt]
    .sort((a, b) => b.insertPos - a.insertPos)
    .filter((s, i, arr) => i === 0 || s.insertPos !== arr[i - 1].insertPos);

  let inserted = 0;
  for (const slot of uniqueSorted) {
    if (inserted >= need) break;
    const pos = slot.insertPos;
    const slice = text.slice(pos, pos + 80);
    if (/^\s*\([^)]{8,120}\)/.test(slice)) continue;
    const before = text.slice(Math.max(0, pos - 40), pos);
    if (/\[[^\]]*$/.test(before)) continue;
    // Never inject if we're still inside an open quote (odd count of quotes in a short window)
    const window = text.slice(Math.max(0, pos - 120), pos);
    const quoteCount = (window.match(/["“”«»]/g) || []).length;
    // If previous char is opening-like without close, skip — handled by slot design

    const joke = pickJokeAside(text.slice(Math.max(0, pos - 24), pos + 24) + String(pos), used);
    used.add(joke);
    const eat = Math.max(0, slot.eatSpaces);
    // Keep one space before next token: `." (joke) "Next`
    const snippet = ` (${joke}) `;
    text = text.slice(0, pos) + snippet + text.slice(pos + eat);
    inserted++;
  }

  if (inserted < need) {
    const joke = pickJokeAside(text + 'tail', used);
    text = text.trimEnd() + ` (${joke})`;
  }

  return text;
}

export function buildHumanJokeAsideBlock(enabled: boolean): string {
  if (!enabled) return '';
  const samples = DEFAULT_HUMAN_JOKE_ASIDES.slice(0, 5)
    .map((s) => `   · (${s})`)
    .join('\n');
  return `
--- CÂU ĐÙA “NGƯỜI NÓI VỚI NGƯỜI” (BẮT BUỘC, TÍNH NGƯỜI) ---
I. Mỗi chương / Hook PHẢI có khoảng 1–3 câu đùa ngắn dạng NGOẶC ĐƠN (...), giọng bạn bè
   xen ngang khi đang kể — không phải lời nhân vật, không phải note đạo diễn.
II. Chèn GIỮA nhịp thoại/kể (sau dấu chấm, trước câu thoại tiếp), ví dụ:
   "Không. Không phải. Mình... mình hơi mệt." (Đề nghị mọi người đi vệ sinh nhớ chùi đít) "Mệt hả?..."
III. GIỌNG HỘI BẠN ĐỜI — PHẢI VUI (BẮT BUỘC):
   - Như đứa bạn ngồi cạnh xen ngang: bẩn nhẹ, absurde, “đề nghị” vớ vẩn, troll phòng — nghe người thật.
   - CẤM mùi AI / setup–punchline công thức: lương về, crush nhắn ok, gym no pain, Google cách giàu,
     giảm giá 50%, ăn kiêng–bụng nói, “tiết kiệm năng lượng cho ngủ”…
   - CẤM nhắc nhạt không hài: uống nước, ngồi thẳng, đổ rác, sạc pin, muỗi bay, quạt kêu…
IV. BÂNG QUƠ VỚI CỐT TRUYỆN (vẫn bắt buộc):
   - KHÔNG dính nội dung, chủ đề, nhân vật, twist, bối cảnh kịch bản.
   - CẤM meta plot: "cảnh này căng", "đoán twist", "nhân vật này…", "đoạn vừa rồi…".
V. CẤM nhầm với SFX/note đạo diễn: (Cười), (thở dài), [âm thanh gió], (nhạc nền)...
VI. Giọng: mày–tao / đề nghị / xin lỗi vớ vẩn — thả 1 câu rồi im, không giảng.
VII. Mỗi câu ≤ 1 dòng; không phá beat bằng cả đoạn hài dài.
VIII. Gợi ý phong cách (tự viết biến thể cùng giọng, đừng copy máy móc cả chương):
${samples}`;
}

export function buildHumanizeScriptBlock(enabled: boolean): string {
  if (!enabled) return '';
  return `
--- CHẾ ĐỘ TÍNH NGƯỜI / YOUTUBE-SAFE NARRATION (BẮT BUỘC) ---
A. Ưu tiên HÀNH ĐỘNG + ĐỐI THOẠI + XUNG ĐỘT hơn miêu tả giác quan liên tục.
B. Mỗi phân cảnh phải có ≥1 câu thoại "đời" (cụt, ngắt quãng, nói tránh, không giải thích hết).
C. Cho phép im lặng hữu ích: 1–2 nhịp hành động không lời thay vì stack 5 giác quan.
D. CẤM văn AI sáo: mắt ánh lên quyết tâm, không khí đông đặc, trái tim thắt lại, trong tích tắc…
E. Mỗi nhân vật có 1 quirk ngôn ngữ (ngắn lời / cộc / mỉa / lắp bắp) bám Bible — không thoại đồng chất.
F. Hook 3–8 giây đầu chương: mâu thuẫn / đe dọa / câu hỏi rõ — không mở bằng thơ tả cảnh dài.
G. Cắt bớt 15–25% miêu tả dư; câu vừa miệng đọc audio (ưu tiên ≤22 từ/câu khi có thể).
H. Word-Gate bằng xung đột & thoại, không nhồi tính từ.
${buildHumanJokeAsideBlock(true)}
${buildNarrativePsychBlock(true)}`;
}

/**
 * Tâm lý KỂ CHUYỆN cho kịch bản (narrative psych).
 * Khác SEO: áp dụng qua tình tiết/hành động/thoại — CẤM slogan marketing.
 */
export function buildNarrativePsychBlock(enabled: boolean): string {
  if (!enabled) return '';
  return `
--- TÂM LÝ KỂ CHUYỆN (NARRATIVE PSYCH — BẮT BUỘC) ---
Áp dụng NGUYÊN LÝ vào cốt truyện. CẤM chèn slogan SEO/marketing vào kịch bản
(ví dụ: "Đừng bỏ lỡ", "sai một bước là mất tất cả", "Like Subscribe", template title YouTube).

1) PATTERN INTERRUPT (mở chương + 1–3 câu đầu mỗi cảnh):
   - Vào ngay xung đột / đe dọa / câu hỏi / hành động nguy hiểm.
   - CẤM mở bằng thơ phong cảnh (gió-lá-trăng-hoàng hôn) nếu không gắn đe dọa trong cùng 1–2 câu.

2) CURIOSITY GAP (trong cốt, không phải title):
   - Mỗi cảnh để ≥1 mảnh thông tin nhân vật (và người nghe) CHƯA biết.
   - Manh mối lộ dần; không dump hết bí mật một lần.

3) ZEIGARNIK / OPEN LOOP:
   - Cuối mỗi cảnh và cuối chương: cắt ở điểm căng (hành động dở, lựa chọn chưa xong, tiếng động, cánh cửa, câu hỏi).
   - CẤM chốt êm "mọi thứ yên bình / mỉm cười kết thúc" giữa chương trừ khi đó là twist giả.

4) LOSS AVERSION (qua TÌNH HUỐNG):
   - Có cược thật: mất người / căn cứ / lựa chọn / danh dự / thời gian sống còn.
   - Sai lầm phải có hệ quả hữu hình — không chỉ "hắn hối hận trong lòng".

5) ESCALATION (nhịp chương):
   - Discovery → Confrontation → Survival Crisis → Insight (bẻ nhận thức).
   - Real-time pacing: CẤM time-skip / tóm tắt tuần-tháng.

6) SPECIFICITY + HIGH-AROUSAL (có chọn lọc):
   - Chi tiết đụng tay (máu ấm, lưỡi dao, hơi thở, tiếng bước) thay vì "hắn sợ hãi vô cùng".
   - Không dồn dập mọi câu đều gào thét — xen im lặng hữu ích / nhịp thở.

7) BEAT CUỐI CẢNH (giữ người nghe):
   - ≥1 câu/hành động khiến muốn sang cảnh tiếp — open loop tình huống, không CTA kênh.`;
}

/**
 * Heuristic nhẹ: chấm narrative psych cục bộ (0–100) để log / tín hiệu phụ.
 * Không thay Editor AI.
 */
export function scoreNarrativePsychScript(script: string): {
  score: number;
  flags: string[];
  openScore: number;
  endScore: number;
  threatDensity: number;
} {
  const text = (script || '').normalize('NFC').trim();
  const flags: string[] = [];
  if (!text) {
    return { score: 0, flags: ['empty'], openScore: 0, endScore: 0, threatDensity: 0 };
  }

  const sentences = text
    .replace(/\[CẢNH[^\]]*\]/gi, ' ')
    .split(/(?<=[.!?…])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 8);

  const head = sentences.slice(0, 3).join(' ');
  const tail = sentences.slice(-3).join(' ');
  const openScore = scorePsychologicalPull(head);
  const endScore = scorePsychologicalPull(tail);

  let threatHits = 0;
  for (const s of sentences) {
    if (scorePsychologicalPull(s) >= 4) threatHits++;
  }
  const threatDensity = sentences.length
    ? Math.round((threatHits / sentences.length) * 100)
    : 0;

  if (openScore < 2) flags.push('weak_open_pattern_interrupt');
  if (endScore < 2 && !/[?…]$/.test(tail.trim())) flags.push('weak_open_loop_ending');
  if (/^(gió|mặt trời|hoàng hôn|bình minh|sương|trăng)/i.test(head.trim())) {
    flags.push('poetic_open');
  }
  if (/đừng bỏ lỡ|like\s*\·?\s*subscribe|sai một bước là mất tất cả/i.test(text)) {
    flags.push('seo_slogan_in_prose');
  }

  let score = 55;
  score += Math.min(20, openScore * 3);
  score += Math.min(15, endScore * 2);
  score += Math.min(15, Math.floor(threatDensity / 5));
  if (flags.includes('poetic_open')) score -= 15;
  if (flags.includes('weak_open_pattern_interrupt')) score -= 10;
  if (flags.includes('weak_open_loop_ending')) score -= 8;
  if (flags.includes('seo_slogan_in_prose')) {
    score -= 35; // SEO slogan trong prose = lỗi nặng
    score = Math.min(score, 55);
  }
  score = Math.max(0, Math.min(100, score));

  return { score, flags, openScore, endScore, threatDensity };
}

export function buildSpeechFingerprintBlock(
  nhan_vat?: string[],
  nhan_vat_prompts?: Record<
    string,
    {
      thoi_quen?: string;
      so_thich?: string;
      gioi_tinh?: string;
      prompt?: string;
      giong_thoai?: string;
      dong_co?: string;
      dac_diem_nhan_dang?: string;
    }
  >,
): string {
  if (!nhan_vat?.length) return '';
  const fallbackQuirks = [
    'nói cộc, câu ngắn',
    'nói vòng vo, hay hỏi lại',
    'mỉa mai, nửa cười',
    'lắp bắp khi sợ',
    'trầm, ít lời, ngắt quãng',
  ];
  const lines = nhan_vat.map((name, i) => {
    const p = nhan_vat_prompts?.[name];
    const habit = p?.thoi_quen || p?.so_thich || 'không rõ';
    const quirk = (p?.giong_thoai || '').trim() || fallbackQuirks[i % fallbackQuirks.length];
    const motive = p?.dong_co ? `; động cơ = "${p.dong_co}"` : '';
    const mark = p?.dac_diem_nhan_dang ? `; nhận dạng = "${p.dac_diem_nhan_dang}"` : '';
    return `- ${name}: quirk thoại = "${quirk}"; thói quen/sở thích = "${habit}"${motive}${mark}. Mọi câu thoại của ${name} phải giữ quirk này.`;
  });
  return `
--- FINGERPRINT THOẠI NHÂN VẬT (BẮT BUỘC) ---
${lines.join('\n')}`;
}

export function buildAudioReadabilityBlock(): string {
  return `
--- AUDIO-READABILITY PASS (đọc TTS / YouTube narration) ---
1. Tách câu dài >22 từ thành 2 câu khi có thể.
2. Tránh mệnh đề lồng 3 tầng; ưu tiên nhịp thở tự nhiên.
3. Giữ tên riêng + thông tin cốt lõi; cắt tính từ stack.
4. Sau dấu chấm/hỏi/cảm, nhịp nghỉ rõ (không dính câu).
5. Không thêm ghi chú đạo diễn; chỉ nội dung kịch bản thuần.`;
}

export function buildShotDiversityBlock(): string {
  return `
SHOT DIVERSITY / SHOT GRAPH (YouTube anti-slideshow):
- Cycle camera scale across consecutive items: wide → medium → close-up → insert detail → OTS/dutch.
- Never repeat the same framing/pose/background layout on adjacent ids.
- Prefer tactile materials, practical light; avoid generic 8k/masterpiece spam tags.
- Each image_prompt must imply DISTINCT composition (subject size in frame, lens feel, depth layers).`;
}

/** Pre-TTS: insert breath-friendly line breaks after sentence ends */
export function injectBreathPauses(text: string): string {
  if (!text) return '';
  return text
    .normalize('NFC')
    .replace(/\r\n/g, '\n')
    .replace(/([.!?…。！？])(["'”’])?\s+/g, '$1$2\n\n')
    .replace(/([,;，；])\s+/g, '$1 ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function emotionPitchOffset(emotion?: string): number {
  const e = (emotion || '').toLowerCase();
  if (!e) return 0;
  if (/sợ|kinh|hoảng|fear|panic|terror|anxiety/.test(e)) return 0.6;
  if (/giận|tức|rage|anger|fury/.test(e)) return 0.35;
  if (/buồn|đau|sad|grief|melancholy/.test(e)) return -0.55;
  if (/thì thầm|whisper|quiet|cold/.test(e)) return -0.75;
  if (/vui|hype|excited|joy/.test(e)) return 0.4;
  if (/căng|tense|suspense/.test(e)) return 0.2;
  return 0;
}

export function applyShotScaleToPrompt(imagePrompt: string, index: number): string {
  const scale = SHOT_SCALE_CYCLE[index % SHOT_SCALE_CYCLE.length];
  const base = (imagePrompt || '').trim();
  if (!base) return scale;
  if (new RegExp(scale.split(',')[0], 'i').test(base)) return base;
  return `${scale}, ${base}`;
}

export function enforceShotGraphOnPrompts<
  T extends { image_prompt?: string; imagePrompt?: string },
>(items: T[]): T[] {
  return items.map((item, i) => {
    const key = item.image_prompt != null ? 'image_prompt' : 'imagePrompt';
    const raw = (item as { image_prompt?: string; imagePrompt?: string }).image_prompt
      ?? (item as { imagePrompt?: string }).imagePrompt
      ?? '';
    const next = applyShotScaleToPrompt(String(raw), i);
    return { ...item, [key]: next } as T;
  });
}

export function checkImagePathReuse(
  imagePath: string,
  existing: Record<string, string>,
  currentKey: string,
): { reused: boolean; otherKey?: string } {
  const norm = (imagePath || '').split('?')[0].replace(/\\/g, '/').toLowerCase();
  if (!norm) return { reused: false };
  for (const [k, v] of Object.entries(existing || {})) {
    if (k === currentKey) continue;
    const ov = (v || '').split('?')[0].replace(/\\/g, '/').toLowerCase();
    if (ov && ov === norm) return { reused: true, otherKey: k };
  }
  return { reused: false };
}

export interface TtsGateInput {
  enforceEditorGate: boolean;
  requireHumanEdit?: boolean;
  humanEdited?: boolean;
  chapterNumber: number;
  hasScript: boolean;
  editorReview?: { verdict?: EditorVerdict; summary?: string } | null;
  ttsPlatform?: string;
  ttsPitch?: number;
  ttsSpeed?: number;
  bypass?: boolean;
}

export interface TtsGateResult {
  ok: boolean;
  hardBlock: boolean;
  reasons: string[];
  warnings: string[];
}

export function evaluateYoutubeTtsGate(input: TtsGateInput): TtsGateResult {
  const reasons: string[] = [];
  const warnings: string[] = [];

  if (input.bypass) {
    return { ok: true, hardBlock: false, reasons, warnings };
  }

  if (!input.hasScript) {
    reasons.push('Chưa có kịch bản để đọc TTS.');
  }

  if (input.enforceEditorGate) {
    if (!input.editorReview || !input.editorReview.verdict) {
      reasons.push(
        'Chưa có AI Editor Review. Hãy Sinh/Đánh giá chương trước khi TTS (YouTube-safe).',
      );
    } else if (input.editorReview.verdict === 'rewrite') {
      reasons.push(
        'Editor verdict = rewrite. Sửa theo nhận xét trước khi sinh giọng (tránh up raw AI).',
      );
    } else if (input.editorReview.verdict === 'polish') {
      warnings.push('Editor verdict = polish. Nên trau chuốt kịch bản trước TTS.');
    }
  }

  if (input.requireHumanEdit && !input.humanEdited) {
    reasons.push(
      'Chưa tick "Đã sửa tay / Human Pass". YouTube-safe yêu cầu biên tập viên xác nhận trước TTS.',
    );
  }

  const platform = (input.ttsPlatform || '').toLowerCase();
  if (HIGH_RISK_TTS_PLATFORMS.has(platform)) {
    warnings.push(
      `Giọng ${platform} dễ trùng pattern kênh AI mass. Ưu tiên Gemini/OpenAI/OmniVoice/CapCut + pitch/speed series.`,
    );
  }

  const pitch = Number(input.ttsPitch ?? 0);
  const speed = Number(input.ttsSpeed ?? 1);
  if (pitch === 0 && Math.abs(speed - 1) < 0.01 && HIGH_RISK_TTS_PLATFORMS.has(platform)) {
    warnings.push(
      'Pitch=0 và Speed=1 trên giọng free: rất dễ "giọng AI phẳng". Đặt pitch ±1–2, speed ~0.95–1.03.',
    );
  }

  return {
    ok: reasons.length === 0,
    hardBlock: reasons.length > 0,
    reasons,
    warnings,
  };
}

export interface YoutubeChecklistItem {
  id: string;
  label: string;
  ok: boolean;
  level: 'pass' | 'warn' | 'fail';
  detail?: string;
}

/**
 * ── Công thức tâm lý học YouTube (địa phương hóa VI) ──────────────────────
 * 1. Curiosity Gap (Loewenstein) — khoảng trống thông tin “biết một phần”
 * 2. Zeigarnik / Open Loop — việc dở dang khó quên → giữ watch time
 * 3. Loss Aversion (Kahneman) — sợ mất > mong được
 * 4. FOMO — sợ bỏ lỡ / bị loại khỏi vòng “người hiểu chuyện”
 * 5. Pattern Interrupt — mở bằng xung đột, không thơ tả cảnh
 * 6. Specificity — số / chi tiết cụ thể tăng tin cậy
 * 7. PAS (Problem → Agitate → Solution/CTA) — khung Description
 * 8. Emotional high-arousal — đe dọa, bí mật, phản bội, sống còn
 */

/** Lexicon kích hoạt cảm xúc / đe dọa (mạt thế · sinh tồn · drama) */
const PSYCH_THREAT_RE =
  /chết|giết|máu|đau|sợ|hối|mất|cướp|phản bội|bí mật|giấu|trốn|chạy|đuổi|còn lại|cuối cùng|không còn|tuyệt|tuyệt vọng|cô đơn|đói|lạnh|bóng tối|xác|quái|virus|sống sót|sinh tồn|mạt thế|tận thế|cách ly|cấm|nguy hiểm|đe dọa|thù|hận|dối|lừa|bẫy|sụp|sụp đổ|tan|nát|vỡ|khóc|la|thét|câm|im lặng|không ai|mọi người|hắn|nàng|ta phải|đừng|không được|phải chết|chỉ còn/i;

const PSYCH_CURIOSITY_RE =
  /tại sao|vì sao|làm sao|liệu|có phải|không ngờ|thật ra|sự thật|bí mật|chưa ai|không ai biết|bỗng|bất ngờ|hóa ra|thì ra|nhưng|mà|nếu|khi ấy|lúc đó|trước khi|sau khi/i;

const PSYCH_QUESTION_RE = /\?|？/;
const PSYCH_NUMBER_RE = /\d+|một|hai|ba|bốn|năm|sáu|bảy|tám|chín|mười|trăm|nghìn|vạn/i;
const PSYCH_DIALOGUE_RE = /["“”'']/;
const PSYCH_POETIC_FLAT_RE =
  /mặt trời|hoàng hôn|bình minh|gió nhẹ|mây trôi|lá rơi|trăng|sương mù|cảnh vật|phong cảnh|thiên nhiên|bầu trời xanh/i;

/** Gỡ thoại / dấu ngoặc — Title SEO không viết kiểu hội thoại */
function stripDialogueStyle(text: string): string {
  return (text || '')
    .normalize('NFC')
    .replace(/["“”''«»]/g, '')
    .replace(/^(?:hắn|nàng|cô ấy|anh ấy|tôi|ta|mày|cậu)\s+(?:nói|thì thầm|gào|hét|đáp|hỏi)[:：]?\s*/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Template Title CTR (tâm lý) — KHÔNG chép thoại.
 * Curiosity Gap · Loss Aversion · FOMO · Open Loop · Specificity
 */
function applySeoTitleFormula(
  kind: 'curiosity' | 'loss' | 'open' | 'fomo' | 'question' | 'stake',
  core: string,
  stake: string,
): string {
  const c = stripDialogueStyle(core).replace(/[.!…?]+$/g, '').trim();
  const s = stripDialogueStyle(stake).replace(/[.!…?]+$/g, '').trim();
  const stakeOk = s && s.length >= 6 && !c.toLowerCase().includes(s.toLowerCase().slice(0, 10));
  const shortC = clipAtWordBoundary(c, 48);
  const shortS = stakeOk ? clipAtWordBoundary(s, 32) : '';

  switch (kind) {
    case 'question':
      return shortC.endsWith('?')
        ? shortC
        : `Tại sao ${shortC.charAt(0).toLowerCase()}${shortC.slice(1)}? Câu trả lời đáng sợ hơn bạn nghĩ`;
    case 'loss': {
      const loss = shortS && /mất|chết|giết|hỏng|sụp|tan|không còn|hủy|sai/i.test(shortS)
        ? shortS.charAt(0).toLowerCase() + shortS.slice(1)
        : 'mất tất cả';
      return `${shortC} — sai một bước là ${loss}`;
    }
    case 'fomo':
      return `Đừng bỏ lỡ: ${shortC}${shortS ? `… ${shortS}` : ''}`;
    case 'open':
      return `${shortC}… và điều xảy ra sau đó không ai ngờ tới`;
    case 'stake':
      return shortS ? `${shortC} | ${shortS}` : `${shortC} — chi tiết khiến người xem rùng mình`;
    case 'curiosity':
    default:
      if (shortS) return `${shortC} — nhưng ${shortS.charAt(0).toLowerCase()}${shortS.slice(1)}`;
      return `Sự thật về ${shortC.charAt(0).toLowerCase()}${shortC.slice(1)}… không ai dám nói to`;
  }
}

/** Sinh nhiều biến thể title rồi chấm điểm — lấy bản CTR cao nhất */
function generateSeoTitleCandidates(
  hook: string,
  novelTitle?: string,
): string[] {
  const sentences = splitSentencesVi(stripDialogueStyle(hook || ''));
  const ranked = [...sentences].sort(
    (a, b) => scorePsychologicalPull(b) - scorePsychologicalPull(a),
  );
  const core = clipAtWordBoundary(
    stripDialogueStyle(ranked[0] || hook || ''),
    55,
  );
  const stake = extractStakeFragment(ranked[1] || ranked[0] || hook || '', 34);
  const kinds: Array<'curiosity' | 'loss' | 'open' | 'fomo' | 'question' | 'stake'> = [
    'curiosity',
    'loss',
    'fomo',
    'open',
    'question',
    'stake',
  ];
  const out: string[] = [];
  for (const k of kinds) {
    let t = applySeoTitleFormula(k, core, stake).replace(/\s+/g, ' ').trim();
    t = t.replace(/(\b[\p{L}\d]{3,}\b)(?:\s+\1\b)+/giu, '$1');
    const series = clipAtWordBoundary((novelTitle || '').trim(), 18);
    if (
      series &&
      t.length + series.length + 3 <= 100 &&
      !t.toLowerCase().includes(series.toLowerCase().slice(0, 6))
    ) {
      t = `${t} | ${series}`;
    }
    if (t.length > 100) t = clipAtWordBoundary(t, 100);
    if (t.length >= 28) out.push(t);
  }
  return Array.from(new Set(out));
}

export function scorePsychologicalPull(text: string): number {
  const s = (text || '').normalize('NFC').trim();
  if (!s || s.length < 4) return 0;
  let n = 0;
  if (PSYCH_THREAT_RE.test(s)) n += 4;
  if (PSYCH_CURIOSITY_RE.test(s)) n += 3;
  if (PSYCH_QUESTION_RE.test(s)) n += 3;
  if (PSYCH_DIALOGUE_RE.test(s)) n += 2;
  if (PSYCH_NUMBER_RE.test(s)) n += 2;
  if (/[!…]/.test(s)) n += 1;
  // High-arousal verbs
  if (/chạy|đập|siết|kéo|vồ|bắn|chém|cắn|hét|rít|run|run rẩy/i.test(s)) n += 2;
  // Penalize flat landscape openers (anti pattern-interrupt)
  if (PSYCH_POETIC_FLAT_RE.test(s) && !PSYCH_THREAT_RE.test(s)) n -= 3;
  // Prefer mobile-thumb length for overlay candidates
  if (s.length <= 40) n += 1;
  if (s.length <= 28) n += 1;
  if (s.length > 120) n -= 1;
  return n;
}

/** Cắt stake ngắn (mất mát / đe dọa) từ câu để nhét title */
function extractStakeFragment(text: string, maxChars = 28): string {
  const s = (text || '').normalize('NFC').replace(/\s+/g, ' ').trim();
  if (!s) return '';
  // Ưu tiên mệnh đề sau "nhưng|mà|nếu|vì"
  const m = s.match(/(?:nhưng|mà|nếu|vì|bởi|khi|lúc)\s+([^,.!?…]{6,48})/i);
  const frag = (m?.[1] || s).trim();
  return clipAtWordBoundary(frag.replace(/^["'“”]+|["'“”]+$/g, ''), maxChars);
}

function splitSentencesVi(text: string): string[] {
  return (text || '')
    .normalize('NFC')
    .split(/(?<=[.!?…])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 6);
}

/**
 * Cold-open hook ~30s — Pattern Interrupt + escalate + Open Loop (Zeigarnik).
 * ~140 wpm → ~70 words ≈ 30s.
 */
export function extractHookFromScript(
  script: string,
  opts?: { targetSec?: number; wpm?: number },
): {
  hook: string;
  thumbnailLine: string;
  seoTitle: string;
  seoDescription: string;
  seoTags: string;
  thumbnailPrompt: string;
} {
  const targetSec = opts?.targetSec ?? 30;
  const wpm = opts?.wpm ?? 140;
  const targetWords = Math.max(55, Math.round((wpm * targetSec) / 60));

  const cleaned = (script || '')
    .normalize('NFC')
    .replace(/\[CẢNH[^\]]*\]/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!cleaned) {
    return {
      hook: '',
      thumbnailLine: '',
      seoTitle: '',
      seoDescription: '',
      seoTags: '',
      thumbnailPrompt: '',
    };
  }

  const sentences = splitSentencesVi(cleaned);

  // Pattern Interrupt: bắt đầu từ câu xung đột đầu tiên (nửa đầu kịch bản),
  // tránh mở bằng thơ tả cảnh (score thấp).
  const searchLimit = Math.max(1, Math.ceil(sentences.length * 0.45));
  let startIdx = 0;
  let bestOpenScore = -99;
  for (let i = 0; i < searchLimit; i++) {
    const sc = scorePsychologicalPull(sentences[i]);
    if (sc > bestOpenScore) {
      bestOpenScore = sc;
      startIdx = i;
    }
    // Early exit nếu đã có xung đột mạnh ngay từ đầu
    if (i <= 2 && sc >= 5) {
      startIdx = i;
      break;
    }
  }
  // Nếu cả nửa đầu đều flat, vẫn mở từ câu 0 (fallback)
  if (bestOpenScore < 2) startIdx = 0;

  const picked: string[] = [];
  let words = 0;
  for (let i = startIdx; i < sentences.length; i++) {
    picked.push(sentences[i]);
    words += sentences[i].split(/\s+/).filter(Boolean).length;
    if (words >= targetWords) break;
  }

  let hook = picked.join(' ').trim();
  if (words < targetWords * 0.55) {
    const allWords = cleaned.split(/\s+/).filter(Boolean);
    hook = allWords.slice(0, targetWords).join(' ');
    if (allWords.length > targetWords) hook += '…';
  }

  // Zeigarnik / Open Loop: kết thúc dở dang — không “chốt” câu chuyện
  hook = applyOpenLoopEnding(hook, sentences, startIdx + picked.length);

  const thumbnailLine = buildClickThumbnailLine(hook, sentences);
  const seoTitle = buildSeoTitleFromHook(hook, thumbnailLine);
  const seoTags = buildSeoTags(hook);
  const seoDescription = buildSeoDescription({
    hook,
    thumbnailLine,
    tags: seoTags,
  });
  const thumbnailPrompt = buildThumbnailPrompt({
    hook,
    thumbnailLine,
  });

  return { hook, thumbnailLine, seoTitle, seoDescription, seoTags, thumbnailPrompt };
}

/** Ép kết thúc open-loop: bỏ chốt êm, thêm khoảng trống thông tin */
function applyOpenLoopEnding(hook: string, allSentences: string[], nextIdx: number): string {
  let h = (hook || '').trim();
  if (!h) return h;

  // Bỏ kết êm “ổn thỏa”
  h = h.replace(/\s*(cuối cùng.*|mọi thứ yên bình.*|hắn mỉm cười.*)$/i, '').trim();

  // Nếu câu sau còn conflict → nhét mảnh cliff (curiosity gap)
  if (nextIdx < allSentences.length) {
    const next = allSentences[nextIdx];
    if (scorePsychologicalPull(next) >= 3) {
      const cliff = clipAtWordBoundary(next, 42);
      if (cliff && !h.includes(cliff.slice(0, 12))) {
        // Chỉ gợi, không kể hết
        const hint = clipAtWordBoundary(cliff, 28);
        if (!/[?…]$/.test(h)) h = `${h.replace(/[.!]+$/, '')}…`;
        h = `${h} ${hint}…`.replace(/\s+/g, ' ').trim();
      }
    }
  }

  // Luôn để ngỏ nếu đang chốt bằng dấu chấm
  if (/[.!]$/.test(h) && !/[?…]$/.test(h)) {
    h = `${h.replace(/[.!]+$/, '')}…`;
  }
  // Câu mở loop nhẹ nếu thiếu tension cuối
  if (scorePsychologicalPull(h.slice(-80)) < 2 && !/[?…]$/.test(h)) {
    h = `${h}… và không ai kịp hiểu chuyện gì đang xảy ra.`;
  }
  return h.replace(/\s+/g, ' ').trim();
}

/** Cut at word boundary so title stays a complete, meaningful phrase. */
export function clipAtWordBoundary(text: string, maxChars: number): string {
  const t = (text || '').normalize('NFC').replace(/\s+/g, ' ').trim();
  if (!t) return '';
  if (t.length <= maxChars) return t;
  const slice = t.slice(0, maxChars);
  const sp = slice.lastIndexOf(' ');
  const cut = sp > Math.floor(maxChars * 0.45) ? slice.slice(0, sp) : slice;
  return cut.replace(/[,;:\-–—|]+$/g, '').trim();
}

/** Ngưỡng pass Meta — dưới này phải viết lại */
export const YOUTUBE_META_PASS_SCORE = 8.5;

/**
 * SEO Title — template CTR tâm lý, KHÔNG thoại, ≤100 ký tự.
 * Chọn biến thể điểm cao nhất (duyên hút + tò mò).
 */
export function buildSeoTitleFromHook(
  hook: string,
  _thumbnailLine?: string,
  novelTitle?: string,
): string {
  const cands = generateSeoTitleCandidates(hook, novelTitle);
  if (cands.length === 0) {
    const fallback = stripDialogueStyle(hook || '').slice(0, 100);
    return clipAtWordBoundary(fallback, 100) || 'Sự thật không ai dám kể… xem đến cuối';
  }
  let best = cands[0];
  let bestScore = scoreSeoTitle(best);
  for (const c of cands) {
    const sc = scoreSeoTitle(c);
    if (sc > bestScore) {
      bestScore = sc;
      best = c;
    }
  }
  return best.slice(0, 100);
}

/**
 * Thumbnail line ≤30 ký tự — chữ trên ảnh (gợi tò mò), KHÁC title dài.
 */
export function buildClickThumbnailLine(hook: string, sentences?: string[]): string {
  const MAX = 30;
  const pool = [
    ...(sentences || []),
    ...splitSentencesVi(stripDialogueStyle(hook || '')),
  ].filter((s) => s.length >= 4);

  const scored = pool
    .map((s) => {
      let n = scorePsychologicalPull(s);
      if (PSYCH_NUMBER_RE.test(s)) n += 2;
      if (PSYCH_THREAT_RE.test(s)) n += 2;
      if (PSYCH_DIALOGUE_RE.test(s)) n -= 3; // thumb không ưu tiên thoại
      if (s.length <= 30) n += 2;
      if (s.length > 50) n -= 2;
      return { s: stripDialogueStyle(s), n };
    })
    .sort((a, b) => b.n - a.n);

  let best = '';
  for (const { s } of scored.slice(0, 10)) {
    let frag = s.replace(/[.!]+$/g, '').trim();
    const comma = frag.search(/[,，]/);
    if (comma >= 8 && comma <= MAX) frag = frag.slice(0, comma);
    frag = clipAtWordBoundary(frag, MAX);
    if (frag.length >= 8 && frag.length <= MAX) {
      best = frag;
      break;
    }
  }
  if (!best) {
    best = clipAtWordBoundary(stripDialogueStyle(hook || ''), MAX);
  }
  let line = clipAtWordBoundary(best, MAX);
  if (line.length >= 8 && line.length <= MAX - 1 && !/[?…]$/.test(line)) {
    const withDots = `${line}…`;
    if (withDots.length <= MAX) line = withDots;
  }
  return line.slice(0, MAX);
}

/** Chấm Title 0–10: tò mò + hút click (không thoại) */
export function scoreSeoTitle(title: string): number {
  const t = (title || '').normalize('NFC').trim();
  if (!t) return 0;
  let s = 3;
  const len = t.length;
  if (len >= 55 && len <= 100) s += 2;
  else if (len >= 40 && len < 55) s += 1;
  else if (len < 28) s -= 2;
  if (len > 100) s -= 2;

  if (PSYCH_CURIOSITY_RE.test(t) || /sự thật|tại sao|nhưng|liệu|không ngờ/i.test(t)) s += 1.5;
  if (PSYCH_THREAT_RE.test(t) || /sai một bước|hối|đáng sợ|rùng mình/i.test(t)) s += 1.5;
  if (PSYCH_QUESTION_RE.test(t) || /[…]$/.test(t)) s += 1;
  if (PSYCH_NUMBER_RE.test(t)) s += 0.5;
  if (/đừng bỏ lỡ|fomo|không ai dám/i.test(t)) s += 1;
  // Trừ điểm: kiểu hội thoại / trích thoại
  if (PSYCH_DIALOGUE_RE.test(t) || /^(hắn|nàng|tôi|ta)\s/i.test(t)) s -= 2.5;
  if (PSYCH_POETIC_FLAT_RE.test(t) && !PSYCH_THREAT_RE.test(t)) s -= 1.5;
  // Lặp cụm
  if (/(\b[\p{L}]{4,}\b).*\1/iu.test(t)) s -= 0.5;

  return Math.max(0, Math.min(10, Math.round(s * 10) / 10));
}

/** Chấm Thumbnail line 0–10 */
export function scoreThumbnailLine(line: string): number {
  const t = (line || '').normalize('NFC').trim();
  if (!t) return 0;
  let s = 3;
  const len = t.length;
  if (len >= 10 && len <= 30) s += 2.5;
  else if (len > 30) s -= 2;
  else if (len < 8) s -= 1.5;

  if (PSYCH_THREAT_RE.test(t) || PSYCH_NUMBER_RE.test(t)) s += 1.5;
  if (PSYCH_CURIOSITY_RE.test(t) || /[?…]$/.test(t)) s += 1.5;
  if (PSYCH_DIALOGUE_RE.test(t)) s -= 2;
  if (PSYCH_POETIC_FLAT_RE.test(t)) s -= 1;
  // Quá ngắn kiểu 1–2 ký tự
  if (len <= 6) s -= 1;

  return Math.max(0, Math.min(10, Math.round(s * 10) / 10));
}

/** Chấm Description: bám thumb + PAS + tò mò */
export function scoreSeoDescription(desc: string, thumbnailLine?: string): number {
  const d = (desc || '').normalize('NFC').trim();
  if (!d) return 0;
  let s = 3;
  if (d.length >= 180 && d.length <= 2500) s += 1.5;
  else if (d.length < 80) s -= 2;

  const thumb = (thumbnailLine || '').trim();
  if (thumb && d.toLowerCase().includes(thumb.replace(/…$/, '').toLowerCase().slice(0, 12))) {
    s += 2; // bám Thumbnail line
  } else if (thumb) {
    s -= 1;
  }

  if (/📌|chapters?|timeline|0:00/i.test(d)) s += 1;
  if (/#\p{L}/u.test(d) || /tags?:/i.test(d)) s += 0.5;
  if (/like|subscribe|theo dõi|đăng ký/i.test(d)) s += 0.5;
  if (PSYCH_CURIOSITY_RE.test(d) || PSYCH_THREAT_RE.test(d)) s += 1;
  if (/——\s*HOOK/i.test(d)) s -= 1.5;
  // Description không nên toàn thoại dài
  const quoteCount = (d.match(/["“”]/g) || []).length;
  if (quoteCount >= 4) s -= 1;

  return Math.max(0, Math.min(10, Math.round(s * 10) / 10));
}

export interface YoutubeFieldScores {
  title: number;
  thumbnail: number;
  description: number;
  average: number;
  pass: boolean;
}

export function scoreYoutubeMetaFields(params: {
  seoTitle: string;
  thumbnailLine: string;
  seoDescription: string;
}): YoutubeFieldScores {
  const title = scoreSeoTitle(params.seoTitle);
  const thumbnail = scoreThumbnailLine(params.thumbnailLine);
  const description = scoreSeoDescription(params.seoDescription, params.thumbnailLine);
  const average = Math.round(((title + thumbnail + description) / 3) * 10) / 10;
  return {
    title,
    thumbnail,
    description,
    average,
    pass:
      title >= YOUTUBE_META_PASS_SCORE &&
      thumbnail >= YOUTUBE_META_PASS_SCORE &&
      description >= YOUTUBE_META_PASS_SCORE,
  };
}

/**
 * Pipeline Meta: sinh → chấm → dưới 8.5 viết lại (tối đa vài vòng).
 * Tiêu chí: duyên hút + gợi tò mò người xem.
 */
export function generateYoutubeMetaWithQA(params: {
  script: string;
  novelTitle?: string;
  chaptersText?: string;
  maxRounds?: number;
}): {
  hook: string;
  seoTitle: string;
  thumbnailLine: string;
  seoDescription: string;
  seoTags: string;
  thumbnailPrompt: string;
  scores: YoutubeFieldScores;
  rounds: number;
} {
  const maxRounds = params.maxRounds ?? 4;
  const base = extractHookFromScript(params.script, { targetSec: 30, wpm: 140 });
  let best = {
    hook: base.hook,
    seoTitle: base.seoTitle,
    thumbnailLine: base.thumbnailLine,
    seoDescription: base.seoDescription,
    seoTags: base.seoTags,
    thumbnailPrompt: base.thumbnailPrompt,
    scores: scoreYoutubeMetaFields({
      seoTitle: base.seoTitle,
      thumbnailLine: base.thumbnailLine,
      seoDescription: base.seoDescription,
    }),
    rounds: 1,
  };

  for (let round = 1; round <= maxRounds; round++) {
    let seoTitle = buildSeoTitleFromHook(base.hook, '', params.novelTitle);
    // Biến thể: xoay kind bằng cách permute seed từ round
    if (round > 1) {
      const cands = generateSeoTitleCandidates(base.hook, params.novelTitle);
      const idx = (round - 1) % Math.max(1, cands.length);
      seoTitle = cands[idx] || seoTitle;
    }

    let thumbnailLine = buildClickThumbnailLine(base.hook);
    if (round > 1) {
      // Lấy mảnh khác từ hook
      const sents = splitSentencesVi(base.hook);
      const pick = sents[round % Math.max(1, sents.length)] || base.hook;
      thumbnailLine = buildClickThumbnailLine(pick, sents);
    }
    thumbnailLine = thumbnailLine.slice(0, 30);

    const seoTags = normalizeHashtagField(base.seoTags || buildSeoTags(base.hook));
    let seoDescription = buildSeoDescription({
      hook: base.hook,
      thumbnailLine,
      tags: seoTags,
      chaptersText: params.chaptersText,
      novelTitle: params.novelTitle,
    });

    // Viết lại desc nếu điểm thấp: nhấn thumb + curiosity
    let scores = scoreYoutubeMetaFields({ seoTitle, thumbnailLine, seoDescription });
    if (scores.description < YOUTUBE_META_PASS_SCORE) {
      seoDescription = buildSeoDescription({
        hook: base.hook,
        thumbnailLine,
        tags: seoTags,
        chaptersText: params.chaptersText,
        novelTitle: params.novelTitle,
        forceThumbLead: true,
        strongerAgitate: true,
      });
      scores = scoreYoutubeMetaFields({ seoTitle, thumbnailLine, seoDescription });
    }

    const thumbnailPrompt = buildThumbnailPrompt({
      hook: base.hook,
      thumbnailLine,
    });

    const pack = {
      hook: base.hook,
      seoTitle: seoTitle.slice(0, 100),
      thumbnailLine,
      seoDescription,
      seoTags,
      thumbnailPrompt,
      scores,
      rounds: round,
    };

    if (scores.average > best.scores.average) best = pack;
    if (scores.pass) return pack;
  }

  return best;
}

/** #truyệnaudio — no spaces inside tag */
export function toHashtag(raw: string): string {
  const body = (raw || '')
    .normalize('NFC')
    .replace(/^#+/, '')
    .trim()
    .replace(/\s+/g, '')
    .replace(/[^\p{L}\p{N}_]/gu, '');
  return body ? `#${body}` : '';
}

/** Normalize free text → "#a #b #c" */
export function normalizeHashtagField(input: string): string {
  if (!input?.trim()) return '';
  const parts = input
    .normalize('NFC')
    .split(/[\s,;|]+/)
    .map((p) => p.trim())
    .filter(Boolean)
    .flatMap((p) => p.split(/(?=#)/).map((x) => x.trim()).filter(Boolean));
  const tags = parts.map(toHashtag).filter(Boolean);
  return Array.from(new Set(tags)).join(' ');
}

export function buildSeoTags(text: string): string {
  const base = [
    'truyệnaudio',
    'kểchuyện',
    'mạtthế',
    'sinhtồn',
    'truyệnđêm',
    'audiobook',
    'novel',
  ];
  const words = (text || '')
    .normalize('NFC')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 4)
    .slice(0, 8)
    .map((w) => w.toLowerCase());
  const unique = Array.from(new Set([...base, ...words]));
  return unique.map(toHashtag).filter(Boolean).slice(0, 15).join(' ');
}

/** Special sceneIndex for Hook ~30s assets (TTS / prompts / images) */
export const YOUTUBE_HOOK_SCENE_INDEX = 990;

/** Legacy sceneIndex used before migration to YOUTUBE_HOOK_SCENE_INDEX */
export const LEGACY_HOOK_SCENE_INDEX = -1;

/** Default cold-open duration (seconds) when Hook has no TTS yet */
export const YOUTUBE_HOOK_DEFAULT_DURATION_SEC = 30;

/** Prompt/asset label: hook-01 for Hook, c1-01 for normal scenes */
export function scenePromptCode(sceneIndex: number, promptIndex: number): string {
  const pad = String(promptIndex + 1).padStart(2, '0');
  if (sceneIndex === YOUTUBE_HOOK_SCENE_INDEX || sceneIndex === LEGACY_HOOK_SCENE_INDEX) {
    return `hook-${pad}`;
  }
  return `c${sceneIndex + 1}-${pad}`;
}

export function isHookSceneIndex(sceneIndex: number): boolean {
  return sceneIndex === YOUTUBE_HOOK_SCENE_INDEX || sceneIndex === LEGACY_HOOK_SCENE_INDEX;
}

/**
 * One-shot migrate store asset keys from chapter_-1* → chapter_990*
 * (safe: only copies when destination empty; keeps legacy keys).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function migrateHookAssetKeys(store: {
  chuong_dang_chon?: number;
  danh_sach_chuong?: { so_chuong: number }[];
  generatedAudioPaths?: Record<string, { path: string; duration: number }>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  generatedPrompts?: Record<string, any[]>;
  generatedImages?: Record<string, string>;
  generatedVideos?: Record<string, string>;
  projectUrls?: Record<string, string>;
  addGeneratedAudio?: (key: string, path: string, duration: number) => void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  addGeneratedPrompts?: (key: string, prompts: any[]) => void;
  addGeneratedImage?: (key: string, path: string) => void;
  addGeneratedVideo?: (key: string, path: string) => void;
  addProjectUrl?: (key: string, url: string) => void;
}): number {
  const chapters = new Set<number>();
  if (store.chuong_dang_chon != null) chapters.add(store.chuong_dang_chon);
  for (const c of store.danh_sach_chuong || []) chapters.add(c.so_chuong);

  let migrated = 0;
  const oldIdx = LEGACY_HOOK_SCENE_INDEX;
  const newIdx = YOUTUBE_HOOK_SCENE_INDEX;

  for (const ch of chapters) {
    const oldKey = `${ch}_${oldIdx}`;
    const newKey = `${ch}_${newIdx}`;

    const audio = store.generatedAudioPaths?.[oldKey];
    if (audio?.path && !store.generatedAudioPaths?.[newKey]?.path && store.addGeneratedAudio) {
      store.addGeneratedAudio(newKey, audio.path, audio.duration || 0);
      migrated++;
    }

    const prompts = store.generatedPrompts?.[oldKey];
    const destPrompts = store.generatedPrompts?.[newKey];
    if (prompts?.length && !(destPrompts?.length) && store.addGeneratedPrompts) {
      store.addGeneratedPrompts(newKey, prompts);
      migrated++;
    }

    // Images / projectUrls / videos: keys like ch_-1_0 or ch_-1_0_video
    const prefixOld = `${ch}_${oldIdx}_`;
    const prefixNew = `${ch}_${newIdx}_`;

    for (const [k, v] of Object.entries(store.generatedImages || {})) {
      if (!k.startsWith(prefixOld) || !v) continue;
      const dest = prefixNew + k.slice(prefixOld.length);
      if (!store.generatedImages?.[dest] && store.addGeneratedImage) {
        store.addGeneratedImage(dest, v);
        migrated++;
      }
    }

    for (const [k, v] of Object.entries(store.generatedVideos || {})) {
      if (!k.startsWith(prefixOld) || !v) continue;
      const dest = prefixNew + k.slice(prefixOld.length);
      if (!store.generatedVideos?.[dest] && store.addGeneratedVideo) {
        store.addGeneratedVideo(dest, v);
        migrated++;
      }
    }

    for (const [k, v] of Object.entries(store.projectUrls || {})) {
      if (!k.startsWith(prefixOld) || !v) continue;
      const dest = prefixNew + k.slice(prefixOld.length);
      if (!store.projectUrls?.[dest] && store.addProjectUrl) {
        store.addProjectUrl(dest, v);
        migrated++;
      }
    }
  }

  return migrated;
}

/**
 * Description — viết LẠI theo Thumbnail line (lead tò mò).
 * PAS: Problem (thumb) → Agitate (tóm ý, KHÔNG dump thoại) → Chapters + CTA + Tags
 */
export function buildSeoDescription(params: {
  hook: string;
  thumbnailLine: string;
  tags?: string;
  chaptersText?: string;
  novelTitle?: string;
  chapter?: number;
  forceThumbLead?: boolean;
  strongerAgitate?: boolean;
}): string {
  const thumb = (params.thumbnailLine || '').trim().slice(0, 30);
  const hookClean = stripDialogueStyle(params.hook || '');
  const title = (params.novelTitle || '').trim();
  const ch = params.chapter;

  // Lead = Thumbnail line (bắt buộc khi forceThumbLead)
  const lead =
    thumb ||
    clipAtWordBoundary(hookClean.split(/[.!?…]/)[0] || hookClean, 30) ||
    'Đừng xem nếu bạn dễ mất ngủ…';

  // Agitate: paraphrase tension — không chép hội thoại dài
  const sents = splitSentencesVi(hookClean)
    .filter((s) => !PSYCH_DIALOGUE_RE.test(s) && scorePsychologicalPull(s) >= 2)
    .slice(0, 3);
  const body =
    sents.length > 0
      ? sents.map((s) => clipAtWordBoundary(stripDialogueStyle(s), 140)).join(' ')
      : clipAtWordBoundary(hookClean, 220);

  const agitate = params.strongerAgitate
    ? [
        body,
        'Càng đi sâu, khoảng trống thông tin càng lớn — và cái giá phải trả không còn chỉ là mạng sống.',
        'Phút tiếp theo sẽ lật ngược mọi thứ bạn vừa tin.',
      ].join('\n')
    : [
        body,
        'Sai một bước là mất sạch. Bí mật lộ ra từng mảnh — không có chỗ lùi.',
      ].join('\n');

  const seriesLine = title
    ? `Tác phẩm: ${title}${ch ? ` · Chương ${ch}` : ''}`
    : 'Series kể chuyện đêm — mạt thế · sinh tồn · drama';

  const lines = [
    lead,
    '',
    agitate,
    '',
    seriesLine,
    '',
    '📌 Timeline / Chapters:',
    params.chaptersText || '(Sinh TTS theo cảnh rồi Export Pack để có mốc thời gian.)',
    '',
    '🔥 Nếu bạn từng thức khuya vì không thể dừng — series này dành cho bạn.',
    '🔔 Like · Subscribe để không bỏ lỡ chương sau.',
    '💬 Comment: bạn đoán điều gì xảy ra tiếp theo?',
    '',
    'Tags:',
    normalizeHashtagField(params.tags || '') || params.tags || '',
  ];
  return lines.filter((l, i, arr) => !(l === '' && arr[i - 1] === '')).join('\n').trim();
}

/** Cinematic EN prompt for thumbnail still (Whisk / Flux / MJ) */
export function buildThumbnailPrompt(params: {
  hook: string;
  thumbnailLine: string;
  visualDna?: string;
  characterHint?: string;
}): string {
  const mood = (params.thumbnailLine || params.hook || 'post-apocalyptic tension').slice(0, 120);
  const dna = params.visualDna?.trim() || 'cinematic natural realism, grounded production design';
  const char = params.characterHint?.trim() || 'lone survivor figure';
  return [
    `YouTube thumbnail still, 16:9, high contrast, readable negative space for bold text`,
    `dramatic key light, shallow depth, emotional face readable at small size`,
    char,
    `scene mood: ${mood}`,
    dna,
    `no clutter, no watermark, no UI chrome, no illegible tiny text in image`,
  ].join(', ');
}

/**
 * Nhãn mốc YouTube: chỉ thời gian + nội dung.
 * Bỏ "Cảnh 1", "CẢNH 2:", v.v.
 */
export function cleanYoutubeChapterLabel(
  title: string,
  contentHint?: string,
  index = 0,
): string {
  let label = (title || '').normalize('NFC').replace(/^\[+|\]+$/g, '').trim();

  // [CẢNH 1: …] / CẢNH 1: / Cảnh 1 —
  label = label.replace(/^CẢNH\s*\d+\s*[:：\-–—.]?\s*/i, '').trim();
  label = label.replace(/^Cảnh\s*\d+\s*[:：\-–—.]?\s*/i, '').trim();
  // Còn sót "Cảnh 1" đứng một mình
  label = label.replace(/^Cảnh\s*\d+\s*$/i, '').trim();

  // Gọn tag kỹ thuật: NỘI CẢNH. / NGOẠI CẢNH.
  label = label
    .replace(/^(NỘI\s*CẢNH|NGOẠI\s*CẢNH|INT\.?|EXT\.?)\s*[.:：\-]?\s*/i, '')
    .trim();

  // Nếu trống → lấy gợi ý nội dung ngắn
  if (!label || /^[\d\s.:\-–—]+$/.test(label)) {
    const hint = (contentHint || '')
      .normalize('NFC')
      .replace(/\[CẢNH[^\]]*\]/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    label = clipAtWordBoundary(hint, 48) || `Phân đoạn ${index + 1}`;
  }

  return label.slice(0, 80);
}

export function buildYoutubeChapters(
  scenes: { title: string; durationSec: number; content?: string }[],
): { startSec: number; label: string; line: string }[] {
  let t = 0;
  const out: { startSec: number; label: string; line: string }[] = [];
  scenes.forEach((sc, i) => {
    const mm = Math.floor(t / 60);
    const ss = Math.floor(t % 60);
    const label = cleanYoutubeChapterLabel(sc.title || '', sc.content, i);
    out.push({
      startSec: t,
      label,
      line: `${mm}:${String(ss).padStart(2, '0')} ${label}`,
    });
    t += Math.max(1, sc.durationSec || 0);
  });
  return out;
}

export function buildCutPlan(params: {
  chapter: number;
  sceneIndex: number;
  durationSec: number;
  prompts: { timestamp?: string; image_prompt?: string; video_prompt?: string; emotion?: string }[];
}): {
  chapter: number;
  sceneIndex: number;
  totalDuration: number;
  cuts: {
    index: number;
    start: number;
    end: number;
    shotScale: string;
    preferVideo: boolean;
    emotion?: string;
  }[];
} {
  const n = Math.max(1, params.prompts?.length || 1);
  const slice = params.durationSec / n;
  const cuts = (params.prompts || [{}]).map((p, i) => {
    const start = i * slice;
    const end = i === n - 1 ? params.durationSec : (i + 1) * slice;
    return {
      index: i,
      start: Math.round(start * 100) / 100,
      end: Math.round(end * 100) / 100,
      shotScale: SHOT_SCALE_CYCLE[i % SHOT_SCALE_CYCLE.length],
      preferVideo: i % 3 === 0 || !!(p.video_prompt && p.video_prompt.length > 20),
      emotion: p.emotion,
    };
  });
  return {
    chapter: params.chapter,
    sceneIndex: params.sceneIndex,
    totalDuration: params.durationSec,
    cuts,
  };
}

export function motionBudgetScore(imageCount: number, videoCount: number): {
  pct: number;
  ok: boolean;
  target: number;
} {
  const total = imageCount + videoCount;
  if (total === 0) return { pct: 0, ok: false, target: 25 };
  const pct = Math.round((videoCount / total) * 100);
  return { pct, ok: pct >= 20, target: 25 };
}

export function buildYoutubeChecklist(params: {
  hasScript: boolean;
  wordOk: boolean;
  sceneCount: number;
  minScenes: number;
  editorVerdict?: EditorVerdict;
  ttsPlatform?: string;
  ttsPitch?: number;
  ttsSpeed?: number;
  hasVisualDna: boolean;
  hasAudio: boolean;
  imageCount: number;
  videoCount: number;
  enforceEditorGate: boolean;
  humanEdited?: boolean;
  requireHumanEdit?: boolean;
  hasHook?: boolean;
  hasSeoTitle?: boolean;
  hasSeoDescription?: boolean;
  hasThumbnailPrompt?: boolean;
}): YoutubeChecklistItem[] {
  const items: YoutubeChecklistItem[] = [];

  items.push({
    id: 'script',
    label: 'Có kịch bản chương',
    ok: params.hasScript,
    level: params.hasScript ? 'pass' : 'fail',
  });

  items.push({
    id: 'word_gate',
    label: 'Đạt Cổng Từ (Word-Gate)',
    ok: params.wordOk,
    level: params.wordOk ? 'pass' : 'warn',
  });

  items.push({
    id: 'scenes',
    label: `≥${params.minScenes} phân cảnh`,
    ok: params.sceneCount >= params.minScenes,
    level: params.sceneCount >= params.minScenes ? 'pass' : 'warn',
  });

  const v = params.editorVerdict;
  if (!v) {
    items.push({
      id: 'editor',
      label: 'AI Editor đã chấm',
      ok: false,
      level: params.enforceEditorGate ? 'fail' : 'warn',
    });
  } else if (v === 'rewrite') {
    items.push({
      id: 'editor',
      label: 'Editor: cần rewrite',
      ok: false,
      level: 'fail',
    });
  } else if (v === 'polish') {
    items.push({
      id: 'editor',
      label: 'Editor: nên polish',
      ok: false,
      level: 'warn',
    });
  } else {
    items.push({ id: 'editor', label: 'Editor: accept', ok: true, level: 'pass' });
  }

  if (params.requireHumanEdit) {
    items.push({
      id: 'human_edit',
      label: params.humanEdited ? 'Human Pass: đã tick' : 'Human Pass: chưa tick',
      ok: !!params.humanEdited,
      level: params.humanEdited ? 'pass' : 'fail',
      detail: 'Sửa tay hook/thoại rồi tick trước TTS',
    });
  }

  items.push({
    id: 'hook',
    label: params.hasHook ? 'Hook ~30s đã có' : 'Chưa có hook ~30s',
    ok: !!params.hasHook,
    level: params.hasHook ? 'pass' : 'warn',
    detail: 'Cold-open đọc ~30 giây (khoảng 55–80 từ)',
  });

  items.push({
    id: 'seo_title',
    label: params.hasSeoTitle ? 'SEO Title' : 'Thiếu SEO Title',
    ok: !!params.hasSeoTitle,
    level: params.hasSeoTitle ? 'pass' : 'warn',
  });

  items.push({
    id: 'seo_desc',
    label: params.hasSeoDescription ? 'SEO Description' : 'Thiếu mô tả YouTube',
    ok: !!params.hasSeoDescription,
    level: params.hasSeoDescription ? 'pass' : 'warn',
  });

  items.push({
    id: 'thumb_prompt',
    label: params.hasThumbnailPrompt ? 'Prompt thumbnail' : 'Thiếu prompt thumbnail',
    ok: !!params.hasThumbnailPrompt,
    level: params.hasThumbnailPrompt ? 'pass' : 'warn',
  });

  const platform = (params.ttsPlatform || '').toLowerCase();
  const voiceRisk = HIGH_RISK_TTS_PLATFORMS.has(platform);
  items.push({
    id: 'voice',
    label: voiceRisk ? `TTS risk: ${platform || '?'}` : `TTS: ${platform || 'chưa chọn'}`,
    ok: !voiceRisk && !!platform,
    level: !platform ? 'warn' : voiceRisk ? 'warn' : 'pass',
  });

  const pitch = Number(params.ttsPitch ?? 0);
  const speed = Number(params.ttsSpeed ?? 1);
  const dnaOk = pitch !== 0 || Math.abs(speed - 1) >= 0.02;
  items.push({
    id: 'voice_dna',
    label: 'Voice DNA (pitch/speed ≠ default phẳng)',
    ok: dnaOk,
    level: dnaOk ? 'pass' : 'warn',
  });

  items.push({
    id: 'visual_dna',
    label: 'Visual DNA / style riêng',
    ok: params.hasVisualDna,
    level: params.hasVisualDna ? 'pass' : 'warn',
  });

  items.push({
    id: 'audio',
    label: 'Đã có TTS audio',
    ok: params.hasAudio,
    level: params.hasAudio ? 'pass' : 'warn',
  });

  const visualOk = params.imageCount + params.videoCount > 0;
  items.push({
    id: 'visuals',
    label: visualOk
      ? `Media: ${params.imageCount} ảnh · ${params.videoCount} video`
      : 'Chưa có ảnh/video storyboard',
    ok: visualOk,
    level: visualOk ? 'pass' : 'warn',
  });

  const motion = motionBudgetScore(params.imageCount, params.videoCount);
  if (params.imageCount + params.videoCount > 0) {
    items.push({
      id: 'motion',
      label: `Motion budget ~${motion.pct}% video (mục tiêu ≥${motion.target}%)`,
      ok: motion.ok,
      level: motion.ok ? 'pass' : 'warn',
      detail: motion.ok ? undefined : 'Thêm clip motion — tránh pure slideshow',
    });
  }

  return items;
}

export function summarizeChecklist(items: YoutubeChecklistItem[]): {
  pass: number;
  warn: number;
  fail: number;
  ready: boolean;
} {
  let pass = 0;
  let warn = 0;
  let fail = 0;
  for (const i of items) {
    if (i.level === 'pass') pass += 1;
    else if (i.level === 'warn') warn += 1;
    else fail += 1;
  }
  return { pass, warn, fail, ready: fail === 0 };
}

export interface YoutubeExportPack {
  version: 2;
  generatedAt: string;
  title: string;
  chapter: number;
  /** ~30s cold-open VO */
  hook: string;
  thumbnailLine: string;
  seoTitle: string;
  seoDescription: string;
  seoTags: string;
  thumbnailPrompt: string;
  chaptersText: string;
  chapters: { startSec: number; label: string; line: string }[];
  cutPlans: ReturnType<typeof buildCutPlan>[];
  checklist: YoutubeChecklistItem[];
  voiceDna: { platform?: string; voice?: string; speed?: number; pitch?: number };
  /** What this pack is for (shown in UI + file) */
  purpose: string[];
  notes: string[];
}
