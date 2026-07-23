import { buildHumanJokeAsideBlock } from './humanJokes';

export function buildHumanizeScriptBlock(enabled: boolean): string {
  if (!enabled) return '';
  return `
--- CHẾ ĐỘ TÍNH NGƯỜI / NARRATION TỰ NHIÊN (BẮT BUỘC) ---
A. Xương sống = HÀNH ĐỘNG + ĐỐI THOẠI + XUNG ĐỘT; miêu tả chỉ là gia vị (1–2 chi tiết đắt/cảnh), không tường thuật dàn đều.
B. Mỗi phân cảnh ≥1 câu thoại "đời" (cụt, ngắt, nói tránh, không giải thích hết) — có subtext.
C. Im lặng hữu ích: 1–2 nhịp hành động/không lời; đừng stack 5 giác quan liên tục.
D. CẤM văn AI sáo: mắt ánh lên quyết tâm, không khí đông đặc, trái tim thắt lại, trong tích tắc… (và các biến thể tương đương).
E. Mỗi NV 1 quirk ngôn ngữ bám Bible — thoại không đồng chất, không “AI lịch sự”.
F. 3–8 giây đầu chương: mâu thuẫn / đe dọa / câu hỏi / hành động — không mở thơ tả cảnh dài.
G. NHỊP ĐỌC: phần lớn câu vừa miệng (thường ≤22 từ), NHƯNG bắt buộc xen vài câu dài hơn để thở — CẤM cả chương toàn câu cắt ngắn đều đều (gây thô cứng).
H. Đủ số từ bằng stakes (lựa chọn, hậu quả, thoại có lực) — không nhồi tính từ / lặp mô tả.
I. Giọng kể liền mạch như người kể chuyện hay, không như bảng việc sản xuất.
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
--- TÂM LÝ KỂ CHUYỆN (NARRATIVE PSYCH — BẮT BUỘC, DỆT VÀO VĂN) ---
Áp dụng NGUYÊN LÝ qua tình tiết/hành động/thoại — như truyện hay, không như checklist marketing.
CẤM chèn slogan SEO (vd. "Đừng bỏ lỡ", "Like Subscribe", template title YouTube).

1) PATTERN INTERRUPT (mở chương + 1–3 câu đầu mỗi cảnh):
   - Vào xung đột / đe dọa / câu hỏi / hành động — có thể bằng 1 chi tiết lạ hoặc 1 câu thoại lệch.
   - CẤM mở thơ phong cảnh (gió-lá-trăng-hoàng hôn) nếu không gắn đe dọa trong 1–2 câu.

2) CURIOSITY GAP (trong cốt):
   - Mỗi cảnh ≥1 mảnh thông tin nhân vật (và người đọc) CHƯA biết; lộ dần, không dump bí mật.

3) OPEN LOOP (tự nhiên, không máy):
   - Cuối cảnh/chương: cắt ở điểm căng (hành động dở, lựa chọn, tiếng động, cánh cửa, câu hỏi).
   - CẤM chốt êm "mọi thứ yên bình / mỉm cười kết thúc" giữa chương (trừ twist giả).
   - Open loop phải là hệ quả của cảnh, không cài máy “và rồi một tiếng động…” lặp lại mỗi cảnh.

4) LOSS / CƯỢC THẬT:
   - Có thứ có thể mất (người, chỗ đứng, lựa chọn, danh dự, thời gian…).
   - Sai lầm → hệ quả hữu hình, không chỉ “hối hận trong lòng”.

5) ESCALATION (nhịp chương, bám Beat + thể loại Setup):
   - Discovery → Confrontation → Crisis (theo Setup, không tự đổi thể loại ngoài Setup) → Insight.
   - Real-time: CẤM time-skip / tóm tắt tuần-tháng.
   - Xen nhịp thở giữa các đỉnh căng — không gào từ đầu đến cuối.

6) SPECIFICITY:
   - Chi tiết đụng tay / đụng tai thay vì nhãn cảm xúc rỗng ("sợ hãi vô cùng").
   - 1–2 chi tiết đắt/cảnh; không liệt kê 5 giác quan.

7) KÉO SANG CẢNH TIẾP:
   - ≥1 câu/hành động khiến muốn đọc tiếp — open loop tình huống, không CTA kênh.`;
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
1. Ưu tiên câu vừa miệng; tách câu >28 từ khi lồng mệnh đề rối — nhưng GIỮ vài câu dài hơn để văn không thô đều.
2. Tránh mệnh đề lồng 3 tầng; nhịp thở tự nhiên (ngắn–vừa–dài xen kẽ).
3. Giữ tên riêng + thông tin cốt lõi; cắt tính từ stack / lặp mô tả.
4. Sau dấu chấm/hỏi/cảm, nghỉ rõ (không dính câu).
5. Không thêm ghi chú đạo diễn; chỉ nội dung kịch bản thuần.
6. Giữ subtext + thoại đời; đừng biến thành checklist hành động.`;
}
