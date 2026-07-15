/**
 * Static audit: generation buttons / actions must call known API paths.
 * Run: npx tsx scripts/audit-gen-buttons-api.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

const checks = [
  // [label, file, mustMatch]
  ['Write chapter', 'src/app/workspace/modules/writeModule.ts', /WRITE_CHAPTER|postGenerate/],
  ['Outline', 'src/app/workspace/modules/setupModule.ts', /GENERATE_OUTLINE|postGenerate/],
  ['Expand scene', 'src/app/workspace/modules/sceneModule.ts', /EXPAND_SCENE/],
  ['Rewrite scene', 'src/app/workspace/modules/sceneModule.ts', /REWRITE_SCENE/],
  ['Image prompt', 'src/app/workspace/modules/imageModule.ts', /GENERATE_IMAGE_PROMPT/],
  ['Image gen', 'src/app/workspace/modules/imageModule.ts', /API\.generateImage|generate-image/],
  ['Video gen', 'src/app/workspace/modules/videoModule.ts', /API\.generateVideo|generate-video/],
  ['TTS gen', 'src/app/workspace/modules/ttsModule.ts', /generateTts|generate-tts|API\.generateTts/],
  ['TTS preview play', 'src/app/workspace/modules/tts/preview.ts', /isPreview:\s*true/],
  ['TTS preview API', 'src/app/workspace/modules/tts/preview.ts', /API\.generateTts/],
  ['Role cast preview uses playTTS', 'src/app/workspace/features/tts/RoleCastStudioModal.tsx', /playTTSAction/],
  ['Role cast credentials', 'src/app/workspace/features/tts/RoleCastStudioModal.tsx', /getTTSCredentialsForConfig/],
  ['Char prompt', 'src/app/workspace/modules/characterModule.ts', /GENERATE_CHARACTER_PROMPT/],
  ['Char image', 'src/app/workspace/modules/characterModule.ts', /API\.generateImage/],
  ['Commit memory', 'src/app/workspace/modules/writeModule.ts', /COMMIT_MEMORY/],
  ['Ship pack', 'src/app/workspace/features/project/ShipPackModal.tsx', /API\.shipPack/],
  ['CapCut', 'src/app/workspace/features/project/CapCutExportButton.tsx', /API\.exportCapcut/],
  ['Clone voice', 'src/app/workspace/features/tts/TTSConfigModal.tsx', /API\.vinaVoiceClone/],
  ['TTS config preview', 'src/app/workspace/features/tts/TTSConfigModal.tsx', /API\.generateTts/],
  ['Cast auto-tag', 'src/app/workspace/features/tts/RoleCastStudioModal.tsx', /API\.castAutoTag/],
];

let hard = 0;
for (const [label, rel, re] of checks) {
  const abs = path.join(root, rel);
  if (!fs.existsSync(abs)) {
    console.log(`HARD  missing ${rel} (${label})`);
    hard++;
    continue;
  }
  const src = fs.readFileSync(abs, 'utf8');
  const ok = re.test(src);
  console.log(`${ok ? 'PASS' : 'HARD'}  ${label} — ${rel}`);
  if (!ok) hard++;
}

// Role cast must not only pass store.apiKeys without credential helper
const cast = fs.readFileSync(
  path.join(root, 'src/app/workspace/features/tts/RoleCastStudioModal.tsx'),
  'utf8',
);
const badCreds =
  /playTTSAction\(\{[\s\S]*?apiKeys:\s*store\.apiKeys[\s\S]*?\}\)/.test(cast) &&
  !/getTTSCredentialsForConfig/.test(cast);
if (badCreds) {
  console.log('HARD  Role cast still uses raw store.apiKeys without credential helper');
  hard++;
} else {
  console.log('PASS  Role cast credentials not raw store-only');
}

console.log(`\nHARD: ${hard}`);
process.exit(hard ? 1 : 0);
