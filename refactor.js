const fs = require('fs');
const path = require('path');

const code = fs.readFileSync(path.join('src', 'app', 'api', 'generate-tts', 'route.ts'), 'utf8');

const postIndex = code.indexOf('export async function POST(req: Request) {');
if (postIndex === -1) throw new Error('Cannot find POST function');

const headerCode = code.substring(0, postIndex);

const newLogic = `interface TTSOptions {
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
  generate: (text: string, options: TTSOptions) => Promise<{ buffer: Buffer, method: string }>;
}

const TTS_PROVIDERS: Record<string, TTSProvider> = {
  piper: {
    name: 'Piper TTS',
    supportsNativeSpeed: true,
    supportsNativePitch: false,
    generate: async (text, opts) => {
      const buffer = await generatePiperTTS(text, opts.voice, opts.speed);
      return { buffer, method: \`Piper TTS (\${opts.voice})\` };
    }
  },
  edge_tts: {
    name: 'Edge TTS',
    supportsNativeSpeed: true,
    supportsNativePitch: true,
    generate: async (text, opts) => {
      const buffer = await generateEdgeTTS(text, opts.voice, opts.speed, opts.pitch);
      return { buffer, method: \`Edge TTS (\${opts.voice})\` };
    }
  },
  capcut_tts: {
    name: 'CapCut TTS',
    supportsNativeSpeed: false,
    supportsNativePitch: false,
    generate: async (text, opts) => {
      const buffer = await generateCapCutTTS(text, opts.voice);
      return { buffer, method: \`CapCut TTS (\${opts.voice})\` };
    }
  },
  vieneu_tts: {
    name: 'VieNeu TTS',
    supportsNativeSpeed: true,
    supportsNativePitch: false,
    generate: async (text, opts) => {
      const buffer = await generateVieNeuTTS(text, opts.voice, opts.speed, opts.pitch, opts.api_url_vieneu);
      return { buffer, method: \`VieNeu TTS (\${opts.voice})\` };
    }
  },
  tiktok_tts: {
    name: 'TikTok TTS',
    supportsNativeSpeed: false,
    supportsNativePitch: false,
    generate: async (text, opts) => {
      const buffer = await generateTikTokTTS(text, opts.voice, opts.tiktokSessionId);
      return { buffer, method: \`TikTok TTS (\${opts.voice})\` };
    }
  },
  openai_tts: {
    name: 'OpenAI TTS',
    supportsNativeSpeed: true,
    supportsNativePitch: false,
    generate: async (text, opts) => {
      const apiKey = Array.isArray(opts.apiKeys) && opts.apiKeys.length > 0 ? opts.apiKeys[0] : process.env.OPENAI_API_KEY || '';
      const buffer = await generateOpenAICompatibleTTS(text, opts.voice, opts.speed, 0, 'https://api.openai.com', apiKey, 'tts-1');
      return { buffer, method: \`OpenAI TTS (\${opts.voice})\` };
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
      return { buffer, method: \`Hotai TTS (\${opts.voice})\` };
    }
  },
  omnivoice_local: {
    name: 'OmniVoice Local',
    supportsNativeSpeed: true,
    supportsNativePitch: true,
    generate: async (text, opts) => {
      const apiUrl = process.env.OMNIVOICE_API_URL || 'http://127.0.0.1:23456';
      const buffer = await generateOpenAICompatibleTTS(text, opts.voice, opts.speed, opts.pitch, apiUrl, '', 'omnivoice-v1');
      return { buffer, method: \`OmniVoice Local (\${opts.voice})\` };
    }
  },
  gemini_tts: {
    name: 'Gemini TTS',
    supportsNativeSpeed: false,
    supportsNativePitch: false,
    generate: async (text, opts) => {
      const keys = Array.isArray(opts.apiKeys) ? opts.apiKeys : [];
      for (const key of keys) {
        if (!key || key.trim().length === 0) continue;
        try {
          const buffer = await generateGeminiTTS(text, key.trim(), opts.voice);
          return { buffer, method: \`Gemini TTS (\${opts.voice})\` };
        } catch (err) {
          console.warn(\`[TTS Gemini] Lỗi với key: \${(err as Error).message}\`);
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
      const buffer = await generateGoogleTranslateTTS(text);
      return { buffer, method: \`Premium TTS (\${opts.voice})\` };
    }
  },
  elevenlabs: {
    name: 'Premium TTS',
    supportsNativeSpeed: false,
    supportsNativePitch: false,
    generate: async (text, opts) => {
      const buffer = await generateGoogleTranslateTTS(text);
      return { buffer, method: \`Premium TTS (\${opts.voice})\` };
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
      const safeVoice = voice.replace(/[^a-z0-9\\._-]/gi, '_');
      const previewFilename = \`preview_\${safePlatform}_\${safeVoice}_s\${speed}_p\${pitch}.\${isWavPreview ? 'wav' : 'mp3'}\`;
      const previewDir = path.join(publicAudioDir, 'previews');
      
      if (!fs.existsSync(previewDir)) fs.mkdirSync(previewDir, { recursive: true });
      
      const previewPath = path.join(previewDir, previewFilename);
      if (fs.existsSync(previewPath)) {
        console.log(\`[TTS Preview] Trả về file cache có sẵn: \${previewFilename}\`);
        return NextResponse.json({
          success: true,
          audioPath: \`/audio/previews/\${previewFilename}\`,
          method: \`Cached Preview (\${voice})\`,
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
      console.warn(\`[TTS API] Provider \${platform} không tồn tại, fallback sang Google.\`);
      provider = TTS_PROVIDERS['google'];
    }

    console.log(\`[TTS API] Đang sinh giọng \${voice} bằng \${provider.name}...\`);

    try {
      const result = await provider.generate(cleanText, options);
      audioBuffer = result.buffer;
      methodUsed = result.method;
      console.log(\`[TTS API] \${provider.name} xử lý thành công!\`);
    } catch (err: unknown) {
      console.error(\`[TTS API] \${provider.name} lỗi: \${(err as Error).message}. Fallback sang Google...\`);
      const fallbackResult = await TTS_PROVIDERS['google'].generate(cleanText, options);
      audioBuffer = fallbackResult.buffer;
      methodUsed = fallbackResult.method;
      provider = TTS_PROVIDERS['google'];
    }

    if (!audioBuffer) {
      return NextResponse.json({ error: 'Không thể sinh giọng đọc sau tất cả fallback.' }, { status: 500 });
    }

    const speedViaFFmpeg = provider.supportsNativeSpeed ? 1.0 : speed;
    const pitchViaFFmpeg = provider.supportsNativePitch ? 0 : pitch;

    if (pitchViaFFmpeg !== 0 || speedViaFFmpeg !== 1.0) {
      console.log(\`[TTS Post-Process] Áp dụng FFmpeg (Speed: \${speedViaFFmpeg}, Pitch: \${pitchViaFFmpeg})...\`);
      try {
        audioBuffer = await applyAudioEffects(audioBuffer, pitchViaFFmpeg, speedViaFFmpeg);
        console.log(\`[TTS Effects] Thành công!\`);
      } catch (effErr: unknown) {
        console.warn(\`[TTS Effects] Lỗi khi apply: \${(effErr as Error).message}\`);
      }
    }

    if (syncMode === 'force_sync' && targetDuration && targetDuration > 0 && audioBuffer) {
      console.log(\`[TTS Sync] Đang ép khớp âm thanh về chính xác \${targetDuration}s...\`);
      try {
        audioBuffer = await forceAudioDuration(audioBuffer, targetDuration);
        console.log(\`[TTS Sync] Ép khớp thành công!\`);
      } catch (syncErr: unknown) {
        console.warn(\`[TTS Sync] Lỗi ép khớp: \${(syncErr as Error).message}\`);
      }
    }

    const isWav = methodUsed.includes('Gemini') || methodUsed.includes('Piper') || methodUsed.includes('VieNeu');
    let filename = '';
    let localSavePath = '';
    let audioPathRet = '';
    
    if (isPreview) {
      const safePlatform = platform.replace(/[^a-z0-9]/gi, '_');
      const safeVoice = voice.replace(/[^a-z0-9\\._-]/gi, '_');
      filename = \`preview_\${safePlatform}_\${safeVoice}_s\${speed}_p\${pitch}.\${isWav ? 'wav' : 'mp3'}\`;
      const previewDir = path.join(publicAudioDir, 'previews');
      if (!fs.existsSync(previewDir)) fs.mkdirSync(previewDir, { recursive: true });
      localSavePath = path.join(previewDir, filename);
      audioPathRet = \`/audio/previews/\${filename}\`;
    } else {
      filename = \`chapter_\${chapterNum}_scene_\${sceneIndex}.\${isWav ? 'wav' : 'mp3'}\`;
      localSavePath = path.join(publicAudioDir, filename);
      audioPathRet = \`/audio/\${filename}\`;
    }
    
    fs.writeFileSync(localSavePath, audioBuffer);

    let driveSaved = false;
    let driveFilePath = '';
    
    if (!isPreview && drivePath && drivePath.trim().length > 0) {
      try {
        const cleanedDrivePath = drivePath.trim();
        let driveFolder = cleanedDrivePath;
        if (chapterNum > 0) {
          driveFolder = path.join(cleanedDrivePath, \`Chương \${chapterNum}\`);
        }
        if (!fs.existsSync(driveFolder)) {
          fs.mkdirSync(driveFolder, { recursive: true });
        }
          
        const scriptTitle = ten_tac_pham 
          ? ten_tac_pham.replace(/[\\/\\:\\*\\?\\"<>\\|]/g, '_').trim() 
          : 'Kịch Bản';
        const driveFilename = \`\${scriptTitle}_Chuong_\${chapterNum}_Canh_\${sceneIndex}.\${isWav ? 'wav' : 'mp3'}\`;
        
        driveFilePath = path.join(driveFolder, driveFilename);
        fs.writeFileSync(driveFilePath, audioBuffer);
        driveSaved = true;
        console.log(\`[Drive Service] Đã lưu âm thanh với tên kịch bản: \${driveFilePath}\`);
      } catch (driveErr: unknown) {
        console.error(\`[Drive Service] Lỗi lưu Drive:\`, (driveErr as Error).message);
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
`;

fs.writeFileSync(path.join('src', 'app', 'api', 'generate-tts', 'route.ts'), headerCode + newLogic);
console.log('Successfully refactored route.ts');
