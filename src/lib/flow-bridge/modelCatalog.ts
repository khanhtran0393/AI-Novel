/**
 * Google Flow (labs.google) model matrix — aisandbox videoModelKey / imageModelName.
 *
 * Source (2026-07):
 * - Observed Flow keys via aisandbox-pa (T2V/I2V/R2V/extend/upsample)
 * - Community reverse catalog (flowkit models.json + fk-change-model)
 * - Google Flow credit matrix (AI Pro / Ultra) + Veo 3.1 duration/resolution docs
 *
 * Credits: base = one clip at defaultDurationSec (8s). Pro/Ultra differ for Lite/Fast.
 * Duration options on Flow: 4 / 6 / 8 seconds only (not 10).
 * Native video scale: 720p; HD/4K via upsample models.
 */

export type FlowModelKind = 'image' | 'video';

export type FlowVideoFamily = 't2v' | 'i2v' | 'reference' | 'extend' | 'upsample';

export type FlowModelEntry = {
  id: string;
  label: string;
  kind: FlowModelKind;
  /**
   * Flow credits on Google AI **Pro** (base duration / one generation).
   * Ultra halves Lite+Fast; Quality stays 100.
   */
  credits: number;
  /** Flow credits on Google AI **Ultra** when different from Pro */
  creditsUltra?: number;
  tier: 'free' | 'lite' | 'fast' | 'quality' | 'ultra';
  family?: FlowVideoFamily;
  /** Allowed clip lengths (video only). Flow Veo: 4 | 6 | 8 */
  durationsSec?: number[];
  /** Default length when UI empty */
  defaultDurationSec?: number;
  /** Native output scale before upscale */
  nativeScale?: '720p' | '1080p' | '1k' | '2k' | '4k';
  portraitVariant?: string;
  /** First+last frame (_fl) sibling for I2V chained */
  firstLastVariant?: string;
  supportsIngredients?: boolean;
  supportsExtend?: boolean;
  supportsI2v?: boolean;
  supportsT2v?: boolean;
  supportsFirstLast?: boolean;
  /** PAYGATE / service tier notes */
  paygateNote?: string;
  /** Technical note (catalog / reverse) */
  note?: string;
  /**
   * User-facing VN hint for Media Config dropdown.
   * Prefer this over `note` in UI; auto-filled by family if empty.
   */
  userHint?: string;
  /** Hide portrait-only keys from primary dropdown (resolved via portraitVariant) */
  uiHidden?: boolean;
};

/** Short family badge for dropdown labels (technical). */
export function flowVideoFamilyBadge(family?: FlowVideoFamily): string {
  switch (family) {
    case 't2v':
      return 'T2V';
    case 'i2v':
      return 'I2V';
    case 'reference':
      return 'R2V';
    case 'extend':
      return 'EXT';
    case 'upsample':
      return 'UP';
    default:
      return '';
  }
}

/** Badge tiếng Việt dễ hiểu trong dropdown VIDEO AI. */
export function flowVideoFamilyBadgeVi(
  family?: FlowVideoFamily,
  opts?: { isFirstLast?: boolean },
): string {
  if (opts?.isFirstLast) return '2 khung';
  switch (family) {
    case 't2v':
      return 'Chữ→Video';
    case 'i2v':
      return 'Ảnh→Video';
    case 'reference':
      return 'Ref ảnh';
    case 'extend':
      return 'Nối clip';
    case 'upsample':
      return 'Upscale';
    default:
      return '';
  }
}

/**
 * Gói Google AI / tier Labs cần để chạy model (credit Google Flow, không phải gói AI Novel).
 * Pro = Google AI Pro · Ultra = Google AI Ultra · Free/Pro = 0 cr (hàng chờ).
 */
export function flowModelGooglePackage(
  m: Pick<FlowModelEntry, 'credits' | 'tier' | 'paygateNote' | 'family'>,
): string {
  const cr = Number(m.credits);
  const note = String(m.paygateNote || '').toUpperCase();
  // 0-cr queue models — package only (credit shown separately as «0 cr / clip»)
  if (Number.isFinite(cr) && cr === 0) {
    if (note.includes('ULTRA')) return 'Gói AI Ultra (hàng chờ)';
    if (note.includes('ADVANCED')) return 'Gói Free/Pro (hàng chờ lâu)';
    return 'Gói Free/Pro (hàng chờ)';
  }
  // tier catalog is free|lite|fast|quality — Ultra detected via paygateNote / family
  if (
    note.includes('TIER_TWO') ||
    (note.includes('ULTRA') && !note.includes('TIER_ONE')) ||
    (m.family === 'upsample' && note.includes('ULTRA'))
  ) {
    return 'Gói AI Ultra';
  }
  return 'Gói AI Pro';
}

/** Credit 1 clip @ mặc định 8s — Pro và Ultra (nếu khác). */
export function formatFlowCreditsPart(
  m: Pick<FlowModelEntry, 'credits' | 'creditsUltra'>,
): string {
  if (m.credits == null || !Number.isFinite(Number(m.credits))) return '';
  const pro = Number(m.credits);
  const ultra =
    m.creditsUltra != null && Number.isFinite(Number(m.creditsUltra))
      ? Number(m.creditsUltra)
      : pro;
  if (pro === 0) return '0 cr / clip';
  if (ultra !== pro) return `${pro} cr Pro · ${ultra} cr Ultra`;
  return `${pro} cr / clip`;
}

/**
 * True only for first+last *keys* (…_fl / «2 khung»).
 * Do NOT use supportsFirstLast alone — I2V Fast sets that for sibling resolve.
 */
function isFirstLastModel(
  m: Pick<FlowModelEntry, 'id' | 'label'>,
): boolean {
  const id = String(m.id || '').toLowerCase();
  const label = String(m.label || '').toLowerCase();
  return (
    id.endsWith('_fl') ||
    id.includes('_fl_') ||
    id.includes('first_last') ||
    id.includes('start_end') ||
    label.includes('2 khung') ||
    label.includes('đầu+cuối') ||
    label.includes('first+last')
  );
}

/**
 * Nhãn dropdown Cấu hình đầu ra — dễ đọc:
 * [Ảnh→Video] Veo Fast · Gói AI Pro · 20 cr Pro · 10 cr Ultra · 720p
 */
export function formatFlowModelDropdownLabel(
  m: Pick<
    FlowModelEntry,
    | 'id'
    | 'label'
    | 'kind'
    | 'family'
    | 'credits'
    | 'creditsUltra'
    | 'tier'
    | 'nativeScale'
    | 'paygateNote'
    | 'supportsFirstLast'
  >,
): string {
  if (m.kind === 'image') {
    const bits = [
      m.label,
      m.credits != null ? `· ${m.credits} cr` : '',
      m.nativeScale ? `· ${m.nativeScale}` : '',
    ].filter(Boolean);
    return bits.join(' ');
  }
  const fl = isFirstLastModel(m);
  const badge = flowVideoFamilyBadgeVi(m.family, { isFirstLast: fl });
  const pkg = flowModelGooglePackage(m);
  const cr = formatFlowCreditsPart(m);
  return [
    badge ? `[${badge}]` : '',
    m.label,
    `· ${pkg}`,
    cr ? `· ${cr}` : '',
    m.nativeScale ? `· ${m.nativeScale}` : '',
  ]
    .filter(Boolean)
    .join(' ');
}

/**
 * Ghi chú cho user chọn model trong «Cấu hình đầu ra».
 * Tránh MODEL_MISMATCH (vd. R2V khi gen T2V không có ảnh start).
 */
export function flowModelUserHint(
  m: Pick<
    FlowModelEntry,
    | 'kind'
    | 'family'
    | 'note'
    | 'userHint'
    | 'id'
    | 'label'
    | 'supportsFirstLast'
    | 'firstLastVariant'
  >,
): string {
  if (m.userHint?.trim()) return m.userHint.trim();
  if (m.kind === 'image') {
    if (m.note?.trim()) return m.note.trim();
    return 'Dùng cho Gen ảnh / GEN TẤT CẢ ẢNH (Google Flow).';
  }
  const id = String(m.id || '').toLowerCase();
  const isFirstLast =
    m.supportsFirstLast === true ||
    id.includes('_fl') ||
    id.includes('first') ||
    id.includes('start_end');
  switch (m.family) {
    case 't2v':
      return 'Text→Video: gen video từ prompt, KHÔNG cần ảnh start. Không chọn model này khi «Nối video» từ ảnh.';
    case 'i2v':
      if (isFirstLast) {
        return 'I2V First+Last: CẦN 2 ảnh liền kề (bật Start+End trên shot). Gen đủ 2 still rồi gen video.';
      }
      return 'Image→Video: CẦN ảnh start (đã gen ảnh trước). Dùng khi bấm Nối video / gen video sau ảnh.';
    case 'reference':
      return 'R2V / Ingredients: CẦN 1–3 ảnh ref (ingredients). Không dùng cho T2V thuần (sẽ lỗi MODEL_MISMATCH).';
    case 'extend':
      return 'Nối dài clip Flow đã có. Cần clip gốc trên Flow — không phải model gen clip mới từ prompt.';
    case 'upsample':
      return 'Upscale sau gen (720p→1080p/4K). Không gen clip mới — chọn model T2V/I2V/R2V để tạo video.';
    default:
      return m.note?.trim() || 'Chọn đúng nhánh T2V / I2V / R2V theo cách bạn gen (có/không ảnh start).';
  }
}

/** Yêu cầu đầu vào khi chọn model video trong Cấu hình đầu ra. */
export type FlowVideoModelRequirement = {
  family: FlowVideoFamily | 'unknown';
  badge: string;
  /** Short chips for UI */
  needs: string[];
  /** One-line VN requirement (bắt buộc) */
  requireLine: string;
  /** One-line how-to summary */
  howTo: string;
  /** Numbered usage steps for Cấu hình đầu ra */
  usageSteps: string[];
  /** Warning if wrong assets / wrong mode */
  warning?: string;
  /** Duration note (4/6/8) */
  durationNote: string;
  isFirstLast: boolean;
  /** Toast title when user picks model */
  toastTitle: string;
};

const FLOW_DURATION_NOTE =
  'Thời lượng Flow chỉ 4 / 6 / 8 giây — chọn trong Cấu hình đầu ra (app không tự bịa giây).';

export function flowVideoModelRequirements(
  modelId?: string,
): FlowVideoModelRequirement {
  const m = modelId ? findFlowModel(modelId) : undefined;
  const family = (m?.family || 'unknown') as FlowVideoFamily | 'unknown';
  const id = String(modelId || m?.id || '').toLowerCase();
  const isFirstLast = Boolean(
    m?.supportsFirstLast ||
      id.includes('_fl') ||
      id.includes('first_last') ||
      id.includes('start_end'),
  );
  const badge = flowVideoFamilyBadge(
    family === 'unknown' ? undefined : family,
  );
  const dur =
    m?.durationsSec?.length
      ? `Thời lượng hợp lệ: ${m.durationsSec.join('/')}s (mặc định ${m.defaultDurationSec ?? 8}s).`
      : FLOW_DURATION_NOTE;

  if (family === 't2v') {
    return {
      family,
      badge: badge || 'T2V',
      needs: ['video_prompt', 'thời lượng 4/6/8s', 'không cần ảnh'],
      requireLine: 'BẮT BUỘC: video_prompt · KHÔNG cần ảnh start.',
      howTo: 'Gen Prompt Studio → Gen video (bỏ qua Gen ảnh).',
      usageSteps: [
        '1. Cấu hình đầu ra → VIDEO AI → model T2V (badge T2V).',
        '2. Chọn tỷ lệ 16:9 hoặc 9:16 + thời lượng 4/6/8s.',
        '3. Gen Prompt Studio (có video_prompt).',
        '4. Bấm Gen video — không cần Gen ảnh trước.',
      ],
      warning:
        'Đừng chọn T2V nếu bạn định «Nối video» từ ảnh start — sẽ lệch mode / tốn credit oan.',
      durationNote: dur,
      isFirstLast: false,
      toastTitle: 'Model T2V · chỉ text→video',
    };
  }
  if (family === 'i2v' && isFirstLast) {
    return {
      family,
      badge: 'I2V·FL',
      needs: [
        'video_prompt',
        'ảnh start',
        'ảnh end (liền kề)',
        'Start+End bật',
        'thời lượng 4/6/8s',
      ],
      requireLine:
        'BẮT BUỘC: 2 ảnh still liền kề (Start+End) · Gen đủ prompt N và N±1.',
      howTo:
        'Gen Prompt → Gen ảnh 2 shot liền kề → bật «Start+End» → Gen video.',
      usageSteps: [
        '1. Cấu hình → model I2V First+Last (badge I2V·FL) hoặc preset «Pipeline Start+End».',
        '2. Gen Prompt Studio cho cảnh (có video_prompt).',
        '3. Gen ảnh cho shot N và shot liền kề (N+1 hoặc N−1).',
        '4. Trên hàng prompt: bật checkbox «Start+End» (app gắn end_image_key).',
        '5. Gen video — app gửi first+last frame (không dùng R2V).',
      ],
      warning:
        'Thiếu 1 trong 2 ảnh → hard-fail. Không chọn model R2V cho Start+End.',
      durationNote: dur,
      isFirstLast: true,
      toastTitle: 'Model I2V·FL · Start+End (2 still liền kề)',
    };
  }
  if (family === 'i2v') {
    return {
      family,
      badge: badge || 'I2V',
      needs: ['video_prompt', 'ảnh start', 'thời lượng 4/6/8s'],
      requireLine: 'BẮT BUỘC: ảnh start (Gen ảnh trước) · 1 still / shot.',
      howTo:
        'Gen Prompt → Gen ảnh → Gen video (I2V). Muốn first+last: bật Start+End + model FL.',
      usageSteps: [
        '1. Cấu hình → model I2V (badge I2V) — cần ảnh start.',
        '2. Chọn tỷ lệ + thời lượng 4/6/8s.',
        '3. Gen Prompt Studio → Gen ảnh shot.',
        '4. Gen video (I2V từ still).',
        '5. (Tuỳ chọn) Bật «Start+End» + model First+Last nếu muốn 2 frame.',
      ],
      warning:
        'Chưa gen ảnh mà bấm Gen video I2V → app chặn / auto T2V (tuỳ cấu hình).',
      durationNote: dur,
      isFirstLast: false,
      toastTitle: 'Model I2V · cần ảnh start',
    };
  }
  if (family === 'reference') {
    return {
      family,
      badge: badge || 'R2V',
      needs: ['video_prompt', '1–3 ảnh ref / cast', 'thời lượng 4/6/8s'],
      requireLine:
        'BẮT BUỘC: 1–3 ảnh ingredients/ref · model R2V (không nhầm I2V/T2V).',
      howTo: 'Gen ảnh cast/ref → chọn R2V → Gen video ingredients.',
      usageSteps: [
        '1. Cấu hình → model R2V / Ingredients (badge R2V).',
        '2. Chuẩn bị 1–3 ảnh ref (cast sheet / still) trên máy hoặc đã gen trong app.',
        '3. Gen Prompt (video_prompt) → Gen video với ingredients.',
        '4. Không dùng R2V cho T2V thuần (sẽ MODEL_MISMATCH).',
      ],
      warning:
        'R2V ≠ Start+End. Start+End dùng I2V first+last; R2V dùng ảnh ref đa chiều.',
      durationNote: dur,
      isFirstLast: false,
      toastTitle: 'Model R2V · cần ảnh ref',
    };
  }
  if (family === 'extend') {
    return {
      family,
      badge: badge || 'EXT',
      needs: ['clip Flow đã gen', 'mediaId'],
      requireLine:
        'BẮT BUỘC: clip video Flow đã có (nút Extend) — không gen shot mới từ prompt trống.',
      howTo: 'Gen video trước → bấm Extend trên clip đã có.',
      usageSteps: [
        '1. Gen video shot trước (I2V/T2V) đến khi có file + mediaId Flow.',
        '2. Cấu hình có thể giữ model I2V; Extend dùng model EXT khi bấm nút Extend.',
        '3. Bấm «Extend» cạnh clip — không bấm Gen video thuần với model EXT.',
      ],
      warning:
        'Model EXT trên Gen video shot kịch bản sẽ bị chặn (sai pipeline cảnh).',
      durationNote: dur,
      isFirstLast: false,
      toastTitle: 'Model EXT · nối dài clip',
    };
  }
  if (family === 'upsample') {
    return {
      family,
      badge: badge || 'UP',
      needs: ['video đã gen'],
      requireLine:
        'BẮT BUỘC: video đã gen (scale 720p→HD/4K) — không tạo clip mới.',
      howTo: 'Gen video xong → upsample quality (pipeline / quality preset).',
      usageSteps: [
        '1. Gen video native 720p trước.',
        '2. Chọn quality HD/2K/4K trong Cấu hình (FLOW QUALITY) khi pipeline hỗ trợ upsample.',
        '3. Không chọn model UP làm model gen shot chính.',
      ],
      warning: 'Upsample không thay Gen Prompt / Gen video.',
      durationNote: dur,
      isFirstLast: false,
      toastTitle: 'Model UP · chỉ scale video',
    };
  }
  // OMNI / unknown — flexible
  return {
    family: 'unknown',
    badge: id.includes('omni') ? 'I2V/T2V' : '?',
    needs: ['video_prompt', 'ảnh start nếu có still', 'thời lượng 4/6/8s'],
    requireLine:
      'BẮT BUỘC: khớp tài sản shot — không ảnh = T2V · có start = I2V · Start+End = 2 still liền kề.',
    howTo: 'Chọn preset «Pipeline cảnh» nếu chưa chắc model.',
    usageSteps: [
      '1. Ưu tiên preset «Pipeline cảnh · Fast / 0 cr» trong Cấu hình.',
      '2. Có ảnh start → path I2V; không ảnh → T2V.',
      '3. Start+End (2 still) → model first+last, không R2V.',
      '4. Thời lượng chỉ 4/6/8s.',
    ],
    warning: 'Sai nhánh model ↔ tài sản shot → MODEL_MISMATCH / HTTP 400.',
    durationNote: dur,
    isFirstLast: false,
    toastTitle: 'Model linh hoạt · khớp still + prompt',
  };
}

/** Short toast body when user picks a Flow video model in Cấu hình đầu ra. */
export function formatFlowVideoModelPickToast(modelId?: string): {
  title: string;
  body: string;
} {
  const r = flowVideoModelRequirements(modelId);
  const body = [
    r.requireLine,
    `Cách dùng: ${r.howTo}`,
    r.durationNote,
    r.warning ? `⚠ ${r.warning}` : '',
  ]
    .filter(Boolean)
    .join('\n');
  return { title: r.toastTitle, body };
}

/** Flow video aspect ratios only (aisandbox rejects others). */
export const FLOW_VIDEO_ASPECT_RATIOS = [
  { id: '16:9', label: '16:9 Landscape', flowEnum: 'VIDEO_ASPECT_RATIO_LANDSCAPE' },
  { id: '9:16', label: '9:16 Portrait', flowEnum: 'VIDEO_ASPECT_RATIO_PORTRAIT' },
] as const;

/** Flow image aspect ratios (common UI → IMAGE_ASPECT_RATIO_*). */
export const FLOW_IMAGE_ASPECT_RATIOS = [
  { id: '16:9', label: '16:9 Wide' },
  { id: '9:16', label: '9:16 Tall' },
  { id: '1:1', label: '1:1 Square' },
  { id: '3:2', label: '3:2' },
  { id: '2:3', label: '2:3' },
  { id: '4:3', label: '4:3' },
  { id: '3:4', label: '3:4' },
  { id: '4:5', label: '4:5' },
] as const;

/** Canonical Flow video durations (seconds). */
export const FLOW_VIDEO_DURATIONS_SEC = [4, 6, 8] as const;
export const FLOW_DEFAULT_VIDEO_DURATION_SEC = 8;

export const FLOW_IMAGE_MODELS: FlowModelEntry[] = [
  {
    id: 'GEM_PIX_2',
    label: 'GEM_PIX_2 (Flow default / Nano Banana Pro path)',
    kind: 'image',
    credits: 2,
    creditsUltra: 2,
    tier: 'quality',
    nativeScale: '1k',
    note: 'Flow imageModelName default — maps NANO_BANANA_PRO UI path',
    userHint:
      'Ảnh mặc định Flow (Nano Banana Pro). Dùng cho Gen ảnh / GEN TẤT CẢ ẢNH · ~2 credit.',
  },
  {
    id: 'HARBOR_SEAL',
    label: 'HARBOR_SEAL (FlowAgent Nano Banana 2 Lite)',
    kind: 'image',
    credits: 0,
    creditsUltra: 0,
    tier: 'lite',
    nativeScale: '1k',
    note: 'Canonical upstream key used by the working FlowAgent package',
    uiHidden: true,
  },
  {
    id: 'NARWHAL',
    label: 'NARWHAL (Nano Banana 2)',
    kind: 'image',
    credits: 0,
    creditsUltra: 0,
    tier: 'fast',
    nativeScale: '1k',
    note: 'Flow maps NANO_BANANA_2 → NARWHAL; often 0–1 credit',
    userHint: 'Ảnh Nano Banana 2 — nhanh, credit thấp (thường 0–1). Phù hợp thử nhiều shot.',
  },
  {
    id: 'NANO_BANANA_2',
    label: 'Nano Banana 2 (alias → NARWHAL)',
    kind: 'image',
    credits: 0,
    tier: 'fast',
    nativeScale: '1k',
    note: 'UI alias; payload should prefer NARWHAL',
    userHint: 'Alias UI → NARWHAL. Gen ảnh thường, credit thấp.',
  },
  {
    id: 'NANO_BANANA_2_LITE',
    label: 'Nano Banana 2 Lite',
    kind: 'image',
    credits: 0,
    tier: 'lite',
    nativeScale: '1k',
    userHint: 'Bản Lite — gen ảnh nhanh, ưu tiên tiết kiệm credit.',
  },
  {
    id: 'NANO_BANANA_PRO',
    label: 'Nano Banana Pro (alias → GEM_PIX_2)',
    kind: 'image',
    credits: 2,
    tier: 'quality',
    nativeScale: '1k',
    note: 'UI alias; payload should prefer GEM_PIX_2',
    userHint: 'Alias UI → GEM_PIX_2. Chất lượng ảnh cao hơn · ~2 credit.',
  },
  {
    id: 'IMAGEN_3_5',
    label: 'Imagen 3.5',
    kind: 'image',
    credits: 2,
    tier: 'quality',
    nativeScale: '1k',
    userHint: 'Imagen 3.5 — gen ảnh Flow · ~2 credit.',
  },
  {
    id: 'IMAGEN_4',
    label: 'Imagen 4',
    kind: 'image',
    credits: 3,
    tier: 'ultra',
    nativeScale: '1k',
    userHint: 'Imagen 4 — chất lượng cao · ~3 credit (gói cao hơn).',
  },
];

const V_DUR = [...FLOW_VIDEO_DURATIONS_SEC];
const V_DEF = FLOW_DEFAULT_VIDEO_DURATION_SEC;

export const FLOW_VIDEO_MODELS: FlowModelEntry[] = [
  // ─── T2V ───────────────────────────────────────────────
  {
    id: 'veo_3_1_t2v_fast',
    label: 'Veo Fast (chỉ chữ)',
    kind: 'video',
    credits: 20,
    creditsUltra: 10,
    tier: 'fast',
    family: 't2v',
    durationsSec: V_DUR,
    defaultDurationSec: V_DEF,
    nativeScale: '720p',
    portraitVariant: 'veo_3_1_t2v_fast_portrait',
    supportsT2v: true,
    paygateNote: 'TIER_ONE+',
    userHint:
      '[Chữ→Video] Chỉ cần video_prompt — không cần ảnh. Mặc định khi chưa gen still.',
  },
  {
    id: 'veo_3_1_t2v_fast_portrait',
    label: 'Veo Fast (chỉ chữ · dọc)',
    kind: 'video',
    credits: 20,
    creditsUltra: 10,
    tier: 'fast',
    family: 't2v',
    durationsSec: V_DUR,
    defaultDurationSec: V_DEF,
    nativeScale: '720p',
    supportsT2v: true,
    uiHidden: true,
  },
  {
    id: 'veo_3_1_t2v_fast_ultra',
    label: 'Veo Fast Ultra (chỉ chữ)',
    kind: 'video',
    credits: 20,
    creditsUltra: 10,
    tier: 'ultra',
    family: 't2v',
    durationsSec: V_DUR,
    defaultDurationSec: V_DEF,
    nativeScale: '720p',
    portraitVariant: 'veo_3_1_t2v_fast_portrait_ultra',
    supportsT2v: true,
    paygateNote: 'TIER_TWO / Ultra queue',
    userHint:
      '[Chữ→Video] Hàng Ultra — chỉ prompt, không cần ảnh. Cần gói Google AI Ultra.',
  },
  {
    id: 'veo_3_1_t2v_fast_portrait_ultra',
    label: 'Veo Fast Ultra (chỉ chữ · dọc)',
    kind: 'video',
    credits: 20,
    creditsUltra: 10,
    tier: 'ultra',
    family: 't2v',
    durationsSec: V_DUR,
    defaultDurationSec: V_DEF,
    nativeScale: '720p',
    supportsT2v: true,
    uiHidden: true,
  },
  {
    id: 'veo_3_1_lite_t2v',
    label: 'Veo Lite (chỉ chữ · rẻ)',
    kind: 'video',
    credits: 10,
    creditsUltra: 5,
    tier: 'lite',
    family: 't2v',
    durationsSec: V_DUR,
    defaultDurationSec: V_DEF,
    nativeScale: '720p',
    supportsT2v: true,
    note: 'Cheap iterate · ~Lite credit band',
    userHint:
      '[Chữ→Video] Rẻ hơn Fast — chỉ prompt, không cần ảnh. Thử ý tưởng / iterate.',
  },

  // ─── I2V ───────────────────────────────────────────────
  {
    id: 'OMNI_FLASH',
    label: 'Omni Flash (linh hoạt)',
    kind: 'video',
    credits: 0,
    creditsUltra: 0,
    tier: 'fast',
    family: 'i2v',
    durationsSec: V_DUR,
    defaultDurationSec: V_DEF,
    nativeScale: '720p',
    supportsI2v: true,
    supportsT2v: true,
    note: 'Resolves explicitly to abra_t2v_{4|6|8}s, matching the working FlowAgent package',
    userHint:
      '[Ảnh→Video / chữ] Omni Flash — 0 cr; ưu tiên khi có ảnh start. Path FlowAgent.',
  },
  {
    id: 'veo_3_1_i2v_s_fast',
    label: 'Veo Fast (từ 1 ảnh)',
    kind: 'video',
    credits: 20,
    creditsUltra: 10,
    tier: 'fast',
    family: 'i2v',
    durationsSec: V_DUR,
    defaultDurationSec: V_DEF,
    nativeScale: '720p',
    portraitVariant: 'veo_3_1_i2v_s_fast_portrait',
    firstLastVariant: 'veo_3_1_i2v_s_fast_fl',
    supportsI2v: true,
    supportsFirstLast: true,
    paygateNote: 'TIER_ONE default frame_2_video',
    userHint:
      '[Ảnh→Video] BẮT BUỘC có ảnh start. Gen ảnh shot → Gen video. Gói Google AI Pro.',
  },
  {
    id: 'veo_3_1_i2v_s_fast_portrait',
    label: 'Veo Fast (từ 1 ảnh · dọc)',
    kind: 'video',
    credits: 20,
    creditsUltra: 10,
    tier: 'fast',
    family: 'i2v',
    durationsSec: V_DUR,
    defaultDurationSec: V_DEF,
    nativeScale: '720p',
    supportsI2v: true,
    uiHidden: true,
  },
  {
    id: 'veo_3_1_i2v_s_fast_fl',
    label: 'Veo Fast (2 khung đầu+cuối)',
    kind: 'video',
    credits: 20,
    creditsUltra: 10,
    tier: 'fast',
    family: 'i2v',
    durationsSec: V_DUR,
    defaultDurationSec: V_DEF,
    nativeScale: '720p',
    portraitVariant: 'veo_3_1_i2v_s_fast_portrait_fl',
    supportsI2v: true,
    supportsFirstLast: true,
    note: 'start_end_frame_2_video (TIER_ONE)',
    userHint:
      '[2 khung] Cần 2 still liền kề + bật Start+End trên shot. Không gen chỉ chữ.',
  },
  {
    id: 'veo_3_1_i2v_s_fast_portrait_fl',
    label: 'Veo Fast (2 khung · dọc)',
    kind: 'video',
    credits: 20,
    creditsUltra: 10,
    tier: 'fast',
    family: 'i2v',
    durationsSec: V_DUR,
    defaultDurationSec: V_DEF,
    nativeScale: '720p',
    supportsI2v: true,
    supportsFirstLast: true,
    uiHidden: true,
  },
  {
    id: 'veo_3_1_i2v_s_fast_ultra',
    label: 'Veo Fast Ultra (từ 1 ảnh)',
    kind: 'video',
    credits: 20,
    creditsUltra: 10,
    tier: 'ultra',
    family: 'i2v',
    durationsSec: V_DUR,
    defaultDurationSec: V_DEF,
    nativeScale: '720p',
    portraitVariant: 'veo_3_1_i2v_s_fast_portrait_ultra',
    firstLastVariant: 'veo_3_1_i2v_s_fast_ultra_fl',
    supportsI2v: true,
    supportsFirstLast: true,
    paygateNote: 'TIER_TWO',
    userHint:
      '[Ảnh→Video] Ultra — cần ảnh start. Cần gói Google AI Ultra / TIER_TWO.',
  },
  {
    id: 'veo_3_1_i2v_s_fast_portrait_ultra',
    label: 'Veo Fast Ultra (từ 1 ảnh · dọc)',
    kind: 'video',
    credits: 20,
    creditsUltra: 10,
    tier: 'ultra',
    family: 'i2v',
    durationsSec: V_DUR,
    defaultDurationSec: V_DEF,
    nativeScale: '720p',
    supportsI2v: true,
    uiHidden: true,
  },
  {
    id: 'veo_3_1_i2v_s_fast_ultra_fl',
    label: 'Veo Ultra (2 khung đầu+cuối)',
    kind: 'video',
    credits: 20,
    creditsUltra: 10,
    tier: 'ultra',
    family: 'i2v',
    durationsSec: V_DUR,
    defaultDurationSec: V_DEF,
    nativeScale: '720p',
    portraitVariant: 'veo_3_1_i2v_s_fast_portrait_ultra_fl',
    supportsI2v: true,
    supportsFirstLast: true,
    paygateNote: 'TIER_TWO',
    userHint: '[2 khung] Ultra — 2 still Start+End. Gói Google AI Ultra.',
  },
  {
    id: 'veo_3_1_i2v_s_fast_portrait_ultra_fl',
    label: 'Veo Ultra (2 khung · dọc)',
    kind: 'video',
    credits: 20,
    creditsUltra: 10,
    tier: 'ultra',
    family: 'i2v',
    durationsSec: V_DUR,
    defaultDurationSec: V_DEF,
    nativeScale: '720p',
    supportsI2v: true,
    supportsFirstLast: true,
    uiHidden: true,
  },
  {
    id: 'veo_3_1_i2v_lite',
    label: 'Veo Lite (từ 1 ảnh · rẻ)',
    kind: 'video',
    credits: 10,
    creditsUltra: 5,
    tier: 'lite',
    family: 'i2v',
    durationsSec: V_DUR,
    defaultDurationSec: V_DEF,
    nativeScale: '720p',
    supportsI2v: true,
    note: 'Lite band · no R2V · ~5–10 cr / 8s',
    userHint: '[Ảnh→Video] Rẻ hơn Fast — cần ảnh start. Gói Google AI Pro.',
  },
  {
    id: 'veo_3_1_i2v_lite_low_priority',
    label: 'Veo Lite chờ chậm (0 cr)',
    kind: 'video',
    credits: 0,
    creditsUltra: 0,
    tier: 'free',
    family: 'i2v',
    durationsSec: V_DUR,
    defaultDurationSec: V_DEF,
    nativeScale: '720p',
    supportsI2v: true,
    paygateNote: 'Works SERVICE_TIER_ADVANCED · slower queue',
    note: 'TRUE 0-credit low priority',
    userHint:
      '[Ảnh→Video] 0 cr, hàng chờ chậm — cần ảnh start. Gói Free/Pro (ADVANCED).',
  },
  {
    id: 'veo_3_1_i2v_s_fast_ultra_relaxed',
    label: 'Veo Ultra relaxed (0 cr)',
    kind: 'video',
    credits: 0,
    creditsUltra: 0,
    tier: 'free',
    family: 'i2v',
    durationsSec: V_DUR,
    defaultDurationSec: V_DEF,
    nativeScale: '720p',
    supportsI2v: true,
    paygateNote: 'Needs SERVICE_TIER_ULTRA — silent empty ops on ADVANCED',
    note: 'Low-priority ultra quality',
    userHint:
      '[Ảnh→Video] 0 cr Ultra relaxed — cần ảnh start. Bắt buộc gói Google AI Ultra.',
  },

  // ─── R2V / Ingredients ─────────────────────────────────
  {
    id: 'veo_3_1_r2v_fast',
    label: 'Ingredients Fast (1–3 ảnh ref)',
    kind: 'video',
    credits: 20,
    creditsUltra: 10,
    tier: 'fast',
    family: 'reference',
    durationsSec: V_DUR,
    defaultDurationSec: V_DEF,
    nativeScale: '720p',
    portraitVariant: 'veo_3_1_r2v_fast_portrait',
    supportsIngredients: true,
    supportsI2v: true,
    paygateNote: 'TIER_ONE reference_frame_2_video',
    userHint:
      '[Ref ảnh] CẦN 1–3 ảnh ref/ingredients. Không dùng khi gen chỉ chữ (MODEL_MISMATCH).',
  },
  {
    id: 'veo_3_1_r2v_fast_portrait',
    label: 'Ingredients Fast (dọc)',
    kind: 'video',
    credits: 20,
    creditsUltra: 10,
    tier: 'fast',
    family: 'reference',
    durationsSec: V_DUR,
    defaultDurationSec: V_DEF,
    nativeScale: '720p',
    supportsIngredients: true,
    uiHidden: true,
  },
  {
    id: 'veo_3_0_r2v_fast_ultra',
    label: 'Ingredients Ultra (1–3 ảnh ref)',
    kind: 'video',
    credits: 20,
    creditsUltra: 10,
    tier: 'ultra',
    family: 'reference',
    durationsSec: V_DUR,
    defaultDurationSec: V_DEF,
    nativeScale: '720p',
    portraitVariant: 'veo_3_0_r2v_fast_portrait_ultra',
    supportsIngredients: true,
    paygateNote: 'TIER_TWO ingredients',
    userHint:
      '[Ref ảnh] Ultra ingredients — cần ảnh ref. Gói Google AI Ultra.',
  },
  {
    id: 'veo_3_0_r2v_fast_portrait_ultra',
    label: 'Ingredients Ultra (dọc)',
    kind: 'video',
    credits: 20,
    creditsUltra: 10,
    tier: 'ultra',
    family: 'reference',
    durationsSec: V_DUR,
    defaultDurationSec: V_DEF,
    nativeScale: '720p',
    supportsIngredients: true,
    uiHidden: true,
  },
  {
    id: 'veo_3_1_r2v_fast_landscape_ultra_relaxed',
    label: 'Ingredients Ultra relaxed (0 cr)',
    kind: 'video',
    credits: 0,
    creditsUltra: 0,
    tier: 'free',
    family: 'reference',
    durationsSec: V_DUR,
    defaultDurationSec: V_DEF,
    nativeScale: '720p',
    supportsIngredients: true,
    paygateNote: 'SERVICE_TIER_ULTRA only',
    userHint:
      '[Ref ảnh] 0 cr Ultra relaxed — cần ingredients. Gói Google AI Ultra only.',
  },
  /** Legacy alias still seen in older app configs — maps family reference */
  {
    id: 'veo_3_1_reference_fast',
    label: 'Reference Fast (cũ → Ingredients)',
    kind: 'video',
    credits: 20,
    creditsUltra: 10,
    tier: 'quality',
    family: 'reference',
    durationsSec: V_DUR,
    defaultDurationSec: V_DEF,
    nativeScale: '720p',
    supportsIngredients: true,
    supportsI2v: true,
    note: 'Legacy key; prefer veo_3_1_r2v_fast',
    userHint:
      '[Ref ảnh] Key cũ — nên chọn «Ingredients Fast». Cần ảnh ref.',
  },

  // ─── Extend ────────────────────────────────────────────
  {
    id: 'veo_3_1_extend_fast',
    label: 'Nối dài clip đã có',
    kind: 'video',
    credits: 20,
    creditsUltra: 10,
    tier: 'fast',
    family: 'extend',
    durationsSec: V_DUR,
    defaultDurationSec: V_DEF,
    nativeScale: '720p',
    supportsExtend: true,
    note: 'Continue from existing Flow clip (~+7s band)',
    userHint:
      '[Nối clip] Kéo dài video Flow đã gen — không tạo clip mới từ prompt trống.',
  },

  // ─── Upsample ──────────────────────────────────────────
  {
    id: 'veo_3_1_upsampler_1080p',
    label: 'Lên 1080p (sau gen)',
    kind: 'video',
    credits: 4,
    creditsUltra: 4,
    tier: 'fast',
    family: 'upsample',
    nativeScale: '1080p',
    note: 'Post-gen scale 720p → 1080p',
    userHint:
      '[Upscale] Scale video đã có → 1080p (+4 cr). Không gen clip mới.',
  },
  {
    id: 'veo_3_1_upsampler_4k',
    label: 'Lên 4K (sau gen)',
    kind: 'video',
    credits: 8,
    creditsUltra: 8,
    tier: 'ultra',
    family: 'upsample',
    nativeScale: '4k',
    note: 'Post-gen scale → 4K (Ultra plan)',
    userHint:
      '[Upscale] Scale video đã có → 4K (+8 cr). Thường cần gói Google AI Ultra.',
  },
];

export const FLOW_QUALITY_PRESETS = [
  {
    id: '1k',
    label: '1K / 720p native (no upscale)',
    imageUpscale: null as null,
    videoUpscale: null as null,
    nativeScale: '720p' as const,
  },
  {
    id: 'hd',
    label: 'HD 1080p (video upsample)',
    imageUpscale: null,
    videoUpscale: 'fhd' as const,
    nativeScale: '1080p' as const,
  },
  {
    id: '2k',
    label: '2K image upsample',
    imageUpscale: '2k' as const,
    videoUpscale: 'fhd' as const,
    nativeScale: '2k' as const,
  },
  {
    id: '4k',
    label: '4K upsample',
    imageUpscale: '4k' as const,
    videoUpscale: '4k' as const,
    nativeScale: '4k' as const,
  },
] as const;

/** Map UI / legacy image aliases to real Flow imageModelName. */
export function resolveFlowImageModelName(id?: string): string {
  const raw = String(id || '').trim();
  if (!raw || raw === 'flow' || raw === 'imagen' || raw === 'imagen3') {
    return 'GEM_PIX_2';
  }
  const upper = raw.toUpperCase();
  if (upper === 'NANO_BANANA_2_LITE' || upper === 'NANO_BANANA2_LITE') {
    return 'HARBOR_SEAL';
  }
  if (upper === 'NANO_BANANA_PRO' || upper === 'NANO_BANANA') return 'GEM_PIX_2';
  if (upper === 'NANO_BANANA_2' || upper === 'NANO_BANANA2') return 'NARWHAL';
  return raw;
}

export function findFlowModel(id: string): FlowModelEntry | undefined {
  const key = String(id || '').trim();
  if (!key) return undefined;
  return (
    FLOW_IMAGE_MODELS.find((m) => m.id === key || m.id.toUpperCase() === key.toUpperCase()) ||
    FLOW_VIDEO_MODELS.find((m) => m.id === key)
  );
}

export function listFlowVideoModelsForUi(opts?: {
  family?: FlowVideoFamily | 'all';
  includeHidden?: boolean;
}): FlowModelEntry[] {
  const fam = opts?.family || 'all';
  return FLOW_VIDEO_MODELS.filter((m) => {
    if (!opts?.includeHidden && m.uiHidden) return false;
    if (fam !== 'all' && m.family && m.family !== fam) return false;
    return true;
  });
}

export function listFlowImageModelsForUi(): FlowModelEntry[] {
  // Prefer real keys; keep aliases for display clarity
  return FLOW_IMAGE_MODELS.filter((m) => !m.uiHidden);
}

/** Clamp duration to Flow-legal set for a model (or global 4/6/8). */
export function clampFlowVideoDuration(
  durationSec: number | undefined,
  modelId?: string,
): number {
  const model = modelId ? findFlowModel(modelId) : undefined;
  const allowed = model?.durationsSec?.length
    ? model.durationsSec
    : [...FLOW_VIDEO_DURATIONS_SEC];
  const def = model?.defaultDurationSec ?? FLOW_DEFAULT_VIDEO_DURATION_SEC;
  const n = Number(durationSec);
  if (!Number.isFinite(n) || n <= 0) return def;
  if (allowed.includes(n)) return n;
  // nearest allowed
  return allowed.reduce((best, cur) =>
    Math.abs(cur - n) < Math.abs(best - n) ? cur : best,
  );
}

/**
 * Generation paths must not invent or coerce a missing clip length.
 * Keep clampFlowVideoDuration for UI/credit estimates only.
 */
export function requireFlowVideoDuration(
  durationSec: number | undefined,
  modelId?: string,
): number {
  const model = modelId ? findFlowModel(modelId) : undefined;
  const allowed = model?.durationsSec?.length
    ? model.durationsSec
    : [...FLOW_VIDEO_DURATIONS_SEC];
  const n = Number(durationSec);
  if (!Number.isFinite(n) || n <= 0) {
    throw new Error(
      `FLOW_DURATION_REQUIRED: Thiếu thời lượng video Flow. Chọn rõ ${allowed.join('/')} giây trong Cấu hình đầu ra.`,
    );
  }
  if (!allowed.includes(n)) {
    throw new Error(
      `FLOW_DURATION_INVALID: Thời lượng ${n}s không hợp lệ cho model "${modelId || 'Flow'}". ` +
        `Chọn một trong ${allowed.join('/')} giây; app không tự đổi thời lượng.`,
    );
  }
  return n;
}

export function getModelDurations(modelId?: string): number[] {
  const m = modelId ? findFlowModel(modelId) : undefined;
  if (m?.durationsSec?.length) return [...m.durationsSec];
  return [...FLOW_VIDEO_DURATIONS_SEC];
}

/**
 * Credit estimate aligned to Flow Pro (default) or Ultra.
 * Scales linearly with duration / 8s base for video gen models.
 */
export function estimateTaskCredits(opts: {
  kind: 'image' | 'video';
  modelId?: string;
  imageCount?: number;
  quality?: string;
  durationSec?: number;
  /** 'pro' (default) | 'ultra' */
  paygate?: 'pro' | 'ultra';
}): number {
  const model =
    findFlowModel(opts.modelId || '') ||
    (opts.kind === 'image' ? FLOW_IMAGE_MODELS[0] : FLOW_VIDEO_MODELS[0]);
  const paygate = opts.paygate === 'ultra' ? 'ultra' : 'pro';
  let base =
    paygate === 'ultra' && model?.creditsUltra != null
      ? model.creditsUltra
      : (model?.credits ?? (opts.kind === 'image' ? 1 : 20));

  if (opts.kind === 'image') {
    base *= Math.max(1, Math.min(4, opts.imageCount || 1));
  } else if (model?.family !== 'upsample') {
    const dur = clampFlowVideoDuration(opts.durationSec, opts.modelId);
    const def = model?.defaultDurationSec ?? FLOW_DEFAULT_VIDEO_DURATION_SEC;
    // Flow charges per clip; longer lengths cost proportionally within 4/6/8 band
    base = Math.round(base * (dur / def) * 100) / 100;
  }

  const q = (opts.quality || '').toLowerCase();
  if (q.includes('4k')) base += opts.kind === 'image' ? 2 : 8;
  else if (q.includes('2k') || q.includes('fhd') || q.includes('1080') || q === 'hd') {
    base += opts.kind === 'image' ? 1 : 4;
  }
  return base;
}

export function resolvePortraitModel(
  modelId: string | undefined,
  portrait: boolean,
): string | undefined {
  if (!modelId || !portrait) return modelId;
  const m = findFlowModel(modelId);
  return m?.portraitVariant || modelId;
}

/** Prefer first+last sibling when end frame is present. */
export function resolveFirstLastModel(
  modelId: string | undefined,
  hasEndFrame: boolean,
): string | undefined {
  if (!modelId || !hasEndFrame) return modelId;
  const m = findFlowModel(modelId);
  return m?.firstLastVariant || modelId;
}

export const FLOW_CATALOG_META = {
  source: 'Google Flow labs / aisandbox-pa model keys + Flow credit matrix',
  updatedAt: '2026-07-15',
  videoDurationsSec: FLOW_VIDEO_DURATIONS_SEC,
  defaultVideoDurationSec: FLOW_DEFAULT_VIDEO_DURATION_SEC,
  nativeVideoScale: '720p',
  videoAspectRatios: FLOW_VIDEO_ASPECT_RATIOS.map((r) => r.id),
  creditNote:
    'Pro: Lite≈10 Fast≈20 Quality≈100 / clip@8s. Ultra: Lite≈5 Fast≈10 Quality≈100. Low-priority keys=0.',
} as const;
