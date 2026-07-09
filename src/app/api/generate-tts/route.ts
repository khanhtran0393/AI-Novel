import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { EdgeTTS } from 'node-edge-tts';
import { config, createAudioFromText } from 'tiktok-tts';
import { cleanVoiceScript, getWordCount } from '../../workspace/utils/stringUtils';
import {
  injectBreathPauses,
  emotionPitchOffset,
} from '@/lib/youtubeSafe';
import { applyAudioStudioMix, probeDurationSec } from '@/lib/audioStudio';
import { synthesizeVinaVoice } from '@/lib/vinaVoice';
import { synthesizeOmniVoiceLocal } from '@/lib/omnivoiceLocal';

export const dynamic = 'force-dynamic';

export const runtime = 'nodejs';

function createWavHeader(dataLength: number, sampleRate = 24000, channels = 1, bitsPerSample = 16): Buffer {
  const byteRate = (sampleRate * channels * bitsPerSample) / 8;
  const blockAlign = (channels * bitsPerSample) / 8;
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + dataLength, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write('data', 36);
  header.writeUInt32LE(dataLength, 40);
  return header;
}

function splitTtsText(text: string, maxLen: number): string[] {
  const chunks: string[] = [];
  let remaining = text.trim();
  while (remaining.length > 0) {
    if (remaining.length <= maxLen) {
      chunks.push(remaining);
      break;
    }
    let cutIndex = remaining.lastIndexOf('.', maxLen);
    if (cutIndex < 50) cutIndex = remaining.lastIndexOf(' ', maxLen);
    if (cutIndex < 50) cutIndex = maxLen;
    chunks.push(remaining.substring(0, cutIndex + 1).trim());
    remaining = remaining.substring(cutIndex + 1).trim();
  }
  return chunks.filter(Boolean);
}

async function generatePiperTTS(text: string, modelName: string, speed: number): Promise<Buffer> {
  const scratchDir = path.join(process.cwd(), 'scratch');
  if (!fs.existsSync(scratchDir)) fs.mkdirSync(scratchDir, { recursive: true });

  const tempText = path.join(scratchDir, `piper_${Date.now()}_${Math.random().toString(36).slice(2)}.txt`);
  const tempWav = path.join(scratchDir, `piper_${Date.now()}_${Math.random().toString(36).slice(2)}.wav`);
  const piperExe = path.join(process.cwd(), 'bin', 'piper', 'piper.exe');
  const modelPath = path.join(process.cwd(), 'bin', 'piper_vn', modelName);
  if (!fs.existsSync(piperExe)) throw new Error(`Piper executable not found: ${piperExe}`);
  if (!fs.existsSync(modelPath)) throw new Error(`Piper model not found: ${modelPath}`);

  fs.writeFileSync(tempText, text, 'utf8');
  try {
    const lengthScale = (1.0 / Math.max(0.1, speed || 1.0)).toFixed(3);
    execSync(`"${piperExe}" -m "${modelPath}" --length_scale ${lengthScale} -f "${tempWav}" < "${tempText}"`, {
      encoding: 'utf-8',
      stdio: 'pipe',
    });
    if (!fs.existsSync(tempWav)) throw new Error('Piper did not generate wav file.');
    return fs.readFileSync(tempWav);
  } finally {
    if (fs.existsSync(tempText)) fs.unlinkSync(tempText);
    if (fs.existsSync(tempWav)) fs.unlinkSync(tempWav);
  }
}

async function generateGeminiTTS(text: string, apiKey: string, voiceName: string): Promise<Buffer> {
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

function resolveFfmpegCmd(): string {
  const localFfmpeg = path.join(process.cwd(), 'bin', 'ffmpeg.exe');
  if (fs.existsSync(localFfmpeg)) return `"${localFfmpeg}"`;
  return 'ffmpeg';
}

/** Nối nhiều buffer audio (mp3/wav) thành 1 file mp3 bằng ffmpeg concat. */
async function concatAudioBuffers(buffers: Buffer[], preferWav = false): Promise<Buffer> {
  if (buffers.length === 0) throw new Error('Không có đoạn audio để nối.');
  if (buffers.length === 1) return buffers[0];

  const scratch = path.join(process.cwd(), 'public', 'audio', 'multi');
  if (!fs.existsSync(scratch)) fs.mkdirSync(scratch, { recursive: true });
  const tag = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const ext = preferWav ? 'wav' : 'mp3';
  const partPaths: string[] = [];
  const listPath = path.join(scratch, `list_${tag}.txt`);
  const outPath = path.join(scratch, `out_${tag}.mp3`);

  try {
    for (let i = 0; i < buffers.length; i++) {
      const p = path.join(scratch, `part_${tag}_${i}.${ext}`);
      fs.writeFileSync(p, buffers[i]);
      partPaths.push(p);
    }
    // Re-encode each part to consistent pcm/mp3 then concat demuxer
    const normalized: string[] = [];
    const ffmpeg = resolveFfmpegCmd();
    for (let i = 0; i < partPaths.length; i++) {
      const norm = path.join(scratch, `norm_${tag}_${i}.mp3`);
      execSync(
        `${ffmpeg} -y -i "${partPaths[i]}" -ar 44100 -ac 1 -c:a libmp3lame -q:a 2 "${norm}"`,
        { encoding: 'utf-8', stdio: 'pipe' },
      );
      normalized.push(norm);
    }
    const listBody = normalized.map((p) => `file '${p.replace(/\\/g, '/')}'`).join('\n');
    fs.writeFileSync(listPath, listBody, 'utf8');
    execSync(
      `${ffmpeg} -y -f concat -safe 0 -i "${listPath}" -c:a libmp3lame -q:a 2 "${outPath}"`,
      { encoding: 'utf-8', stdio: 'pipe' },
    );
    if (!fs.existsSync(outPath)) throw new Error('FFmpeg concat không tạo file đầu ra.');
    return fs.readFileSync(outPath);
  } finally {
    for (const p of [...partPaths, listPath, outPath]) {
      try {
        if (p && fs.existsSync(p)) fs.unlinkSync(p);
      } catch { /* ignore */ }
    }
    // cleanup norm parts
    try {
      for (const f of fs.readdirSync(scratch)) {
        if (f.includes(tag)) {
          try { fs.unlinkSync(path.join(scratch, f)); } catch { /* ignore */ }
        }
      }
    } catch { /* ignore */ }
  }
}

/** Pitch / speed / optional broadcast loudnorm (YouTube-friendlier levels). */
async function applyAudioEffects(
  inputBuffer: Buffer,
  pitchSemitones: number,
  speedFactor: number,
  applyLoudnorm = false,
): Promise<Buffer> {
  if (pitchSemitones === 0 && speedFactor === 1.0 && !applyLoudnorm) return inputBuffer;

  const tempIn = path.join(
    process.cwd(),
    'public',
    'audio',
    `temp_in_${Date.now()}_${Math.random().toString(36).substring(7)}.mp3`,
  );
  const tempOut = path.join(
    process.cwd(),
    'public',
    'audio',
    `temp_out_${Date.now()}_${Math.random().toString(36).substring(7)}.mp3`,
  );

  fs.writeFileSync(tempIn, inputBuffer);

  const filters: string[] = [];

  if (pitchSemitones !== 0) {
    const rateFactor = Math.pow(2, pitchSemitones / 12);
    const newSampleRate = Math.round(44100 * rateFactor);
    let tempo = (1 / rateFactor) * speedFactor;

    filters.push('aresample=44100');
    filters.push(`asetrate=${newSampleRate}`);

    while (tempo > 2.0) {
      filters.push('atempo=2.0');
      tempo /= 2.0;
    }
    while (tempo < 0.5) {
      filters.push('atempo=0.5');
      tempo /= 0.5;
    }
    if (tempo !== 1.0) filters.push(`atempo=${tempo}`);
  } else if (speedFactor !== 1.0) {
    let tempo = speedFactor;
    while (tempo > 2.0) {
      filters.push('atempo=2.0');
      tempo /= 2.0;
    }
    while (tempo < 0.5) {
      filters.push('atempo=0.5');
      tempo /= 0.5;
    }
    if (tempo !== 1.0) filters.push(`atempo=${tempo}`);
  }

  // Broadcast-ish level (helps avoid flat/raw TTS loudness on YouTube)
  if (applyLoudnorm) {
    filters.push('loudnorm=I=-16:TP=-1.5:LRA=11');
  }

  if (filters.length === 0) {
    if (fs.existsSync(tempIn)) fs.unlinkSync(tempIn);
    return inputBuffer;
  }

  try {
    const filterStr = filters.join(',');
    const ffmpegCmd = resolveFfmpegCmd();
    const command = `${ffmpegCmd} -i "${tempIn}" -af "${filterStr}" -y "${tempOut}"`;
    execSync(command, { encoding: 'utf-8', stdio: 'pipe' });

    const outBuffer = fs.readFileSync(tempOut);
    fs.unlinkSync(tempIn);
    fs.unlinkSync(tempOut);
    return outBuffer;
  } catch (err: unknown) {
    if (fs.existsSync(tempIn)) fs.unlinkSync(tempIn);
    if (fs.existsSync(tempOut)) fs.unlinkSync(tempOut);
    // Loudnorm sometimes fails on short clips — fall back to non-loudnorm
    if (applyLoudnorm && (pitchSemitones !== 0 || speedFactor !== 1.0)) {
      console.warn('[TTS] loudnorm failed, retry without loudnorm');
      return applyAudioEffects(inputBuffer, pitchSemitones, speedFactor, false);
    }
    if (applyLoudnorm && pitchSemitones === 0 && speedFactor === 1.0) {
      console.warn('[TTS] loudnorm failed, returning original buffer');
      return inputBuffer;
    }
    console.error('Lỗi FFmpeg Effects (execSync):', err);
    throw err instanceof Error ? err : new Error(String(err));
  }
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
    throw err instanceof Error ? err : new Error(String(err));
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
      const rawVoice = opts.voice;
      const modelBaseName = rawVoice.normalize('NFD')
                                    .replace(/[\u0300-\u036f]/g, '')
                                    .replace(/đ/g, 'd').replace(/Đ/g, 'D')
                                    .toLowerCase()
                                    .replace(/\s+/g, '');
      
      const modelName = `${modelBaseName}.onnx`;
      const modelPath = path.join(process.cwd(), 'bin', 'piper_vn', modelName);
      
      if (!fs.existsSync(modelPath)) {
          throw new Error(`VieNeu/Piper model file not found: ${modelPath}`);
      }
      console.log(`[VieNeu-TTS API] Found local model, routing to Piper: ${modelName}`);
      const buffer = await generatePiperTTS(text, modelName, opts.speed);
      const method = `VieNeu-TTS (Piper: ${modelName})`;
      // Piper applies length_scale natively — must NOT also FFmpeg atempo
      return { buffer, method, nativePitchApplied: false, nativeSpeedApplied: true };
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
        try {
          const buffer = await generateCapCutTTS(text, opts.voice);
          return { buffer, method: `CapCut TTS (${opts.voice})` };
        } catch (capErr) {
          console.warn('[TTS CapCut] native fail → Edge fallback:', (capErr as Error).message);
        }
      } else {
        console.warn('[TTS CapCut] sscronet.dll missing → Edge TTS fallback (independent mode)');
      }
      // Independence: không phụ thuộc CapCut desktop
      const edgeVoice =
        /female|nữ|huong|my|hoa|mai/i.test(String(opts.voice || ''))
          ? 'vi-VN-HoaiMyNeural'
          : 'vi-VN-NamMinhNeural';
      const buffer = await generateEdgeTTS(text, edgeVoice, opts.speed, opts.pitch);
      return {
        buffer,
        method: `Edge TTS fallback (${edgeVoice}) [CapCut unavailable]`,
      };
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
    // Pitch: server clone path không nhận pitch semitone — post-process FFmpeg phía dưới
    supportsNativePitch: false,
    generate: async (text, opts) => {
      const result = await synthesizeOmniVoiceLocal({
        text,
        voice: opts.voice,
        speed: opts.speed,
        pitch: opts.pitch,
      });
      console.log(
        `[TTS omnivoice_local] mode=${result.mode} base=${result.baseUrl} method=${result.method}`,
      );
      return {
        buffer: result.buffer,
        method: result.method,
        nativeSpeedApplied: true,
        nativePitchApplied: false,
      };
    },
  },
  vina_voice: {
    name: 'VinaVoice (Independent)',
    // Prosody (speed/pitch) được engine apply trong synthesizeVinaVoice → postProcessWav
    supportsNativeSpeed: true,
    supportsNativePitch: true,
    generate: async (text, opts) => {
      // opts.voice = profile name from profiles_goc OR edge neural id
      // Extra fields may be attached on opts via ttsConfig merge below
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const extra = opts as any;
      const profileLooksLikeEdge =
        typeof opts.voice === 'string' && /Neural$/i.test(opts.voice);
      const uiSpeed =
        typeof opts.speed === 'number' && Number.isFinite(opts.speed) ? opts.speed : 1;
      const uiPitch =
        typeof opts.pitch === 'number' && Number.isFinite(opts.pitch) ? opts.pitch : 0;
      console.log(
        `[TTS vina_voice] voice=${opts.voice} uiSpeed=${uiSpeed} uiPitch=${uiPitch}`,
      );
      const result = await synthesizeVinaVoice({
        text,
        profileName: profileLooksLikeEdge ? undefined : opts.voice,
        settings: {
          speed: uiSpeed,
          pitch_shift: uiPitch,
          gender: extra.vinaGender || (profileLooksLikeEdge && /HoaiMy|female|Nu/i.test(opts.voice) ? 'female' : 'male'),
          area: extra.vinaArea || 'southern',
          group: extra.vinaGroup || 'story',
          emotion: extra.vinaEmotion || 'neutral',
          use_clone: extra.vinaUseClone !== false,
          reference_audio: extra.vinaReferenceAudio || '',
          reference_audio_b64: extra.vinaReferenceAudioB64 || undefined,
          reference_text: extra.vinaReferenceText || '',
          speaker_seed: extra.vinaSpeakerSeed || 2336,
          style_seed: extra.vinaStyleSeed || 4125,
          engine_url:
            extra.vinaEngineUrl ||
            process.env.VINA_ENGINE_URL ||
            'http://127.0.0.1:8765',
          samples_dir:
            process.env.VINA_SAMPLES_DIR ||
            path.join(process.cwd(), 'data', 'vina-voices', 'samples'),
        },
      });
      if (!result.ok || !result.audioPath || !fs.existsSync(result.audioPath)) {
        throw new Error(result.error || 'VinaVoice synthesize failed');
      }
      if (result.warnings?.length) {
        console.warn('[TTS vina_voice] warnings:', result.warnings.join(' | '));
      }
      const buffer = fs.readFileSync(result.audioPath);
      return {
        buffer,
        method: result.method,
        nativeSpeedApplied: true,
        nativePitchApplied: true,
      };
    },
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
  }
};

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const {
      sceneText,
      chapterNum,
      sceneIndex,
      drivePath,
      voiceName,
      apiKeys,
      ten_tac_pham,
      ttsConfig,
      isPreview,
      targetDuration,
      syncMode,
      applyLoudnorm,
      injectBreathPauses: wantBreathPauses,
      roomTone,
      bgmMix,
      bgmPath,
      emotion,
      emotionTts,
      /** Đa giọng: [{ speaker?, text, voice }] — nếu có ≥2 voice khác nhau */
      voiceSegments,
    } = body;

    if (!sceneText && !(Array.isArray(voiceSegments) && voiceSegments.length > 0)) {
      return NextResponse.json({ error: 'Nội dung phân cảnh rỗng.' }, { status: 400 });
    }

    const publicAudioDir = path.join(process.cwd(), 'public', 'audio');
    if (!fs.existsSync(publicAudioDir)) {
      fs.mkdirSync(publicAudioDir, { recursive: true });
    }

    const platform = ttsConfig?.platform;
    const voice = voiceName || ttsConfig?.voice;
    if (!platform) {
      return NextResponse.json({ error: 'Missing TTS platform. Please select a real TTS engine.' }, { status: 400 });
    }
    if (!voice && !(Array.isArray(voiceSegments) && voiceSegments.length > 0)) {
      return NextResponse.json({ error: 'Missing TTS voice. Please select a real voice for the selected engine.' }, { status: 400 });
    }

    const baseSpeed = parseFloat(ttsConfig?.speed) || 1.0;
    const basePitch = parseFloat(ttsConfig?.pitch) || 0;
    const sceneEmotion = typeof emotion === 'string' ? emotion : '';
    // Single-path only: bake scene emotion into pitch. Multi uses per-seg emotion.
    let pitch = basePitch;
    if (emotionTts !== false) {
      pitch = basePitch + emotionPitchOffset(sceneEmotion);
    }
    const speed = baseSpeed;
    const tiktokSessionId = ttsConfig?.tiktokSessionId || '';
    const api_url_vieneu = ttsConfig?.api_url_vieneu || 'http://localhost:3000/api/v1';

    type SegIn = {
      speaker?: string | null;
      text: string;
      voice: string;
      speed?: number;
      pitch?: number;
      emotion?: string;
    };
    const multiSegs: SegIn[] = Array.isArray(voiceSegments)
      ? (voiceSegments as SegIn[]).filter((s) => s && typeof s.text === 'string' && s.text.trim() && s.voice)
      : [];

    const voicesDiffer = multiSegs.length > 0 && new Set(multiSegs.map((s) => s.voice)).size > 1;
    const prosodyDiffer = multiSegs.some((s) => {
      if (typeof s.speed === 'number' && Math.abs(s.speed - baseSpeed) > 0.001) return true;
      if (typeof s.pitch === 'number' && Math.abs(s.pitch - basePitch) > 0.001) return true;
      return false;
    });
    const emotionsDiffer =
      multiSegs.length > 0 &&
      new Set(multiSegs.map((s) => (s.emotion || '').trim())).size > 1;

    const useMulti =
      !isPreview &&
      multiSegs.length > 0 &&
      (voicesDiffer || prosodyDiffer || emotionsDiffer);

    let cleanText = '';
    if (useMulti) {
      cleanText = multiSegs.map((s) => s.text.trim()).join('\n\n');
      if (wantBreathPauses !== false) {
        cleanText = multiSegs
          .map((s) => injectBreathPauses(s.text.trim()))
          .join('\n\n');
      }
    } else {
      cleanText = cleanVoiceScript(sceneText || multiSegs.map((s) => s.text).join('\n'));
      if (wantBreathPauses !== false) {
        cleanText = injectBreathPauses(cleanText);
      }
    }
    if (!cleanText) {
      return NextResponse.json({ error: 'Không có lời thoại nào khả dụng sau khi lọc kịch bản sạch.' }, { status: 400 });
    }

    // Cast active single path: if all segs share one non-empty emotion, use it instead of scene
    if (!useMulti && multiSegs.length > 0 && emotionTts !== false) {
      const ems = [...new Set(multiSegs.map((s) => (s.emotion || '').trim()).filter(Boolean))];
      if (ems.length === 1) {
        pitch = basePitch + emotionPitchOffset(ems[0]);
      }
    }

    const options: TTSOptions & Record<string, unknown> = {
      voice: voice || multiSegs[0]?.voice || '',
      speed,
      pitch,
      tiktokSessionId,
      api_url_vieneu,
      apiKeys: Array.isArray(apiKeys) ? apiKeys : [],
      // VinaVoice extras from store ttsConfig
      vinaGender: ttsConfig?.vinaGender,
      vinaArea: ttsConfig?.vinaArea,
      vinaGroup: ttsConfig?.vinaGroup,
      vinaEmotion: ttsConfig?.vinaEmotion,
      vinaUseClone: ttsConfig?.vinaUseClone,
      vinaReferenceAudio: ttsConfig?.vinaReferenceAudio,
      vinaReferenceAudioB64: ttsConfig?.vinaReferenceAudioB64,
      vinaReferenceText: ttsConfig?.vinaReferenceText,
      vinaSpeakerSeed: ttsConfig?.vinaSpeakerSeed,
      vinaStyleSeed: ttsConfig?.vinaStyleSeed,
      vinaEngineUrl: ttsConfig?.vinaEngineUrl,
    };

    const resolveNativeFlags = (
      prov: (typeof TTS_PROVIDERS)[string],
      result: { method: string; nativeSpeedApplied?: boolean; nativePitchApplied?: boolean },
      plat: string,
    ): { nativeSpeed: boolean; nativePitch: boolean } => {
      if (
        plat === 'vieneu_tts' ||
        plat === 'piper' ||
        /VieNeu|Piper/i.test(result.method || '')
      ) {
        // Piper length_scale is native speed; pitch not native
        return { nativeSpeed: true, nativePitch: false };
      }
      return {
        nativeSpeed:
          result.nativeSpeedApplied !== undefined
            ? !!result.nativeSpeedApplied
            : !!prov.supportsNativeSpeed,
        nativePitch:
          result.nativePitchApplied !== undefined
            ? !!result.nativePitchApplied
            : !!prov.supportsNativePitch,
      };
    };

    if (isPreview) {
      const isWavPreview =
        platform === 'piper' ||
        platform === 'gemini_tts' ||
        platform === 'vieneu_tts' ||
        platform === 'vina_voice';
      const safePlatform = platform.replace(/[^a-z0-9]/gi, '_');
      const safeVoice = (voice || 'default').replace(/[^a-z0-9\._-]/gi, '_');
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

    if (!provider) {
      console.warn(`[TTS API] Provider ${platform} không tồn tại.`);
      return NextResponse.json({ error: `Provider ${platform} không tồn tại.` }, { status: 400 });
    }

    let nativeSpeedApplied = provider.supportsNativeSpeed;
    let nativePitchApplied = provider.supportsNativePitch;

    try {
      if (useMulti) {
        console.log(
          `[TTS API] Đa giọng: ${multiSegs.length} đoạn, voices=${[...new Set(multiSegs.map((s) => s.voice))].join(', ')}`,
        );
        // Parallel pool (default 2) — preserve segment order in partBuffers
        const concurrencyRaw = Number(
          body?.multiConcurrency ?? process.env.TTS_MULTI_CONCURRENCY ?? 2,
        );
        const concurrency = Math.max(
          1,
          Math.min(4, Number.isFinite(concurrencyRaw) ? concurrencyRaw : 2),
        );
        console.log(
          `[TTS API] Multi concurrency=${concurrency} for ${multiSegs.length} segments`,
        );

        type SegOut = { buffer: Buffer; method: string; index: number };
        type SegFail = {
          index: number;
          speaker: string | null;
          voice: string;
          message: string;
        };
        const results: SegOut[] = new Array(multiSegs.length);
        let cursor = 0;
        const failBox: { err: SegFail | null } = { err: null };

        const runOne = async (i: number) => {
          if (failBox.err) return;
          const seg = multiSegs[i];
          let segText = seg.text.trim();
          if (wantBreathPauses !== false) segText = injectBreathPauses(segText);

          const segSpeed =
            typeof seg.speed === 'number' && Number.isFinite(seg.speed) ? seg.speed : baseSpeed;
          const rolePitch =
            typeof seg.pitch === 'number' && Number.isFinite(seg.pitch) ? seg.pitch : basePitch;
          const emKey = (seg.emotion || '').trim();
          const segPitch =
            rolePitch + (emotionTts !== false ? emotionPitchOffset(emKey) : 0);

          const segOpts: TTSOptions = {
            ...options,
            voice: seg.voice,
            speed: segSpeed,
            pitch: segPitch,
          };
          console.log(
            `[TTS API] Segment ${i + 1}/${multiSegs.length} speaker=${seg.speaker || 'kể'} voice=${seg.voice} speed=${segSpeed} pitch=${segPitch}`,
          );
          try {
            const result = await provider.generate(segText, segOpts);
            const flags = resolveNativeFlags(provider, result, platform);
            let buf = result.buffer;
            const speedViaFFmpeg_i = flags.nativeSpeed ? 1.0 : segSpeed;
            const pitchViaFFmpeg_i = flags.nativePitch ? 0 : segPitch;
            if (speedViaFFmpeg_i !== 1.0 || pitchViaFFmpeg_i !== 0) {
              buf = await applyAudioEffects(buf, pitchViaFFmpeg_i, speedViaFFmpeg_i, false);
            }
            results[i] = { buffer: buf, method: result.method, index: i };
          } catch (segErr: unknown) {
            if (!failBox.err) {
              failBox.err = {
                index: i,
                speaker: seg.speaker || null,
                voice: seg.voice,
                message: (segErr as Error).message || 'unknown',
              };
            }
          }
        };

        const workers = Array.from({ length: Math.min(concurrency, multiSegs.length) }, async () => {
          while (!failBox.err) {
            const i = cursor++;
            if (i >= multiSegs.length) break;
            await runOne(i);
          }
        });
        await Promise.all(workers);

        if (failBox.err) {
          const fe = failBox.err;
          console.error(`[TTS API] Multi fail at segment ${fe.index}: ${fe.message}`);
          return NextResponse.json(
            {
              error: `Lỗi sinh âm thanh segment ${fe.index + 1}/${multiSegs.length} (${fe.speaker || 'kể'}): ${fe.message}`,
              failedSegmentIndex: fe.index,
              speaker: fe.speaker,
              voice: fe.voice,
            },
            { status: 500 },
          );
        }

        const partBuffers = results.map((r) => r.buffer);
        const methods = results.map((r) => r.method);
        const preferWav = methods.some((m) => /Gemini|Piper|VieNeu|Vina/i.test(m));
        audioBuffer = await concatAudioBuffers(partBuffers, preferWav);
        methodUsed = `Multi-voice (${multiSegs.length} segs×${concurrency}) · ${methods[0] || provider.name}`;
        nativeSpeedApplied = true;
        nativePitchApplied = true;
        console.log(`[TTS API] Nối đa giọng thành công (${multiSegs.length} đoạn, concurrency=${concurrency}).`);
      } else {
        console.log(`[TTS API] Đang sinh giọng ${options.voice} bằng ${provider.name}...`);
        const result = await provider.generate(cleanText, options);
        audioBuffer = result.buffer;
        methodUsed = result.method;
        const flags = resolveNativeFlags(provider, result, platform);
        nativeSpeedApplied = flags.nativeSpeed;
        nativePitchApplied = flags.nativePitch;
        console.log(`[TTS API] ${provider.name} xử lý thành công!`);
      }
    } catch (err: unknown) {
      console.error(`[TTS API] ${provider.name} lỗi: ${(err as Error).message}`);
      return NextResponse.json({ error: `Lỗi sinh âm thanh từ ${provider.name}: ${(err as Error).message || 'unknown'}` }, { status: 500 });
    }

    if (!audioBuffer) {
      return NextResponse.json({ error: 'TTS provider did not return a valid audio buffer.' }, { status: 500 });
    }

    // Multi path: speed/pitch already applied per-seg → only loudnorm here
    const speedViaFFmpeg = nativeSpeedApplied ? 1.0 : speed;
    const pitchViaFFmpeg = nativePitchApplied ? 0 : pitch;
    const wantLoudnorm = applyLoudnorm !== false && !isPreview;

    if (pitchViaFFmpeg !== 0 || speedViaFFmpeg !== 1.0 || wantLoudnorm) {
      console.log(
        `[TTS Post-Process] FFmpeg Speed=${speedViaFFmpeg} Pitch=${pitchViaFFmpeg} Loudnorm=${wantLoudnorm} multi=${useMulti}...`,
      );
      try {
        audioBuffer = await applyAudioEffects(
          audioBuffer,
          pitchViaFFmpeg,
          speedViaFFmpeg,
          wantLoudnorm,
        );
        console.log(`[TTS Effects] Thành công!`);
      } catch (effErr: unknown) {
        return NextResponse.json({ error: `TTS audio effects failed: ${(effErr as Error).message}` }, { status: 500 });
      }
    }

    if (syncMode === 'force_sync' && targetDuration && targetDuration > 0 && audioBuffer) {
      console.log(`[TTS Sync] Đang ép khớp âm thanh về chính xác ${targetDuration}s...`);
      try {
        audioBuffer = await forceAudioDuration(audioBuffer, targetDuration);
        console.log(`[TTS Sync] Ép khớp thành công!`);
      } catch (syncErr: unknown) {
        return NextResponse.json({ error: `TTS duration sync failed: ${(syncErr as Error).message}` }, { status: 500 });
      }
    }

    // YouTube audio studio: room tone + optional BGM bed + mix loudnorm
    let studioApplied: string[] = [];
    if (!isPreview && audioBuffer && (roomTone !== false || bgmMix === true)) {
      try {
        const mixed = await applyAudioStudioMix(audioBuffer, {
          roomTone: roomTone !== false,
          bgmMix: bgmMix === true,
          bgmPath: typeof bgmPath === 'string' ? bgmPath : '',
          loudnormI: -14,
        });
        audioBuffer = mixed.buffer;
        studioApplied = mixed.applied;
        if (studioApplied.length) {
          console.log(`[TTS AudioStudio] applied: ${studioApplied.join(', ')}`);
        }
      } catch (studioErr) {
        console.warn('[TTS AudioStudio] skipped:', studioErr);
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
    // Ưu tiên đo duration thật từ file (đa giọng / loudnorm)
    try {
      const probed = probeDurationSec(localSavePath);
      if (probed > 0) calculatedDuration = Math.max(1, Math.round(probed));
    } catch { /* ignore */ }

    return NextResponse.json({
      success: true,
      audioPath: audioPathRet,
      method: methodUsed,
      voice: useMulti ? `multi:${[...new Set(multiSegs.map((s) => s.voice))].join('+')}` : voice,
      multiVoice: useMulti,
      segmentCount: useMulti ? multiSegs.length : undefined,
      speakers: useMulti ? multiSegs.map((s) => s.speaker || 'kể') : undefined,
      duration: calculatedDuration,
      driveSaved,
      driveFilePath,
      filename,
      studioApplied,
      pitchApplied: pitch,
    });

  } catch (err: unknown) {
    console.error('[TTS API] Fatal error:', err);
    return NextResponse.json(
      { error: (err as Error).message || 'Lỗi xảy ra trong quá trình sản xuất giọng nói TTS.' },
      { status: 500 }
    );
  }
}

