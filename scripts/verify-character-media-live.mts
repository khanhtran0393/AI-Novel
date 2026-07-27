import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { request } from 'undici';

import {
  buildIdentityLockEnglish,
  composeCharacterReferenceSheetPrompt,
  normalizeNhanVatProfile,
} from '../src/lib/characterProfile.ts';
import { localCharacterSheetFilename } from '../src/contracts/keys.ts';
import { YOUTUBE_THUMB_SCENE_INDEX } from '../src/lib/youtube-safe/assets.ts';
import { probeVisualArtifact } from '../src/lib/mediaArtifactValidation.ts';

const baseUrl = process.env.AINOVEL_BASE_URL || 'http://127.0.0.1:3000';
const requestedStage = String(
  process.env.AINOVEL_LIVE_MEDIA_STAGE || 'all',
).toLowerCase();
const latestStore = path.join(
  process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'),
  'ai-novel-script-generator',
  'store',
  'latest.json',
);

type JsonRecord = Record<string, unknown>;

function readState(): JsonRecord {
  const raw = JSON.parse(fs.readFileSync(latestStore, 'utf8')) as JsonRecord;
  return ((raw.state as JsonRecord | undefined) || raw) as JsonRecord;
}

function mustString(value: unknown, label: string): string {
  const result = String(value || '').trim();
  if (!result) throw new Error(`Missing real ${label} in durable app state.`);
  return result;
}

async function generate(
  label: string,
  body: JsonRecord,
): Promise<{
  imagePath: string;
  localFilePath: string;
  imagePaths: string[];
}> {
  const startedAt = Date.now();
  console.log(`[live-media] START ${label}`);
  const response = await request(`${baseUrl}/api/generate-image`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    headersTimeout: 12 * 60_000,
    bodyTimeout: 12 * 60_000,
  });
  const data = (await response.body.json().catch(() => ({}))) as JsonRecord;
  if (response.statusCode < 200 || response.statusCode >= 300) {
    throw new Error(
      `${label} HTTP ${response.statusCode}: ${String(
        data.error || data.message || 'unknown provider error',
      )}`,
    );
  }

  const localFilePath = mustString(data.localFilePath, `${label}.localFilePath`);
  const imagePath = mustString(data.imagePath, `${label}.imagePath`);
  const probe = probeVisualArtifact(localFilePath, 'image');
  if (!probe.ok) {
    throw new Error(`${label} invalid image: ${probe.error}`);
  }
  const served = await fetch(`${baseUrl}${imagePath}`);
  if (!served.ok) {
    throw new Error(`${label} preview URL HTTP ${served.status}: ${imagePath}`);
  }
  console.log(
    `[live-media] PASS ${label} ${probe.width}x${probe.height} ${probe.sizeBytes}B ${Math.round(
      (Date.now() - startedAt) / 1000,
    )}s -> ${localFilePath}`,
  );
  return {
    imagePath,
    localFilePath,
    imagePaths: Array.isArray(data.imagePaths)
      ? data.imagePaths.map(String).filter(Boolean)
      : [imagePath],
  };
}

const state = readState();
const names = Array.isArray(state.nhan_vat)
  ? state.nhan_vat.map(String).filter(Boolean)
  : [];
const characterName = mustString(names[0], 'character');
const profiles = (state.nhan_vat_prompts || {}) as Record<string, JsonRecord>;
const profile = normalizeNhanVatProfile(profiles[characterName] || {});
const setup = (state.setup || {}) as JsonRecord;
const styleHint = mustString(
  state.visualDnaPrompt || state.mediaStylePreset,
  'Visual DNA / Media Style',
);
const genre = [
  String(setup.chu_de || '').trim(),
  String(setup.phong_cach || '').trim(),
]
  .filter(Boolean)
  .join(' / ');
if (!genre) throw new Error('Missing real Setup genre in durable app state.');

const common = {
  drivePath: String(state.savePathCharacter || state.savePathImage || ''),
  ten_tac_pham: mustString(state.ten_tac_pham, 'project title'),
  cookie: '',
  imageProvider: mustString(state.imageProvider, 'image provider'),
  model: mustString(state.imageModel, 'image model'),
  imageApiKey: String(state.imageApiKey || ''),
  apiKey: String(state.apiKey || ''),
  apiKeys: Array.isArray(state.apiKeys) ? state.apiKeys : [],
  imageAspectRatio: mustString(state.imageAspectRatio, 'image aspect ratio'),
  imageCount: 1,
};

const existingSheet = String(
  process.env.AINOVEL_EXISTING_CHARACTER_SHEET || '',
).trim();
const sheet = existingSheet
  ? {
      localFilePath: existingSheet,
      imagePath: `/api/serve-image?path=${encodeURIComponent(existingSheet)}`,
      imagePaths: [] as string[],
    }
  : await generate('character-sheet', {
      ...common,
      prompt: composeCharacterReferenceSheetPrompt(profile, characterName, {
        styleHint,
        genre,
      }),
      chapterNum: 0,
      sceneIndex: 999,
      promptIndex: 999,
      assetFilename: localCharacterSheetFilename(characterName),
    });

const sheetProbe = probeVisualArtifact(sheet.localFilePath, 'image');
if (!sheetProbe.ok) {
  throw new Error(`Existing character sheet invalid: ${sheetProbe.error}`);
}
if (requestedStage === 'sheet') {
  console.log('[verify-character-media-live] MEDIA_OK stage=sheet');
  process.exit(0);
}

const generatedPrompts = (state.generatedPrompts || {}) as Record<
  string,
  JsonRecord[]
>;
const sceneEntries = Object.entries(generatedPrompts).filter(
  ([key, value]) => !key.endsWith('_990') && Array.isArray(value) && value.length,
);
const [sceneKey, scenePrompts] = sceneEntries[0] || [];
if (!sceneKey || !scenePrompts?.length) {
  throw new Error('Missing real scene prompt in durable app state.');
}
const [chapterNum, sceneIndex] = sceneKey.split('_').map(Number);
const scenePrompt = mustString(
  scenePrompts[0].image_prompt || scenePrompts[0].prompt,
  'scene image prompt',
);
if (requestedStage === 'all' || requestedStage === 'scene') {
  await generate('scene-with-character-reference', {
    ...common,
    drivePath: String(state.savePathImage || ''),
    prompt: scenePrompt,
    chapterNum,
    sceneIndex,
    promptIndex: 0,
    characterPrompt: buildIdentityLockEnglish(profile),
    referenceImagePath: sheet.localFilePath,
    ingredientPaths: [sheet.localFilePath],
  });
}
if (requestedStage === 'scene') {
  console.log('[verify-character-media-live] MEDIA_OK stage=scene');
  process.exit(0);
}

const hooks = (state.chapterHooks || {}) as Record<string, JsonRecord>;
const chapterHook = hooks[String(chapterNum)] || Object.values(hooks)[0];
const thumbnailPrompt = mustString(
  chapterHook?.thumbnailPrompt,
  'thumbnail prompt',
);
if (requestedStage === 'all' || requestedStage === 'thumbnail') {
  await generate('youtube-thumbnail', {
    ...common,
    drivePath: String(state.savePathImage || ''),
    prompt: thumbnailPrompt,
    chapterNum,
    sceneIndex: YOUTUBE_THUMB_SCENE_INDEX,
    promptIndex: 0,
    imageAspectRatio: '16:9',
    referenceImagePath: sheet.localFilePath,
    ingredientPaths: [sheet.localFilePath],
  });
}

console.log('[verify-character-media-live] MEDIA_OK');
