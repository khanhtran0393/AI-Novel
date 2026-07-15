
export async function generateGoogleCloudTts(
  text: string,
  voiceName: string,
  apiKey: string,
  speed: number,
  pitchSemitones: number = 0,
): Promise<Buffer> {
  // REST: texttospeech.googleapis.com — cần API key bật Cloud Text-to-Speech
  const lang = voiceName.startsWith('en-')
    ? 'en-US'
    : voiceName.startsWith('fr-')
      ? 'fr-FR'
      : 'vi-VN';
  const speakingRate = Math.max(0.25, Math.min(4, speed || 1));
  // Google pitch is in semitones already (-20…20)
  const pitch = Math.max(
    -20,
    Math.min(20, Number.isFinite(pitchSemitones) ? pitchSemitones : 0),
  );
  const url = `https://texttospeech.googleapis.com/v1/text:synthesize?key=${encodeURIComponent(apiKey)}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      input: { text },
      voice: { languageCode: lang, name: voiceName },
      audioConfig: { audioEncoding: 'MP3', speakingRate, pitch },
    }),
    signal: AbortSignal.timeout(30_000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data?.audioContent) {
    throw new Error(
      data?.error?.message || `Google Cloud TTS HTTP ${res.status}`,
    );
  }
  return Buffer.from(data.audioContent, 'base64');
}
