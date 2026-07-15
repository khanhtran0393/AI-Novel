/**
 * Gán voice TTS theo nhân vật (dựa trên giới tính + giọng thoại/quirk)
 * và tách kịch bản thành các lượt thoại đa giọng.
 */
import type { NhanVatProfile } from './characterProfile';
import {
  STATIC_VOICE_CATALOG,
  getCharacterVoiceOptions as getCatalogCharacterVoices,
  type VoiceOption as CatalogVoiceOption,
  type VoiceCatalog,
} from './voiceCatalog';
import { getCachedPreparedCatalog } from './voiceCatalogPrep';

export type VoiceOption = CatalogVoiceOption;

/**
 * Danh sách voice đầy đủ theo platform (dùng catalog + cache hậu trường nếu đã prep).
 * Mặc định gộp mọi language để gán NV đa giọng không bị cắt list.
 */
export function getCharacterVoiceOptions(
  platform: string,
  language = 'vi',
  opts?: { includeAllLanguages?: boolean; catalog?: VoiceCatalog },
): VoiceOption[] {
  const catalog = opts?.catalog || getCachedPreparedCatalog() || STATIC_VOICE_CATALOG;
  return getCatalogCharacterVoices(platform, language, {
    includeAllLanguages: opts?.includeAllLanguages !== false,
    catalog,
  });
}

function isFemaleGender(gioiTinh: string): boolean | null {
  const g = (gioiTinh || '').toLowerCase().normalize('NFC');
  if (!g) return null;
  if (/(nữ|nu|female|girl|woman|she|her|cô|chị|bà|em gái)/i.test(g)) return true;
  if (/(nam|male|boy|man|he|him|anh|ông|cậu)/i.test(g)) return false;
  return null;
}

function profileQuirkBlob(profile: Partial<NhanVatProfile> | undefined): string {
  if (!profile) return '';
  return [
    profile.giong_thoai,
    profile.thoi_quen,
    profile.vai_tro,
    profile.tuoi,
    profile.dang_nguoi,
    profile.gioi_tinh,
    profile.dong_co,
    profile.so_thich,
    // personality / identity extras when present
    (profile as { tinh_cach?: string }).tinh_cach,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
    .normalize('NFC');
}

/**
 * Gợi ý voice từ giới tính + quirk thoại.
 * Quirk chỉ tinh chỉnh (cộc/khàn → nam trầm hơn; ngọt/mềm → nữ nhẹ hơn).
 */
export function suggestVoiceFromProfile(
  profile: Partial<NhanVatProfile> | undefined,
  platform: string,
  language = 'vi',
): string {
  const options = getCharacterVoiceOptions(platform, language, {
    // Ưu tiên language hiện tại khi gợi ý (tránh gán EN voice cho truyện VI)
    includeAllLanguages: false,
  });
  // Nếu language rỗng giọng → full list
  const pool =
    options.length > 0
      ? options
      : getCharacterVoiceOptions(platform, language, { includeAllLanguages: true });
  if (pool.length === 0) return '';

  const gender = isFemaleGender(profile?.gioi_tinh || '');
  const quirk = profileQuirkBlob(profile);

  const femaleBias =
    gender === true ||
    /(ngọt|mềm|nhẹ|nữ|êm|dìu|dí dỏm|rụt rè|nhỏ|yếu)/i.test(quirk);
  const maleBias =
    gender === false ||
    /(cộc|khàn|trầm|thô|lạnh|cộc lốc|đàn ông|nam|gằn|cứng)/i.test(quirk);

  // Platform-specific classic picks (stable defaults)
  // vina_voice: profile names are zero-shot speakers (catalog WAV mồi)
  if (platform === 'vina_voice') {
    if (femaleBias && !maleBias) {
      const f = pool.find(
        (o) =>
          o.gender === 'female' ||
          /nữ|nu |female|cô |chị /i.test(o.name || o.id),
      );
      if (f) return f.id;
    }
    if (maleBias && !femaleBias) {
      const m = pool.find(
        (o) =>
          o.gender === 'male' ||
          /nam |già|male|ông |chú /i.test(o.name || o.id),
      );
      if (m) return m.id;
    }
    return pool[0]?.id || '';
  }
  if (platform === 'edge_tts') {
    if (maleBias && !femaleBias) return 'vi-VN-NamMinhNeural';
    if (femaleBias) return 'vi-VN-HoaiMyNeural';
  }
  if (platform === 'openai_tts') {
    if (maleBias && !femaleBias) {
      return /(trầm|khàn|cộc)/i.test(quirk) ? 'onyx' : 'echo';
    }
    if (femaleBias) {
      return /(ngọt|mềm|nhẹ)/i.test(quirk) ? 'shimmer' : 'nova';
    }
    return 'alloy';
  }
  if (platform === 'gemini_tts') {
    if (maleBias && !femaleBias) {
      return /(trầm|cộc)/i.test(quirk) ? 'Charon' : 'Orus';
    }
    if (femaleBias) {
      return /(trẻ|nhẹ|dí)/i.test(quirk) ? 'Leda' : 'Kore';
    }
    return 'Puck';
  }
  if (platform === 'tiktok_tts' || platform === 'capcut_tts') {
    if (maleBias && !femaleBias) return 'BV075_streaming';
    return 'BV074_streaming';
  }

  // Generic: pick by VoiceOption.gender metadata
  if (femaleBias && !maleBias) {
    const f = pool.find((o) => o.gender === 'female');
    if (f) return f.id;
  }
  if (maleBias && !femaleBias) {
    const m = pool.find((o) => o.gender === 'male');
    if (m) return m.id;
  }
  return pool[0].id;
}

export type SuggestedProsody = {
  /** Absolute TTS speed 0.5–2 (role override) */
  speed: number;
  /** Semitones −12…+12 */
  pitch: number;
  emotion?: string;
  /** Short VN note for UI / toast */
  note: string;
};

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function roundSpeed(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Tính speed / pitch / emotion đặc trưng từ hồ sơ NV
 * (ưu tiên **Giọng thoại / quirk** `giong_thoai`, kèm thói quen, tuổi, giới).
 *
 * Dùng cho Role Casting Studio seed + nút Gợi ý.
 * `baseSpeed` / `basePitch` = TTS global (narrator baseline).
 */
export function suggestProsodyFromProfile(
  profile: Partial<NhanVatProfile> | undefined,
  opts?: { baseSpeed?: number; basePitch?: number },
): SuggestedProsody {
  const baseSpeed =
    typeof opts?.baseSpeed === 'number' && Number.isFinite(opts.baseSpeed)
      ? opts.baseSpeed
      : 1;
  const basePitch =
    typeof opts?.basePitch === 'number' && Number.isFinite(opts.basePitch)
      ? opts.basePitch
      : 0;

  const gender = isFemaleGender(profile?.gioi_tinh || '');
  const quirk = profileQuirkBlob(profile);
  const giong = (profile?.giong_thoai || '').toLowerCase().normalize('NFC');
  const notes: string[] = [];

  let speedDelta = 0;
  let pitchDelta = 0;
  let emotion: string | undefined;

  // —— Giọng thoại / quirk (trọng số cao) ——
  if (/(nhanh|vội|gấp|dồn\s*dập|hối\s*hả|liến\s*thoắng|tốc\s*độ)/i.test(giong + ' ' + quirk)) {
    speedDelta += 0.18;
    notes.push('nhanh');
  }
  if (/(chậm|thong\s*thả|từ\s*tốn|chậm\s*rãi|khoan\s*thai|lề\s*mề|kéo\s*dài)/i.test(giong + ' ' + quirk)) {
    speedDelta -= 0.14;
    notes.push('chậm');
  }
  if (/(cộc|ngắn|dứt\s*khoát|gọn|lạnh\s*lùng|cộc\s*lốc)/i.test(giong + ' ' + quirk)) {
    speedDelta += 0.08;
    pitchDelta -= 1;
    notes.push('cộc');
  }
  if (/(trầm|khàn|nặng|ồ\s*ồ|trầm\s*ấm|bass)/i.test(giong + ' ' + quirk)) {
    pitchDelta -= 3;
    speedDelta -= 0.04;
    notes.push('trầm');
  }
  if (/(cao|trong|mỏng|mảnh|líu\s*lo|the\s*thé)/i.test(giong + ' ' + quirk)) {
    pitchDelta += 3;
    notes.push('cao');
  }
  if (/(ngọt|mềm|êm|dịu|nhẹ\s*nhàng|ấm\s*áp)/i.test(giong + ' ' + quirk)) {
    pitchDelta += 1;
    speedDelta -= 0.05;
    notes.push('êm');
  }
  if (/(gằn|gắt|cứng|thô|lạnh)/i.test(giong + ' ' + quirk)) {
    pitchDelta -= 1;
    speedDelta += 0.04;
    notes.push('gằn');
  }
  if (/(dí\s*dỏm|hài|vui\s*tính|tếu)/i.test(giong + ' ' + quirk)) {
    emotion = emotion || 'happy';
    pitchDelta += 1;
    notes.push('dí dỏm');
  }
  if (/(buồn|u\s*sầu|thê\s*lương|ảm\s*đạm)/i.test(giong + ' ' + quirk)) {
    emotion = emotion || 'sad';
    pitchDelta -= 1;
    speedDelta -= 0.08;
    notes.push('buồn');
  }
  if (/(giận|nóng\s*nảy|cáu|hung)/i.test(giong + ' ' + quirk)) {
    emotion = emotion || 'angry';
    speedDelta += 0.1;
    notes.push('giận');
  }
  if (/(sợ|run|nhát|hoảng)/i.test(giong + ' ' + quirk)) {
    emotion = emotion || 'fear';
    pitchDelta += 2;
    speedDelta += 0.06;
    notes.push('sợ');
  }
  if (/(quyết|kiên|cứng\s*rắn|lãnh\s*đạo)/i.test(giong + ' ' + quirk)) {
    emotion = emotion || 'determined';
    pitchDelta -= 0.5;
    notes.push('quyết');
  }
  if (/(kể\s*chuyện|truyền\s*cảm|sách\s*nói|narrat)/i.test(giong + ' ' + quirk)) {
    speedDelta -= 0.06;
    notes.push('kể chuyện');
  }

  // —— Giới tính / tuổi (mặc định nhẹ) ——
  if (gender === true) {
    pitchDelta += 1.5;
    notes.push('nữ');
  } else if (gender === false) {
    pitchDelta -= 1;
    notes.push('nam');
  }

  const tuoi = (profile?.tuoi || '').toLowerCase();
  if (/(già|lão|cao\s*tuổi|60|70|80|ông\s*già|bà\s*già)/i.test(tuoi + ' ' + quirk)) {
    pitchDelta -= 2;
    speedDelta -= 0.1;
    notes.push('già');
  } else if (/(trẻ|thiếu\s*niên|nhí|em\s*bé|15|16|17|18|teen)/i.test(tuoi + ' ' + quirk)) {
    pitchDelta += 1.5;
    speedDelta += 0.06;
    notes.push('trẻ');
  } else if (/(trẻ\s*con|nhỏ|bé)/i.test(quirk)) {
    pitchDelta += 3;
    speedDelta += 0.08;
    notes.push('trẻ em');
  }

  // —— Vai trò ——
  const vai = (profile?.vai_tro || '').toLowerCase();
  if (/(phản\s*diện|trùm|ác|villain)/i.test(vai)) {
    pitchDelta -= 1;
    emotion = emotion || 'determined';
    notes.push('phản diện');
  }
  if (/(hài|comic|trickster)/i.test(vai)) {
    emotion = emotion || 'happy';
    pitchDelta += 1;
  }
  if (/(chính|protagonist|hero)/i.test(vai)) {
    emotion = emotion || 'determined';
    notes.push('chính');
  }

  // —— Tính cách / động cơ / sở thích (chất giọng) ——
  const dongCo = (profile?.dong_co || '').toLowerCase().normalize('NFC');
  const soThich = (profile?.so_thich || '').toLowerCase().normalize('NFC');
  const personalityBlob = `${dongCo} ${soThich} ${quirk}`;
  if (/(báo\s*thù|hận|tàn|máu\s*lạnh|thù\s*hằn)/i.test(personalityBlob)) {
    pitchDelta -= 1.5;
    speedDelta -= 0.04;
    emotion = emotion || 'determined';
    notes.push('tính cứng');
  }
  if (/(bảo\s*vệ|che\s*chở|hy\s*sinh|nhân\s*hậu|hiền)/i.test(personalityBlob)) {
    pitchDelta += 0.5;
    speedDelta -= 0.05;
    emotion = emotion || 'neutral';
    notes.push('hiền');
  }
  if (/(tham\s*vọng|thống\s*trị|quyền\s*lực|lãnh\s*đạo)/i.test(personalityBlob)) {
    pitchDelta -= 1;
    emotion = emotion || 'determined';
    notes.push('tham vọng');
  }
  if (/(nhút\s*nhát|rụt\s*rè|yếu\s*đuối|nhạy\s*cảm)/i.test(personalityBlob)) {
    pitchDelta += 1.5;
    speedDelta -= 0.04;
    emotion = emotion || 'fear';
    notes.push('nhút nhát');
  }
  if (/(lạnh\s*lùng|vô\s*cảm|xa\s*cách)/i.test(personalityBlob)) {
    pitchDelta -= 1;
    speedDelta -= 0.02;
    notes.push('lạnh');
  }

  // —— Dáng người (gợi ý pitch nhẹ) ——
  const dang = (profile?.dang_nguoi || '').toLowerCase();
  if (/(vạm\s*vỡ|to\s*lớn|cao\s*to|cơ\s*bắp)/i.test(dang)) {
    pitchDelta -= 1;
    notes.push('vạm vỡ');
  }
  if (/(mảnh|gầy|nhỏ\s*nhắn|yểu)/i.test(dang)) {
    pitchDelta += 1;
    notes.push('mảnh');
  }

  // Không có tín hiệu → lệch nhẹ theo base (vẫn gán số để Studio không trống)
  if (notes.length === 0) {
    notes.push('mặc định hồ sơ');
  }

  const speed = roundSpeed(clamp(baseSpeed + speedDelta, 0.55, 1.75));
  const pitch = Math.round(clamp(basePitch + pitchDelta, -10, 10));

  return {
    speed,
    pitch,
    emotion,
    note: notes.slice(0, 4).join(' · '),
  };
}

/** Gói gợi ý đầy đủ: voice + prosody từ hồ sơ */
export function suggestCastFromProfile(
  profile: Partial<NhanVatProfile> | undefined,
  platform: string,
  language = 'vi',
  opts?: { baseSpeed?: number; basePitch?: number },
): { voiceId: string } & SuggestedProsody {
  const voiceId = suggestVoiceFromProfile(profile, platform, language);
  const prosody = suggestProsodyFromProfile(profile, opts);
  return { voiceId, ...prosody };
}

export interface ScriptVoiceSegment {
  /** null = người kể / mặc định */
  speaker: string | null;
  text: string;
  voice: string;
}

/**
 * Tách kịch bản theo lượt thoại:
 * - Dòng dạng `Tên NV: ...` hoặc `Tên NV：...`
 * - Dòng không khớp → người kể (defaultVoice)
 * Gộp các đoạn cùng speaker liền kề.
 */
export function parseScriptVoiceSegments(params: {
  sceneText: string;
  characterNames: string[];
  characterVoices: Record<string, string>;
  defaultVoice: string;
}): ScriptVoiceSegment[] {
  const { sceneText, characterNames, characterVoices, defaultVoice } = params;
  if (!sceneText?.trim()) return [];

  // Tên dài trước để "Khánh Ân" không bị nuốt bởi "Ân"
  const names = [...characterNames]
    .map((n) => n.trim())
    .filter(Boolean)
    .sort((a, b) => b.length - a.length);

  const lines = sceneText
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

  const raw: { speaker: string | null; text: string }[] = [];

  for (const line of lines) {
    // Bỏ tag cảnh
    if (/^\[?CẢNH\s+\d+/i.test(line)) continue;

    let matched = false;
    for (const name of names) {
      // "Kiến: ..." | "Kiến：" | "Kiến nói: ..." | "Kiến thở dài: ..."
      const re = new RegExp(
        `^${escapeRegExp(name)}(?:\\s*(?:nói|hỏi|đáp|thét|gầm|thì\\s*thầm|cười|thở\\s*dài|gằn\\s*giọng|lạnh\\s*lùng|khàn))?\\s*[:：]\\s*(.+)$`,
        'iu',
      );
      const m = line.match(re);
      if (m) {
        const body = (m[1] || '').trim();
        if (body) {
          raw.push({ speaker: name, text: body });
          matched = true;
          break;
        }
      }
    }
    if (!matched) {
      raw.push({ speaker: null, text: line });
    }
  }

  // Gộp speaker liền kề
  const merged: { speaker: string | null; text: string }[] = [];
  for (const seg of raw) {
    const last = merged[merged.length - 1];
    if (last && last.speaker === seg.speaker) {
      last.text = `${last.text}\n${seg.text}`;
    } else {
      merged.push({ ...seg });
    }
  }

  return merged
    .map((seg) => {
      const cleaned = cleanSegmentText(seg.text);
      if (!cleaned) return null;
      const voice =
        (seg.speaker && characterVoices[seg.speaker]?.trim()) ||
        defaultVoice;
      return {
        speaker: seg.speaker,
        text: cleaned,
        voice,
      } as ScriptVoiceSegment;
    })
    .filter((s): s is ScriptVoiceSegment => !!s);
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Làm sạch 1 đoạn thoại (không strip speaker — đã tách) */
export function cleanSegmentText(text: string): string {
  let cleaned = text;
  cleaned = cleaned.replace(/\([^)]*\)/g, '');
  cleaned = cleaned.replace(/\[[^\]]*\]/g, '');
  cleaned = cleaned.replace(/[\*\_`#]/g, '');
  cleaned = cleaned.replace(/^["“«]+|["”»]+$/g, '');
  return cleaned
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .join('\n')
    .trim();
}

/** true khi có lượt thoại NV và xuất hiện ≥2 voice khác nhau trong các đoạn */
export function shouldUseMultiVoice(
  segments: ScriptVoiceSegment[],
  _characterVoices: Record<string, string>,
  defaultVoice: string,
): boolean {
  const hasCharLine = segments.some((s) => s.speaker != null);
  if (!hasCharLine) return false;
  const voices = new Set(
    segments.map((s) => (s.voice || defaultVoice).trim()).filter(Boolean),
  );
  return voices.size > 1;
}

/** Map tên NV → tts_voice (gợi ý nếu trống) */
export function buildCharacterVoiceMap(
  names: string[],
  prompts: Record<string, Partial<NhanVatProfile> | undefined>,
  platform: string,
  autoSuggest = true,
  language = 'vi',
): Record<string, string> {
  const map: Record<string, string> = {};
  for (const name of names) {
    const p = prompts[name];
    const explicit = (p?.tts_voice || '').trim();
    if (explicit) {
      map[name] = explicit;
    } else if (autoSuggest) {
      map[name] = suggestVoiceFromProfile(p, platform, language);
    }
  }
  return map;
}
