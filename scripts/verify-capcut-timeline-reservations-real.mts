import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { chapterAssetPrefix } from '../src/contracts/keys';
import { probeDurationSec } from '../src/lib/audioStudio';
import {
  collectChapterAudioDiskPaths,
  collectChapterImageDiskPaths,
  collectChapterVideoDiskPaths,
} from '../src/lib/integrations/mediaPaths';
import {
  buildChapterTimelineReservation,
  persistChapterTimelineReservation,
} from '../src/lib/integrations/timelineReservation';
import { buildXinChaoPack } from '../src/lib/integrations/xinchaoCut';
import { runChapterPipeline } from '../src/lib/integrations/chapterPipeline';

const appData = String(process.env.APPDATA || '').trim();
assert.ok(appData, 'APPDATA is required');
const storePath = path.join(
  appData,
  'ai-novel-script-generator',
  'store',
  'latest.json',
);
assert.ok(fs.existsSync(storePath), `Durable store not found: ${storePath}`);

const persisted = JSON.parse(fs.readFileSync(storePath, 'utf8')) as {
  state?: Record<string, unknown>;
};
const state = (persisted.state || persisted) as {
  ten_tac_pham?: string;
  chuong_dang_chon?: number;
  generatedPrompts?: Record<string, Array<{ timestamp?: string }>>;
  generatedAudioPaths?: Record<
    string,
    { path: string; duration: number } | string
  >;
  generatedImages?: Record<string, string>;
  generatedVideos?: Record<string, string>;
  imageProvider?: string;
  videoProvider?: string;
  videoAspectRatio?: string;
  videoDuration?: number;
};
const chapterNum = Number(state.chuong_dang_chon);
assert.ok(Number.isInteger(chapterNum) && chapterNum > 0);
const prefix = chapterAssetPrefix(chapterNum);
const projectName = String(state.ten_tac_pham || '').normalize('NFC').trim();
assert.ok(projectName, 'Durable store is missing ten_tac_pham');

const prompts = Object.fromEntries(
  Object.entries(state.generatedPrompts || {}).filter(([key]) =>
    key.startsWith(prefix),
  ),
);
const rawAudio = collectChapterAudioDiskPaths(
  chapterNum,
  state.generatedAudioPaths || {},
);
const images = collectChapterImageDiskPaths(
  chapterNum,
  state.generatedImages || {},
);
const videos = collectChapterVideoDiskPaths(
  chapterNum,
  state.generatedVideos || {},
);
assert.ok(rawAudio.length > 0, 'No real chapter TTS resolved from durable store');
assert.ok(Object.keys(prompts).length > 0, 'No real prompt timestamps resolved');

const input = {
  chapterNum,
  projectName,
  prompts,
  audio: rawAudio.map((item) => ({
    key: item.key,
    path: item.disk,
    durationSec:
      probeDurationSec(item.disk, process.cwd()) || Number(item.duration) || 0,
  })),
  images: images.map((item) => ({ key: item.key, path: item.disk })),
  videos: process.argv.includes('--images-only')
    ? []
    : videos.map((item) => ({ key: item.key, path: item.disk })),
};

const reservedOnly = buildChapterTimelineReservation({
  ...input,
  images: [],
  videos: [],
  now: '2026-07-27T00:00:00.000Z',
});
const filled = buildChapterTimelineReservation({
  ...input,
  previous: reservedOnly,
  now: '2026-07-27T00:01:00.000Z',
});
assert.deepEqual(
  filled.slots.map((slot) => [slot.slotId, slot.startSec, slot.endSec]),
  reservedOnly.slots.map((slot) => [slot.slotId, slot.startSec, slot.endSec]),
  'Real late-generated media reflowed reserved TTS slots',
);
assert.ok(filled.filledSlots > 0, 'Real media did not bind to any reserved slot');
for (const slot of filled.slots.filter((item) => item.mediaPath)) {
  assert.ok(
    fs.existsSync(slot.mediaPath!),
    `Bound media is not on disk: ${slot.slotId} -> ${slot.mediaPath}`,
  );
}

const persistedReservation = persistChapterTimelineReservation({
  ...input,
  previous: filled,
});
assert.ok(fs.existsSync(persistedReservation.filePath));
const diskJson = JSON.parse(
  fs.readFileSync(persistedReservation.filePath, 'utf8'),
) as typeof persistedReservation.reservation;
assert.equal(diskJson.reservationId, filled.reservationId);
assert.equal(diskJson.slots.length, filled.slots.length);

const aspect = String(state.videoAspectRatio || '').trim();
assert.ok(
  ['16:9', '9:16', '1:1', '4:5'].includes(aspect),
  `Invalid real videoAspectRatio: ${aspect}`,
);
const imageProvider = String(state.imageProvider || '').trim();
const videoProvider = String(state.videoProvider || '').trim();
const videoDuration = Number(state.videoDuration);
assert.ok(imageProvider && videoProvider);
assert.ok(Number.isFinite(videoDuration) && videoDuration > 0);
const pack = buildXinChaoPack({
  chapterNum,
  ten_tac_pham: projectName,
  generatedPrompts: prompts,
  generatedAudioPaths: Object.fromEntries(
    rawAudio.map((item) => [
      item.key,
      {
        path: item.disk,
        duration:
          probeDurationSec(item.disk, process.cwd()) ||
          Number(item.duration) ||
          0,
      },
    ]),
  ),
  generatedImages: Object.fromEntries(
    images.map((item) => [item.key, item.disk]),
  ),
  generatedVideos: Object.fromEntries(
    (process.argv.includes('--images-only') ? [] : videos).map((item) => [
      item.key,
      item.disk,
    ]),
  ),
  aspect,
  videoDuration,
  imageProvider,
  videoProvider,
});
assert.equal(pack.success, true, pack.error);
const packManifest = JSON.parse(
  fs.readFileSync(pack.manifestPath, 'utf8'),
) as {
  timelineReservation: typeof persistedReservation.reservation;
  suggestedTimeline: Array<{
    slotId?: string;
    kind: string;
    startSec: number;
    durationSec: number;
  }>;
};
assert.deepEqual(
  packManifest.timelineReservation.slots.map((slot) => [
    slot.slotId,
    slot.startSec,
    slot.endSec,
  ]),
  filled.slots.map((slot) => [slot.slotId, slot.startSec, slot.endSec]),
);
assert.equal(
  packManifest.suggestedTimeline.filter(
    (clip) => clip.kind === 'image' || clip.kind === 'video',
  ).length,
  filled.filledSlots,
);

const pipeline = await runChapterPipeline({
  chapterNum,
  title: `Chương ${chapterNum}`,
  ten_tac_pham: projectName,
  generatedPrompts: prompts,
  generatedAudioPaths: Object.fromEntries(
    rawAudio.map((item) => [
      item.key,
      {
        path: item.disk,
        duration:
          probeDurationSec(item.disk, process.cwd()) ||
          Number(item.duration) ||
          0,
      },
    ]),
  ),
  generatedImages: Object.fromEntries(
    images.map((item) => [item.key, item.disk]),
  ),
  generatedVideos: Object.fromEntries(
    (process.argv.includes('--images-only') ? [] : videos).map((item) => [
      item.key,
      item.disk,
    ]),
  ),
  runSeedance: false,
  runFableCut: true,
  liveEditor: false,
  aspect: aspect as '16:9' | '9:16' | '1:1' | '4:5',
  secondsPerImage: videoDuration,
});
assert.ok(
  pipeline.timelineReservationPath &&
    fs.existsSync(pipeline.timelineReservationPath),
  pipeline.timelineReservationError || 'Pipeline did not persist reservation JSON',
);
assert.equal(
  pipeline.timelineReservation?.slots.length,
  filled.slots.length,
);
assert.equal(pipeline.fablecut?.success, true, pipeline.fablecut?.error);
const fableJson = JSON.parse(
  fs.readFileSync(pipeline.fablecut!.projectPath, 'utf8'),
) as {
  media: Array<{ id: string; name: string; kind: string }>;
  clips: Array<{
    mediaId?: string;
    track: number;
    start: number;
    duration: number;
  }>;
};
const fableMediaById = new Map(
  fableJson.media.map((item) => [item.id, item]),
);
const fableAudio = fableJson.clips
  .filter(
    (clip) => fableMediaById.get(String(clip.mediaId))?.kind === 'audio',
  )
  .sort((left, right) => left.start - right.start);
assert.equal(
  fableMediaById.get(String(fableAudio[0]?.mediaId))?.name,
  '1_990.wav',
  'FableCut must place hook TTS first, not after scene 5',
);
for (let index = 1; index < fableAudio.length; index += 1) {
  assert.ok(
    Math.abs(
      fableAudio[index].start -
        (fableAudio[index - 1].start + fableAudio[index - 1].duration),
    ) <= 0.001,
    `FableCut TTS gap before audio ${index}`,
  );
}

console.log(
  JSON.stringify({
    ok: true,
    storePath,
    reservationPath: persistedReservation.filePath,
    chapterNum,
    audioFiles: rawAudio.length,
    promptScenes: Object.keys(prompts).length,
    slots: filled.slots.length,
    filledSlots: filled.filledSlots,
    durationSec: filled.durationSec,
    packRoot: pack.packRoot,
    manifestPath: pack.manifestPath,
    fablecutPath: pipeline.fablecut?.projectPath,
  }),
);
console.log('MEDIA_OK capcut-timeline-reservations-real');
