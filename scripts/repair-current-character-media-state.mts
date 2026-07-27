import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  characterImageKey,
  imageAssetKey,
  localCharacterSheetFilename,
  localImageFilename,
  videoAssetKey,
} from '../src/contracts/keys.ts';
import { YOUTUBE_THUMB_SCENE_INDEX } from '../src/lib/youtube-safe/assets.ts';
import { probeVisualArtifact } from '../src/lib/mediaArtifactValidation.ts';

const appData =
  process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
const userData = path.join(appData, 'ai-novel-script-generator');
const targets = [
  path.join(userData, 'store', 'latest.json'),
  path.join(userData, 'novel_store_backup.json'),
].filter((target, index, all) => all.indexOf(target) === index);

function atomicWrite(target: string, data: unknown) {
  const backup = `${target}.bak-character-media-${Date.now()}`;
  fs.copyFileSync(target, backup);
  const temp = `${target}.tmp-character-media-${process.pid}`;
  fs.writeFileSync(temp, JSON.stringify(data), 'utf8');
  fs.renameSync(temp, target);
  console.log(`[repair-character-media] backup=${backup}`);
}

for (const target of targets) {
  if (!fs.existsSync(target)) continue;
  const root = JSON.parse(fs.readFileSync(target, 'utf8')) as Record<
    string,
    unknown
  >;
  const state =
    ((root.state as Record<string, unknown> | undefined) || root) as Record<
      string,
      unknown
    >;
  const names = Array.isArray(state.nhan_vat)
    ? state.nhan_vat.map(String).filter(Boolean)
    : [];
  const characterName = names[0];
  if (!characterName) throw new Error(`No real character in ${target}`);

  const chapterNum = Number(state.chuong_dang_chon) || 1;
  const characterFile = path.join(
    process.cwd(),
    'public',
    'images',
    localCharacterSheetFilename(characterName),
  );
  const thumbnailFile = path.join(
    process.cwd(),
    'public',
    'images',
    localImageFilename(chapterNum, YOUTUBE_THUMB_SCENE_INDEX, 0),
  );
  for (const [label, file] of [
    ['character sheet', characterFile],
    ['thumbnail', thumbnailFile],
  ] as const) {
    const probe = probeVisualArtifact(file, 'image');
    if (!probe.ok) throw new Error(`${label} is not valid: ${probe.error}`);
  }

  const characterUrl = `/api/serve-image?path=${encodeURIComponent(
    characterFile,
  )}`;
  const thumbnailUrl = `/api/serve-image?path=${encodeURIComponent(
    thumbnailFile,
  )}`;
  const sceneVideoFile = path.join(
    process.cwd(),
    'public',
    'video',
    `chapter_${chapterNum}_scene_1_animatic.mp4`,
  );
  const sceneVideoProbe = fs.existsSync(sceneVideoFile)
    ? probeVisualArtifact(sceneVideoFile, 'video')
    : null;
  if (sceneVideoProbe && !sceneVideoProbe.ok) {
    throw new Error(`scene video is not valid: ${sceneVideoProbe.error}`);
  }
  const profiles = {
    ...((state.nhan_vat_prompts || {}) as Record<
      string,
      Record<string, unknown>
    >),
  };
  profiles[characterName] = {
    ...(profiles[characterName] || {}),
    face_ref: characterFile,
    identity_lock:
      String(profiles[characterName]?.identity_lock || '').trim() ||
      `sheet:${characterName}`,
  };

  const thumbKey = imageAssetKey(
    chapterNum,
    YOUTUBE_THUMB_SCENE_INDEX,
    0,
  );
  const chapterHooks = {
    ...((state.chapterHooks || {}) as Record<
      string,
      Record<string, unknown>
    >),
  };
  chapterHooks[String(chapterNum)] = {
    ...(chapterHooks[String(chapterNum)] || {}),
    thumbnailImagePath: thumbnailUrl,
  };

  Object.assign(state, {
    nhan_vat_prompts: profiles,
    generatedImages: {
      ...((state.generatedImages || {}) as Record<string, string>),
      [characterImageKey(characterName)]: characterUrl,
      [thumbKey]: thumbnailUrl,
    },
    generatedImageVariants: {
      ...((state.generatedImageVariants || {}) as Record<string, string[]>),
      [thumbKey]: [thumbnailUrl],
    },
    generatedVideos:
      sceneVideoProbe?.ok
        ? {
            ...((state.generatedVideos || {}) as Record<string, string>),
            [videoAssetKey(chapterNum, 1, 0)]:
              `/api/serve-local-video?path=${encodeURIComponent(sceneVideoFile)}`,
          }
        : state.generatedVideos,
    chapterHooks,
  });

  atomicWrite(target, root);
  console.log(
    `[repair-character-media] PASS target=${target} character=${characterName} thumbKey=${thumbKey}`,
  );
}
