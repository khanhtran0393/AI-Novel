import { createWavHeader, splitTtsText } from '../audioUtils';

export async function generateGeminiTTS(text: string, apiKey: string, voiceName: string): Promise<Buffer> {
  const chunks = splitTtsText(text, 900);
  const pcmBuffers: Buffer[] = [];

  for (const chunk of chunks) {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-tts:generateContent?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: chunk }] }],
        generationConfig: {
          responseModalities: ['AUDIO'],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName },
            },
          },
        },
      }),
    });

    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      throw new Error(errData?.error?.message || `Gemini TTS API error ${response.status}`);
    }

    const data = await response.json();
    const audioBase64 = data?.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
    if (!audioBase64) throw new Error('Gemini TTS API did not return audio data.');
    pcmBuffers.push(Buffer.from(audioBase64, 'base64'));
  }

  const combinedPcm = Buffer.concat(pcmBuffers);
  return Buffer.concat([createWavHeader(combinedPcm.length), combinedPcm]);
}
