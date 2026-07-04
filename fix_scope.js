const fs = require('fs');
const path = require('path');

const filePath = path.join('src', 'app', 'api', 'generate-tts', 'route.ts');
let code = fs.readFileSync(filePath, 'utf8');

const oldTryBlock = `    try {
      const result = await provider.generate(cleanText, options);
      audioBuffer = result.buffer;
      methodUsed = result.method;
      console.log(\`[TTS API] \${provider.name} xử lý thành công!\`);
    } catch (err: unknown) {`;

const newTryBlock = `    let nativeSpeedApplied = provider.supportsNativeSpeed;
    let nativePitchApplied = provider.supportsNativePitch;

    try {
      const result = await provider.generate(cleanText, options);
      audioBuffer = result.buffer;
      methodUsed = result.method;
      if (result.nativeSpeedApplied !== undefined) nativeSpeedApplied = result.nativeSpeedApplied;
      if (result.nativePitchApplied !== undefined) nativePitchApplied = result.nativePitchApplied;
      console.log(\`[TTS API] \${provider.name} xử lý thành công!\`);
    } catch (err: unknown) {`;

code = code.replace(oldTryBlock, newTryBlock);

const ffmpegLogicReplace = `const speedViaFFmpeg = (result.nativeSpeedApplied ?? provider.supportsNativeSpeed) ? 1.0 : speed;
    const pitchViaFFmpeg = (result.nativePitchApplied ?? provider.supportsNativePitch) ? 0 : pitch;`;
const fixedFfmpegLogic = `const speedViaFFmpeg = nativeSpeedApplied ? 1.0 : speed;
    const pitchViaFFmpeg = nativePitchApplied ? 0 : pitch;`;

code = code.replace(ffmpegLogicReplace, fixedFfmpegLogic);

fs.writeFileSync(filePath, code);
console.log('Fixed result scope in route.ts');
