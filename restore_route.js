const fs = require('fs');
const path = require('path');

const filePath = path.join('src', 'app', 'api', 'generate-tts', 'route.ts');
let code = fs.readFileSync(filePath, 'utf8');

// 1. Update TTSProvider interface
code = code.replace(
  'generate: (text: string, options: TTSOptions) => Promise<{ buffer: Buffer, method: string }>;',
  'generate: (text: string, options: TTSOptions) => Promise<{ buffer: Buffer, method: string, nativeSpeedApplied?: boolean, nativePitchApplied?: boolean }>;'
);

// 2. Insert vieneu_tts back into TTS_PROVIDERS
const capcutIndex = code.indexOf('  capcut_tts: {');
const vieneuBlock = `  vieneu_tts: {
    name: 'VieNeu TTS',
    supportsNativeSpeed: true,
    supportsNativePitch: false, // Default is false, but we can override it in generate
    generate: async (text, opts) => {
      const rawVoice = opts.voice || 'ngochuyen';
      const modelBaseName = rawVoice.normalize('NFD')
                                    .replace(/[\\u0300-\\u036f]/g, '')
                                    .replace(/đ/g, 'd').replace(/Đ/g, 'D')
                                    .toLowerCase()
                                    .replace(/\\s+/g, '');
      
      const modelName = \`\${modelBaseName}.onnx\`;
      const modelPath = path.join(process.cwd(), 'bin', 'piper_vn', modelName);
      
      let buffer;
      let method;
      let nativePitchApplied = false;
      
      if (fs.existsSync(modelPath)) {
          console.log(\`[VieNeu-TTS API] Found local model, routing to Piper: \${modelName}\`);
          buffer = await generatePiperTTS(text, modelName, opts.speed);
          method = \`VieNeu-TTS (Piper: \${modelName})\`;
      } else {
          const v = rawVoice.toLowerCase();
          if (v.includes('nam') || v.includes('adam') || v.includes('mạnh dũng') || v.includes('trung') || v.includes('sơn') || v.includes('anh') || v.includes('khôi') || v.includes('quân') || v.includes('an')) {
              console.log(\`[VieNeu-TTS API] Model \${modelName} not found locally, routing to EdgeTTS: NamMinh\`);
              buffer = await generateEdgeTTS(text, 'vi-VN-NamMinhNeural', opts.speed, opts.pitch);
              method = \`VieNeu-TTS (EdgeTTS: NamMinh)\`;
          } else {
              console.log(\`[VieNeu-TTS API] Model \${modelName} not found locally, routing to EdgeTTS: HoaiMy\`);
              buffer = await generateEdgeTTS(text, 'vi-VN-HoaiMyNeural', opts.speed, opts.pitch);
              method = \`VieNeu-TTS (EdgeTTS: HoaiMy)\`;
          }
          nativePitchApplied = true; // EdgeTTS applied pitch!
      }
      return { buffer, method, nativePitchApplied, nativeSpeedApplied: true };
    }
  },
`;

if (capcutIndex !== -1 && !code.includes('vieneu_tts: {')) {
  code = code.substring(0, capcutIndex) + vieneuBlock + code.substring(capcutIndex);
}

// 3. Update the FFmpeg logic to respect dynamic flags
const ffmpegLogicSearch = 'const speedViaFFmpeg = provider.supportsNativeSpeed ? 1.0 : speed;';
const ffmpegLogicReplace = `const speedViaFFmpeg = (result.nativeSpeedApplied ?? provider.supportsNativeSpeed) ? 1.0 : speed;
    const pitchViaFFmpeg = (result.nativePitchApplied ?? provider.supportsNativePitch) ? 0 : pitch;`;

code = code.replace(
  /const speedViaFFmpeg = provider\.supportsNativeSpeed \? 1\.0 : speed;\s*const pitchViaFFmpeg = provider\.supportsNativePitch \? 0 : pitch;/g,
  ffmpegLogicReplace
);

// 4. Add 'vieneu_tts' to isWavPreview
code = code.replace(
  /const isWavPreview = platform === 'piper' \|\| platform === 'gemini_tts';/g,
  "const isWavPreview = platform === 'piper' || platform === 'gemini_tts' || platform === 'vieneu_tts';"
);

fs.writeFileSync(filePath, code);
console.log('Restored vieneu_tts logic in route.ts');
