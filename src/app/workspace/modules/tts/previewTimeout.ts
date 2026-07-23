/**
 * UI AbortController budget for "Nghe thử".
 * Must exceed server-side provider budget + network + post-process, or the client
 * aborts a still-healthy synth and the user hears nothing.
 *
 * Active platforms only (see `@/lib/tts/activePlatforms`).
 *
 * Edge engine: timeouts [55s, 70s, 90s] sequential → worst-case ~220s.
 * Vina daemon: up to ~240s cold ONNX.
 * OmniVoice: cold model load can exceed 3 min.
 */
export function ttsPreviewTimeoutMs(platform: string): number {
  const p = String(platform || '')
    .trim()
    .toLowerCase();
  switch (p) {
    case 'vina_voice':
      return 270_000;
    case 'omnivoice_local':
      return 360_000;
    case 'la_studio':
      return 320_000;
    case 'edge_tts':
      // Covers full Edge retry ladder (55+70+90) + margin — was 25s (too short).
      return 240_000;
    case 'piper':
      return 90_000;
    case 'capcut_tts':
    case 'tiktok_tts':
      return 90_000;
    case 'gemini_tts':
      return 60_000;
    default:
      return 90_000;
  }
}
