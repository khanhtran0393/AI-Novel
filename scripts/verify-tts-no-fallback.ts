import fs from 'fs';
import path from 'path';
import {
  loadVinaProfiles,
  mergeSettings,
  resolveSamplePath,
} from '../src/lib/vinaVoice/profiles';
import { resolveSpeaker, SpeakerResolveError } from '../src/lib/vinaVoice/speakerRegistry';
import { provider_piper } from '../src/app/api/generate-tts/platforms/piper';
import { provider_vieneu_tts } from '../src/app/api/generate-tts/platforms/vieneu_tts';
import { provider_vina_voice } from '../src/app/api/generate-tts/platforms/vina_voice';
import { STATIC_VOICE_CATALOG } from '../src/lib/voiceCatalog';
import type { TTSOptions } from '../src/app/api/generate-tts/providers';

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

async function assertRejects(fn: () => unknown | Promise<unknown>, message: RegExp): Promise<string> {
  try {
    await fn();
  } catch (e) {
    const got = e instanceof Error ? e.message : String(e);
    assert(message.test(got), `Unexpected error "${got}", expected ${message}`);
    return got;
  }
  throw new Error(`Expected function to reject with ${message}`);
}

const deletedProfiles = [
  'Giọng Bảo Lồng Tiếng Già 1',
  'Bảo - Giả giọng nữ',
  'USER-Lồng Tiếng Nam 1',
];

for (const file of [
  'data/vina-voices/profiles_goc.json',
  'Voice Studio/data/vina-voices/profiles_goc.json',
]) {
  if (!fs.existsSync(file)) continue;
  const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, unknown>;
  for (const name of deletedProfiles) {
    assert(!(name in raw), `${name} must be removed from ${file}`);
  }
}

const profiles = loadVinaProfiles(process.cwd());
const base = mergeSettings({}, process.cwd());
const missing = profiles
  .map((p) => ({
    name: p.name,
    filename: p.filename,
    sample: resolveSamplePath(p, base, process.cwd()),
  }))
  .filter((p) => !p.sample);

assert(missing.length === 0, `Vina profiles without sample: ${JSON.stringify(missing, null, 2)}`);
assert(Object.values(STATIC_VOICE_CATALOG.vina_voice || {}).every((list) => list.length === 0), 'static Vina catalog must not contain Edge/Piper fallback voices');

async function main(): Promise<void> {
  const opts = (voice: string): TTSOptions => ({
    voice,
    speed: 1,
    pitch: 0,
    tiktokSessionId: '',
    api_url_vieneu: '',
    apiKeys: [],
  });

  const noDefaultMsg = await assertRejects(
    () => resolveSpeaker({ cwd: process.cwd(), settings: {} }),
    /DEFAULT_NARRATOR|reference_audio|profile Zero-Shot/i,
  );

  const edgeInVinaMsg = await assertRejects(
    () =>
      provider_vina_voice.generate('Xin chao.', opts('vi-VN-NamMinhNeural')),
    /khong phai profile Zero-Shot/i,
  );

  const piperMsg = await assertRejects(
    () =>
      provider_piper.generate('Xin chao.', opts('not-a-real-piper-model')),
    /not-a-real-piper-model|khong ton tai/i,
  );

  const vieneuMsg = await assertRejects(
    () =>
      provider_vieneu_tts.generate('Xin chao.', opts('not-a-real-vieneu-voice')),
    /not-a-real-vieneu-voice|Khong fallback/i,
  );

  console.log(
    JSON.stringify(
      {
        ok: true,
        profiles: profiles.length,
        samplesResolved: profiles.length - missing.length,
        deletedProfiles,
        checks: {
          noDefaultMsg,
          edgeInVinaMsg,
          piperMsg,
          vieneuMsg,
        },
        samplesDir: path.join(process.cwd(), 'data', 'vina-voices', 'samples'),
      },
      null,
      2,
    ),
  );
}

void main();
