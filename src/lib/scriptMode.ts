/**
 * Phong cách kịch bản (scriptMode) — DNA AI Novel.
 *
 * Một nguồn chân lý cho nhịp xuất bản / retention:
 * - chuyen_sau  → audio novel / chuyên sâu (chậm, cold open TẮT)
 * - sang_van    → recap / sảng văn dồn (nhanh, cold open GỢI Ý)
 * - short_manhua → Short / Manhua / Reels (siêu nhanh, cold open BẬT)
 *
 * short_manhua: logic short drama / manhua xuyên pipeline app
 * (outline → write → scene → prompt → media hints), không đổi Phase wizard.
 */

export const SCRIPT_MODES = ['chuyen_sau', 'sang_van', 'short_manhua'] as const;
export type ScriptMode = (typeof SCRIPT_MODES)[number];

/** Cold open trong body kịch bản — phân theo Phong Cách Kịch Bản */
export type ColdOpenPolicy = 'off' | 'soft' | 'on';

export function isScriptMode(v: unknown): v is ScriptMode {
  return (
    typeof v === 'string' &&
    (SCRIPT_MODES as readonly string[]).includes(v)
  );
}

export function normalizeScriptMode(v: unknown): ScriptMode {
  if (isScriptMode(v)) return v;
  return 'chuyen_sau';
}

export function isShortManhuaMode(v: unknown): boolean {
  return normalizeScriptMode(v) === 'short_manhua';
}

export function isSangVanMode(v: unknown): boolean {
  return normalizeScriptMode(v) === 'sang_van';
}

/** Suggested words/chapter when user picks short/manhua (soft nudge). */
export const SHORT_MANHUA_RECOMMENDED_WORDS = 1200;

/** Soft ceiling for scenes per chapter in short mode. */
export const SHORT_MANHUA_MAX_SCENES = 8;

/** Min scenes for short (still ≥ core MIN of 3). */
export const SHORT_MANHUA_MIN_SCENES = 4;

/** Preferred seconds/beat for short production (soft). */
export const SHORT_MANHUA_SECONDS_PER_BEAT = 3.5;

/** Preferred Flow video duration when short (4|6|8). */
export const SHORT_MANHUA_VIDEO_DURATION = 6;

/** Preferred TTS WPM when short (soft). */
export const SHORT_MANHUA_WPM = 170;

export interface ScriptModePacing {
  /** Target spoken WPM for TTS / duration estimate */
  wpm: number;
  /** Default seconds per visual beat */
  secondsPerBeat: number;
  /** Preferred Flow clip length 4|6|8 */
  videoDuration: number;
  /** Soft so_tu_chuong target (short only usually) */
  so_tu_chuong?: number;
  /** Nudge so_tu down when current ≥ this */
  so_tu_nudge_if_at_least?: number;
  /** Cold open policy for WRITE body */
  coldOpen: ColdOpenPolicy;
  /** Shot duration band for Gen Prompt (seconds) */
  shotSecMin: number;
  shotSecMax: number;
  /** UI / docs one-liner */
  pacingBlurb: string;
}

/**
 * Preset nhịp theo Phong Cách Kịch Bản.
 * Soft-apply khi setScriptMode — không đè nếu user đã chỉnh trong band hợp lệ.
 */
export const SCRIPT_MODE_PACING: Record<ScriptMode, ScriptModePacing> = {
  chuyen_sau: {
    wpm: 130,
    secondsPerBeat: 7,
    videoDuration: 8,
    coldOpen: 'off',
    shotSecMin: 6,
    shotSecMax: 8.5,
    pacingBlurb:
      'Audio dài / chuyên sâu: ~130 WPM, beat ~7s, không cold-open trailer, shot dài + zoom nhẹ.',
  },
  sang_van: {
    wpm: 155,
    secondsPerBeat: 4.5,
    videoDuration: 6,
    coldOpen: 'soft',
    shotSecMin: 3.5,
    shotSecMax: 5.5,
    pacingBlurb:
      'Recap / sảng văn: ~155 WPM, beat ~4.5s, cold-open gợi ý (vả mặt), shot vừa–nhanh.',
  },
  short_manhua: {
    wpm: SHORT_MANHUA_WPM,
    secondsPerBeat: SHORT_MANHUA_SECONDS_PER_BEAT,
    videoDuration: SHORT_MANHUA_VIDEO_DURATION,
    so_tu_chuong: SHORT_MANHUA_RECOMMENDED_WORDS,
    so_tu_nudge_if_at_least: 2500,
    coldOpen: 'on',
    shotSecMin: 2.5,
    shotSecMax: 4,
    pacingBlurb:
      'Short / Manhua: ~170 WPM, beat ~3.5s, cold-open BẮT BUỘC, shot 2.5–4s theo tension.',
  },
};

export function getScriptModePacing(mode?: unknown): ScriptModePacing {
  return SCRIPT_MODE_PACING[normalizeScriptMode(mode)];
}

export const SCRIPT_MODE_META: Record<
  ScriptMode,
  {
    label: string;
    shortLabel: string;
    accent: 'purple' | 'rose' | 'teal';
    blurb: string;
  }
> = {
  chuyen_sau: {
    label: 'Kịch Bản Chuyên Sâu',
    shortLabel: 'Chuyên sâu',
    accent: 'purple',
    blurb:
      'Audio novel / chuyên sâu: logic hiện thực, tả cảnh + tâm lý, ~130 WPM, beat dài — không ép cold-open trailer.',
  },
  sang_van: {
    label: 'Sảng Văn (Dopamine Hit)',
    shortLabel: 'Sảng văn',
    accent: 'rose',
    blurb:
      'Recap dồn: vả mặt, câu ngắn, ~155 WPM, beat vừa — cold-open gợi ý (pattern interrupt).',
  },
  short_manhua: {
    label: 'Short / Manhua',
    shortLabel: 'Short·Manhua',
    accent: 'teal',
    blurb:
      'Shorts/Reels: thoại + action nhìn được, ~170 WPM, cold-open bắt buộc, shot 2.5–4s theo tension.',
  },
};

/** Min [CẢNH] tags expected for word-gate / quality. */
export function minScenesForScriptMode(mode?: unknown): number {
  return isShortManhuaMode(mode) ? SHORT_MANHUA_MIN_SCENES : 3;
}

export function maxScenesForScriptMode(mode?: unknown): number {
  return isShortManhuaMode(mode) ? SHORT_MANHUA_MAX_SCENES : 5;
}

export type ScriptModeSoftPatch = {
  so_tu_chuong?: number;
  secondsPerBeat?: number;
  videoDuration?: number;
  wpm?: number;
};

/**
 * Soft media / pacing patch when switching Phong Cách Kịch Bản.
 * Only nudges values that look like wrong-mode defaults or extremes — does not
 * stomp user fine-tuning inside a mode's comfort band.
 */
export function scriptModeMediaSoftPatch(
  mode: unknown,
  current: {
    so_tu_chuong?: number | null;
    secondsPerBeat?: number | null;
    videoDuration?: number | null;
    wpm?: number | null;
  },
): ScriptModeSoftPatch {
  const m = normalizeScriptMode(mode);
  const p = SCRIPT_MODE_PACING[m];
  const out: ScriptModeSoftPatch = {};

  const words = Number(current.so_tu_chuong);
  const beat = Number(current.secondsPerBeat);
  const vd = Number(current.videoDuration);
  const wpm = Number(current.wpm);

  if (m === 'short_manhua') {
    if (
      !Number.isFinite(words) ||
      words <= 0 ||
      (p.so_tu_nudge_if_at_least != null && words >= p.so_tu_nudge_if_at_least)
    ) {
      out.so_tu_chuong = p.so_tu_chuong ?? SHORT_MANHUA_RECOMMENDED_WORDS;
    }
    // Long-form beat (≥6) or invalid → short beat
    if (!Number.isFinite(beat) || beat <= 0 || beat >= 6) {
      out.secondsPerBeat = p.secondsPerBeat;
    }
    if (!Number.isFinite(vd) || vd <= 0 || vd >= 8) {
      out.videoDuration = p.videoDuration;
    }
    // Slow audio WPM or invalid → short WPM
    if (!Number.isFinite(wpm) || wpm <= 0 || wpm <= 145) {
      out.wpm = p.wpm;
    }
    return out;
  }

  if (m === 'sang_van') {
    // Beat from long audio (≥6) or ultra-short (≤2.5) → recap mid
    if (!Number.isFinite(beat) || beat <= 0 || beat >= 6 || beat <= 2.5) {
      out.secondsPerBeat = p.secondsPerBeat;
    }
    if (!Number.isFinite(vd) || vd <= 0 || vd >= 8) {
      out.videoDuration = p.videoDuration;
    }
    // Too slow (audio) or too fast (short 170+) → 155
    if (!Number.isFinite(wpm) || wpm <= 0 || wpm <= 140 || wpm >= 168) {
      out.wpm = p.wpm;
    }
    return out;
  }

  // chuyen_sau — restore long-form when coming from short/recap defaults
  if (!Number.isFinite(beat) || beat <= 0 || beat <= 5) {
    out.secondsPerBeat = p.secondsPerBeat;
  }
  if (!Number.isFinite(vd) || vd <= 0 || vd < 8) {
    // Prefer 8 for long still holds; only nudge if missing/short-ish
    if (!Number.isFinite(vd) || vd <= 0 || vd === 4 || vd === 6) {
      out.videoDuration = p.videoDuration;
    }
  }
  if (!Number.isFinite(wpm) || wpm <= 0 || wpm >= 150) {
    out.wpm = p.wpm;
  }
  return out;
}

/**
 * @deprecated Prefer scriptModeMediaSoftPatch('short_manhua', current)
 * Kept for smoke / callers that still import the short-only name.
 */
export function shortManhuaMediaSoftPatch(current: {
  so_tu_chuong?: number | null;
  secondsPerBeat?: number | null;
  videoDuration?: number | null;
  wpm?: number | null;
}): ScriptModeSoftPatch {
  return scriptModeMediaSoftPatch('short_manhua', current);
}

export function shouldNudgeWordGoalForShortManhua(
  currentSoTu?: number | null,
): boolean {
  const n = Number(currentSoTu);
  if (!Number.isFinite(n) || n <= 0) return true;
  return n >= 2500;
}

/**
 * WRITE_CHAPTER — nhịp TTS/beat theo mode (prompt guidance).
 */
export function buildScriptModePacingBlock(mode?: unknown): string {
  const m = normalizeScriptMode(mode);
  const p = SCRIPT_MODE_PACING[m];
  return `
--- NHỊP THEO PHONG CÁCH KỊCH BẢN (${m}) ---
${p.pacingBlurb}
1) TTS pacing mục tiêu ~${p.wpm} WPM (câu ${m === 'chuyen_sau' ? 'vừa–dài, thở' : m === 'sang_van' ? 'ngắn–dồn, dứt' : 'siêu ngắn, kinetic'}).
2) Visual beat gợi ý ~${p.secondsPerBeat}s/shot (band ${p.shotSecMin}–${p.shotSecMax}s theo tension khi Gen Prompt).
3) Cold open policy: ${p.coldOpen === 'off' ? 'TẮT — không trailer-teaser' : p.coldOpen === 'soft' ? 'GỢI Ý — pattern interrupt đầu chương' : 'BẬT — [CẢNH 0] cold open bắt buộc'}.
4) CẤM áp nhịp mode khác (ví dụ short 2.5s / cold open trailer cho audio chuyên sâu).
`;
}

/**
 * WRITE_CHAPTER — cold open theo mode. Skip when continuing mid-chapter.
 */
export function buildScriptModeColdOpenBlock(
  mode?: unknown,
  opts?: { isContinue?: boolean },
): string {
  if (opts?.isContinue) return '';
  const m = normalizeScriptMode(mode);
  const p = SCRIPT_MODE_PACING[m];

  if (p.coldOpen === 'off') {
    return `
--- COLD OPEN (chuyen_sau — TẮT) ---
KHÔNG chèn [CẢNH 0] trailer-teaser / cold-open vả mặt kiểu Shorts.
Bắt đầu bằng [CẢNH 1: ...] theo nhịp chương (bối cảnh + NV có chiều sâu, vào việc sớm nhưng không spoiler đỉnh tập dạng teaser).
Câu mở: pattern interrupt nhẹ (xung đột/câu hỏi) được — CẤM mở thơ phong cảnh; CẤM structure "15s hook rồi 3 năm trước" trừ khi dàn ý chương yêu cầu.
`;
  }

  if (p.coldOpen === 'soft') {
    return `
--- COLD OPEN (sang_van — GỢI Ý) ---
1–3 câu đầu chương: pattern interrupt / vả mặt / đe dọa / câu hỏi — CẤM mở thơ phong cảnh.
Có thể gói ~15–30s cold-open ngay trong [CẢNH 1] (không bắt buộc [CẢNH 0]).
Sau hook ngắn: nối thẳng cốt recap dồn; cuối chương open loop.
Không bắt buộc flash-forward "3 năm trước" nếu dàn ý không có.
`;
  }

  // on — short_manhua
  return `
--- COLD OPEN SHORT / MANHUA (BẮT BUỘC) ---
Mở chương bằng tag riêng (ước đọc ~15–30s, ~40–90 từ):
[CẢNH 0: COLD OPEN - HOOK]
Nội dung: xung đột đỉnh / phản bội / vả mặt / câu hỏi sống còn — pattern interrupt trong 1–3 câu đầu.
Sau CẢNH 0 → [CẢNH 1: ...] nối hệ quả hoặc "quay về trước nhịp đỉnh" (không time-skip tuần/tháng máy).
Cấu trúc tập short: giây 0–3 hook → thân xung đột → cuối twist / open loop.
CẤM mở thơ phong cảnh; CẤM monologue dài trong CẢNH 0.
`;
}

/**
 * Gen Prompt Studio — shot rhythm language + tension duration guidance.
 */
export function buildScriptModeShotRhythmBlock(mode?: unknown): string {
  const m = normalizeScriptMode(mode);
  const p = SCRIPT_MODE_PACING[m];

  if (m === 'short_manhua') {
    return `
--- NHỊP SHOT SHORT / MANHUA (BẮT BUỘC) ---
Band duration: ${p.shotSecMin}–${p.shotSecMax}s / shot (dồn, kinetic).
- Chiến đấu / đuổi bắt / thảm họa / shock: thiên ${p.shotSecMin}–${(p.shotSecMin + 1).toFixed(1)}s.
- Hội thoại / reaction: ~3.5–${p.shotSecMax}s.
- Tả cảnh / establishing: tối đa ~${p.shotSecMax}s — không kéo 6–8s kiểu audio dài.
Emotion field: dùng từ tension rõ (tense/action/shock/calm/dialogue) để app phân bổ duration.
Mỗi shot = 1 beat nhìn được; camera move ngắn.
`;
  }

  if (m === 'sang_van') {
    return `
--- NHỊP SHOT SẢNG VĂN / RECAP ---
Band duration: ${p.shotSecMin}–${p.shotSecMax}s / shot (vừa–nhanh).
- Vả mặt / combat / reveal: thiên ${p.shotSecMin}–4.2s.
- Thoại / thuyết minh recap: ~4–${p.shotSecMax}s.
- Không ép shot 2.5s toàn bộ (đó là short); không kéo 7–8s audio dài.
Emotion field: tense/action/shock vs calm/dialogue để weight duration.
`;
  }

  return `
--- NHỊP SHOT CHUYÊN SÂU / AUDIO DÀI ---
Band duration: ${p.shotSecMin}–${p.shotSecMax}s / shot (chậm, tĩnh + zoom nhẹ).
- Hội thoại / nội tâm / tả cảnh: thiên ${p.shotSecMin}–${p.shotSecMax}s.
- Xung đột có thể rút nhẹ (~${p.shotSecMin}s) nhưng CẤM dồn 2.5–3.5s kiểu Shorts.
- Ưu tiên establishing + hold; motion vừa phải.
`;
}

/**
 * Tension score 0–1 from emotion + optional sentence (deterministic, no AI invent).
 * Higher = shorter shots when mode allows dynamic rhythm.
 */
export function scoreShotTension(emotion?: string, sentence?: string): number {
  const e = `${emotion || ''} ${sentence || ''}`.toLowerCase().normalize('NFC');
  if (!e.trim()) return 0.35;
  let score = 0.35;
  if (
    /fight|battle|combat|action|chase|run|explode|crash|slash|kiếm|đánh|đuổi|nổ|sấm|war|shock|vả|slap|reveal|twist|panic|scream|hét|thét|blood|máu/.test(
      e,
    )
  ) {
    score += 0.45;
  }
  if (/tense|căng|threat|nguy|fear|sợ|anger|giận|rage|crisis|khủng/.test(e)) {
    score += 0.25;
  }
  if (
    /calm|peaceful|contemplat|sad|buồn|melanch|establishing|wide|scenery|tả cảnh|suy tư|dialogue|thoại|nói|whisper|thì thầm/.test(
      e,
    )
  ) {
    score -= 0.25;
  }
  return Math.max(0, Math.min(1, score));
}

/**
 * Allocate per-shot seconds that SUM to totalDurationSec.
 * Mode band from SCRIPT_MODE_PACING; tension shortens within band.
 * B10: never invent total — caller must pass real totalDurationSec > 0.
 */
export function allocateShotDurationsByMode(opts: {
  mode?: unknown;
  totalDurationSec: number;
  count: number;
  emotions?: Array<string | undefined>;
  sentences?: Array<string | undefined>;
  /** Optional style-engine shot band; intersect with scriptMode (format wins if empty) */
  styleShot?: { min?: number; max?: number } | null;
}): number[] {
  const n = Math.max(0, Math.floor(opts.count));
  const total = Number(opts.totalDurationSec);
  if (n <= 0) return [];
  if (!Number.isFinite(total) || total <= 0) {
    throw new Error(
      'allocateShotDurationsByMode: thieu totalDurationSec hop le — khong tu gan duration.',
    );
  }

  const m = normalizeScriptMode(opts.mode);
  const p = SCRIPT_MODE_PACING[m];
  // Full tension weight: short + sang_van. Mild tension for chuyen_sau (long band only).
  const strongDynamic = m === 'short_manhua' || m === 'sang_van';
  const mildDynamic = m === 'chuyen_sau';

  const weights: number[] = [];
  for (let i = 0; i < n; i++) {
    if (!strongDynamic && !mildDynamic) {
      weights.push(1);
      continue;
    }
    const t = scoreShotTension(opts.emotions?.[i], opts.sentences?.[i]);
    if (mildDynamic) {
      // Mild: high tension slightly shorter within long band (blend toward even)
      weights.push(Math.max(0.75, 1.05 - t * 0.35));
      continue;
    }
    // High tension → higher weight for "shortness" inverse: use (1.15 - t) so fight gets less share
    weights.push(Math.max(0.35, 1.2 - t));
  }

  const sumW = weights.reduce((a, b) => a + b, 0) || n;
  const raw = weights.map((w) => (w / sumW) * total);

  // Clamp into mode band (∩ style engine band when provided and non-empty)
  let minB = Math.max(1, p.shotSecMin);
  let maxB = Math.max(minB, p.shotSecMax);
  const sMin = Number(opts.styleShot?.min);
  const sMax = Number(opts.styleShot?.max);
  if (Number.isFinite(sMin) && Number.isFinite(sMax) && sMin > 0 && sMax >= sMin) {
    const iMin = Math.max(minB, sMin);
    const iMax = Math.min(maxB, sMax);
    if (iMin <= iMax) {
      minB = iMin;
      maxB = iMax;
    }
  }
  const even = total / n;
  let clamped = raw.map((d) => Math.min(maxB, Math.max(minB, d)));

  // Timeline không khớp band (even ngoài [min,max], quá dày/thưa) → even split, giữ tổng
  // B10: tổng duration từ TTS/WPM phải đúng — không để clamp band làm lệch sum
  if (
    even < minB ||
    even > maxB ||
    even < minB * 0.55 ||
    even > maxB * 1.15 ||
    n * minB > total * 1.35
  ) {
    clamped = raw.map(() => even);
  }

  // Integer seconds, last shot absorbs remainder (allow last ≥1)
  const target = Math.round(total);
  const out: number[] = [];
  let used = 0;
  for (let i = 0; i < n; i++) {
    if (i === n - 1) {
      out.push(Math.max(1, target - used));
    } else {
      const d = Math.max(1, Math.round(clamped[i]));
      out.push(d);
      used += d;
    }
  }
  // Force exact sum: adjust last, then cascade earlier shots if last would go <1
  let sum = out.reduce((a, b) => a + b, 0);
  if (sum !== target && n > 0) {
    out[n - 1] += target - sum;
    if (out[n - 1] < 1) {
      let need = 1 - out[n - 1];
      out[n - 1] = 1;
      for (let i = n - 2; i >= 0 && need > 0; i--) {
        const take = Math.min(need, Math.max(0, out[i] - 1));
        out[i] -= take;
        need -= take;
      }
    }
    sum = out.reduce((a, b) => a + b, 0);
    // Final remainder on last if still off (edge only)
    if (sum !== target) out[n - 1] += target - sum;
  }
  return out;
}

/**
 * Outline guidance when scriptMode = short_manhua.
 */
export function buildShortManhuaOutlineBlock(soChuong: number): string {
  const n = Math.max(1, Math.min(500, Number(soChuong) || 1));
  return `
--- LOGIC SHORT / MANHUA (pipeline AI Novel — BẮT BUỘC) ---
Đây là dàn ý **short drama / manhua / dynamic comic**, không phải tiểu thuyết dài thrift:
1) Mỗi "chương" = **1 tập short** (logline 1 câu + 3–6 beat hình ảnh/hành động).
2) Tổng ${n} tập: mỗi tập mở cold-open hook → xung đột → twist/reveal → open loop (hook tập sau).
3) Nhân vật: 2–4 role chính; mỗi người 1 **visual anchor** (trang phục/đặc điểm nhìn thấy) + khuyết điểm (điểm yếu).
4) Lorebook: **ngắn** — 5–10 luật tối đa; ưu tiên location tái dùng, không world-bible dày.
5) dan_y mỗi chương: bullet "HOOK → Hành động nhìn được + thoại → chốt open loop" (sẵn Gen Prompt).
6) CẤM time-skip tuần/tháng; real-time trong tập.
`;
}

/** Expand / rewrite scene — short production logic. */
export function buildShortManhuaSceneBlock(kind: 'expand' | 'rewrite'): string {
  if (kind === 'expand') {
    return `
--- LOGIC SHORT / MANHUA (MỞ RỘNG CẢNH) ---
1) Ưu tiên **thoại + hành động nhìn được**; narration tối đa 1–3 câu bối cảnh.
2) Mỗi beat phải "camera-ready": ai ở đâu, làm gì, phản ứng rõ (sẵn image/video prompt).
3) Mở rộng **không** thành monologue nội tâm dài; thêm micro-conflict / reaction shot bằng hành động-thoại.
4) Cuối cảnh: open loop ngắn (hệ quả) — hook sang cảnh sau / TTS cut.
5) CẤM note đạo diễn [zoom], (Cười), checklist A.B.C.
`;
  }
  return `
--- LOGIC SHORT / MANHUA (VIẾT LẠI CẢNH) ---
1) Giữ cốt; trau chuốt thành **thoại dứt + action visible**.
2) Cắt tường thuật thừa; mỗi đoạn phải vẽ được 1 still.
3) Visual anchor NV (trang phục/marks) nếu NV xuất hiện.
4) Độ dài ±15%; nhịp audio-friendly (câu ngắn vừa miệng TTS ~170 WPM).
5) CẤM monologue >3 câu; CẤM note đạo diễn thô.
`;
}

/** Gen Prompt Studio — short shot language. */
export function buildShortManhuaImagePromptBlock(): string {
  return `
--- LOGIC SHORT / MANHUA (GEN PROMPT SHOT) ---
1) Mỗi shot = 1 clear visual beat (composition + action + emotion face nếu có NV).
2) image_prompt: cinematic still, readable silhouette, production design theo Setup/Visual DNA — không dump nội tâm.
3) video_prompt: camera move ngắn (push-in / pan / hold), subject motion rõ 1–2 hành động; duration-friendly short clip (${SCRIPT_MODE_PACING.short_manhua.shotSecMin}–${SCRIPT_MODE_PACING.short_manhua.shotSecMax}s).
4) Ưu tiên continuity wardrobe/face lock; tránh đổi outfit giữa shot liên tiếp trừ khi kịch bản đổi.
5) script_prompt giữ nguyên tiếng Việt; image/video 100% English.
`;
}

/** Word-gate continue extra for short mode. */
export function buildShortManhuaWordGateExtra(
  wordMin: number,
  minScenes: number,
): string {
  return `
⚠️ BÙ CỔNG TỪ — SHORT / MANHUA (CHẤT LƯỢNG, KHÔNG NHỒI):
Bản trước chưa đạt ≥${wordMin} từ và/hoặc ≥${minScenes} [CẢNH].
- Viết thêm phần MỚI: beat hành động + thoại + stakes (không monologue thrift).
- Thiếu cảnh: thêm [CẢNH X: NỘI/NGOẠI…] ngắn, 1 micro-goal/cảnh, open loop.
- Nếu thiếu CẢNH 0 cold open: có thể bổ sung hook ngắn rồi nối CẢNH đã có.
- CẤM đệm tính từ / lặp mô tả / tóm tắt lại.
- Chỉ trả về phần MỚI.
`;
}

/** Quality-gate soft findings for short scripts (warnings only). */
export function shortManhuaQualityHints(content: string): Array<{
  severity: 'warning' | 'info';
  code: string;
  message: string;
}> {
  const text = (content || '').normalize('NFC');
  const out: Array<{ severity: 'warning' | 'info'; code: string; message: string }> =
    [];
  if (!text.trim()) return out;

  const scenes =
    text.match(/\[CẢNH\s+\d+\s*:[^\]]+\]/gi)?.length || 0;
  if (scenes > 0 && scenes < SHORT_MANHUA_MIN_SCENES) {
    out.push({
      severity: 'warning',
      code: 'short_scene_count',
      message: `Short/Manhua: nên ≥${SHORT_MANHUA_MIN_SCENES} [CẢNH] (hiện ${scenes}) để cut storyboard.`,
    });
  }

  const hasColdOpen =
    /\[CẢNH\s*0\s*:[^\]]*COLD\s*OPEN/i.test(text) ||
    /\[CẢNH\s*0\s*:[^\]]*HOOK/i.test(text);
  if (scenes >= 2 && !hasColdOpen) {
    out.push({
      severity: 'warning',
      code: 'short_missing_cold_open',
      message:
        'Short/Manhua: thiếu [CẢNH 0: COLD OPEN - HOOK] — retention 0–3s dễ rớt.',
    });
  }

  // Rough dialogue density: lines with colon speaker or quotes
  const dialogueHits =
    (text.match(/["“”]/g) || []).length +
    (text.match(/(?:^|\n)\s*[\wÀ-ỹ'’\-\s]{2,24}\s*[:：]/gm) || []).length;
  const words = text.replace(/\[[^\]]*\]/g, '').split(/\s+/).filter(Boolean)
    .length;
  if (words > 200 && dialogueHits < 4) {
    out.push({
      severity: 'warning',
      code: 'short_low_dialogue',
      message:
        'Short/Manhua: thoại thưa — ưu tiên hội thoại/reaction visible cho TTS + shot.',
    });
  }

  if (words > 1800) {
    out.push({
      severity: 'info',
      code: 'short_long_chapter',
      message:
        'Short/Manhua: chương khá dài cho 1 tập short — cân nhắc cắt beat hoặc hạ so_tu_chuong.',
    });
  }

  return out;
}
