import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';

import {
  imageAssetKey,
  parseImageAssetKey,
  parseSceneAssetKey,
  safeDiskToken,
  videoAssetKey,
} from '@/contracts';
import {
  parseTimestampDuration,
  parseTimestampStart,
  type TimedPrompt,
} from '@/lib/timestampSync';
import { getIntegrationPaths } from './paths';
import { isFullChapterAudioKey } from './mediaPaths';

export type TimelineReservationMediaKind = 'image' | 'video';
export type TimelineReservationState = 'reserved' | 'image' | 'video';

export interface TimelineReservationAudioInput {
  key: string;
  path?: string;
  durationSec: number;
}

export interface TimelineReservationMediaInput {
  key: string;
  path: string;
}

export interface TimelineReservationScene {
  sceneIndex: number;
  startSec: number;
  endSec: number;
  durationSec: number;
  audioKeys: string[];
}

export interface TimelineReservationSlot {
  slotId: string;
  chapterNum: number;
  sceneIndex: number;
  promptIndex: number;
  startSec: number;
  endSec: number;
  durationSec: number;
  imageKey: string;
  videoKey: string;
  state: TimelineReservationState;
  mediaKey?: string;
  mediaKind?: TimelineReservationMediaKind;
  mediaPath?: string;
}

export interface ChapterTimelineReservation {
  version: 1;
  source: 'ai-novel';
  kind: 'capcut-timeline-reservation';
  reservationId: string;
  projectName: string;
  chapterNum: number;
  durationSec: number;
  fullAudioKey?: string;
  fullAudioPath?: string;
  scenes: TimelineReservationScene[];
  slots: TimelineReservationSlot[];
  filledSlots: number;
  createdAt: string;
  updatedAt: string;
}

export interface BuildChapterTimelineReservationInput {
  chapterNum: number;
  projectName: string;
  prompts: Record<string, TimedPrompt[] | undefined>;
  audio: TimelineReservationAudioInput[];
  images: TimelineReservationMediaInput[];
  videos: TimelineReservationMediaInput[];
  previous?: ChapterTimelineReservation | null;
  now?: string;
}

function roundMillis(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function sceneRank(sceneIndex: number): number {
  return sceneIndex === 990 ? -1 : sceneIndex;
}

function assertPositiveDuration(value: number, label: string): number {
  const duration = Number(value);
  if (!Number.isFinite(duration) || duration <= 0) {
    throw new Error(`${label} thiếu duration TTS hợp lệ`);
  }
  return duration;
}

function reservationId(projectName: string, chapterNum: number): string {
  return `${safeDiskToken(projectName, 'AI-Novel')}_ch${chapterNum}`;
}

/**
 * Build immutable absolute storyboard slots from real TTS scene durations.
 *
 * Prompt timestamps are scene-local. Audio scene offsets convert them to
 * chapter-absolute positions; the full chapter duration scales the offsets so
 * the final reserved end matches the real concatenated narration exactly.
 */
export function buildChapterTimelineReservation(
  input: BuildChapterTimelineReservationInput,
): ChapterTimelineReservation {
  const chapterNum = Number(input.chapterNum);
  if (!Number.isInteger(chapterNum) || chapterNum < 1) {
    throw new Error('chapterNum không hợp lệ cho timeline reservation');
  }
  const projectName = String(input.projectName || '').normalize('NFC').trim();
  if (!projectName) {
    throw new Error('Thiếu tên project cho timeline reservation');
  }

  const fullAudio = input.audio
    .filter((item) => isFullChapterAudioKey(item.key))
    .sort((left, right) => Number(right.durationSec) - Number(left.durationSec))[0];
  const sceneAudio = input.audio
    .filter((item) => !isFullChapterAudioKey(item.key))
    .map((item) => {
      const parsed = parseSceneAssetKey(item.key);
      if (!parsed || parsed.chapter !== chapterNum) return null;
      return {
        ...item,
        sceneIndex: parsed.sceneIndex,
        durationSec: assertPositiveDuration(
          item.durationSec,
          `Audio ${item.key}`,
        ),
      };
    })
    .filter((item): item is NonNullable<typeof item> => item !== null);

  const durationByScene = new Map<number, number>();
  const audioKeysByScene = new Map<number, string[]>();
  for (const item of sceneAudio) {
    durationByScene.set(
      item.sceneIndex,
      (durationByScene.get(item.sceneIndex) || 0) + item.durationSec,
    );
    audioKeysByScene.set(item.sceneIndex, [
      ...(audioKeysByScene.get(item.sceneIndex) || []),
      item.key,
    ]);
  }

  const promptScenes = Object.entries(input.prompts || {})
    .map(([key, prompts]) => {
      const parsed = parseSceneAssetKey(key);
      if (!parsed || parsed.chapter !== chapterNum || !prompts?.length) {
        return null;
      }
      return { sceneIndex: parsed.sceneIndex, prompts };
    })
    .filter((item): item is NonNullable<typeof item> => item !== null)
    .sort((left, right) => sceneRank(left.sceneIndex) - sceneRank(right.sceneIndex));

  if (promptScenes.length === 0) {
    throw new Error(
      `Chương ${chapterNum} chưa có prompt timestamp để đặt chỗ timeline`,
    );
  }

  if (sceneAudio.length === 0) {
    if (promptScenes.length !== 1 || !fullAudio) {
      throw new Error(
        `Chương ${chapterNum} thiếu duration TTS từng cảnh để đặt slot tuyệt đối`,
      );
    }
    durationByScene.set(
      promptScenes[0].sceneIndex,
      assertPositiveDuration(fullAudio.durationSec, `Audio ${fullAudio.key}`),
    );
    audioKeysByScene.set(promptScenes[0].sceneIndex, [fullAudio.key]);
  }

  for (const promptScene of promptScenes) {
    if (!(durationByScene.get(promptScene.sceneIndex)! > 0)) {
      throw new Error(
        `Thiếu TTS cảnh ${promptScene.sceneIndex} cho timeline chương ${chapterNum}`,
      );
    }
  }

  const orderedSceneIndexes = Array.from(durationByScene.keys()).sort(
    (left, right) => sceneRank(left) - sceneRank(right),
  );
  const sceneDurationSum = orderedSceneIndexes.reduce(
    (total, sceneIndex) => total + (durationByScene.get(sceneIndex) || 0),
    0,
  );
  const measuredFullDuration = fullAudio
    ? assertPositiveDuration(fullAudio.durationSec, `Audio ${fullAudio.key}`)
    : 0;
  const segmentCoverage =
    measuredFullDuration > 0 ? sceneDurationSum / measuredFullDuration : Number.NaN;
  const segmentsCoverFull =
    sceneAudio.some((item) => item.sceneIndex !== 990) &&
    Number.isFinite(segmentCoverage) &&
    segmentCoverage >= 0.95 &&
    segmentCoverage <= 1.05;
  if (fullAudio && sceneAudio.length > 0 && !segmentsCoverFull) {
    throw new Error(
      `TTS từng cảnh chỉ phủ ${roundMillis(segmentCoverage * 100)}% file full; không kéo giãn slot khi thiếu audio cảnh`,
    );
  }
  // Match selectChapterTimelineAudioPaths: if the scene files cover the full
  // narration, they are the authoritative runtime audio and their exact sum
  // owns the reservation end. Otherwise the aggregate full file owns it.
  const authoritativeDuration = segmentsCoverFull
    ? sceneDurationSum
    : measuredFullDuration > 0
      ? measuredFullDuration
      : sceneDurationSum;
  const scale = authoritativeDuration / sceneDurationSum;

  const scenes: TimelineReservationScene[] = [];
  const sceneByIndex = new Map<number, TimelineReservationScene>();
  let sceneCursor = 0;
  for (const sceneIndex of orderedSceneIndexes) {
    const durationSec = roundMillis((durationByScene.get(sceneIndex) || 0) * scale);
    const scene: TimelineReservationScene = {
      sceneIndex,
      startSec: roundMillis(sceneCursor),
      endSec: roundMillis(sceneCursor + durationSec),
      durationSec,
      audioKeys: audioKeysByScene.get(sceneIndex) || [],
    };
    scenes.push(scene);
    sceneByIndex.set(sceneIndex, scene);
    sceneCursor = scene.endSec;
  }
  if (scenes.length > 0) {
    const last = scenes[scenes.length - 1];
    last.endSec = roundMillis(authoritativeDuration);
    last.durationSec = roundMillis(last.endSec - last.startSec);
  }

  const imageByKey = new Map(
    input.images
      .filter((item) => {
        const parsed = parseImageAssetKey(item.key);
        return parsed?.chapter === chapterNum && Boolean(item.path);
      })
      .map((item) => [item.key, item.path]),
  );
  const videoByKey = new Map(
    input.videos
      .filter((item) => {
        const parsed = parseImageAssetKey(item.key.replace(/_video$/, ''));
        return parsed?.chapter === chapterNum && Boolean(item.path);
      })
      .map((item) => [item.key, item.path]),
  );

  const slots: TimelineReservationSlot[] = [];
  for (const promptScene of promptScenes) {
    const scene = sceneByIndex.get(promptScene.sceneIndex)!;
    const localScale =
      scene.durationSec / (durationByScene.get(promptScene.sceneIndex) || 1);
    for (
      let promptIndex = 0;
      promptIndex < promptScene.prompts.length;
      promptIndex += 1
    ) {
      const prompt = promptScene.prompts[promptIndex];
      const localStart = parseTimestampStart(prompt.timestamp);
      const localDuration = parseTimestampDuration(prompt.timestamp);
      if (!(localDuration > 0)) {
        throw new Error(
          `Timestamp slot ${chapterNum}_${promptScene.sceneIndex}_${promptIndex} không hợp lệ`,
        );
      }
      const localEnd = localStart + localDuration;
      const originalSceneDuration =
        durationByScene.get(promptScene.sceneIndex) || 0;
      if (
        localStart < 0 ||
        localEnd > originalSceneDuration + Math.max(0.15, originalSceneDuration * 0.02)
      ) {
        throw new Error(
          `Timestamp slot ${chapterNum}_${promptScene.sceneIndex}_${promptIndex} vượt duration TTS cảnh`,
        );
      }

      const slotId = imageAssetKey(
        chapterNum,
        promptScene.sceneIndex,
        promptIndex,
      );
      const imageKey = slotId;
      const videoKey = videoAssetKey(
        chapterNum,
        promptScene.sceneIndex,
        promptIndex,
      );
      const videoPath = videoByKey.get(videoKey);
      const imagePath = imageByKey.get(imageKey);
      // Storyboard/TTS resync already treats <=15% drift as the same scene
      // timing. Snap the outer prompt edges to the real audio boundaries so
      // encoder rounding (for example 11.0s prompt vs 11.257s audio) leaves no
      // black/silent gap.
      const edgeTolerance = Math.max(0.15, originalSceneDuration * 0.15);
      const startSec =
        promptIndex === 0 && localStart <= edgeTolerance
          ? scene.startSec
          : roundMillis(scene.startSec + localStart * localScale);
      const endSec =
        promptIndex === promptScene.prompts.length - 1 &&
        Math.abs(originalSceneDuration - localEnd) <= edgeTolerance
          ? scene.endSec
          : roundMillis(scene.startSec + localEnd * localScale);
      slots.push({
        slotId,
        chapterNum,
        sceneIndex: promptScene.sceneIndex,
        promptIndex,
        startSec,
        endSec,
        durationSec: roundMillis(endSec - startSec),
        imageKey,
        videoKey,
        state: videoPath ? 'video' : imagePath ? 'image' : 'reserved',
        mediaKey: videoPath ? videoKey : imagePath ? imageKey : undefined,
        mediaKind: videoPath ? 'video' : imagePath ? 'image' : undefined,
        mediaPath: videoPath || imagePath || undefined,
      });
    }
  }

  slots.sort(
    (left, right) =>
      left.startSec - right.startSec ||
      left.sceneIndex - right.sceneIndex ||
      left.promptIndex - right.promptIndex,
  );
  const now = input.now || new Date().toISOString();
  const id = reservationId(projectName, chapterNum);
  return {
    version: 1,
    source: 'ai-novel',
    kind: 'capcut-timeline-reservation',
    reservationId: id,
    projectName,
    chapterNum,
    durationSec: roundMillis(authoritativeDuration),
    fullAudioKey: fullAudio?.key,
    fullAudioPath: fullAudio?.path,
    scenes,
    slots,
    filledSlots: slots.filter((slot) => slot.state !== 'reserved').length,
    createdAt:
      input.previous?.reservationId === id
        ? input.previous.createdAt
        : now,
    updatedAt: now,
  };
}

export function persistChapterTimelineReservation(
  input: BuildChapterTimelineReservationInput & { cwd?: string },
): { reservation: ChapterTimelineReservation; filePath: string } {
  const cwd = input.cwd || process.cwd();
  const paths = getIntegrationPaths(cwd);
  const dir = path.join(paths.workRoot, 'capcut', 'reservations');
  fs.mkdirSync(dir, { recursive: true });
  const filePath = path.join(
    dir,
    `${reservationId(input.projectName, input.chapterNum)}.timeline.json`,
  );
  let previous: ChapterTimelineReservation | null = input.previous || null;
  if (!previous && fs.existsSync(filePath)) {
    try {
      previous = JSON.parse(
        fs.readFileSync(filePath, 'utf8'),
      ) as ChapterTimelineReservation;
    } catch {
      previous = null;
    }
  }
  const reservation = buildChapterTimelineReservation({
    ...input,
    previous,
  });
  const tempPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(reservation, null, 2), 'utf8');
  fs.renameSync(tempPath, filePath);
  return { reservation, filePath };
}
