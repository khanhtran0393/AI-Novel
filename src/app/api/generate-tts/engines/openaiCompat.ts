
export async function generateOpenAICompatibleTTS(text: string, voiceName: string, speed: number, pitch: number, apiBaseUrl: string, apiKey: string, model: string): Promise<Buffer> {
  const baseUrl = apiBaseUrl.replace(/\/v1\/?$/, '');
  
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (apiKey) {
    headers['Authorization'] = `Bearer ${apiKey}`;
  }

  const payload: any = {
    model: model,
    input: text,
    voice: voiceName,
    speed: speed || 1.0,
    response_format: 'mp3'
  };

  // Chỉ thêm pitch nếu API hỗ trợ (Ví dụ: OmniVoice server tuỳ chỉnh của ta)
  if (pitch !== 0 && apiBaseUrl.includes('localhost')) {
    payload.pitch = pitch;
  }

  const response = await fetch(`${baseUrl}/v1/audio/speech`, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Lỗi OpenAI Compatible API (${baseUrl}): ${response.status} - ${errText}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}
