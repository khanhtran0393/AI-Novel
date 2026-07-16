/**
 * Legacy sample maps removed (IRON B10).
 * VBee / Google "map to Edge sample" was content fallback — hard-fail if still called.
 */

export function mapVbeeSampleVoice(_voiceId: string): never {
  throw new Error(
    'mapVbeeSampleVoice đã gỡ (không fallback Piper/Edge). Platform VBee không còn; chọn engine TTS thật trong Cấu hình giọng.',
  );
}

export function mapGoogleSampleVoice(_voiceId: string): never {
  throw new Error(
    'mapGoogleSampleVoice đã gỡ (không fallback Edge mẫu). Dùng Google Cloud TTS với API key thật, hoặc chọn platform Edge TTS tường minh.',
  );
}
