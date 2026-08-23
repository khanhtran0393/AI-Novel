import {
  GEMINI_INTERACTIONS_ENDPOINT,
  GEMINI_TTS_MODEL,
} from '@/lib/geminiModels';

export async function generateGeminiTtsPcmChunk(
  text: string,
  apiKey: string,
  voiceName: string,
): Promise<Buffer> {
  const response = await fetch(
    GEMINI_INTERACTIONS_ENDPOINT,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey,
      },
      body: JSON.stringify({
        model: GEMINI_TTS_MODEL,
        input: text,
        response_format: { type: 'audio' },
        generation_config: {
          speech_config: [{ voice: voiceName }],
        },
      }),
    },
  );

  if (!response.ok) {
    const errData = await response.json().catch(() => ({}));
    throw Object.assign(
      new Error(
        errData?.error?.message || `Gemini TTS API error ${response.status}`,
      ),
      { providerStatus: response.status },
    );
  }

  const data = await response.json();
  const audioBase64 = data?.output_audio?.data;
  if (!audioBase64) {
    throw Object.assign(
      new Error('Gemini TTS API did not return audio data.'),
      { providerStatus: 502 },
    );
  }
  return Buffer.from(audioBase64, 'base64');
}
