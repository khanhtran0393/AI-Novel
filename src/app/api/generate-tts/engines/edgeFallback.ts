/**
 * NO silent Edge fallback.
 *
 * Previously every failing platform (Vina/Omni/CapCut/Gemini/…) quietly
 * synthesized Edge TTS so the UI looked "ok". That hid broken engines.
 * Callers must surface `reason` to the user so they can fix config.
 *
 * Edge is only valid when the user explicitly selects platform `edge_tts`.
 */
export function pickEdgeVoice(hint: string | undefined | null): string {
  const h = String(hint || '');
  if (/^[a-z]{2}-[A-Z]{2}-.+Neural$/i.test(h) || /Neural$/i.test(h)) {
    return h;
  }
  if (/^en[-_]|_en_|english|jenny|guy|aria/i.test(h)) {
    return /female|nu|nữ|jenny|aria|bella|rachel|nova|shimmer|coral/i.test(h)
      ? 'en-US-JennyNeural'
      : 'en-US-GuyNeural';
  }
  if (/^zh|xiaoxiao|yunxi|chinese/i.test(h)) {
    return /female|nu|nữ|xiao/i.test(h) ? 'zh-CN-XiaoxiaoNeural' : 'zh-CN-YunxiNeural';
  }
  if (/^ja|nanami|keita|japanese/i.test(h)) {
    return /female|nu|nữ|nanami|mayu|aoi/i.test(h) ? 'ja-JP-NanamiNeural' : 'ja-JP-KeitaNeural';
  }
  if (/^ko|sunhi|injoon|korean/i.test(h)) {
    return /female|nu|nữ|sunhi|jimin/i.test(h) ? 'ko-KR-SunHiNeural' : 'ko-KR-InJoonNeural';
  }
  if (/^fr|denise|henri|french/i.test(h)) {
    return /female|nu|nữ|denise|eloise/i.test(h) ? 'fr-FR-DeniseNeural' : 'fr-FR-HenriNeural';
  }
  if (/^de|katja|conrad|german/i.test(h)) {
    return /female|nu|nữ|katja|amala/i.test(h) ? 'de-DE-KatjaNeural' : 'de-DE-ConradNeural';
  }
  const female =
    /female|nu|nữ|my|huyen|huong|mai|hoa|thao|linh|chi|phuong|trinh|bella|rachel|nova|shimmer|coral|jenny|aria|hoaimy/i.test(
      h,
    );
  return female ? 'vi-VN-HoaiMyNeural' : 'vi-VN-NamMinhNeural';
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
