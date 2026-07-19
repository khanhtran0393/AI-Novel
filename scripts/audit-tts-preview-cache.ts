import fs from 'fs';
import path from 'path';
import { inspectTtsAudioFile } from '../src/lib/tts/audioQuality';

const root = path.join(process.cwd(), 'data', 'tts-preview-cache');
const strict = process.argv.includes('--strict');
const knownPlatforms = [
  'omnivoice_local',
  'capcut_tts',
  'elevenlabs',
  'gemini_tts',
  'google',
  'hotai_tts',
  'openai_tts',
  'tiktok_tts',
  'vieneu_tts',
  'vina_voice',
  'edge_tts',
  'piper',
  'vbee',
];

function platformFromFilename(filename: string): string {
  return (
    knownPlatforms.find(
      (platform) =>
        filename.startsWith(`pv_${platform}_`) ||
        filename.startsWith(`preview_${platform}_`),
    ) || 'unknown'
  );
}

const files = fs.existsSync(root)
  ? fs
      .readdirSync(root)
      .filter((name) => /\.(wav|mp3)$/i.test(name))
      .sort()
  : [];
const summary: Record<string, { total: number; passed: number; rejected: number }> = {};
const rejected: Array<{ file: string; platform: string; reasons: string[] }> = [];

for (let index = 0; index < files.length; index += 1) {
  const file = files[index];
  const platform = platformFromFilename(file);
  summary[platform] ||= { total: 0, passed: 0, rejected: 0 };
  summary[platform].total += 1;
  const quality = inspectTtsAudioFile(path.join(root, file));
  if (quality.ok) {
    summary[platform].passed += 1;
  } else {
    summary[platform].rejected += 1;
    rejected.push({ file, platform, reasons: quality.reasons });
  }
  if ((index + 1) % 100 === 0) {
    console.error(`[audit-tts-preview-cache] ${index + 1}/${files.length}`);
  }
}

console.log(
  JSON.stringify(
    {
      ok: rejected.length === 0,
      root,
      total: files.length,
      passed: files.length - rejected.length,
      rejected: rejected.length,
      byPlatform: summary,
      rejectedFiles: rejected,
    },
    null,
    2,
  ),
);

if (strict && rejected.length > 0) process.exitCode = 1;
