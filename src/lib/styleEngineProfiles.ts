/**
 * Style Engine Profiles — 5 niche hot YouTube/TikTok.
 *
 * Content DNA theo Setup (chu_de + phong_cach), độc lập với scriptMode (format DNA).
 * Match optional: không khớp → null (không ép genre default — IRON/B10).
 */

import {
  getScriptModePacing,
  normalizeScriptMode,
  type ScriptMode,
} from './scriptMode';

export const STYLE_ENGINE_IDS = [
  'tu_tien',
  'do_thi_va_mat',
  'mat_the_sinh_ton',
  'kinh_di_huyen_nghi',
  'cung_dau_ngon_tinh',
] as const;

export type StyleEngineId = (typeof STYLE_ENGINE_IDS)[number];

export type StyleEngineProfile = {
  id: StyleEngineId;
  labelVi: string;
  /** Match Setup labels (NFC, case-insensitive, substring / alias) */
  match: { chu_de: string[]; phong_cach: string[] };
  audienceCraving: string;
  coldOpen: {
    recipeVi: string;
    sampleHookLine: string;
  };
  wpm: number;
  wpmMin: number;
  wpmMax: number;
  shotSecMin: number;
  shotSecMax: number;
  visual: {
    colorGrade: string;
    visualDnaEn: string;
    mediaStylePreset: string;
  };
  ttsTone: {
    narrator: string;
    rolesHint: string;
    suggestedNarratorVoice?: string;
  };
  ctr: {
    titlePatterns: string[];
    thumbTextExamples: string[];
    thumbCompositionHintEn: string;
    primaryHookType: string;
    /** Motifs for SEO score boost (VI, lowercase-friendly) */
    scoreMotifs: string[];
  };
};

function nfc(s: string): string {
  return (s || '').normalize('NFC').trim();
}

function normKey(s: string): string {
  return nfc(s).toLowerCase().replace(/\s+/g, ' ');
}

/** True if haystack contains any alias (substring, NFC). */
function hitsAlias(haystack: string, aliases: string[]): boolean {
  const h = normKey(haystack);
  if (!h) return false;
  return aliases.some((a) => {
    const k = normKey(a);
    return k.length > 0 && h.includes(k);
  });
}

export const STYLE_ENGINE_PROFILES: StyleEngineProfile[] = [
  {
    id: 'tu_tien',
    labelVi: 'Tu Tiên / Tiên Hiệp / Huyền Huyễn',
    match: {
      chu_de: [
        'Linh Khí Khôi Phục',
        'Võ Hiệp',
        'Kỳ Ảo Mạo Hiểm',
        'Thần Thoại',
        'Hệ Thống',
      ],
      phong_cach: [
        'Tu Tiên / Tiên Hiệp',
        'Tu Tiên',
        'Tiên Hiệp',
        'Huyền Huyễn',
        'Đông Phương Kỳ Ảo',
        'Kiếm Hiệp',
      ],
    },
    audienceCraving:
      'Thích thăng cấp (level up), phá vỡ giới hạn (realm breach), bị khinh bỉ → thức tỉnh hào quang trảm sát kẻ thù.',
    coldOpen: {
      recipeVi:
        '15s: cắt ngay cảnh Rút Thần Kiếm trảm sát Lão Tổ hoặc Thiên Kiếp Giáng Lâm đưa lên đầu — pattern interrupt sức mạnh, không mở thơ phong cảnh tông môn.',
      sampleHookLine:
        'Chỉ với 1 kiếm này, hắn đã san bằng cả Tông môn số 1 Nam Hoang...',
    },
    wpm: 140,
    wpmMin: 135,
    wpmMax: 145,
    shotSecMin: 3.5,
    shotSecMax: 5.0,
    visual: {
      colorGrade: 'Cyan / Gold Electric',
      visualDnaEn:
        'eastern cultivation fantasy, cyan and gold electric aura, volumetric spirit qi, wide establishing peaks and thunder tribulation, glowing immortal sword, tactile robes and jade, cinematic epic yet intimate character close-ups, no plastic CGI',
      mediaStylePreset:
        'cinematic eastern fantasy, cyan-gold electric grade, volumetric qi light, wide-shot priority for realm power, grounded fabric and stone',
    },
    ttsTone: {
      narrator: 'Giọng nam trầm hùng, có lực (thuyết minh).',
      rolesHint:
        'Nam chính: lạnh lùng kiêu ngạo. Lão tổ/Sư phụ: ồm, trầm khàn, vang vọng.',
      suggestedNarratorVoice: 'vi-VN-NamMinhNeural',
    },
    ctr: {
      titlePatterns: [
        'Chê Hắn Linh Căn Phế Vật, Đến Khi Hắn Rút Thần Kiếm Cả Lão Tổ Phải Quỳ Xin Tha Mạng',
        'Bị Tông Môn Trục Xuất, Hắn Thức Tỉnh Thần Cấp — Một Kiếm San Phẳng Nam Hoang',
        'Linh Căn Phế Vật? Thiên Kiếp Giáng Lâm, Cả Lão Tổ Phải Cúi Đầu',
      ],
      thumbTextExamples: ['LINH CĂN THẦN CẤP!', 'MỘT KIẾM TRẢM!', 'THIÊN KIẾP!'],
      thumbCompositionHintEn:
        'hero on mountain peak holding glowing golden immortal sword, cyan-gold lightning sky, small kneeling elder silhouettes below, bold overlay space top-right',
      primaryHookType: 'Thần cấp / Trảm sát',
      scoreMotifs: [
        'linh căn',
        'thần kiếm',
        'thần cấp',
        'lão tổ',
        'tông môn',
        'thiên kiếp',
        'phế vật',
        'trảm',
        'tu tiên',
        'đạo quả',
      ],
    },
  },
  {
    id: 'do_thi_va_mat',
    labelVi: 'Đô Thị / Trọng Sinh / Vả Mặt',
    match: {
      chu_de: [
        'Trùng Sinh',
        'Báo Thù',
        'Phản Công',
        'Thương Chiến',
        'Hệ Thống',
        'Y Học',
      ],
      phong_cach: ['Đô Thị', 'Siêu Anh Hùng'],
    },
    audienceCraving:
      'Thích tương phản Giàu–Nghèo đột ngột, bị bạn gái/mẹ vợ khinh rẻ → lộ thân phận thật (Chiến Thần / Tỷ Phú / Y Thần) trả thù cực gắt.',
    coldOpen: {
      recipeVi:
        'Giây 0–5: bị ném giấy Hủy Hôn vào mặt. Giây 6–15: 100 xe sang vây quanh gọi "Kính chào Chủ Tịch!" — contrast nghèo→thân phận.',
      sampleHookLine: 'Cô chê tôi nghèo? Vậy 100 tỷ trong tài khoản này là gì?',
    },
    wpm: 160,
    wpmMin: 155,
    wpmMax: 165,
    shotSecMin: 2.5,
    shotSecMax: 3.5,
    visual: {
      colorGrade: 'Vibrant Neon Urban',
      visualDnaEn:
        'modern urban drama, vibrant neon city night, luxury cars glass towers, slap-face reaction close-ups, high contrast wealth vs humiliation, glossy cinematic realism',
      mediaStylePreset:
        'vibrant neon urban cinematic, fast reaction close-ups, luxury vs poverty contrast, modern city night grade',
    },
    ttsTone: {
      narrator: 'Giọng hiện đại, dồn dập, châm biếm nhẹ.',
      rolesHint: 'Phản diện nữ: chua ngoa, chảnh chọe. Nam chính: lạnh, dứt khoát khi lộ thân phận.',
      suggestedNarratorVoice: 'vi-VN-NamMinhNeural',
    },
    ctr: {
      titlePatterns: [
        'Bị Vị Hôn Thê Hủy Hôn Vì Nghèo, Hắn Thức Tỉnh Hệ Thống Trở Thành Tỷ Phú Số 1 Thế Giới',
        'Chê Tôi Nghèo? 100 Tỷ Trong Tài Khoản Và 100 Xe Sang Đang Chờ Bên Ngoài',
        'Mẹ Vợ Ném Đơn Hủy Hôn — Ba Phút Sau Cả Thành Phố Gọi Hắn Là Chủ Tịch',
      ],
      thumbTextExamples: ['CHÊ TÔI NGHÈO?', 'CHỦ TỊCH!', 'HỦY HÔN?'],
      thumbCompositionHintEn:
        'smirking young man, stack of cash or luxury cars behind, angry ex-fiancee throwing papers, neon urban night, bold overlay text space',
      primaryHookType: 'Khinh bỉ / Thân phận thật',
      scoreMotifs: [
        'hủy hôn',
        'chê',
        'nghèo',
        'tỷ phú',
        'chủ tịch',
        'vả mặt',
        'thân phận',
        'mẹ vợ',
        'hệ thống',
        '100 tỷ',
      ],
    },
  },
  {
    id: 'mat_the_sinh_ton',
    labelVi: 'Dystopia / Sinh Tồn / Mạt Thế',
    match: {
      chu_de: ['Sinh Tồn', 'Game / Vô Hạn Lưu', 'Nông Trường', 'Du Hành / Di Cư'],
      phong_cach: ['Dystopia', 'Xây Dựng Thế Giới', 'Hắc Ám', 'Military Sci-Fi'],
    },
    audienceCraving:
      'Căng thẳng thiếu nguồn sống, phản bội giữa người với người, hệ thống tích trữ vật tư bá đạo, xây căn cứ an toàn.',
    coldOpen: {
      recipeVi:
        'Còi báo động mạt thế → bị bạn gái/đồng đội đẩy vào bầy quái/zombie → giây ~12: trùng sinh về trước mạt thế vài ngày — thề tích trữ.',
      sampleHookLine:
        'Lần trùng sinh này, tôi sẽ không để kẻ nào cướp đi dù chỉ 1 ổ bánh mì!',
    },
    wpm: 145,
    wpmMin: 145,
    wpmMax: 150,
    shotSecMin: 3.0,
    shotSecMax: 4.0,
    visual: {
      colorGrade: 'Teal & Orange Dark',
      visualDnaEn:
        'post-apocalyptic survival, teal and orange dark grade, fortified steel base, overflowing supply warehouse vs horde outside, dusty practical light, tense handheld energy',
      mediaStylePreset:
        'dark teal-orange apocalypse cinematic, fortress vs horde, survival logistics visual, gritty tactile grit',
    },
    ttsTone: {
      narrator: 'Giọng kịch tính, dồn dập (dramatic narrative).',
      rolesHint: 'Nam chính: quyết đoán, tàn nhẫn với kẻ thù. Phản bội: giọng run/độc.',
      suggestedNarratorVoice: 'vi-VN-NamMinhNeural',
    },
    ctr: {
      titlePatterns: [
        'Mạt Thế Giáng Lâm: Trong Khi Mọi Người Chết Đói, Hắn Trọng Sinh Tích Trữ 10 Triệu Tấn Vật Tư',
        'Bị Đẩy Vào Bầy Zombie — Trùng Sinh Trước 3 Ngày, Hắn Xây Pháo Đài Thép',
        'Mạt Thế: Ai Cướp Ổ Bánh Mì Của Hắn Sẽ Không Sống Sót',
      ],
      thumbTextExamples: ['TÍCH TRỮ MẠT THẾ!', 'PHÁO ĐÀI!', 'TRÙNG SINH!'],
      thumbCompositionHintEn:
        'steel fortress overflowing supplies inside vs zombie horde outside, teal-orange dark sky, lone survivor silhouette on wall',
      primaryHookType: 'Tích trữ / Zombie',
      scoreMotifs: [
        'mạt thế',
        'tích trữ',
        'zombie',
        'vật tư',
        'trùng sinh',
        'pháo đài',
        'chết đói',
        'bánh mì',
        'sinh tồn',
        'còi báo',
      ],
    },
  },
  {
    id: 'kinh_di_huyen_nghi',
    labelVi: 'Huyền Nghi / Kinh Dị / Trinh Thám',
    match: {
      chu_de: ['Kinh Dị', 'Trinh Thám', 'Tình Báo'],
      phong_cach: [
        'Huyền Nghi',
        'Thriller',
        'Noir',
        'Gothic',
        'Tâm Lý Tội Phạm',
      ],
    },
    audienceCraving:
      'Tò mò, sợ hãi nhẹ, thích giải đố, red herrings, quy tắc sinh tồn kỳ dị.',
    coldOpen: {
      recipeVi:
        'Đưa 1 quy tắc sinh tồn bất hợp lý bị (sắp) vi phạm → tiếng đập cửa / thì thầm ngoài phòng — không spoil rule-break ngay.',
      sampleHookLine:
        'Quy tắc thứ 3: Tuyệt đối không được mở mắt nếu nghe thấy tiếng mẹ gọi lúc 2h đêm...',
    },
    wpm: 128,
    wpmMin: 125,
    wpmMax: 130,
    shotSecMin: 5.0,
    shotSecMax: 7.0,
    visual: {
      colorGrade: 'Monochromatic Low-key',
      visualDnaEn:
        'low-key monochromatic horror mystery, fog and flashlight practicals, negative space dread, wet corridors, eyes in door crack, restrained color, film grain',
      mediaStylePreset:
        'moody low-key monochrome horror, fog flashlight, long hold suspense frames, desaturated cinematic',
    },
    ttsTone: {
      narrator: 'Giọng thì thầm, bí ẩn, hơi khàn (mystery whisper).',
      rolesHint: 'Narration chậm, ngắt nghỉ; NV sợ: run nhẹ, không hét rẻ tiền liên tục.',
      suggestedNarratorVoice: 'vi-VN-NamMinhNeural',
    },
    ctr: {
      titlePatterns: [
        '4 Quy Tắc Sinh Tồn Kỳ Quái Khi Ở Khách Sạn Đêm Khuya: Ai Vi Phạm Sẽ Không Thể Trở Về',
        'Đừng Mở Cửa Lúc 2h Đêm — Quy Tắc Thứ 3 Sẽ Giết Bạn',
        'Khách Sạn 0 Sao: 4 Luật, 1 Người Vi Phạm Không Bao Giờ Về',
      ],
      thumbTextExamples: ['ĐỪNG MỞ CỬA!', 'QUY TẮC 3', '2H ĐÊM'],
      thumbCompositionHintEn:
        'glowing eyes in dark door crack, monochrome low-key hallway, flashlight fog, forbidden door handle, overlay text space upper third',
      primaryHookType: 'Quy tắc rùng rợn / Cấm đoán',
      scoreMotifs: [
        'quy tắc',
        'đừng mở',
        '2h',
        'khách sạn',
        'vi phạm',
        'cấm',
        'mở mắt',
        'tiếng gõ',
        'huyền nghi',
        'không trở về',
      ],
    },
  },
  {
    id: 'cung_dau_ngon_tinh',
    labelVi: 'Cổ Đại / Cung Đấu / Romantasy',
    match: {
      chu_de: ['Cung Đấu', 'Ngôn Tình', 'Trùng Sinh', 'Báo Thù', 'Chính Trị'],
      phong_cach: ['Cổ Đại', 'Romantasy', 'Epic / Sử Thi'],
    },
    audienceCraving:
      'Đam mê mưu lược hai lòng, gia đấu cung đấu, từ thảm cảnh bị hại → lật ngược làm Nữ Đế / trọng sinh sửa tiếc nuối, tình cảm ngược tâm.',
    coldOpen: {
      recipeVi:
        'Cảnh bị ban rượu độc / ném lãnh cung → lời thề trùng sinh trả thù cả vương triều — cảm xúc sắc, Hán Việt trau chuốt.',
      sampleHookLine:
        'Kiếp trước ta vì ngài mà chết, kiếp này ta sẽ dẫm lên ngai vàng của ngài!',
    },
    wpm: 132,
    wpmMin: 130,
    wpmMax: 138,
    shotSecMin: 4.5,
    shotSecMax: 6.0,
    visual: {
      colorGrade: 'Cinematic Royal Gold',
      visualDnaEn:
        'historical palace romantasy, cinematic royal gold and crimson, phoenix robe, candlelit intrigue, elegant hanfu silhouettes, emotional close-ups, luxurious production design',
      mediaStylePreset:
        'cinematic royal gold crimson palace drama, soft key on faces, rich fabric detail, romantasy elegance',
    },
    ttsTone: {
      narrator: 'Giọng nữ truyền cảm, dịu dàng hoặc kiêu sa.',
      rolesHint:
        'Nữ chính: sắc sảo kiên cường. Vương gia/Hoàng đế: trầm ấm uy nghiêm.',
      suggestedNarratorVoice: 'vi-VN-HoaiMyNeural',
    },
    ctr: {
      titlePatterns: [
        'Trọng Sinh Vào Đêm Ban Rượu Độc, Thứ Muội Chân Đất Lật Đổ Cả Vương Triều Trở Thành Nữ Đế',
        'Kiếp Trước Chết Vì Ngài — Kiếp Này Ta Dẫm Lên Ngai Vàng',
        'Lãnh Cung Đêm Rượu Độc: Nàng Trở Lại Thành Nữ Đế',
      ],
      thumbTextExamples: ['TRẢ NỢ MÁU!', 'NỮ ĐẾ!', 'RƯỢU ĐỘC!'],
      thumbCompositionHintEn:
        'phoenix robe empress looking back with sharp eyes, royal gold crimson palace, poison cup or throne silhouette, elegant overlay text space',
      primaryHookType: 'Trọng sinh / Vương quyền',
      scoreMotifs: [
        'nữ đế',
        'rượu độc',
        'trọng sinh',
        'vương triều',
        'lãnh cung',
        'ngai vàng',
        'thứ muội',
        'trả nợ máu',
        'cung đấu',
        'phượng bào',
      ],
    },
  },
];

const PROFILE_BY_ID = Object.fromEntries(
  STYLE_ENGINE_PROFILES.map((p) => [p.id, p]),
) as Record<StyleEngineId, StyleEngineProfile>;

export function getStyleEngineProfile(
  id: string | null | undefined,
): StyleEngineProfile | null {
  if (!id) return null;
  return PROFILE_BY_ID[id as StyleEngineId] ?? null;
}

export function isStyleEngineId(v: unknown): v is StyleEngineId {
  return (
    typeof v === 'string' &&
    (STYLE_ENGINE_IDS as readonly string[]).includes(v)
  );
}

/**
 * Resolve profile from Setup labels.
 * Score: +2 phong_cach hit, +1 chu_de hit.
 * Require ≥2 OR strong phong_cach-only (score≥2 from PC alone).
 * Tie-break: higher score → phong_cach weight already higher; first max wins stable order.
 */
export function resolveStyleEngineProfile(
  chu_de?: string | null,
  phong_cach?: string | null,
): StyleEngineProfile | null {
  const cd = nfc(chu_de || '');
  const pc = nfc(phong_cach || '');
  if (!cd && !pc) return null;

  let best: StyleEngineProfile | null = null;
  let bestScore = 0;

  for (const p of STYLE_ENGINE_PROFILES) {
    const pcHit = hitsAlias(pc, p.match.phong_cach);
    const cdHit = hitsAlias(cd, p.match.chu_de);
    let score = 0;
    if (pcHit) score += 2;
    if (cdHit) score += 1;
    // Strong PC alone is enough (score 2)
    if (score < 2) continue;
    if (score > bestScore) {
      bestScore = score;
      best = p;
    }
  }
  return best;
}

export type StyleEngineSoftPatch = {
  wpm?: number;
  secondsPerBeat?: number;
  visualDnaPrompt?: string;
  mediaStylePreset?: string;
  activeStyleEngineId?: StyleEngineId | null;
};

/** Mid shot band → default secondsPerBeat for soft apply. */
export function styleEngineDefaultBeat(profile: StyleEngineProfile): number {
  const mid = (profile.shotSecMin + profile.shotSecMax) / 2;
  return Math.round(mid * 10) / 10;
}

/**
 * Soft media patch when Setup matches a style profile.
 * - WPM: nudge if invalid or outside profile band (and not locked by extreme short mode defaults handled elsewhere)
 * - Beat: midpoint shot band if invalid / far outside band
 * - Visual: only if empty OR equals previous profile's visual (tracked via prevId)
 */
export function styleEngineMediaSoftPatch(
  profile: StyleEngineProfile | null,
  current: {
    wpm?: number | null;
    secondsPerBeat?: number | null;
    visualDnaPrompt?: string | null;
    mediaStylePreset?: string | null;
    activeStyleEngineId?: string | null;
    /** When short_manhua, keep format WPM master — only set content id */
    scriptMode?: unknown;
  },
): StyleEngineSoftPatch {
  if (!profile) {
    return { activeStyleEngineId: null };
  }

  const out: StyleEngineSoftPatch = { activeStyleEngineId: profile.id };
  const mode = normalizeScriptMode(current.scriptMode);
  const wpm = Number(current.wpm);
  const beat = Number(current.secondsPerBeat);
  const dna = String(current.visualDnaPrompt || '').trim();
  const preset = String(current.mediaStylePreset || '').trim();
  const prevId = current.activeStyleEngineId;
  const prev = getStyleEngineProfile(prevId);

  // WPM: short_manhua keeps format master (no force 128/140 onto 170)
  if (mode !== 'short_manhua') {
    if (
      !Number.isFinite(wpm) ||
      wpm <= 0 ||
      wpm < profile.wpmMin - 5 ||
      wpm > profile.wpmMax + 8
    ) {
      // If coming from another profile default or scriptMode default extremes
      out.wpm = profile.wpm;
    }
  }

  const targetBeat = styleEngineDefaultBeat(profile);
  if (
    !Number.isFinite(beat) ||
    beat <= 0 ||
    beat < profile.shotSecMin - 0.5 ||
    beat > profile.shotSecMax + 1.5
  ) {
    // short: only nudge if beat looks like long-form (≥6)
    if (mode === 'short_manhua') {
      if (!Number.isFinite(beat) || beat <= 0 || beat >= 6) {
        out.secondsPerBeat = Math.min(4, Math.max(2.5, targetBeat));
      }
    } else {
      out.secondsPerBeat = targetBeat;
    }
  }

  const dnaIsEmpty = !dna;
  const dnaIsPrevDefault = prev && dna === prev.visual.visualDnaEn;
  if (dnaIsEmpty || dnaIsPrevDefault) {
    out.visualDnaPrompt = profile.visual.visualDnaEn;
  }

  const presetIsEmpty = !preset;
  const presetIsPrevDefault = prev && preset === prev.visual.mediaStylePreset;
  // Also treat long generic boot default as replaceable when applying first profile
  const genericBoot =
    /cinematic natural realism, grounded production design/i.test(preset);
  if (presetIsEmpty || presetIsPrevDefault || (genericBoot && !prev)) {
    out.mediaStylePreset = profile.visual.mediaStylePreset;
  }

  return out;
}

/**
 * Intersect scriptMode shot band with style band.
 * Empty intersection → scriptMode wins (format DNA).
 */
export function intersectShotBand(
  scriptMode?: unknown,
  profile?: StyleEngineProfile | null,
): { min: number; max: number } {
  const p = getScriptModePacing(scriptMode);
  let min = p.shotSecMin;
  let max = p.shotSecMax;
  if (profile) {
    const iMin = Math.max(min, profile.shotSecMin);
    const iMax = Math.min(max, profile.shotSecMax);
    if (iMin <= iMax) {
      min = iMin;
      max = iMax;
    }
    // else keep scriptMode band
  }
  return { min, max };
}

export function buildStyleEngineWriteBlock(
  profile: StyleEngineProfile | null | undefined,
  opts?: { scriptMode?: unknown; isContinue?: boolean },
): string {
  if (!profile) return '';
  if (opts?.isContinue) {
    return `
--- STYLE ENGINE (${profile.id} — CONTINUE) ---
Giữ niche ${profile.labelVi}: ${profile.audienceCraving}
Nhịp ~${profile.wpm} WPM (band ${profile.wpmMin}–${profile.wpmMax}); shot visual ${profile.shotSecMin}–${profile.shotSecMax}s.
Tone TTS: ${profile.ttsTone.narrator} ${profile.ttsTone.rolesHint}
CẤM lệch niche (đổi sang genre khác không có trong Setup).
`;
  }

  const mode = normalizeScriptMode(opts?.scriptMode);
  const coldPolicy = getScriptModePacing(mode).coldOpen;

  let coldSection = '';
  if (coldPolicy === 'off') {
    coldSection = `
COLD OPEN (scriptMode=chuyen_sau — TẮT trailer):
- KHÔNG [CẢNH 0]. Pattern interrupt nhẹ theo niche trong [CẢNH 1].
- Niche recipe (tham khảo nội dung, không copy cứng sample): ${profile.coldOpen.recipeVi}
- CẤM mở thơ phong cảnh; có thể 1–2 câu xung đột niche rồi vào thân chương.
`;
  } else if (coldPolicy === 'soft') {
    coldSection = `
COLD OPEN (GỢI Ý ~15s trong [CẢNH 1] hoặc đầu chương):
- Recipe niche: ${profile.coldOpen.recipeVi}
- Gợi ý câu hook (tự viết, ĐỪNG copy nguyên): "${profile.coldOpen.sampleHookLine}"
- Sau hook: nối thẳng cốt; open loop cuối.
`;
  } else {
    coldSection = `
COLD OPEN BẮT BUỘC [CẢNH 0] ~15–30s (~40–90 từ):
- Recipe niche: ${profile.coldOpen.recipeVi}
- Gợi ý câu hook (tự viết, ĐỪNG copy nguyên): "${profile.coldOpen.sampleHookLine}"
- Sau CẢNH 0 → [CẢNH 1] hệ quả / quay nhịp trước đỉnh.
`;
  }

  return `
--- STYLE ENGINE · ${profile.labelVi} (${profile.id}) ---
Tâm lý khán giả: ${profile.audienceCraving}
${coldSection}
Nhịp đọc mục tiêu ~${profile.wpm} WPM (band ${profile.wpmMin}–${profile.wpmMax}) — câu ${
    profile.wpm >= 155 ? 'ngắn dồn dập' : profile.wpm <= 130 ? 'chậm, ngắt nghỉ suspense' : 'vừa, rõ lực'
  }.
Visual grade: ${profile.visual.colorGrade} · shot gợi ý ${profile.shotSecMin}–${profile.shotSecMax}s.
TTS: ${profile.ttsTone.narrator} | Roles: ${profile.ttsTone.rolesHint}
CTR motif (viết prose phục vụ click, KHÔNG nhét slogan SEO vào body): ${profile.ctr.primaryHookType}
CẤM lệch niche; bám Setup thể loại.
`.normalize('NFC');
}

export function buildStyleEngineOutlineBlock(
  profile: StyleEngineProfile | null | undefined,
): string {
  if (!profile) return '';
  return `
--- STYLE ENGINE OUTLINE · ${profile.labelVi} ---
Audience: ${profile.audienceCraving}
Mỗi chương/tập nên có beat cold-open kiểu: ${profile.coldOpen.recipeVi}
CTR hook type: ${profile.ctr.primaryHookType} (logline hướng click, không viết title YouTube vào dàn ý thô).
`.normalize('NFC');
}

export function buildStyleEngineShotHintBlock(
  profile: StyleEngineProfile | null | undefined,
  scriptMode?: unknown,
): string {
  if (!profile) return '';
  const band = intersectShotBand(scriptMode, profile);
  return `
--- STYLE ENGINE SHOT · ${profile.labelVi} ---
Color grade: ${profile.visual.colorGrade}
Band duration gợi ý (intersect format×niche): ${band.min}–${band.max}s / shot.
Composition CTR thumb: ${profile.ctr.thumbCompositionHintEn}
Visual DNA bám: ${profile.visual.visualDnaEn.slice(0, 180)}…
`.normalize('NFC');
}

/** SEO: extra title candidates from profile templates (may be static examples). */
export function buildStyleCtrTitleCandidates(
  profile: StyleEngineProfile | null | undefined,
  core?: string,
): string[] {
  if (!profile) return [];
  const c = nfc(core || '');
  const out: string[] = [...profile.ctr.titlePatterns];
  if (c.length >= 8) {
    // Light personalization: prefix core into first pattern slot variant
    out.unshift(
      `${c.slice(0, 40)}${c.length > 40 ? '…' : ''} — ${profile.ctr.primaryHookType}`,
    );
  }
  return out.map((t) => t.normalize('NFC'));
}

export function styleEngineTitleScoreBoost(
  title: string,
  profile: StyleEngineProfile | null | undefined,
): number {
  if (!profile) return 0;
  const t = normKey(title);
  if (!t) return 0;
  let hits = 0;
  for (const m of profile.ctr.scoreMotifs) {
    if (t.includes(normKey(m))) hits += 1;
  }
  if (hits <= 0) return 0;
  return Math.min(2.5, 0.45 * hits + 0.3);
}

export function styleEngineThumbOverlaySuggestions(
  profile: StyleEngineProfile | null | undefined,
): string[] {
  if (!profile) return [];
  return profile.ctr.thumbTextExamples.map((s) => s.normalize('NFC'));
}

/** Resolve from payload-like object (API handlers). */
export function resolveStyleEngineFromSetupPayload(payload: {
  chu_de?: unknown;
  phong_cach?: unknown;
  genre?: unknown;
}): StyleEngineProfile | null {
  const chu = String(payload.chu_de || '').trim();
  const phong = String(payload.phong_cach || '').trim();
  if (chu || phong) return resolveStyleEngineProfile(chu, phong);
  // genre often "chu_de / phong_cach"
  const g = String(payload.genre || '').trim();
  if (!g) return null;
  const parts = g.split(/\s*\/\s*/);
  if (parts.length >= 2) {
    return resolveStyleEngineProfile(parts[0], parts.slice(1).join(' / '));
  }
  return resolveStyleEngineProfile(g, g);
}
