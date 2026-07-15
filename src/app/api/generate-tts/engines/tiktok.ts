import fs from 'fs';
import path from 'path';
import { config, createAudioFromText } from 'tiktok-tts';

export async function generateTikTokTTS(text: string, voiceName: string, sessionId: string): Promise<Buffer> {
  if (!sessionId) {
    throw new Error('Bạn chưa cấu hình TikTok Session ID. Vui lòng vào Cài đặt TTS để nhập.');
  }
  
  config(sessionId);
  
  const tempFileName = `temp_tiktok_${Date.now()}_${Math.random().toString(36).substring(7)}`;
  const tempDir = path.join(process.cwd(), 'public', 'audio');
  
  // createAudioFromText tự động thêm '.mp3' vào filename, ta bỏ '.mp3' ra khi truyền path
  const tempPathWithoutExt = path.join(tempDir, tempFileName);
  
  // Chia nhỏ thành các chunks dưới 300 ký tự (TikTok TTS limit là khoảng 300 ký tự)
  const chunks: string[] = [];
  const maxLen = 290;
  let remaining = text;
  while (remaining.length > 0) {
    if (remaining.length <= maxLen) {
      chunks.push(remaining);
      break;
    }
    let cutIndex = remaining.lastIndexOf('.', maxLen);
    if (cutIndex < 50) cutIndex = remaining.lastIndexOf(' ', maxLen);
    if (cutIndex < 50) cutIndex = maxLen;
    chunks.push(remaining.substring(0, cutIndex + 1));
    remaining = remaining.substring(cutIndex + 1).trim();
  }

  const audioBuffers: Buffer[] = [];
  
  for (let i = 0; i < chunks.length; i++) {
    const chunkPathWithoutExt = `${tempPathWithoutExt}_${i}`;
    await createAudioFromText(chunks[i], chunkPathWithoutExt, voiceName);
    
    const actualSavedPath = `${chunkPathWithoutExt}.mp3`;
    if (fs.existsSync(actualSavedPath)) {
      const buffer = fs.readFileSync(actualSavedPath);
      audioBuffers.push(buffer);
      fs.unlinkSync(actualSavedPath);
    } else {
      throw new Error(`TikTok TTS không tạo được file âm thanh cho đoạn ${i}. SessionID có thể đã hết hạn.`);
    }
  }

  return Buffer.concat(audioBuffers);
}

