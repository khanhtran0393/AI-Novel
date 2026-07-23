/**
 * Retention & binge blocks — Wave-Rhythm, Cliffhanger, End-screen prompt hint.
 * Respects scriptMode cold-open policy (no force CẢNH 0 on chuyen_sau).
 */

import {
  getScriptModePacing,
  normalizeScriptMode,
  type ScriptMode,
} from '../scriptMode';

function estMinutes(soTu: number, wpm: number): number {
  const words = Number(soTu);
  const w = Number(wpm);
  if (!Number.isFinite(words) || words <= 0) return 8;
  if (!Number.isFinite(w) || w <= 0) return Math.max(3, words / 140);
  return Math.max(2, words / w);
}

/**
 * Wave-rhythm anchors scaled by estimated spoken length.
 */
export function buildWaveRhythmBlock(opts?: {
  scriptMode?: unknown;
  wpm?: number | null;
  so_tu_chuong?: number | null;
  isContinue?: boolean;
}): string {
  if (opts?.isContinue) return '';
  const mode = normalizeScriptMode(opts?.scriptMode);
  const pacing = getScriptModePacing(mode);
  const wpm = Number(opts?.wpm) > 0 ? Number(opts?.wpm) : pacing.wpm;
  const soTu = Number(opts?.so_tu_chuong) > 0 ? Number(opts?.so_tu_chuong) : 3000;
  const mins = estMinutes(soTu, wpm);

  if (mode === 'short_manhua') {
    return `
--- WAVE-RHYTHM SHORT / MANHUA (giữ AVD) ---
Ước lượng ~${mins.toFixed(1)} phút đọc @${wpm} WPM.
1) 0–3s / CẢNH 0: pattern interrupt (đã có cold-open policy).
2) ~30–40% tập: micro-conflict (nạn / phản diện / fail).
3) ~60–70%: micro-climax (vả mặt / reveal / skill).
4) 15s cuối: cliffhanger (xem khối CLIFFHANGER) — cấm hạ nhiệt êm.
Nhịp sóng dồn: mỗi cảnh 1 stakes; cấm 2 cảnh filler liền.
`.normalize('NFC');
  }

  if (mode === 'sang_van') {
    const t1 = Math.max(1, Math.round(mins * 0.2 * 10) / 10);
    const t2 = Math.max(t1 + 0.5, Math.round(mins * 0.45 * 10) / 10);
    const t3 = Math.max(t2 + 0.5, Math.round(mins * 0.7 * 10) / 10);
    return `
--- WAVE-RHYTHM SẢNG VĂN / RECAP (~${mins.toFixed(1)} phút) ---
Neo nhịp (ước lượng, dệt vào cốt — KHÔNG in timestamp vào prose):
- Đầu: hook / vả mặt (cold-open soft).
- ~${t1}′: micro-conflict.
- ~${t2}′: micro-climax / lật bài.
- ~${t3}′: mystery / báu / thông tin mới.
- Cuối: open loop mạnh (cliffhanger).
Câu ngắn–dồn; mỗi beat dopamine có giá.
`.normalize('NFC');
  }

  // chuyen_sau — softer wave, no trailer cold open
  const a = Math.max(1.5, Math.round(mins * 0.25 * 10) / 10);
  const b = Math.max(a + 1, Math.round(mins * 0.5 * 10) / 10);
  const c = Math.max(b + 1, Math.round(mins * 0.75 * 10) / 10);
  return `
--- WAVE-RHYTHM CHUYÊN SÂU (~${mins.toFixed(1)} phút audio) ---
Không trailer 15s; vẫn CHỐNG TUỘT giữa chừng bằng nhịp sóng cảm xúc:
- Mở [CẢNH 1]: xung đột/câu hỏi (pattern interrupt nhẹ).
- ~${a}′: discovery / complication.
- ~${b}′: confrontation đỉnh vừa.
- ~${c}′: insight / twist logic.
- Cuối chương: open loop (không bắt buộc cliffhanger shock Shorts).
Giữ câu thở; cấm checklist A.B.C.
`.normalize('NFC');
}

export function buildCliffhangerBlock(opts?: {
  scriptMode?: unknown;
  isContinue?: boolean;
}): string {
  if (opts?.isContinue) return '';
  const mode = normalizeScriptMode(opts?.scriptMode);

  if (mode === 'chuyen_sau') {
    return `
--- OPEN LOOP CUỐI CHƯƠNG (chuyên sâu) ---
15–40 từ cuối: câu hỏi / hệ quả / lựa chọn dở dang — mời chương sau.
CẤM spoil toàn bộ twist tập sau; CẤM kết êm “và mọi thứ yên”.
`.normalize('NFC');
  }

  return `
--- CLIFFHANGER ~15s CUỐI (BINGE) ---
Ngắt ở ĐỈNH: nguy cơ chết người / nhân vật khủng xuất hiện / bí mật hé nửa / system fail.
CẤM epilogue êm, CẤM tóm tắt bài học, CẤM “sáng hôm sau yên”.
1–3 câu cuối = hook tập tiếp (đọc ~15s). Có thể gợi “Tập sau…” bằng hành động, không meta YouTube thô trong prose.
`.normalize('NFC');
}

/**
 * End-screen visual prompt (EN) for YouTube packaging — not injected into chapter body.
 */
export function buildEndScreenPromptHint(opts?: {
  genreLabel?: string;
  visualDna?: string;
  nextHook?: string;
}): string {
  const genre = (opts?.genreLabel || 'story series').normalize('NFC');
  const dna = (opts?.visualDna || 'cinematic dark grade, readable faces').normalize('NFC');
  const hook = (opts?.nextHook || 'next episode danger silhouette').normalize('NFC');
  return (
    `YouTube end screen 5s still, 16:9, dark cinematic UI: ` +
    `left 40% blurred next-video thumbnail tease (${hook}), ` +
    `right subscribe + bell + playlist end-cards empty frames, ` +
    `genre mood ${genre}, visual ${dna.slice(0, 120)}, ` +
    `no baked long title text, high contrast, mobile readable`
  ).normalize('NFC');
}

export function retentionModeLabel(mode?: unknown): ScriptMode {
  return normalizeScriptMode(mode);
}
