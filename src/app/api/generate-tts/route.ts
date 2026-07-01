import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

export const runtime = 'nodejs';

// Hàm tạo WAV header cho dữ liệu PCM thô từ Gemini TTS API
function createWavHeader(dataLength: number, sampleRate: number = 24000, numChannels: number = 1, bitsPerSample: number = 16): Buffer {
  const byteRate = (sampleRate * numChannels * bitsPerSample) / 8;
  const blockAlign = (numChannels * bitsPerSample) / 8;
  const header = Buffer.alloc(44);

  header.write('RIFF', 0);
  header.writeUInt32LE(36 + dataLength, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);            // PCM chunk size
  header.writeUInt16LE(1, 20);             // PCM format
  header.writeUInt16LE(numChannels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write('data', 36);
  header.writeUInt32LE(dataLength, 40);

  return header;
}

// Hàm dọn dẹp kịch bản (lọc bỏ âm thanh, hành động, định dạng)
function cleanVoiceScript(text: string): string {
  let cleaned = text;
  cleaned = cleaned.replace(/\[?CẢNH\s+\d+:[^\]\n]+\]?/gi, '');
  cleaned = cleaned.replace(/CẢNH\s+\d+:\s*[^\n]+/gi, '');
  cleaned = cleaned.replace(/\([^)]*\)/g, '');
  cleaned = cleaned.replace(/\[[^\]]*\]/g, '');
  cleaned = cleaned.replace(/[\*\_\`#]/g, '');
  cleaned = cleaned.replace(/^[a-zA-ZÀ-ỹ\s\d\-]+:/gm, '');
  cleaned = cleaned.replace(/^[a-zA-ZÀ-ỹ\s\d\-]+\([^)]*\):/gm, '');

  return cleaned.split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0)
    .join('\n\n')
    .trim();
}

// Đếm từ (server-side)
function getWordCount(text: string): number {
  if (!text) return 0;
  const cleaned = text.normalize('NFC').replace(/\[[^\]]*\]/g, '').trim();
  if (!cleaned) return 0;
  return cleaned.split(/\s+/).filter(Boolean).length;
}

// CHẾ ĐỘ 1: Sinh giọng đọc bằng Gemini TTS API (gemini-2.5-flash-preview-tts)
async function generateGeminiTTS(text: string, apiKey: string, voiceName: string = 'Kore'): Promise<Buffer> {
  // Chia nhỏ văn bản thành các phân đoạn tối đa 3000 ký tự
  const chunks: string[] = [];
  const maxLen = 3000;
  let remaining = text;
  while (remaining.length > 0) {
    if (remaining.length <= maxLen) {
      chunks.push(remaining);
      break;
    }
    let cutIndex = remaining.lastIndexOf('.', maxLen);
    if (cutIndex < 500) cutIndex = remaining.lastIndexOf(' ', maxLen);
    if (cutIndex < 500) cutIndex = maxLen;
    chunks.push(remaining.substring(0, cutIndex + 1));
    remaining = remaining.substring(cutIndex + 1).trim();
  }

  const pcmBuffers: Buffer[] = [];
  for (const chunk of chunks) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-tts:generateContent?key=${apiKey}`;
    
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          role: 'user',
          parts: [{ text: `Đọc rõ ràng, truyền cảm, giọng kể chuyện tiếng Việt:\n${chunk}` }]
        }],
        generationConfig: {
          responseModalities: ['AUDIO'],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName }
            }
          }
        }
      })
    });

    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      const errMsg = errData?.error?.message || `HTTP ${response.status}`;
      throw new Error(`Gemini TTS API lỗi: ${errMsg}`);
    }

    const data = await response.json();
    
    // Trích xuất base64 PCM audio
    const audioBase64 = data?.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
    if (!audioBase64) {
      throw new Error('Gemini TTS API không trả về dữ liệu âm thanh.');
    }

    pcmBuffers.push(Buffer.from(audioBase64, 'base64'));
  }

  const combinedPcm = Buffer.concat(pcmBuffers);
  const wavHeader = createWavHeader(combinedPcm.length, 24000, 1, 16);
  return Buffer.concat([wavHeader, combinedPcm]);
}

// CHẾ ĐỘ 2: Fallback - Google Translate TTS miễn phí (chỉ 1 giọng nữ tiếng Việt)
async function generateGoogleTranslateTTS(text: string): Promise<Buffer> {
  // Google Translate TTS cho tối đa ~200 ký tự mỗi request
  const chunks: string[] = [];
  const maxLen = 190;
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
  for (const chunk of chunks) {
    const url = `https://translate.google.com/translate_tts?ie=UTF-8&tl=vi&client=tw-ob&q=${encodeURIComponent(chunk)}`;
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }
    });

    if (!response.ok) {
      throw new Error('Không thể sinh giọng đọc từ Google Translate TTS.');
    }

    const arrayBuffer = await response.arrayBuffer();
    audioBuffers.push(Buffer.from(arrayBuffer));
  }

  return Buffer.concat(audioBuffers);
}

// CHẾ ĐỘ 3: Sinh giọng đọc bằng Edge-TTS (Microsoft)
async function generateEdgeTTS(text: string, voiceName: string, speed: number = 1.0): Promise<Buffer> {
  const { EdgeTTS } = require('node-edge-tts');
  // Chuyển đổi speed (0.5 -> -50%, 1.5 -> +50%)
  const ratePercent = Math.round((speed - 1.0) * 100);
  const rateStr = ratePercent >= 0 ? `+${ratePercent}%` : `${ratePercent}%`;

  const tts = new EdgeTTS({
    voice: voiceName,
    lang: 'vi-VN',
    outputFormat: 'audio-24khz-48kbitrate-mono-mp3',
    rate: rateStr
  });
  
  const tempPath = path.join(process.cwd(), 'public', 'audio', `temp_edge_${Date.now()}_${Math.random().toString(36).substring(7)}.mp3`);
  
  await tts.ttsPromise(text, tempPath);
  
  const buffer = fs.readFileSync(tempPath);
  fs.unlinkSync(tempPath); // Dọn dẹp
  return buffer;
}

// CHẾ ĐỘ 4: Sinh giọng đọc bằng TikTok TTS
async function generateTikTokTTS(text: string, voiceName: string, sessionId: string): Promise<Buffer> {
  const { config, createAudioFromText } = require('tiktok-tts');
  if (!sessionId) {
    throw new Error('Bạn chưa cấu hình TikTok Session ID. Vui lòng vào Cài đặt TTS để nhập.');
  }
  
  config(sessionId);
  
  const tempFileName = `temp_tiktok_${Date.now()}_${Math.random().toString(36).substring(7)}`;
  const tempDir = path.join(process.cwd(), 'public', 'audio');
  const tempPathFull = path.join(tempDir, `${tempFileName}.mp3`);
  
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

// CHẾ ĐỘ 5: Sinh giọng đọc bằng CapCut TTS API
async function generateCapCutTTS(text: string, voiceId: string): Promise<Buffer> {
  const { execSync } = require('child_process');
  
  // Sửa config.py của CapCut API bằng Node.js trước khi chạy
  const capcutDir = path.join(process.cwd(), 'src', 'app', 'api', 'generate-tts', 'capcut_api', 'capcut_windows');
  const configPath = path.join(capcutDir, 'config.py');
  
  if (fs.existsSync(configPath)) {
    let configContent = fs.readFileSync(configPath, 'utf8');
    // Regex replace VOICE_RESOURCE_ID or VOICE_NAME
    configContent = configContent.replace(/VOICE_RESOURCE_ID\s*=\s*['"][^'"]*['"]/, `VOICE_RESOURCE_ID = "${voiceId}"`);
    configContent = configContent.replace(/VOICE_NAME\s*=\s*['"][^'"]*['"]/, `VOICE_NAME = "Giọng CapCut"`);
    fs.writeFileSync(configPath, configContent);
  } else {
    throw new Error('Không tìm thấy config.py của CapCut TTS API.');
  }

  // Chạy python script
  try {
    const output = execSync(`python capcut_tts_ctypes.py "${text}"`, { cwd: capcutDir, encoding: 'utf8', stdio: 'pipe' });
    
    // Parse Audio URL từ stdout
    const urlMatch = output.match(/Audio URL:\s*(https?:\/\/[^\s]+)/);
    if (urlMatch && urlMatch[1]) {
      const audioUrl = urlMatch[1];
      const res = await fetch(audioUrl);
      if (!res.ok) throw new Error('Không thể tải file âm thanh từ CapCut.');
      const arrayBuffer = await res.arrayBuffer();
      return Buffer.from(arrayBuffer);
    } else {
      throw new Error('CapCut TTS API không trả về URL âm thanh hợp lệ.');
    }
  } catch (error: any) {
    throw new Error(`CapCut TTS thất bại: ${error.message || error.stdout || error.stderr}`);
  }
}

// CHẾ ĐỘ 6: Sinh giọng đọc bằng VieNeu-TTS
async function generateVieNeuTTS(text: string, voiceName: string, apiBaseUrl: string): Promise<Buffer> {
  // Lọc baseUrl, xoá bỏ /v1 nếu có vì openai spec thường thêm /audio/speech
  const baseUrl = apiBaseUrl.replace(/\/v1\/?$/, '');
  
  const response = await fetch(`${baseUrl}/v1/audio/speech`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'pnnbao-ump/VieNeu-TTS-v2', // Hoặc v3 tuỳ server
      input: text,
      voice: voiceName,
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

// Hàm xử lý Pitch (Cao độ / Độ trầm) bằng FFmpeg
async function applyAudioPitch(inputBuffer: Buffer, pitchSemitones: number): Promise<Buffer> {
  if (!pitchSemitones || pitchSemitones === 0) return inputBuffer;
  
  const ffmpeg = require('fluent-ffmpeg');
  
  // Lưu buffer ra file tạm
  const tempIn = path.join(process.cwd(), 'public', 'audio', `temp_in_${Date.now()}_${Math.random().toString(36).substring(7)}.mp3`);
  const tempOut = path.join(process.cwd(), 'public', 'audio', `temp_out_${Date.now()}_${Math.random().toString(36).substring(7)}.mp3`);
  
  fs.writeFileSync(tempIn, inputBuffer);
  
  // Công thức đổi từ Semitone sang Rate (Pitch Shift = 2^(semitones/12))
  // Tuy nhiên, filter asetrate làm đổi tốc độ. Nếu muốn giữ nguyên tốc độ, phải dùng atempo ngược lại.
  // Ví dụ pitch = 2 semitone -> rate = 2^(2/12) = 1.12246
  // asetrate = 44100 * 1.12246 = 49500
  // atempo = 1 / 1.12246 = 0.8908
  
  const rateFactor = Math.pow(2, pitchSemitones / 12);
  const newSampleRate = Math.round(44100 * rateFactor);
  const tempoCorrection = 1 / rateFactor;

  return new Promise((resolve, reject) => {
    ffmpeg(tempIn)
      .audioFilters([
        `asetrate=${newSampleRate}`,
        `atempo=${tempoCorrection}`
      ])
      .on('end', () => {
        const outBuffer = fs.readFileSync(tempOut);
        fs.unlinkSync(tempIn);
        fs.unlinkSync(tempOut);
        resolve(outBuffer);
      })
      .on('error', (err: any) => {
        if (fs.existsSync(tempIn)) fs.unlinkSync(tempIn);
        if (fs.existsSync(tempOut)) fs.unlinkSync(tempOut);
        console.error('Lỗi FFmpeg Pitch:', err);
        // Fallback về audio gốc nếu FFmpeg lỗi
        resolve(inputBuffer); 
      })
      .save(tempOut);
  });
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { sceneText, chapterNum, sceneIndex, drivePath, voiceName, apiKeys, ten_tac_pham, ttsConfig } = body;

    if (!sceneText) {
      return NextResponse.json({ error: 'Nội dung phân cảnh rỗng.' }, { status: 400 });
    }

    const cleanText = cleanVoiceScript(sceneText);
    if (!cleanText) {
      return NextResponse.json({ error: 'Không có lời thoại nào khả dụng sau khi lọc kịch bản sạch.' }, { status: 400 });
    }

    // Thiết lập đường dẫn lưu trữ
    const publicAudioDir = path.join(process.cwd(), 'public', 'audio');
    if (!fs.existsSync(publicAudioDir)) {
      fs.mkdirSync(publicAudioDir, { recursive: true });
    }

    let audioBuffer: Buffer | null = null;
    let methodUsed = 'Google Translate TTS';
    
    // Nếu ttsConfig có truyền vào, lấy config ra, nếu không thì lấy giá trị mặc định
    const platform = ttsConfig?.platform || 'google';
    const voice = voiceName || ttsConfig?.voice || 'Kore';
    const speed = ttsConfig?.speed || 1.0;
    const pitch = ttsConfig?.pitch || 0;
    const tiktokSessionId = ttsConfig?.tiktokSessionId || '';
    const api_url_vieneu = ttsConfig?.api_url_vieneu || 'http://localhost:23333/v1';
    
    const isVbee = voice.startsWith('VBEE_') || platform === 'vbee' || platform === 'elevenlabs';

    if (platform === 'capcut_tts') {
      console.log(`[TTS CapCut] Đang sinh giọng "${voice}" bằng CapCut API...`);
      try {
        audioBuffer = await generateCapCutTTS(cleanText, voice);
        methodUsed = `CapCut TTS (${voice})`;
        console.log(`[TTS CapCut] Thành công! Voice: ${voice}`);
      } catch (err: any) {
        console.warn(`[TTS CapCut] Lỗi: ${err.message}`);
      }
    } else if (platform === 'vieneu_tts') {
      console.log(`[TTS VieNeu] Đang sinh giọng "${voice}" bằng VieNeu-TTS...`);
      try {
        audioBuffer = await generateVieNeuTTS(cleanText, voice, api_url_vieneu);
        methodUsed = `VieNeu TTS (${voice})`;
        console.log(`[TTS VieNeu] Thành công! Voice: ${voice}`);
      } catch (err: any) {
        console.warn(`[TTS VieNeu] Lỗi: ${err.message}`);
      }
    } else if (platform === 'tiktok_tts') {
      console.log(`[TTS TikTok] Đang sinh giọng "${voice}" bằng TikTok TTS API...`);
      try {
        audioBuffer = await generateTikTokTTS(cleanText, voice, tiktokSessionId);
        methodUsed = `TikTok TTS (${voice})`;
        console.log(`[TTS TikTok] Thành công! Voice: ${voice}`);
      } catch (err: any) {
        console.warn(`[TTS TikTok] Lỗi: ${err.message}`);
        // Nếu lỗi, sẽ rơi xuống fallback
      }
    } else if (platform === 'edge_tts') {
      console.log(`[TTS Edge] Đang sinh giọng "${voice}" bằng Microsoft Edge TTS...`);
      try {
        audioBuffer = await generateEdgeTTS(cleanText, voice, speed);
        methodUsed = `Edge TTS (${voice})`;
        console.log(`[TTS Edge] Thành công! Voice: ${voice}`);
      } catch (err: any) {
        console.warn(`[TTS Edge] Lỗi: ${err.message}`);
        // Nếu lỗi, sẽ rơi xuống fallback
      }
    } else if (isVbee) {
      console.log(`[TTS Premium] Giả lập gọi API VBee / ElevenLabs cho giọng: ${voice}...`);
      try {
        // Thực tế sẽ gọi API VBee tại đây bằng fetch(https://iam.vbee.vn/api/v1/tts)
        // Hiện tại dùng tạm Google Translate để mock output
        audioBuffer = await generateGoogleTranslateTTS(cleanText);
        methodUsed = `Premium TTS (${voice})`;
        console.log(`[TTS Premium] Thành công! Voice: ${voice}`);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } catch (err: any) {
        console.warn(`[TTS Premium] Lỗi VBee: ${err.message}`);
      }
    } else {
      // --- BƯỚC 1: THỬ GEMINI TTS API (nếu có API Key và platform là google hoặc default) ---
      const keys: string[] = Array.isArray(apiKeys) ? apiKeys : [];
      for (const key of keys) {
        if (!key || key.trim().length === 0) continue;
        try {
          console.log(`[TTS Gemini] Đang sinh giọng "${voice}" bằng Gemini TTS API...`);
          audioBuffer = await generateGeminiTTS(cleanText, key.trim(), voice);
          methodUsed = `Gemini TTS (${voice})`;
          console.log(`[TTS Gemini] Thành công! Voice: ${voice}, Size: ${audioBuffer.length} bytes`);
          break;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } catch (geminiErr: any) {
          console.warn(`[TTS Gemini] Lỗi với key ${key.substring(0, 10)}...: ${geminiErr.message}`);
        }
      }
    }

    // --- BƯỚC 2: FALLBACK GOOGLE TRANSLATE TTS ---
    if (!audioBuffer) {
      console.log(`[TTS Service] Sử dụng Google Translate TTS dự phòng...`);
      try {
        audioBuffer = await generateGoogleTranslateTTS(cleanText);
        methodUsed = 'Google Translate TTS';
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } catch (fallbackErr: any) {
        return NextResponse.json(
          { error: `Không thể sinh giọng đọc: ${fallbackErr.message}` },
          { status: 500 }
        );
      }
    }

    // --- BƯỚC XỬ LÝ PITCH (FFMPEG) ---
    // NẾU không phải Edge-TTS (vì Edge có sẵn pitch, nhưng mà ở trên chưa implement pitch cho edge-tts, nên ta apply chung cho tất cả nếu pitch != 0)
    if (audioBuffer && pitch !== 0) {
      console.log(`[TTS Pitch] Đang áp dụng thay đổi cao độ (pitch): ${pitch > 0 ? '+' : ''}${pitch} semitones...`);
      try {
        audioBuffer = await applyAudioPitch(audioBuffer, pitch);
        console.log(`[TTS Pitch] Thành công!`);
      } catch (pitchErr: any) {
        console.warn(`[TTS Pitch] Lỗi khi apply pitch: ${pitchErr.message}`);
      }
    }

    // Lưu trữ tệp âm thanh cục bộ
    const isGemini = methodUsed.includes('Gemini');
    const filename = `chapter_${chapterNum}_scene_${sceneIndex}.${isGemini ? 'wav' : 'mp3'}`;
    const localSavePath = path.join(publicAudioDir, filename);
    fs.writeFileSync(localSavePath, audioBuffer);

    // --- BƯỚC 3: LƯU GOOGLE DRIVE (NẾU CÓ) ---
    let driveSaved = false;
    let driveFilePath = '';
    
    if (drivePath && drivePath.trim().length > 0) {
      try {
        const cleanedDrivePath = drivePath.trim();
        let driveFolder = cleanedDrivePath;
        if (chapterNum > 0) {
          driveFolder = path.join(cleanedDrivePath, `Chương ${chapterNum}`);
        }
        if (!fs.existsSync(driveFolder)) {
          fs.mkdirSync(driveFolder, { recursive: true });
        }
          
          const scriptTitle = ten_tac_pham 
            ? ten_tac_pham.replace(/[\/\\:\*\?"<>\|]/g, '_').trim() 
            : 'Kịch Bản';
          const driveFilename = `${scriptTitle}_Chuong_${chapterNum}_Canh_${sceneIndex}.${isGemini ? 'wav' : 'mp3'}`;
          
          driveFilePath = path.join(driveFolder, driveFilename);
          fs.writeFileSync(driveFilePath, audioBuffer);
          driveSaved = true;
          console.log(`[Drive Service] Đã lưu âm thanh với tên kịch bản: ${driveFilePath}`);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } catch (driveErr: any) {
        console.error(`[Drive Service] Lỗi lưu Drive:`, driveErr.message);
      }
    }

    // Tính duration chính xác từ kích thước PCM (24000 Hz * 2 bytes = 48000 bytes/giây)
    let calculatedDuration = Math.max(5, Math.round(getWordCount(cleanText) / 2.5));
    if (isGemini && audioBuffer.length > 44) {
      calculatedDuration = Math.max(5, Math.round((audioBuffer.length - 44) / 48000));
    }

    return NextResponse.json({
      success: true,
      audioPath: `/audio/${filename}`,
      method: methodUsed,
      voice,
      duration: calculatedDuration,
      driveSaved,
      driveFilePath,
      filename
    });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    console.error('Lỗi API Generate TTS:', err);
    return NextResponse.json(
      { error: err.message || 'Lỗi xảy ra trong quá trình sản xuất giọng nói TTS.' },
      { status: 500 }
    );
  }
}
