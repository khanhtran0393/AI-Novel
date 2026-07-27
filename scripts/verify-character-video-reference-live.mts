import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { request } from 'undici';

import { probeVisualArtifact } from '../src/lib/mediaArtifactValidation.ts';

const baseUrl = process.env.AINOVEL_BASE_URL || 'http://127.0.0.1:3000';
const appData =
  process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
const latestStore = path.join(
  appData,
  'ai-novel-script-generator',
  'store',
  'latest.json',
);
const raw = JSON.parse(fs.readFileSync(latestStore, 'utf8')) as Record<
  string,
  unknown
>;
const state = ((raw.state as Record<string, unknown> | undefined) ||
  raw) as Record<string, unknown>;
const chapterNum = Number(state.chuong_dang_chon) || 1;
const sceneIndex = 1;
const prompts = (state.generatedPrompts || {}) as Record<
  string,
  Array<Record<string, unknown>>
>;
const promptAsset = prompts[`${chapterNum}_${sceneIndex}`]?.[0];
const prompt = String(promptAsset?.video_prompt || '').trim();
if (!prompt) throw new Error('Missing real video_prompt in durable app state.');

const startImage = path.join(
  process.cwd(),
  'public',
  'images',
  `chapter_${chapterNum}_scene_${sceneIndex}_prompt_0.png`,
);
const startProbe = probeVisualArtifact(startImage, 'image');
if (!startProbe.ok) {
  throw new Error(`Character-consistent start image invalid: ${startProbe.error}`);
}

const setup = (state.setup || {}) as Record<string, unknown>;
const genre = [setup.chu_de, setup.phong_cach]
  .map((item) => String(item || '').trim())
  .filter(Boolean)
  .join(' / ');
const styleHint = String(
  state.visualDnaPrompt || state.mediaStylePreset || '',
).trim();
if (!genre || !styleHint) {
  throw new Error('Missing real Setup genre or Visual DNA in durable app state.');
}

console.log(
  `[live-video] START model=${String(state.videoModel)} start=${startImage}`,
);
const response = await request(`${baseUrl}/api/generate-video`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    chapterNum,
    sceneIndex,
    promptIndex: 0,
    prompt,
    duration: Number(state.videoDuration),
    startImage,
    model: String(state.videoModel || ''),
    videoProvider: String(state.videoProvider || ''),
    videoApiKey: String(state.videoApiKey || ''),
    videoAspectRatio: String(state.videoAspectRatio || ''),
    characterHints: Array.isArray(state.nhan_vat) ? state.nhan_vat : [],
    environmentHint: styleHint,
    genre,
    styleHint,
    secondsPerBeat: Number(state.secondsPerBeat),
    ten_tac_pham: String(state.ten_tac_pham || ''),
    projectTitle: String(state.ten_tac_pham || ''),
    videoMode: 'i2v',
    async: false,
  }),
  headersTimeout: 15 * 60_000,
  bodyTimeout: 15 * 60_000,
});
const data = (await response.body.json().catch(() => ({}))) as Record<
  string,
  unknown
>;
if (response.statusCode < 200 || response.statusCode >= 300) {
  throw new Error(
    `Video HTTP ${response.statusCode}: ${String(
      data.error || data.message || 'unknown provider error',
    )}`,
  );
}
const filename = String(data.filename || '').trim();
if (!filename) throw new Error('Video response missing filename.');
const localVideoPath = path.join(process.cwd(), 'public', 'video', filename);
const probe = probeVisualArtifact(localVideoPath, 'video');
if (!probe.ok) throw new Error(`Generated video invalid: ${probe.error}`);
console.log(
  `[live-video] PASS ${probe.width}x${probe.height} ${probe.durationSec}s ${probe.sizeBytes}B -> ${localVideoPath}`,
);
console.log('[verify-character-video-reference-live] MEDIA_OK');
