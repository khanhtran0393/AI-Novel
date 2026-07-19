/** UI abort budget must exceed the server-side engine budget plus post-processing. */
export function ttsPreviewTimeoutMs(platform: string): number {
  if (platform === 'vina_voice') return 270_000;
  if (platform === 'omnivoice_local') return 180_000;
  if (platform === 'gemini_tts') return 35_000;
  return 25_000;
}
