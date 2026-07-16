/**
 * NO silent Edge fallback.
 *
 * Previously every failing platform (Vina/Omni/CapCut/Gemini/…) quietly
 * synthesized Edge TTS so the UI looked "ok". That hid broken engines.
 * Callers must surface `reason` to the user so they can fix config.
 *
 * Edge is only valid when the user explicitly selects platform `edge_tts`.
 */
/** @deprecated IRON B10 — không map giọng dự phòng */
export function pickEdgeVoice(hint: string | undefined | null): string {
  const h = String(hint || '').trim();
  if (!h) {
    throw new Error('pickEdgeVoice: thiếu voice hint. Không gán giọng mặc định dự phòng.');
  }
  // Chỉ chấp nhận id đã là Edge Neural tường minh
  if (/^[a-z]{2}-[A-Z]{2}-.+Neural$/i.test(h) || /Neural$/i.test(h)) {
    return h;
  }
  throw new Error(
    `pickEdgeVoice: "${h}" không phải Edge Neural id. Không map sang giọng khác. Chọn voice tường minh.`,
  );
}

/**
 * Hard-fail helper — name kept for call-site compatibility.
 * Never generates Edge audio when another platform was requested.
 */
export async function edgeFallbackAudio(
  _text: string,
  opts: {
    voiceHint?: string;
    speed?: number;
    pitch?: number;
    reason: string;
  },
): Promise<never> {
  const reason = String(opts.reason || 'unknown').slice(0, 240);
  throw new Error(
    `TTS_NO_SILENT_FALLBACK: Engine đã chọn thất bại — không chuyển Edge ngầm. ` +
      `Lý do: ${reason}. ` +
      `Sửa engine/key/session/model, hoặc chọn platform Edge TTS thủ công trong «Cấu hình giọng đọc».`,
  );
}
