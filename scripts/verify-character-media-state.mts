import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  characterImageKey,
  imageAssetKey,
  videoAssetKey,
} from '../src/contracts/keys.ts';
import { resolveImageReferenceTransportPath } from '../src/lib/mediaReference.ts';
import { probeVisualArtifact } from '../src/lib/mediaArtifactValidation.ts';
import { YOUTUBE_THUMB_SCENE_INDEX } from '../src/lib/youtube-safe/assets.ts';

const appData =
  process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
const userData = path.join(appData, 'ai-novel-script-generator');
const targets = [
  path.join(userData, 'store', 'latest.json'),
  path.join(userData, 'novel_store_backup.json'),
];

function resolveVideoReference(raw: string): string {
  const url = new URL(raw, 'http://ainovel.local');
  const candidate = url.searchParams.get('path') || raw;
  return decodeURIComponent(candidate);
}

for (const target of targets) {
  assert.ok(fs.existsSync(target), `Missing durable store: ${target}`);
  const root = JSON.parse(fs.readFileSync(target, 'utf8')) as Record<
    string,
    unknown
  >;
  const state =
    ((root.state as Record<string, unknown> | undefined) || root) as Record<
      string,
      unknown
    >;
  const characterName = Array.isArray(state.nhan_vat)
    ? String(state.nhan_vat[0] || '')
    : '';
  assert.ok(characterName, `No real character in ${target}`);

  const profiles = (state.nhan_vat_prompts || {}) as Record<
    string,
    Record<string, unknown>
  >;
  const profile = profiles[characterName] || {};
  const faceRef = String(profile.face_ref || '');
  assert.ok(faceRef, `Missing face_ref for ${characterName} in ${target}`);
  assert.notEqual(
    faceRef,
    '/api/serve-image',
    `face_ref lost its query in ${target}`,
  );

  const generatedImages = (state.generatedImages || {}) as Record<
    string,
    string
  >;
  const chapterNum = Number(state.chuong_dang_chon) || 1;
  const characterRef = generatedImages[characterImageKey(characterName)] || '';
  const thumbRef =
    generatedImages[
      imageAssetKey(chapterNum, YOUTUBE_THUMB_SCENE_INDEX, 0)
    ] || '';
  for (const [label, ref] of [
    ['character', characterRef],
    ['thumbnail', thumbRef],
  ] as const) {
    assert.match(
      ref,
      /^\/api\/serve-image\?(file|path)=/u,
      `${label} reference lost its query in ${target}`,
    );
    const diskPath = resolveImageReferenceTransportPath(ref);
    const absolutePath = path.isAbsolute(diskPath)
      ? diskPath
      : path.resolve(process.cwd(), diskPath);
    const probe = probeVisualArtifact(absolutePath, 'image');
    assert.equal(
      probe.ok,
      true,
      `${label} artifact invalid in ${target}: ${probe.error || absolutePath}`,
    );
  }

  const generatedVideos = (state.generatedVideos || {}) as Record<
    string,
    string
  >;
  const videoRef = generatedVideos[videoAssetKey(chapterNum, 1, 0)] || '';
  assert.match(
    videoRef,
    /^\/api\/serve-local-video\?path=/u,
    `video reference lost its path in ${target}`,
  );
  const videoProbe = probeVisualArtifact(resolveVideoReference(videoRef), 'video');
  assert.equal(
    videoProbe.ok,
    true,
    `video artifact invalid in ${target}: ${videoProbe.error || videoRef}`,
  );

  console.log(
    `[verify-character-media-state] PASS target=${target} character=${characterName}`,
  );
}
