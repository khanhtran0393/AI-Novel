import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { EdgeTTS } from 'node-edge-tts';
import { config, createAudioFromText } from 'tiktok-tts';

export const dynamic = 'force-dynamic';

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

// CHẾ ĐỘ 7: Sinh giọng đọc bằng Piper TTS (Local AI)
async function generatePiperTTS(text: string, voice: string, speed: number = 1.0): Promise<Buffer> {
  const piperExe = path.join(process.cwd(), 'bin', 'piper', 'piper.exe');
  if (!fs.existsSync(piperExe)) {
    throw new Error(`Không tìm thấy Piper tại ${piperExe}`);
  }

  const modelPath = path.join(process.cwd(), 'bin', 'piper_vn', voice);
  if (!fs.existsSync(modelPath)) {
    throw new Error(`Không tìm thấy Model Piper tại ${modelPath}`);
  }

  const tempTextFile = path.join(process.cwd(), 'bin', 'piper', `temp_${Date.now()}_${Math.random().toString(36).substring(7)}.txt`);
  const tempWavFile = path.join(process.cwd(), 'bin', 'piper', `temp_${Date.now()}_${Math.random().toString(36).substring(7)}.wav`);

  try {
    fs.writeFileSync(tempTextFile, text, 'utf8');
    const lengthScale = (1.0 / speed).toFixed(3);
    const command = `"${piperExe}" -m "${modelPath}" --length_scale ${lengthScale} -f "${tempWavFile}" < "${tempTextFile}"`;
    execSync(command, { encoding: 'utf-8', stdio: 'pipe' });

    if (!fs.existsSync(tempWavFile)) {
      throw new Error('Piper chạy xong nhưng không sinh ra file WAV.');
    }

    return fs.readFileSync(tempWavFile);
  } finally {
    if (fs.existsSync(tempTextFile)) fs.unlinkSync(tempTextFile);
    if (fs.existsSync(tempWavFile)) fs.unlinkSync(tempWavFile);
  }
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
async function generateEdgeTTS(text: string, voiceName: string, speed: number = 1.0, pitch: number = 0): Promise<Buffer> {
  const options: any = {
    voice: voiceName,
    lang: 'vi-VN',
    outputFormat: 'audio-24khz-48kbitrate-mono-mp3'
  };

  const tts = new EdgeTTS(options);
  
  const tempPath = path.join(process.cwd(), 'public', 'audio', `temp_edge_${Date.now()}_${Math.random().toString(36).substring(7)}.mp3`);
  
  await tts.ttsPromise(text, tempPath);
  
  const buffer = fs.readFileSync(tempPath);
  fs.unlinkSync(tempPath); // Dọn dẹp
  return buffer;
}

// CHẾ ĐỘ 4: Sinh giọng đọc bằng TikTok TTS
async function generateTikTokTTS(text: string, voiceName: string, sessionId: string): Promise<Buffer> {
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

// CHẾ ĐỘ 5: Sinh giọng đọc bằng CapCut TTS API
async function generateCapCutTTS(text: string, voiceId: string): Promise<Buffer> {
  
  // Sửa config.py của CapCut API bằng Node.js trước khi chạy
  const capcutDir = path.join(process.cwd(), 'src', 'app', 'api', 'generate-tts', 'capcut_api', 'capcut_windows');
  const configPath = path.join(capcutDir, 'config.py');
  
  if (fs.existsSync(configPath)) {
    let configContent = fs.readFileSync(configPath, 'utf8');
    // Regex replace VOICE_RESOURCE_ID or VOICE_NAME
    configContent = configContent.replace(/VOICE_RESOURCE_ID\s*=\s*['"][^'"]*['"]/, `VOICE_RESOURCE_ID = "${voiceId}"`);
    configContent = configContent.replace(/VOICE_NAME\s*=\s*['"][^'"]*['"]/, `VOICE_NAME = "Giọng CapCut"`);
    
    // Tự động dò tìm thư mục CapCut để lấy sscronet.dll
    const localAppData = process.env.LOCALAPPDATA || path.join(process.env.USERPROFILE || '', 'AppData', 'Local');
    const capcutAppsDir = path.join(localAppData, 'CapCut', 'Apps');
    if (fs.existsSync(capcutAppsDir)) {
      const versions = fs.readdirSync(capcutAppsDir).filter(f => fs.statSync(path.join(capcutAppsDir, f)).isDirectory());
      versions.sort((a, b) => b.localeCompare(a, undefined, { numeric: true })); // Lấy bản mới nhất
      for (const v of versions) {
         const dllPath = path.join(capcutAppsDir, v, 'sscronet.dll');
         if (fs.existsSync(dllPath)) {
            // Cập nhật đường dẫn DLL
            configContent = configContent.replace(/SSCRONET_DLL\s*=\s*r?['"][^'"]*['"]/, `SSCRONET_DLL = r"${dllPath.replace(/\\/g, '\\\\')}"`);
            break;
         }
      }
    }

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
  } catch (error: unknown) {
    throw new Error(`CapCut TTS thất bại: ${(error as Error).message}`);
  }
}

// CHẾ ĐỘ 6: Sinh giọng đọc bằng VieNeu-TTS
async function generateVieNeuTTS(text: string, voiceName: string, speed: number, pitch: number, apiBaseUrl: string): Promise<Buffer> {
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

// CHẾ ĐỘ MỚI: Sinh giọng đọc bằng OpenAI Compatible API (OmniVoice, Hotai, OpenAI)
async function generateOpenAICompatibleTTS(text: string, voiceName: string, speed: number, pitch: number, apiBaseUrl: string, apiKey: string, model: string): Promise<Buffer> {
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

// Hàm xử lý Pitch (Cao độ) và Speed bằng FFmpeg
async function applyAudioEffects(inputBuffer: Buffer, pitchSemitones: number, speedFactor: number): Promise<Buffer> {
  if (pitchSemitones === 0 && speedFactor === 1.0) return inputBuffer;
  
  const tempIn = path.join(process.cwd(), 'public', 'audio', `temp_in_${Date.now()}_${Math.random().toString(36).substring(7)}.mp3`);
  const tempOut = path.join(process.cwd(), 'public', 'audio', `temp_out_${Date.now()}_${Math.random().toString(36).substring(7)}.mp3`);
  
  fs.writeFileSync(tempIn, inputBuffer);
  
  const filters: string[] = [];
  
  if (pitchSemitones !== 0) {
    const rateFactor = Math.pow(2, pitchSemitones / 12);
    const newSampleRate = Math.round(44100 * rateFactor);
    let tempo = (1 / rateFactor) * speedFactor;
    
    filters.push('aresample=44100');
    filters.push(`asetrate=${newSampleRate}`);
    
    while (tempo > 2.0) { filters.push('atempo=2.0'); tempo /= 2.0; }
    while (tempo < 0.5) { filters.push('atempo=0.5'); tempo /= 0.5; }
    if (tempo !== 1.0) filters.push(`atempo=${tempo}`);
  } else {
    let tempo = speedFactor;
    while (tempo > 2.0) { filters.push('atempo=2.0'); tempo /= 2.0; }
    while (tempo < 0.5) { filters.push('atempo=0.5'); tempo /= 0.5; }
    if (tempo !== 1.0) filters.push(`atempo=${tempo}`);
  }

  return new Promise((resolve) => {
    try {
      const filterStr = filters.join(',');
      let ffmpegCmd = 'ffmpeg';
      const localFfmpeg = path.join(process.cwd(), 'bin', 'ffmpeg.exe');
      if (fs.existsSync(localFfmpeg)) {
        ffmpegCmd = `"${localFfmpeg}"`;
      }
      
      const command = `${ffmpegCmd} -i "${tempIn}" -af "${filterStr}" -y "${tempOut}"`;
      execSync(command, { encoding: 'utf-8', stdio: 'pipe' });
      
      const outBuffer = fs.readFileSync(tempOut);
      fs.unlinkSync(tempIn);
      fs.unlinkSync(tempOut);
      resolve(outBuffer);
    } catch (err: unknown) {
      if (fs.existsSync(tempIn)) fs.unlinkSync(tempIn);
      if (fs.existsSync(tempOut)) fs.unlinkSync(tempOut);
      console.error('Lỗi FFmpeg Effects (execSync):', err);
      resolve(inputBuffer); 
    }
  });
}

// Hàm ép khớp Timestamp (Ép thời lượng âm thanh)
async function forceAudioDuration(inputBuffer: Buffer, targetDuration: number): Promise<Buffer> {
  const tempIn = path.join(process.cwd(), 'public', 'audio', `temp_force_in_${Date.now()}_${Math.random().toString(36).substring(7)}.mp3`);
  const tempOut = path.join(process.cwd(), 'public', 'audio', `temp_force_out_${Date.now()}_${Math.random().toString(36).substring(7)}.mp3`);
  
  fs.writeFileSync(tempIn, inputBuffer);
  
  let ffmpegCmd = 'ffmpeg';
  let ffprobeCmd = 'ffprobe';
  const localFfmpeg = path.join(process.cwd(), 'bin', 'ffmpeg.exe');
  const localFfprobe = path.join(process.cwd(), 'bin', 'ffprobe.exe');
  
  if (fs.existsSync(localFfmpeg)) ffmpegCmd = `"${localFfmpeg}"`;
  if (fs.existsSync(localFfprobe)) ffprobeCmd = `"${localFfprobe}"`;

  try {
    // 1. Lấy độ dài hiện tại của audio
    const probeOutput = execSync(`${ffprobeCmd} -i "${tempIn}" -show_entries format=duration -v quiet -of csv="p=0"`, { encoding: 'utf-8' });
    const currentDuration = parseFloat(probeOutput.trim());
    
    if (isNaN(currentDuration) || currentDuration <= 0) {
      throw new Error("Không thể xác định thời lượng audio bằng ffprobe.");
    }

    // 2. Tính tỷ lệ atempo
    const speedFactor = currentDuration / targetDuration;
    
    // Tốc độ quá lớn (FFmpeg atempo chỉ cho phép 0.5 -> 100.0)
    // Để an toàn, chia nhỏ atempo
    const filters: string[] = [];
    let tempo = speedFactor;
    while (tempo > 2.0) { filters.push('atempo=2.0'); tempo /= 2.0; }
    while (tempo < 0.5) { filters.push('atempo=0.5'); tempo /= 0.5; }
    if (tempo !== 1.0) filters.push(`atempo=${tempo.toFixed(4)}`);

    const filterStr = filters.join(',') || 'atempo=1.0';
    
    // 3. Thực thi FFmpeg với tuỳ chọn trim để đảm bảo thời lượng chính xác tuyệt đối (nếu cần)
    // -t targetDuration để force cut ở đuôi nếu có sai số mili giây
    const command = `${ffmpegCmd} -i "${tempIn}" -af "${filterStr}" -t ${targetDuration} -y "${tempOut}"`;
    execSync(command, { encoding: 'utf-8', stdio: 'pipe' });
    
    const outBuffer = fs.readFileSync(tempOut);
    return outBuffer;
  } catch (err: unknown) {
    console.error('Lỗi FFmpeg Ép Khớp Timestamp:', err);
    return inputBuffer; // Fallback
  } finally {
    if (fs.existsSync(tempIn)) fs.unlinkSync(tempIn);
    if (fs.existsSync(tempOut)) fs.unlinkSync(tempOut);
  }
}

interface TTSOptions {
  voice: string;
  speed: number;
  pitch: number;
  tiktokSessionId: string;
  api_url_vieneu: string;
  apiKeys: string[];
}

interface TTSProvider {
  name: string;
  supportsNativeSpeed: boolean;
  supportsNativePitch: boolean;
  generate: (text: string, options: TTSOptions) => Promise<{ buffer: Buffer, method: string, nativeSpeedApplied?: boolean, nativePitchApplied?: boolean }>;
}

const TTS_PROVIDERS: Record<string, TTSProvider> = {
  piper: {
    name: 'Piper TTS',
    supportsNativeSpeed: true,
    supportsNativePitch: false,
    generate: async (text, opts) => {
      const buffer = await generatePiperTTS(text, opts.voice, opts.speed);
      return { buffer, method: `Piper TTS (${opts.voice})` };
    }
  },
  edge_tts: {
    name: 'Edge TTS',
    supportsNativeSpeed: false,
    supportsNativePitch: false,
    generate: async (text, opts) => {
      const buffer = await generateEdgeTTS(text, opts.voice, opts.speed, opts.pitch);
      return { buffer, method: `Edge TTS (${opts.voice})` };
    }
  },
  vieneu_tts: {
    name: 'VieNeu TTS',
    supportsNativeSpeed: true,
    supportsNativePitch: false, // Default is false, but we can override it in generate
    generate: async (text, opts) => {
      const rawVoice = opts.voice || 'ngochuyen';
      const modelBaseName = rawVoice.normalize('NFD')
                                    .replace(/[\u0300-\u036f]/g, '')
                                    .replace(/đ/g, 'd').replace(/Đ/g, 'D')
                                    .toLowerCase()
                                    .replace(/\s+/g, '');
      
      const modelName = `${modelBaseName}.onnx`;
      const modelPath = path.join(process.cwd(), 'bin', 'piper_vn', modelName);
      
      let buffer;
      let method;
      let nativePitchApplied = false;
      
      if (fs.existsSync(modelPath)) {
          console.log(`[VieNeu-TTS API] Found local model, routing to Piper: ${modelName}`);
          buffer = await generatePiperTTS(text, modelName, opts.speed);
          method = `VieNeu-TTS (Piper: ${modelName})`;
      } else {
          const v = rawVoice.toLowerCase();
          if (v.includes('nam') || v.includes('adam') || v.includes('mạnh dũng') || v.includes('trung') || v.includes('sơn') || v.includes('anh') || v.includes('khôi') || v.includes('quân') || v.includes('an')) {
              console.log(`[VieNeu-TTS API] Model ${modelName} not found locally, routing to EdgeTTS: NamMinh`);
              buffer = await generateEdgeTTS(text, 'vi-VN-NamMinhNeural', opts.speed, opts.pitch);
              method = `VieNeu-TTS (EdgeTTS: NamMinh)`;
          } else {
              console.log(`[VieNeu-TTS API] Model ${modelName} not found locally, routing to EdgeTTS: HoaiMy`);
              buffer = await generateEdgeTTS(text, 'vi-VN-HoaiMyNeural', opts.speed, opts.pitch);
              method = `VieNeu-TTS (EdgeTTS: HoaiMy)`;
          }
          nativePitchApplied = false; // EdgeTTS no longer applies pitch natively
      }
      return { buffer, method, nativePitchApplied, nativeSpeedApplied: false };
    }
  },
  capcut_tts: {
    name: 'CapCut TTS',
    supportsNativeSpeed: false,
    supportsNativePitch: false,
    generate: async (text, opts) => {
      const localAppData = process.env.LOCALAPPDATA || path.join(process.env.USERPROFILE || '', 'AppData', 'Local');
      const capcutAppsDir = path.join(localAppData, 'CapCut', 'Apps');
      let capcutInstalled = false;
      if (fs.existsSync(capcutAppsDir)) {
        const versions = fs.readdirSync(capcutAppsDir).filter(f => fs.statSync(path.join(capcutAppsDir, f)).isDirectory());
        for (const v of versions) {
          if (fs.existsSync(path.join(capcutAppsDir, v, 'sscronet.dll'))) {
            capcutInstalled = true;
            break;
          }
        }
      }

      if (capcutInstalled) {
        const buffer = await generateCapCutTTS(text, opts.voice);
        return { buffer, method: `CapCut TTS (${opts.voice})` };
      } else {
        throw new Error('Không tìm thấy thư viện CapCut sscronet.dll cục bộ trên hệ thống. Vui lòng cài đặt CapCut phiên bản Desktop hoặc chuyển đổi sang platform khác (như Edge TTS, Piper TTS, v.v.).');
      }
    }
  },
  tiktok_tts: {
    name: 'TikTok TTS',
    supportsNativeSpeed: false,
    supportsNativePitch: false,
    generate: async (text, opts) => {
      const buffer = await generateTikTokTTS(text, opts.voice, opts.tiktokSessionId);
      return { buffer, method: `TikTok TTS (${opts.voice})` };
    }
  },
  openai_tts: {
    name: 'OpenAI TTS',
    supportsNativeSpeed: true,
    supportsNativePitch: false,
    generate: async (text, opts) => {
      const apiKey = Array.isArray(opts.apiKeys) && opts.apiKeys.length > 0 ? opts.apiKeys[0] : process.env.OPENAI_API_KEY || '';
      const buffer = await generateOpenAICompatibleTTS(text, opts.voice, opts.speed, 0, 'https://api.openai.com', apiKey, 'tts-1');
      return { buffer, method: `OpenAI TTS (${opts.voice})` };
    }
  },
  hotai_tts: {
    name: 'Hotai TTS',
    supportsNativeSpeed: true,
    supportsNativePitch: false,
    generate: async (text, opts) => {
      const apiKey = Array.isArray(opts.apiKeys) && opts.apiKeys.length > 0 ? opts.apiKeys[0] : process.env.HOTAI_API_KEY || '';
      const apiUrl = process.env.HOTAI_API_URL || 'https://api.hotai.vn';
      const buffer = await generateOpenAICompatibleTTS(text, opts.voice, opts.speed, 0, apiUrl, apiKey, 'hotai-tts-1');
      return { buffer, method: `Hotai TTS (${opts.voice})` };
    }
  },
  omnivoice_local: {
    name: 'OmniVoice Local',
    supportsNativeSpeed: true,
    supportsNativePitch: true,
    generate: async (text, opts) => {
      const apiUrl = process.env.OMNIVOICE_API_URL || 'http://127.0.0.1:23456';
      const buffer = await generateOpenAICompatibleTTS(text, opts.voice, opts.speed, opts.pitch, apiUrl, '', 'omnivoice-v1');
      return { buffer, method: `OmniVoice Local (${opts.voice})` };
    }
  },
  gemini_tts: {
    name: 'Gemini TTS',
    supportsNativeSpeed: false,
    supportsNativePitch: false,
    generate: async (text, opts) => {
      let keys = Array.isArray(opts.apiKeys) ? opts.apiKeys : [];
      if (keys.length === 0) {
        keys = [
          process.env.GEMINI_KEY_1,
          process.env.GEMINI_KEY_2,
          process.env.GEMINI_KEY_3,
          process.env.GEMINI_KEY_4,
          process.env.GEMINI_KEY_5,
          process.env.GEMINI_KEY_6,
          process.env.GEMINI_KEY_7,
          process.env.GEMINI_KEY_8,
          process.env.GEMINI_API_KEY
        ].filter((k): k is string => !!k && k.trim().length > 0);
      }
      for (const key of keys) {
        if (!key || key.trim().length === 0) continue;
        try {
          const buffer = await generateGeminiTTS(text, key.trim(), opts.voice);
          return { buffer, method: `Gemini TTS (${opts.voice})` };
        } catch (err) {
          console.warn(`[TTS Gemini] Lỗi với key: ${(err as Error).message}`);
        }
      }
      throw new Error('Tất cả API Key Gemini đều thất bại.');
    }
  },
  vbee: {
    name: 'Premium TTS',
    supportsNativeSpeed: false,
    supportsNativePitch: false,
    generate: async (text, opts) => {
      throw new Error('Vbee API chưa được tích hợp chính thức trong phiên bản này.');
    }
  },
  elevenlabs: {
    name: 'Premium TTS',
    supportsNativeSpeed: false,
    supportsNativePitch: false,
    generate: async (text, opts) => {
      throw new Error('ElevenLabs API chưa được tích hợp chính thức trong phiên bản này.');
    }
  },
  google: {
    name: 'Google Translate TTS',
    supportsNativeSpeed: false,
    supportsNativePitch: false,
    generate: async (text) => {
      const buffer = await generateGoogleTranslateTTS(text);
      return { buffer, method: 'Google Translate TTS' };
    }
  }
};

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { sceneText, chapterNum, sceneIndex, drivePath, voiceName, apiKeys, ten_tac_pham, ttsConfig, isPreview, targetDuration, syncMode } = body;

    if (!sceneText) {
      return NextResponse.json({ error: 'Nội dung phân cảnh rỗng.' }, { status: 400 });
    }

    const cleanText = cleanVoiceScript(sceneText);
    if (!cleanText) {
      return NextResponse.json({ error: 'Không có lời thoại nào khả dụng sau khi lọc kịch bản sạch.' }, { status: 400 });
    }

    const publicAudioDir = path.join(process.cwd(), 'public', 'audio');
    if (!fs.existsSync(publicAudioDir)) {
      fs.mkdirSync(publicAudioDir, { recursive: true });
    }

    const platform = ttsConfig?.platform || 'google';
    const voice = voiceName || ttsConfig?.voice || 'Kore';
    const speed = parseFloat(ttsConfig?.speed) || 1.0;
    const pitch = parseFloat(ttsConfig?.pitch) || 0;
    const tiktokSessionId = ttsConfig?.tiktokSessionId || '';
    const api_url_vieneu = ttsConfig?.api_url_vieneu || 'http://localhost:3000/api/v1';

    const options: TTSOptions = {
      voice,
      speed,
      pitch,
      tiktokSessionId,
      api_url_vieneu,
      apiKeys: Array.isArray(apiKeys) ? apiKeys : []
    };

    if (isPreview) {
      const isWavPreview = platform === 'piper' || platform === 'gemini_tts' || platform === 'vieneu_tts';
      const safePlatform = platform.replace(/[^a-z0-9]/gi, '_');
      const safeVoice = voice.replace(/[^a-z0-9\._-]/gi, '_');
      const previewFilename = `preview_${safePlatform}_${safeVoice}_s${speed}_p${pitch}.${isWavPreview ? 'wav' : 'mp3'}`;
      const previewDir = path.join(publicAudioDir, 'previews');
      
      if (!fs.existsSync(previewDir)) fs.mkdirSync(previewDir, { recursive: true });
      
      const previewPath = path.join(previewDir, previewFilename);
      if (fs.existsSync(previewPath)) {
        console.log(`[TTS Preview] Trả về file cache có sẵn: ${previewFilename}`);
        return NextResponse.json({
          success: true,
          audioPath: `/audio/previews/${previewFilename}`,
          method: `Cached Preview (${voice})`,
          voice,
          duration: 5,
          driveSaved: false,
          driveFilePath: '',
          filename: previewFilename
        });
      }
    }

    let audioBuffer: Buffer | null = null;
    let methodUsed = 'Unknown';
    let provider = TTS_PROVIDERS[platform];

    if (voice.startsWith('VBEE_')) {
      provider = TTS_PROVIDERS['vbee'];
    }

    if (!provider) {
      console.warn(`[TTS API] Provider ${platform} không tồn tại.`);
      return NextResponse.json({ error: `Provider ${platform} không tồn tại.` }, { status: 400 });
    }

    console.log(`[TTS API] Đang sinh giọng ${voice} bằng ${provider.name}...`);

    let nativeSpeedApplied = provider.supportsNativeSpeed;
    let nativePitchApplied = provider.supportsNativePitch;

    try {
      const result = await provider.generate(cleanText, options);
      audioBuffer = result.buffer;
      methodUsed = result.method;
      if (result.nativeSpeedApplied !== undefined) nativeSpeedApplied = result.nativeSpeedApplied;
      if (result.nativePitchApplied !== undefined) nativePitchApplied = result.nativePitchApplied;
      console.log(`[TTS API] ${provider.name} xử lý thành công!`);
    } catch (err: unknown) {
      console.error(`[TTS API] ${provider.name} lỗi: ${(err as Error).message}`);
      return NextResponse.json({ error: `Lỗi sinh âm thanh từ ${provider.name}: ${(err as Error).message}` }, { status: 500 });
    }

    if (!audioBuffer) {
      return NextResponse.json({ error: 'Không thể sinh giọng đọc sau tất cả fallback.' }, { status: 500 });
    }

    const speedViaFFmpeg = nativeSpeedApplied ? 1.0 : speed;
    const pitchViaFFmpeg = nativePitchApplied ? 0 : pitch;

    if (pitchViaFFmpeg !== 0 || speedViaFFmpeg !== 1.0) {
      console.log(`[TTS Post-Process] Áp dụng FFmpeg (Speed: ${speedViaFFmpeg}, Pitch: ${pitchViaFFmpeg})...`);
      try {
        audioBuffer = await applyAudioEffects(audioBuffer, pitchViaFFmpeg, speedViaFFmpeg);
        console.log(`[TTS Effects] Thành công!`);
      } catch (effErr: unknown) {
        console.warn(`[TTS Effects] Lỗi khi apply: ${(effErr as Error).message}`);
      }
    }

    if (syncMode === 'force_sync' && targetDuration && targetDuration > 0 && audioBuffer) {
      console.log(`[TTS Sync] Đang ép khớp âm thanh về chính xác ${targetDuration}s...`);
      try {
        audioBuffer = await forceAudioDuration(audioBuffer, targetDuration);
        console.log(`[TTS Sync] Ép khớp thành công!`);
      } catch (syncErr: unknown) {
        console.warn(`[TTS Sync] Lỗi ép khớp: ${(syncErr as Error).message}`);
      }
    }

    const isWav = methodUsed.includes('Gemini') || methodUsed.includes('Piper') || methodUsed.includes('VieNeu');
    let filename = '';
    let localSavePath = '';
    let audioPathRet = '';
    
    if (isPreview) {
      const safePlatform = platform.replace(/[^a-z0-9]/gi, '_');
      const safeVoice = voice.replace(/[^a-z0-9\._-]/gi, '_');
      filename = `preview_${safePlatform}_${safeVoice}_s${speed}_p${pitch}.${isWav ? 'wav' : 'mp3'}`;
      const previewDir = path.join(publicAudioDir, 'previews');
      if (!fs.existsSync(previewDir)) fs.mkdirSync(previewDir, { recursive: true });
      localSavePath = path.join(previewDir, filename);
      audioPathRet = `/audio/previews/${filename}`;
    } else {
      filename = `chapter_${chapterNum}_scene_${sceneIndex}.${isWav ? 'wav' : 'mp3'}`;
      localSavePath = path.join(publicAudioDir, filename);
      audioPathRet = `/audio/${filename}`;
    }
    
    fs.writeFileSync(localSavePath, audioBuffer);

    let driveSaved = false;
    let driveFilePath = '';
    
    if (!isPreview && drivePath && drivePath.trim().length > 0) {
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
          ? ten_tac_pham.replace(/[\/\:\*\?\"<>\|]/g, '_').trim() 
          : 'Kịch Bản';
        const driveFilename = `${scriptTitle}_Chuong_${chapterNum}_Canh_${sceneIndex}.${isWav ? 'wav' : 'mp3'}`;
        
        driveFilePath = path.join(driveFolder, driveFilename);
        fs.writeFileSync(driveFilePath, audioBuffer);
        driveSaved = true;
        console.log(`[Drive Service] Đã lưu âm thanh với tên kịch bản: ${driveFilePath}`);
      } catch (driveErr: unknown) {
        console.error(`[Drive Service] Lỗi lưu Drive:`, (driveErr as Error).message);
      }
    }

    let calculatedDuration = Math.max(5, Math.round(getWordCount(cleanText) / 2.5));
    if (isWav && audioBuffer.length > 44) {
      calculatedDuration = Math.max(5, Math.round((audioBuffer.length - 44) / 48000));
    }

    return NextResponse.json({
      success: true,
      audioPath: audioPathRet,
      method: methodUsed,
      voice,
      duration: calculatedDuration,
      driveSaved,
      driveFilePath,
      filename
    });

  } catch (err: unknown) {
    console.error('[TTS API] Fatal error:', err);
    return NextResponse.json(
      { error: (err as Error).message || 'Lỗi xảy ra trong quá trình sản xuất giọng nói TTS.' },
      { status: 500 }
    );
  }
}
