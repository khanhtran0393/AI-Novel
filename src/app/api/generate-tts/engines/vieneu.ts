
export async function generateVieNeuTTS(text: string, voiceName: string, speed: number, pitch: number, apiBaseUrl: string): Promise<Buffer> {
  // Lọc baseUrl, xoá bỏ /v1 nếu có vì openai spec thường thêm /audio/speech
  const baseUrl = apiBaseUrl.replace(/\/v1\/?$/, '');
  
  const response = await fetch(`${baseUrl}/v1/audio/speech`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'pnnbao-ump/VieNeu-TTS-v2', // Hoặc v3 tuỳ server
      input: text,
      voice: voiceName,
      speed: speed,
      pitch: pitch,
      response_format: 'wav'
    })
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Lỗi VieNeu-TTS API: ${response.status} - ${errText}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

