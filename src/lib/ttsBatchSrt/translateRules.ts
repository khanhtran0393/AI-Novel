/**
 * 14 phong cách dịch — parity CapAssist (Tool Dịch SRT / Auto Render).
 * Cùng ruleId dùng cho Google Studio translate.
 */

export type TranslateRuleOption = {
  id: string;
  /** Label hiển thị UI (VN) */
  label: string;
  /** Mô tả đưa vào prompt (giống CapAssist) */
  description: string;
};

/** Đúng 14 chế độ CapAssist (rpa-translate-srt / translate_subtitles_engine). */
export const TRANSLATE_RULE_OPTIONS: TranslateRuleOption[] = [
  {
    id: 'xianxia',
    label: 'Tu tiên / Huyền huyễn',
    description:
      'Sử dụng từ ngữ Hán Việt cổ kính, trang trọng, khí thế hào hùng. Giữ nguyên các thuật ngữ tu tiên, pháp bảo.',
  },
  {
    id: 'romance',
    label: 'Lãng mạn',
    description:
      'Lãng mạn, nhẹ nhàng, sử dụng xưng hô huynh - muội, chàng - thiếp, vương gia, nương nương.',
  },
  {
    id: 'wuxia',
    label: 'Võ hiệp',
    description:
      'Võ thuật, ân oán giang hồ. Xưng hô tại hạ, các hạ, huynh đài, tiền bối.',
  },
  {
    id: 'palace',
    label: 'Cung đấu',
    description:
      'Tranh quyền đoạt vị, nội chiến gia tộc. Giọng điệu cung đình trang trọng, cung kính.',
  },
  {
    id: 'rich',
    label: 'Tổng tài / Giới siêu giàu',
    description:
      'Giới siêu giàu, tổng tài bá đạo, ngôn từ hiện đại pha chút kiêu ngạo, thương trường.',
  },
  {
    id: 'school',
    label: 'Học đường',
    description:
      'Tươi trẻ, hồn nhiên, thuật ngữ học đường, xưng hô cậu - tớ, mày - tao thân thiết.',
  },
  {
    id: 'comedy',
    label: 'Hài hước',
    description:
      'Vui tươi, hài hước, ngôn từ hiện đại thoải mái, có thể dùng từ lóng mạng mẻ.',
  },
  {
    id: 'horror',
    label: 'Kinh dị / Phá án',
    description:
      'Kịch tính, logic, lạnh lùng, thuật ngữ phá án/tâm lý/kinh dị. Giọng điệu hồi hộp, nghiêm túc.',
  },
  {
    id: 'action',
    label: 'Hành động',
    description:
      'Gọn gàng, mạnh mẽ, dứt khoát. Nhịp độ nhanh, tập trung vào hành động.',
  },
  {
    id: 'scifi',
    label: 'Khoa học viễn tưởng',
    description:
      'Sinh tồn, tương lai, công nghệ khoa học viễn tưởng. Thuật ngữ máy móc, không gian, AI.',
  },
  {
    id: 'history',
    label: 'Lịch sử / Chiến tranh',
    description:
      'Hào hùng, bi tráng, thời kỳ dân quốc/chiến tranh. Ngôn từ thời chiến lược, tư lệnh, quan chức.',
  },
  {
    id: 'modern',
    label: 'Hiện đại / Đời thường',
    description:
      'Tone chân thực, thực tế, đời sống thường ngày kết hợp thuật ngữ công sở và gia đình. Ngôn từ gần gũi.',
  },
  {
    id: 'strict',
    label: 'Strict 1-1 (Light Novel)',
    description:
      'Dịch 1-1 sát nghĩa gốc, bám sát cấu trúc ngữ pháp nguyên bản, không phóng tác, cực kỳ chuẩn xác, phù hợp Light Novel.',
  },
  {
    id: 'auto',
    label: 'Tự động (AI đoán ngữ cảnh)',
    description:
      'AI tự động quét toàn bộ văn bản để phán đoán bối cảnh, từ đó linh hoạt điều chỉnh văn phong và đại từ nhân xưng cho phù hợp nhất.',
  },
];

const BY_ID = Object.fromEntries(
  TRANSLATE_RULE_OPTIONS.map((r) => [r.id, r]),
) as Record<string, TranslateRuleOption>;

export function resolveTranslateRuleDescription(ruleId?: string): string {
  const id = String(ruleId || 'modern').trim() || 'modern';
  return (BY_ID[id] || BY_ID.modern).description;
}

/**
 * Số dòng/cue mỗi batch dịch (neo ||).
 * Tự điền UI = 50 (CapAssist thực chiến).
 * (Không DeepSeek; chỉ Gemini API.)
 */
export const DEFAULT_TRANSLATE_CHUNK = 50;
export const MIN_TRANSLATE_CHUNK = 5;
/** Cho phép chỉnh tay; >80 dễ lệch token — ưu tiên 30–50 */
export const MAX_TRANSLATE_CHUNK = 100;

export function clampTranslateChunk(n: unknown): number {
  const v = typeof n === 'number' ? n : parseInt(String(n ?? ''), 10);
  if (!Number.isFinite(v)) return DEFAULT_TRANSLATE_CHUNK;
  return Math.max(MIN_TRANSLATE_CHUNK, Math.min(MAX_TRANSLATE_CHUNK, Math.trunc(v)));
}
