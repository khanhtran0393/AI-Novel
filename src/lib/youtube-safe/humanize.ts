import { buildHumanJokeAsideBlock } from './humanJokes';

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

export type CharacterPromptLite = {
  thoi_quen?: string;
  so_thich?: string;
  gioi_tinh?: string;
  prompt?: string;
  giong_thoai?: string;
  dong_co?: string;
  dac_diem_nhan_dang?: string;
};

/** Lookup profile with NFC-normalized name keys (persist / import often diverge). */
function findCharacterPrompt(
  name: string,
  map?: Record<string, CharacterPromptLite>,
): CharacterPromptLite | undefined {
  if (!map) return undefined;
  if (map[name]) return map[name];
  const nfc = name.normalize('NFC');
  if (map[nfc]) return map[nfc];
  for (const [k, v] of Object.entries(map)) {
    if (k.normalize('NFC') === nfc) return v;
  }
  return undefined;
}

/**
 * Preflight for WRITE_CHAPTER / REVISE — clear VN errors, no silent invent.
 * Returns null when OK; otherwise human-readable message for toast/UI.
 */
export function validateSpeechFingerprints(
  nhan_vat?: string[],
  nhan_vat_prompts?: Record<string, CharacterPromptLite>,
): string | null {
  if (!nhan_vat?.length) return null;
  const missingQuirk: string[] = [];
  const missingHabit: string[] = [];
  for (const name of nhan_vat) {
    const p = findCharacterPrompt(name, nhan_vat_prompts);
    const quirk = (p?.giong_thoai || '').trim();
    const habit = (p?.thoi_quen || p?.so_thich || '').trim();
    if (!quirk) missingQuirk.push(name);
    if (!habit) missingHabit.push(name);
  }
  const parts: string[] = [];
  if (missingQuirk.length) {
    parts.push(
      `Thiếu «Giọng thoại / quirk» cho: ${missingQuirk.join(', ')}. ` +
        `Mở hồ sơ nhân vật → điền Giọng thoại (VD: «cộc, câu ngắn»). App không tự bịa quirk.`,
    );
  }
  if (missingHabit.length) {
    parts.push(
      `Thiếu «Thói quen / sở thích» cho: ${missingHabit.join(', ')}. ` +
        `Điền trong hồ sơ nhân vật. App không tự tạo habit.`,
    );
  }
  return parts.length ? parts.join('\n') : null;
}

export function buildSpeechFingerprintBlock(
  nhan_vat?: string[],
  nhan_vat_prompts?: Record<string, CharacterPromptLite>,
): string {
  if (!nhan_vat?.length) return '';
  const pre = validateSpeechFingerprints(nhan_vat, nhan_vat_prompts);
  if (pre) {
    throw new Error(pre);
  }
  const lines = nhan_vat.map((name) => {
    const p = findCharacterPrompt(name, nhan_vat_prompts);
    const habit = (p?.thoi_quen || p?.so_thich || '').trim();
    const quirk = (p?.giong_thoai || '').trim();
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
