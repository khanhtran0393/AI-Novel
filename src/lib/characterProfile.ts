/**
 * Hồ sơ nhân vật mở rộng:
 * - Khóa nhận diện (face lock + đặc điểm nhận dạng)
 * - Ảnh đối chiếu 4 chiều (turnaround)
 * - Biểu cảm khuôn mặt nhất quán theo cảm xúc
 */

export const CHAR_ANGLES = ['front', 'three_quarter', 'side', 'back'] as const;
export type CharAngle = (typeof CHAR_ANGLES)[number];

export const CHAR_ANGLE_LABELS: Record<CharAngle, string> = {
  front: 'Chính diện',
  three_quarter: '3/4',
  side: 'Nghiêng / Profile',
  back: 'Sau lưng',
};

export const CHAR_EMOTIONS = [
  'neutral',
  'happy',
  'sad',
  'angry',
  'fear',
  'surprised',
  'determined',
  'pain',
] as const;
export type CharEmotion = (typeof CHAR_EMOTIONS)[number];

export const CHAR_EMOTION_LABELS: Record<CharEmotion, string> = {
  neutral: 'Trung tính',
  happy: 'Vui / Mỉm cười',
  sad: 'Buồn',
  angry: 'Giận',
  fear: 'Sợ',
  surprised: 'Ngạc nhiên',
  determined: 'Quyết tâm',
  pain: 'Đau / Căng thẳng',
};

/** English camera / framing hints for turnaround sheet */
export const CHAR_ANGLE_CAMERA: Record<CharAngle, string> = {
  front:
    'front view, facing camera, full-body or waist-up character turnaround sheet, neutral stance, centered composition',
  three_quarter:
    'three-quarter view, 3/4 angle facing slightly left of camera, character turnaround sheet, same identity as front view',
  side:
    'strict side profile view, 90-degree profile, character turnaround sheet, same identity as front view',
  back:
    'rear view from behind, back of head and outfit visible, character turnaround sheet, same identity as front view',
};

/** English facial expression anchors — keep identity fixed, only muscle/expression changes */
export const CHAR_EMOTION_FACE: Record<CharEmotion, string> = {
  neutral: 'neutral calm expression, relaxed facial muscles, soft gaze',
  happy: 'genuine subtle smile, lifted cheeks, warm eyes, no exaggerated cartoon grin',
  sad: 'downcast eyes, slight frown, melancholic expression, restrained sorrow',
  angry: 'furrowed brows, tense jaw, sharp intense eyes, controlled anger',
  fear: 'widened eyes, raised brows, tight lips, fearful tension',
  surprised: 'raised eyebrows, open eyes, slightly parted lips, startled but controlled',
  determined: 'focused narrowed eyes, firm mouth, resolute expression, quiet resolve',
  pain: 'winced eyes, clenched jaw, strained brow, physical or emotional pain, restrained',
};

export interface NhanVatProfile {
  /** Giới tính (chỉ giới tính, không nhét tuổi) */
  gioi_tinh: string;
  /** Tuổi / độ tuổi ước lượng */
  tuoi: string;
  /** Dáng người, chiều cao ước lượng */
  dang_nguoi: string;
  /** Vai trò: chính / phụ / phản diện / ... */
  vai_tro: string;
  /** Trang phục signature */
  quan_ao: string;
  /** Sở thích / phong cách */
  so_thich: string;
  /** Thói quen hành vi */
  thoi_quen: string;
  /** Động cơ cốt lõi */
  dong_co: string;
  /** Quirk / fingerprint thoại (văn phong khi viết thoại) */
  giong_thoai: string;
  /**
   * Voice ID TTS gắn cho nhân vật (theo platform đang chọn, VD: vi-VN-NamMinhNeural).
   * Dùng khi sinh đa giọng theo lượt thoại trong cảnh.
   */
  tts_voice: string;
  /** Khóa ngoại hình khuôn mặt (face lock) */
  ngoai_hinh: string;
  /** Đặc điểm nhận dạng cố định: sẹo, nốt ruồi, xăm, khuyết tật, vật dụng... */
  dac_diem_nhan_dang: string;
  /** Khuyết tật mạt thế / thương tật (nếu có) */
  khuet_tat: string;
  /**
   * Master visual prompt (English) — khóa nhận diện gốc cho concept + consistency.
   * Legacy field: vẫn dùng làm ảnh front / base.
   */
  prompt: string;
  /** Prompt tiếng Anh cho từng góc quay (4 chiều) */
  angle_prompts?: Partial<Record<CharAngle, string>>;
  /** Prompt tiếng Anh cho từng biểu cảm khuôn mặt */
  expression_prompts?: Partial<Record<CharEmotion, string>>;
}

export type NhanVatPromptsMap = Record<string, NhanVatProfile>;

export function emptyNhanVatProfile(): NhanVatProfile {
  return {
    gioi_tinh: '',
    tuoi: '',
    dang_nguoi: '',
    vai_tro: '',
    quan_ao: '',
    so_thich: '',
    thoi_quen: '',
    dong_co: '',
    giong_thoai: '',
    tts_voice: '',
    ngoai_hinh: '',
    dac_diem_nhan_dang: '',
    khuet_tat: '',
    prompt: '',
    angle_prompts: {},
    expression_prompts: {},
  };
}

/** Merge partial + legacy data safely (persist may miss new keys) */
export function normalizeNhanVatProfile(
  raw?: Partial<NhanVatProfile> | null,
): NhanVatProfile {
  const base = emptyNhanVatProfile();
  if (!raw || typeof raw !== 'object') return base;
  return {
    ...base,
    ...raw,
    angle_prompts: { ...(raw.angle_prompts || {}) },
    expression_prompts: { ...(raw.expression_prompts || {}) },
  };
}

/** Các trường text bắt buộc (khuyết tật mạt thế = tùy chọn) */
export const CHAR_PROFILE_REQUIRED_FIELDS: Array<{
  key: keyof NhanVatProfile;
  label: string;
  minLen?: number;
}> = [
  { key: 'gioi_tinh', label: 'Giới tính', minLen: 1 },
  { key: 'tuoi', label: 'Tuổi', minLen: 1 },
  { key: 'dang_nguoi', label: 'Dáng người', minLen: 2 },
  { key: 'vai_tro', label: 'Vai trò', minLen: 1 },
  { key: 'quan_ao', label: 'Trang phục', minLen: 2 },
  { key: 'so_thich', label: 'Sở thích', minLen: 1 },
  { key: 'thoi_quen', label: 'Thói quen', minLen: 1 },
  { key: 'dong_co', label: 'Động cơ', minLen: 2 },
  { key: 'giong_thoai', label: 'Giọng thoại / quirk', minLen: 2 },
  { key: 'tts_voice', label: 'Giọng đọc TTS', minLen: 2 },
  { key: 'ngoai_hinh', label: 'Face lock', minLen: 4 },
  { key: 'dac_diem_nhan_dang', label: 'Đặc điểm nhận dạng', minLen: 2 },
  { key: 'prompt', label: 'Master prompt EN', minLen: 12 },
];

export type CharacterSetupStatus = {
  complete: boolean;
  missing: string[];
  hasAllFields: boolean;
  hasTtsVoice: boolean;
  hasReferenceImage: boolean;
};

/**
 * Hồ sơ NV setup xong = đủ MỌI trường bắt buộc + giọng TTS + ảnh tham chiếu.
 * `khuet_tat` không bắt buộc (không phải NV nào cũng có).
 */
export function getCharacterProfileSetupStatus(
  raw?: Partial<NhanVatProfile> | null,
  opts?: { hasReferenceImage?: boolean },
): CharacterSetupStatus {
  const p = normalizeNhanVatProfile(raw);
  const missing: string[] = [];

  for (const f of CHAR_PROFILE_REQUIRED_FIELDS) {
    const val = String(p[f.key] ?? '').trim();
    const min = f.minLen ?? 1;
    if (val.length < min) missing.push(f.label);
  }

  const hasTtsVoice = (p.tts_voice || '').trim().length >= 2;
  const hasReferenceImage = opts?.hasReferenceImage === true;
  if (!hasReferenceImage) missing.push('Ảnh tham chiếu');

  // Mọi field text bắt buộc (gồm tts_voice) đủ
  const textOk = CHAR_PROFILE_REQUIRED_FIELDS.every((f) => {
    const val = String(p[f.key] ?? '').trim();
    return val.length >= (f.minLen ?? 1);
  });

  return {
    complete: textOk && hasReferenceImage,
    missing: Array.from(new Set(missing)),
    hasAllFields: textOk,
    hasTtsVoice,
    hasReferenceImage,
  };
}

export function isCharacterProfileSetupComplete(
  raw?: Partial<NhanVatProfile> | null,
  opts?: { hasReferenceImage?: boolean },
): boolean {
  return getCharacterProfileSetupStatus(raw, opts).complete;
}

/** Image map keys for generatedImages / projectUrls */
export function charImageKey(charName: string): string {
  return `char_${charName}`;
}

export function charAngleImageKey(charName: string, angle: CharAngle): string {
  return `char_${charName}_angle_${angle}`;
}

export function charExprImageKey(charName: string, emotion: CharEmotion): string {
  return `char_${charName}_expr_${emotion}`;
}

/** Build identity lock block (English) from profile fields for image/video prompts */
export function buildIdentityLockEnglish(profile: Partial<NhanVatProfile> | undefined): string {
  if (!profile) return '';
  const parts: string[] = [];
  if (profile.prompt?.trim()) parts.push(profile.prompt.trim());
  if (profile.ngoai_hinh?.trim()) {
    parts.push(`Face lock: ${profile.ngoai_hinh.trim()}`);
  }
  if (profile.dac_diem_nhan_dang?.trim()) {
    parts.push(`Distinctive identifying marks (MUST keep identical every shot): ${profile.dac_diem_nhan_dang.trim()}`);
  }
  if (profile.khuet_tat?.trim()) {
    parts.push(`Permanent trait/disability: ${profile.khuet_tat.trim()}`);
  }
  if (profile.quan_ao?.trim()) {
    parts.push(`Signature outfit: ${profile.quan_ao.trim()}`);
  }
  if (profile.gioi_tinh?.trim() || profile.tuoi?.trim() || profile.dang_nguoi?.trim()) {
    parts.push(
      `Identity: ${[profile.gioi_tinh, profile.tuoi, profile.dang_nguoi].filter(Boolean).join(', ')}`,
    );
  }
  return parts.join('. ');
}

/**
 * Compose a full English prompt for a specific turnaround angle,
 * forcing identity + distinctive marks to stay fixed.
 */
export function composeAnglePrompt(
  profile: Partial<NhanVatProfile>,
  angle: CharAngle,
  custom?: string,
): string {
  if (custom?.trim()) return custom.trim();
  const stored = profile.angle_prompts?.[angle]?.trim();
  if (stored) return stored;

  const identity = buildIdentityLockEnglish(profile);
  const cam = CHAR_ANGLE_CAMERA[angle];
  return [
    identity || 'consistent character design sheet',
    cam,
    'same face, same scars/marks, same hair, same outfit details, character design reference, clean neutral background, cinematic natural lighting, grounded production design, no text, no watermark',
  ]
    .filter(Boolean)
    .join(', ');
}

/**
 * Compose English prompt for a facial expression close-up,
 * identity fixed — only expression changes.
 */
export function composeExpressionPrompt(
  profile: Partial<NhanVatProfile>,
  emotion: CharEmotion,
  custom?: string,
): string {
  if (custom?.trim()) return custom.trim();
  const stored = profile.expression_prompts?.[emotion]?.trim();
  if (stored) return stored;

  const identity = buildIdentityLockEnglish(profile);
  const face = CHAR_EMOTION_FACE[emotion];
  return [
    identity || 'consistent character portrait',
    'tight head-and-shoulders portrait, front three-quarter face preferred',
    face,
    'identical facial structure, identical scars/moles/marks, identical hair and eyes, only expression muscles change',
    'expressive character art, natural lighting, grounded production design, no text, no watermark',
  ]
    .filter(Boolean)
    .join(', ');
}

/**
 * ONE unified character reference sheet prompt:
 * master front portrait + 4-view turnaround + expression row — single image.
 */
export function composeCharacterReferenceSheetPrompt(
  profile: Partial<NhanVatProfile>,
  charName?: string,
): string {
  const identity = buildIdentityLockEnglish(profile);
  const nameHint = charName?.trim() ? `Character: ${charName.trim()}. ` : '';
  return [
    `${nameHint}Professional character design reference sheet, single cohesive image, clean neutral studio background`,
    'Layout: TOP ROW = large front-facing master portrait (head-and-shoulders, neutral expression)',
    'MIDDLE ROW = full-body turnaround 4 views of the SAME character left-to-right: front, three-quarter, side profile, back',
    'BOTTOM ROW = facial expression sheet close-ups of the SAME face: neutral, happy, sad, angry, fear, surprised, determined, pain',
    identity || 'consistent character identity',
    'CRITICAL: identical face structure, hair, eyes, skin, scars/moles/marks, body proportions, and signature outfit in EVERY panel',
    'Distinctive identifying marks must appear the same in portrait, all 4 turnaround angles, and all expression faces',
    'Even panel spacing, model-sheet style, concept art production design, cinematic natural lighting, high detail, no text labels, no watermark, no logo',
  ]
    .filter(Boolean)
    .join('. ');
}

/** Short VN bible line for writing consistency */
export function formatProfileBibleLine(name: string, p: Partial<NhanVatProfile>): string {
  const bits = [
    p.vai_tro ? `Vai=${p.vai_tro}` : null,
    `Giới=${p.gioi_tinh || '?'}`,
    p.tuoi ? `Tuổi=${p.tuoi}` : null,
    p.dang_nguoi ? `Dáng=${p.dang_nguoi}` : null,
    `Trang phục=${p.quan_ao || '?'}`,
    p.ngoai_hinh ? `Ngoại hình=${p.ngoai_hinh}` : null,
    p.dac_diem_nhan_dang ? `Nhận dạng=${p.dac_diem_nhan_dang}` : null,
    p.khuet_tat ? `Khuyết tật=${p.khuet_tat}` : null,
    `Sở thích=${p.so_thich || '?'}`,
    `Thói quen=${p.thoi_quen || '?'}`,
    p.dong_co ? `Động cơ=${p.dong_co}` : null,
    p.giong_thoai ? `Giọng thoại=${p.giong_thoai}` : null,
  ].filter(Boolean);
  return `- ${name}: ${bits.join('; ')}. Giọng/hành vi/nhận diện phải nhất quán.`;
}

/** Compact reference block for image-prompt API (character consistency) */
export function formatCharacterVisualRef(
  name: string,
  p: Partial<NhanVatProfile>,
): string {
  const lock = buildIdentityLockEnglish(p);
  return (
    `- Nhân vật: "${name}"` +
    ` | Vai: ${p.vai_tro || '?'}` +
    ` | Giới: ${p.gioi_tinh || '?'}` +
    ` | Tuổi: ${p.tuoi || '?'}` +
    ` | Dáng: ${p.dang_nguoi || '?'}` +
    ` | Trang phục: ${p.quan_ao || '?'}` +
    ` | Face lock: ${p.ngoai_hinh || '?'}` +
    ` | Đặc điểm nhận dạng (BẮT BUỘC giữ): ${p.dac_diem_nhan_dang || p.khuet_tat || '?'}` +
    ` | Prompt khóa: "${lock || p.prompt || ''}"`
  );
}
