/**
 * 55 quy luật tâm lý gây tò mò / muốn click (SEO Title + Thumbnail).
 * Dùng cho YouTube Studio meta — đa dạng hóa template, giảm lặp 6 motif cũ.
 */

export type ThumbBias =
  | 'threat'
  | 'curiosity'
  | 'number'
  | 'question'
  | 'forbidden'
  | 'identity'
  | 'time'
  | 'paradox'
  | 'scale'
  | 'social'
  | 'loss'
  | 'open';

export interface PsychLaw {
  id: number;
  /** English short name */
  key: string;
  /** Vietnamese label */
  nameVi: string;
  thumbBias: ThumbBias;
  /** Extra score when title matches this law's signature */
  scoreBoost: number;
  /** Build title from core (main tension) + stake (secondary cost) */
  title: (core: string, stake: string) => string;
  /** Build thumbnail line (caller will clip ≤30) */
  thumb: (core: string, stake: string) => string;
}

function c(s: string) {
  return (s || '').replace(/[.!…?]+$/g, '').trim();
}
function lc(s: string) {
  const t = c(s);
  if (!t) return t;
  return t.charAt(0).toLowerCase() + t.slice(1);
}

/** 55 laws — curiosity / CTR psychology for Vietnamese storytelling channels */
export const YOUTUBE_PSYCH_55: PsychLaw[] = [
  {
    id: 1,
    key: 'curiosity_gap',
    nameVi: 'Khoảng trống tò mò (Loewenstein)',
    thumbBias: 'curiosity',
    scoreBoost: 1.2,
    title: (core, stake) =>
      stake
        ? `${c(core)} — nhưng ${lc(stake)}`
        : `Sự thật về ${lc(core)}… chưa ai dám nói hết`,
    thumb: (core) => `${c(core).slice(0, 22)}…`,
  },
  {
    id: 2,
    key: 'zeigarnik',
    nameVi: 'Zeigarnik — việc dở dang',
    thumbBias: 'open',
    scoreBoost: 1.1,
    title: (core) => `${c(core)}… và câu chuyện dừng đúng chỗ đáng sợ nhất`,
    thumb: (core) => `Chưa xong: ${c(core).slice(0, 16)}…`,
  },
  {
    id: 3,
    key: 'fomo',
    nameVi: 'FOMO — sợ bỏ lỡ',
    thumbBias: 'time',
    scoreBoost: 1.0,
    title: (core, stake) =>
      `Đừng bỏ lỡ: ${c(core)}${stake ? `… ${lc(stake)}` : ''}`,
    thumb: () => `Đừng bỏ lỡ…`,
  },
  {
    id: 4,
    key: 'loss_aversion',
    nameVi: 'Né mất mát (Kahneman)',
    thumbBias: 'loss',
    scoreBoost: 1.3,
    title: (core, stake) =>
      `${c(core)} — sai một bước là ${stake && /mất|chết|hỏng|sụp|tan|hủy/i.test(stake) ? lc(stake) : 'mất tất cả'}`,
    thumb: (core, stake) =>
      stake && /mất|chết|hỏng/i.test(stake) ? `Sai = ${c(stake).slice(0, 18)}` : `Sai là mất…`,
  },
  {
    id: 5,
    key: 'social_proof',
    nameVi: 'Bằng chứng xã hội',
    thumbBias: 'social',
    scoreBoost: 0.8,
    title: (core) => `Hàng nghìn người xem rồi… ${lc(core)}`,
    thumb: () => `Ai cũng xem…`,
  },
  {
    id: 6,
    key: 'scarcity',
    nameVi: 'Khan hiếm',
    thumbBias: 'time',
    scoreBoost: 0.9,
    title: (core) => `Chỉ còn một cơ hội hiểu ${lc(core)}`,
    thumb: () => `Chỉ còn 1 cơ hội…`,
  },
  {
    id: 7,
    key: 'authority',
    nameVi: 'Thẩm quyền',
    thumbBias: 'forbidden',
    scoreBoost: 0.7,
    title: (core) => `Chuyên gia cũng im: ${c(core)}`,
    thumb: () => `Chuyên gia im…`,
  },
  {
    id: 8,
    key: 'reciprocity',
    nameVi: 'Có đi có lại',
    thumbBias: 'curiosity',
    scoreBoost: 0.6,
    title: (core) => `Họ cho bạn manh mối — đổi bằng ${lc(core)}`,
    thumb: (core) => `Đổi bằng ${c(core).slice(0, 14)}…`,
  },
  {
    id: 9,
    key: 'commitment',
    nameVi: 'Cam kết / nhất quán',
    thumbBias: 'identity',
    scoreBoost: 0.7,
    title: (core) => `Đã hứa rồi thì phải xem: ${c(core)}`,
    thumb: () => `Đã hứa…`,
  },
  {
    id: 10,
    key: 'liking',
    nameVi: 'Đồng cảm / nhân vật gần',
    thumbBias: 'identity',
    scoreBoost: 0.8,
    title: (core, stake) =>
      stake ? `Người như bạn: ${c(core)} — ${lc(stake)}` : `Người như bạn: ${c(core)}`,
    thumb: () => `Người như bạn…`,
  },
  {
    id: 11,
    key: 'anchoring',
    nameVi: 'Mỏ neo số / mốc',
    thumbBias: 'number',
    scoreBoost: 1.0,
    title: (core) => `Phút 03:00 — ${c(core)}`,
    thumb: () => `Phút 03:00…`,
  },
  {
    id: 12,
    key: 'contrast',
    nameVi: 'Tương phản trước/sau',
    thumbBias: 'paradox',
    scoreBoost: 1.0,
    title: (core, stake) =>
      stake ? `Trước: yên. Sau: ${lc(stake)}. (${c(core)})` : `Trước yên — sau là ${lc(core)}`,
    thumb: () => `Trước/Sau…`,
  },
  {
    id: 13,
    key: 'priming',
    nameVi: 'Mồi cảm xúc',
    thumbBias: 'threat',
    scoreBoost: 0.8,
    title: (core) => `Nếu tim bạn yếu — đừng xem ${lc(core)}`,
    thumb: () => `Tim yếu? Đừng…`,
  },
  {
    id: 14,
    key: 'incongruity',
    nameVi: 'Lệch kỳ vọng / bất ngờ',
    thumbBias: 'paradox',
    scoreBoost: 1.1,
    title: (core) => `${c(core)}… nhưng kết quả ngược hoàn toàn`,
    thumb: (core) => `Ngược: ${c(core).slice(0, 18)}…`,
  },
  {
    id: 15,
    key: 'pattern_interrupt',
    nameVi: 'Ngắt mẫu',
    thumbBias: 'curiosity',
    scoreBoost: 1.0,
    title: (core) => `Dừng. ${c(core)}`,
    thumb: () => `Dừng lại…`,
  },
  {
    id: 16,
    key: 'specificity',
    nameVi: 'Cụ thể hóa (số chi tiết)',
    thumbBias: 'number',
    scoreBoost: 1.0,
    title: (core, stake) =>
      stake ? `3 chi tiết: ${c(core)} — ${lc(stake)}` : `3 chi tiết về ${lc(core)}`,
    thumb: () => `3 chi tiết…`,
  },
  {
    id: 17,
    key: 'open_loop',
    nameVi: 'Vòng mở',
    thumbBias: 'open',
    scoreBoost: 1.2,
    title: (core) => `${c(core)}… và điều xảy ra sau đó không ai ngờ`,
    thumb: (core) => `${c(core).slice(0, 20)}…?`,
  },
  {
    id: 18,
    key: 'closed_loop_tease',
    nameVi: 'Gợi vòng đóng',
    thumbBias: 'curiosity',
    scoreBoost: 0.9,
    title: (core) => `Cuối cùng sẽ rõ — nếu bạn chịu xem ${lc(core)}`,
    thumb: () => `Cuối sẽ rõ…`,
  },
  {
    id: 19,
    key: 'mystery_box',
    nameVi: 'Hộp bí ẩn',
    thumbBias: 'forbidden',
    scoreBoost: 1.1,
    title: (core) => `Bên trong: ${c(core)} (đừng mở sớm)`,
    thumb: () => `Đừng mở sớm…`,
  },
  {
    id: 20,
    key: 'before_after',
    nameVi: 'Trước–sau biến đổi',
    thumbBias: 'scale',
    scoreBoost: 0.9,
    title: (core, stake) =>
      `Từ bình thường đến ${stake ? lc(stake) : 'không thể tin'}: ${c(core)}`,
    thumb: () => `Từ → đến…`,
  },
  {
    id: 21,
    key: 'forbidden_knowledge',
    nameVi: 'Kiến thức cấm',
    thumbBias: 'forbidden',
    scoreBoost: 1.2,
    title: (core) => `Điều bị giấu: ${c(core)}`,
    thumb: () => `Bị giấu…`,
  },
  {
    id: 22,
    key: 'controversy',
    nameVi: 'Gây tranh cãi',
    thumbBias: 'paradox',
    scoreBoost: 0.9,
    title: (core) => `Bạn sẽ phản đối: ${c(core)}`,
    thumb: () => `Sẽ phản đối…`,
  },
  {
    id: 23,
    key: 'identity_threat',
    nameVi: 'Đe dọa bản ngã',
    thumbBias: 'identity',
    scoreBoost: 1.0,
    title: (core) => `Nếu bạn từng tin mình đúng — xem ${lc(core)}`,
    thumb: () => `Bạn từng tin…`,
  },
  {
    id: 24,
    key: 'status_anxiety',
    nameVi: 'Lo âu địa vị',
    thumbBias: 'social',
    scoreBoost: 0.7,
    title: (core) => `Kẻ đứng trên cũng sụp vì ${lc(core)}`,
    thumb: () => `Kẻ trên cũng sụp…`,
  },
  {
    id: 25,
    key: 'envy',
    nameVi: 'Ghen tị / thèm muốn',
    thumbBias: 'social',
    scoreBoost: 0.6,
    title: (core) => `Họ có thứ bạn muốn — đến khi ${lc(core)}`,
    thumb: () => `Thứ bạn muốn…`,
  },
  {
    id: 26,
    key: 'revenge',
    nameVi: 'Ảo tưởng trả thù',
    thumbBias: 'threat',
    scoreBoost: 0.9,
    title: (core, stake) =>
      stake ? `Trả giá: ${c(core)} — ${lc(stake)}` : `Ngày trả giá: ${c(core)}`,
    thumb: () => `Trả giá…`,
  },
  {
    id: 27,
    key: 'survival',
    nameVi: 'Đe dọa sống còn',
    thumbBias: 'threat',
    scoreBoost: 1.3,
    title: (core) => `Sống sót hay không phụ thuộc ${lc(core)}`,
    thumb: () => `Sống hay chết…`,
  },
  {
    id: 28,
    key: 'moral_outrage',
    nameVi: 'Phẫn nộ đạo đức',
    thumbBias: 'threat',
    scoreBoost: 0.9,
    title: (core) => `Không thể chấp nhận: ${c(core)}`,
    thumb: () => `Không chấp nhận…`,
  },
  {
    id: 29,
    key: 'empathy',
    nameVi: 'Kéo đồng cảm',
    thumbBias: 'identity',
    scoreBoost: 0.8,
    title: (core, stake) =>
      stake ? `${c(core)} — nỗi đau ${lc(stake)}` : `Nỗi đau trong ${lc(core)}`,
    thumb: (core) => `Nỗi: ${c(core).slice(0, 18)}…`,
  },
  {
    id: 30,
    key: 'self_reference',
    nameVi: 'Tự tham chiếu “bạn”',
    thumbBias: 'identity',
    scoreBoost: 1.0,
    // Max ~6 words for the face-off object — avoid dumping full clauses
    title: (core) => {
      const words = c(core).split(/\s+/).filter(Boolean).slice(0, 6).join(' ');
      return words
        ? `Bạn có dám đối mặt ${lc(words)} không?`
        : `Bạn có dám xem đến cuối không?`;
    },
    thumb: () => `Bạn dám xem?`,
  },
  {
    id: 31,
    key: 'time_pressure',
    nameVi: 'Áp lực thời gian',
    thumbBias: 'time',
    scoreBoost: 1.0,
    title: (core) => `Còn vài giây trước khi ${lc(core)}`,
    thumb: () => `Còn vài giây…`,
  },
  {
    id: 32,
    key: 'concrete_hyperbole',
    nameVi: 'Cụ thể + phóng đại có kiểm soát',
    thumbBias: 'scale',
    scoreBoost: 0.8,
    title: (core, stake) =>
      `${c(core)} — chi tiết nhỏ ${stake ? lc(stake) : 'làm cả thế giới sụp'}`,
    thumb: () => `Chi tiết nhỏ…`,
  },
  {
    id: 33,
    key: 'irony',
    nameVi: 'Mỉa / twist mỉa',
    thumbBias: 'paradox',
    scoreBoost: 0.9,
    title: (core) => `Cứ tưởng an toàn… ${lc(core)}`,
    thumb: () => `Cứ tưởng an toàn…`,
  },
  {
    id: 34,
    key: 'paradox',
    nameVi: 'Nghịch lý',
    thumbBias: 'paradox',
    scoreBoost: 1.0,
    title: (core) => `Càng chạy càng ${lc(core)}`,
    thumb: () => `Càng chạy càng…`,
  },
  {
    id: 35,
    key: 'unanswerable_q',
    nameVi: 'Câu hỏi không trả lời được nếu không click',
    thumbBias: 'question',
    scoreBoost: 1.2,
    title: (core) => {
      let body = c(core);
      // Prevent "Tại sao ... vì sao ..."
      body = body.replace(/^(tại\s+sao|vì\s+sao)\s+/i, '').trim();
      body = body.replace(/\b(tại\s+sao|vì\s+sao)\b/gi, '').replace(/\s+/g, ' ').trim();
      if (body.endsWith('?')) return body;
      const short = body.split(/[,，—–]/)[0].trim().slice(0, 48);
      return short
        ? `Vì sao ${lc(short)}? Câu trả lời đáng sợ hơn bạn nghĩ`
        : `Vì sao mọi thứ sụp trong một đêm?`;
    },
    thumb: (core) => {
      const s = c(core).replace(/^(tại\s+sao|vì\s+sao)\s+/i, '').slice(0, 16);
      return s ? `Vì sao ${s}?` : `Vì sao?`;
    },
  },
  {
    id: 36,
    key: 'incomplete_list',
    nameVi: 'Danh sách khuyết',
    thumbBias: 'number',
    scoreBoost: 1.0,
    title: (core) => `2/3 manh mối đã lộ — còn lại là ${lc(core)}`,
    thumb: () => `2/3 manh mối…`,
  },
  {
    id: 37,
    key: 'negative_frame',
    nameVi: 'Khung phủ định',
    thumbBias: 'threat',
    scoreBoost: 0.9,
    title: (core) => `Đừng xem nếu bạn sợ ${lc(core)}`,
    thumb: () => `Đừng xem nếu sợ…`,
  },
  {
    id: 38,
    key: 'aspiration',
    nameVi: 'Khát vọng tích cực (tương phản tối)',
    thumbBias: 'curiosity',
    scoreBoost: 0.6,
    title: (core) => `Hy vọng cuối cùng trước ${lc(core)}`,
    thumb: () => `Hy vọng cuối…`,
  },
  {
    id: 39,
    key: 'us_vs_them',
    nameVi: 'Ta–địch',
    thumbBias: 'social',
    scoreBoost: 0.8,
    title: (core) => `Họ muốn bạn im — về ${lc(core)}`,
    thumb: () => `Họ muốn bạn im…`,
  },
  {
    id: 40,
    key: 'insider',
    nameVi: 'Ngôn ngữ nội bộ',
    thumbBias: 'forbidden',
    scoreBoost: 0.7,
    title: (core) => `Chỉ người trong cuộc biết: ${c(core)}`,
    thumb: () => `Người trong cuộc…`,
  },
  {
    id: 41,
    key: 'confession',
    nameVi: 'Thú tội / tự thú',
    thumbBias: 'identity',
    scoreBoost: 0.9,
    title: (core) => `Tôi phải thú: ${c(core)}`,
    thumb: () => `Phải thú…`,
  },
  {
    id: 42,
    key: 'warning',
    nameVi: 'Cảnh báo',
    thumbBias: 'threat',
    scoreBoost: 1.1,
    title: (core) => `Cảnh báo: ${c(core)}`,
    thumb: () => `CẢNH BÁO…`,
  },
  {
    id: 43,
    key: 'challenge',
    nameVi: 'Thách thức / dám xem',
    thumbBias: 'curiosity',
    scoreBoost: 0.9,
    title: (core) => `Dám xem hết ${lc(core)} không?`,
    thumb: () => `Dám xem hết?`,
  },
  {
    id: 44,
    key: 'transformation',
    nameVi: 'Lời hứa biến đổi',
    thumbBias: 'scale',
    scoreBoost: 0.8,
    title: (core, stake) =>
      `Sau đêm đó, ${stake ? lc(stake) : 'không còn là người cũ'} — ${c(core)}`,
    thumb: () => `Sau đêm đó…`,
  },
  {
    id: 45,
    key: 'hidden_cost',
    nameVi: 'Chi phí ẩn',
    thumbBias: 'loss',
    scoreBoost: 1.0,
    title: (core, stake) =>
      `${c(core)} — cái giá thật là ${stake ? lc(stake) : 'không phải mạng sống'}`,
    thumb: () => `Cái giá thật…`,
  },
  {
    id: 46,
    key: 'last_chance',
    nameVi: 'Cơ hội cuối',
    thumbBias: 'time',
    scoreBoost: 0.9,
    title: (core) => `Lần cuối có thể hiểu ${lc(core)}`,
    thumb: () => `Lần cuối…`,
  },
  {
    id: 47,
    key: 'uncanny',
    nameVi: 'Quen mà lạ / sai lệch',
    thumbBias: 'paradox',
    scoreBoost: 1.0,
    title: (core) => `Quen thuộc… đến khi ${lc(core)}`,
    thumb: () => `Quen mà lạ…`,
  },
  {
    id: 48,
    key: 'intimate_scale',
    nameVi: 'Tỷ lệ thân mật (một người)',
    thumbBias: 'identity',
    scoreBoost: 0.8,
    title: (core) => `Chỉ một người — ${c(core)}`,
    thumb: () => `Chỉ một người…`,
  },
  {
    id: 49,
    key: 'epic_scale',
    nameVi: 'Tỷ lệ sử thi',
    thumbBias: 'scale',
    scoreBoost: 0.7,
    title: (core) => `Cả thành phố im lặng vì ${lc(core)}`,
    thumb: () => `Cả thành im…`,
  },
  {
    id: 50,
    key: 'counterintuitive',
    nameVi: 'Phản trực giác',
    thumbBias: 'paradox',
    scoreBoost: 1.1,
    title: (core) => `Nghe vô lý: ${c(core)}`,
    thumb: () => `Nghe vô lý…`,
  },
  {
    id: 51,
    key: 'prediction_fail',
    nameVi: 'Dự đoán sai',
    thumbBias: 'curiosity',
    scoreBoost: 1.0,
    title: (core) => `Bạn đoán sai về ${lc(core)}`,
    thumb: () => `Bạn đoán sai…`,
  },
  {
    id: 52,
    key: 'memory_trigger',
    nameVi: 'Gợi ký ức',
    thumbBias: 'identity',
    scoreBoost: 0.7,
    title: (core) => `Nhớ lại lần đầu ${lc(core)}…`,
    thumb: () => `Nhớ lần đầu…`,
  },
  {
    id: 53,
    key: 'dark_humor',
    nameVi: 'Hài tối (undercut)',
    thumbBias: 'paradox',
    scoreBoost: 0.6,
    title: (core) => `${c(core)} (và không, đây không phải đùa)`,
    thumb: () => `Không phải đùa…`,
  },
  {
    id: 54,
    key: 'whisper_secret',
    nameVi: 'Thì thầm / mật',
    thumbBias: 'forbidden',
    scoreBoost: 1.1,
    title: (core) => `Nghe thì thầm: ${c(core)}`,
    thumb: () => `Thì thầm…`,
  },
  {
    id: 55,
    key: 'cliff_edge',
    nameVi: 'Mép vực (click trước khi rơi)',
    thumbBias: 'threat',
    scoreBoost: 1.2,
    title: (core, stake) =>
      `${c(core)} — một bước nữa là ${stake ? lc(stake) : 'không kịp quay đầu'}`,
    thumb: () => `Một bước nữa…`,
  },
];

export function getPsychLaw(id: number): PsychLaw | undefined {
  return YOUTUBE_PSYCH_55.find((l) => l.id === id);
}

/** Rotate starting law by chapter / seed for diversity */
export function psychLawOrder(seed = 0): PsychLaw[] {
  const n = YOUTUBE_PSYCH_55.length;
  const start = Math.abs(seed) % n;
  return [...YOUTUBE_PSYCH_55.slice(start), ...YOUTUBE_PSYCH_55.slice(0, start)];
}

/** Detect which law a title most resembles (for scoring + anti-repeat) */
export function detectPsychLawInTitle(title: string): PsychLaw | undefined {
  const t = (title || '').toLowerCase();
  const hits: Array<{ law: PsychLaw; n: number }> = [];
  for (const law of YOUTUBE_PSYCH_55) {
    let n = 0;
    const sample = law.title('X', 'Y').toLowerCase();
    // keyword fingerprints
    if (law.key === 'fomo' && /đừng bỏ lỡ|bo lo/i.test(t)) n += 3;
    if (law.key === 'loss_aversion' && /sai một bước|mất tất cả/i.test(t)) n += 3;
    if (law.key === 'open_loop' && /không ai ngờ|sau đó/i.test(t)) n += 2;
    if (law.key === 'curiosity_gap' && /sự thật|nhưng |chưa ai dám/i.test(t)) n += 2;
    if (law.key === 'unanswerable_q' && /\?|tại sao|vì sao/i.test(t)) n += 2;
    if (law.key === 'warning' && /cảnh báo/i.test(t)) n += 3;
    if (law.key === 'forbidden_knowledge' && /bị giấu|điều bị/i.test(t)) n += 2;
    if (law.key === 'whisper_secret' && /thì thầm|mật/i.test(t)) n += 2;
    if (law.key === 'zeigarnik' && /dừng đúng|chưa xong|…/i.test(t)) n += 1;
    if (law.key === 'cliff_edge' && /một bước nữa|mép/i.test(t)) n += 2;
    if (law.key === 'time_pressure' && /vài giây|còn .* giây|lần cuối/i.test(t)) n += 2;
    if (law.key === 'challenge' && /dám xem/i.test(t)) n += 3;
    if (law.key === 'prediction_fail' && /đoán sai/i.test(t)) n += 3;
    if (law.key === 'self_reference' && /bạn sẽ/i.test(t)) n += 2;
    if (n > 0) hits.push({ law, n });
    void sample;
  }
  hits.sort((a, b) => b.n - a.n);
  return hits[0]?.law;
}

export function scoreTitleAgainstPsychLaws(title: string): number {
  const law = detectPsychLawInTitle(title);
  if (!law) return 0;
  return law.scoreBoost;
}
