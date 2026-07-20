/**
 * Stamp DNA when media is generated; compare vs live toolbar (Ảnh/Video · TTS)
 * before Ship / CapCut so user knows assets are stale after settings change.
 */

import { chapterAssetPrefix } from '@/contracts';

export type MediaAssetKind = 'audio' | 'image' | 'video';

export type MediaAssetDnaStamp = {
  kind: MediaAssetKind;
  at: string;
  /** TTS */
  ttsPlatform?: string;
  ttsVoice?: string;
  ttsSpeed?: number;
  ttsPitch?: number;
  /** Image / Video */
  imageProvider?: string;
  imageModel?: string;
  imageAspectRatio?: string;
  videoProvider?: string;
  videoModel?: string;
  videoAspectRatio?: string;
  videoDuration?: number;
};

export type LiveMediaDnaTarget = {
  ttsPlatform?: string;
  ttsVoice?: string;
  ttsSpeed?: number;
  ttsPitch?: number;
  imageProvider?: string;
  imageModel?: string;
  imageAspectRatio?: string;
  videoProvider?: string;
  videoModel?: string;
  videoAspectRatio?: string;
  videoDuration?: number;
};

export type MediaDnaMismatch = {
  key: string;
  kind: MediaAssetKind | 'unknown';
  level: 'warn' | 'fail';
  field: string;
  expected: string;
  actual: string;
  message: string;
};

export type MediaDnaMatchReport = {
  checked: number;
  stamped: number;
  unstamped: number;
  mismatches: MediaDnaMismatch[];
  warnings: string[];
  /** true if any mismatch or unstamped assets that need re-gen */
  hasIssues: boolean;
};

export type MediaDnaMismatchSummary = {
  key: string;
  kind: MediaDnaMismatch['kind'];
  level: MediaDnaMismatch['level'];
  field: string;
  expected: string;
  actual: string;
  message: string;
  count: number;
  assetKeys: string[];
};

function norm(s?: string | null): string {
  return String(s || '')
    .trim()
    .toLowerCase();
}

function near(a?: number, b?: number, eps = 0.06): boolean {
  if (typeof a !== 'number' || typeof b !== 'number') return true;
  return Math.abs(a - b) <= eps;
}

/**
 * Collapse repeated per-asset mismatches into stable UI rows.
 * The identity includes both sides of the comparison so React replaces a row
 * when the live toolbar target changes instead of retaining stale DOM nodes.
 */
export function summarizeMediaDnaMismatches(
  mismatches: MediaDnaMismatch[],
): MediaDnaMismatchSummary[] {
  const grouped = new Map<string, MediaDnaMismatchSummary>();

  for (const mismatch of mismatches) {
    const key = JSON.stringify([
      mismatch.kind,
      mismatch.level,
      mismatch.field,
      norm(mismatch.expected),
      norm(mismatch.actual),
    ]);
    const existing = grouped.get(key);
    if (existing) {
      existing.count += 1;
      existing.assetKeys.push(mismatch.key);
      continue;
    }

    grouped.set(key, {
      key,
      kind: mismatch.kind,
      level: mismatch.level,
      field: mismatch.field,
      expected: mismatch.expected,
      actual: mismatch.actual,
      message: mismatch.message,
      count: 1,
      assetKeys: [mismatch.key],
    });
  }

  return Array.from(grouped.values());
}

export function stampAudioDna(live: LiveMediaDnaTarget): MediaAssetDnaStamp {
  return {
    kind: 'audio',
    at: new Date().toISOString(),
    ttsPlatform: live.ttsPlatform || '',
    ttsVoice: live.ttsVoice || '',
    ttsSpeed: live.ttsSpeed,
    ttsPitch: live.ttsPitch,
  };
}

export function stampImageDna(live: LiveMediaDnaTarget): MediaAssetDnaStamp {
  return {
    kind: 'image',
    at: new Date().toISOString(),
    imageProvider: live.imageProvider || '',
    imageModel: live.imageModel || '',
    imageAspectRatio: live.imageAspectRatio || '',
  };
}

export function stampVideoDna(live: LiveMediaDnaTarget): MediaAssetDnaStamp {
  return {
    kind: 'video',
    at: new Date().toISOString(),
    videoProvider: live.videoProvider || '',
    videoModel: live.videoModel || '',
    videoAspectRatio: live.videoAspectRatio || '',
    videoDuration: live.videoDuration,
  };
}

export function liveDnaFromStoreLike(store: {
  ttsConfig?: {
    platform?: string;
    voice?: string;
    speed?: number;
    pitch?: number;
  } | null;
  imageProvider?: string;
  imageModel?: string;
  imageAspectRatio?: string;
  videoProvider?: string;
  videoModel?: string;
  videoAspectRatio?: string;
  videoDuration?: number;
}): LiveMediaDnaTarget {
  return {
    ttsPlatform: store.ttsConfig?.platform,
    ttsVoice: store.ttsConfig?.voice,
    ttsSpeed: store.ttsConfig?.speed,
    ttsPitch: store.ttsConfig?.pitch,
    imageProvider: store.imageProvider,
    imageModel: store.imageModel,
    imageAspectRatio: store.imageAspectRatio,
    videoProvider: store.videoProvider,
    videoModel: store.videoModel,
    videoAspectRatio: store.videoAspectRatio,
    videoDuration: store.videoDuration,
  };
}

/**
 * Compare chapter assets' DNA stamps to live toolbar targets.
 * Unstamped (legacy) assets → warn re-gen.
 */
export function evaluateMediaDnaMatch(params: {
  chapterNum: number;
  audioKeys?: string[];
  imageKeys?: string[];
  videoKeys?: string[];
  stamps?: Record<string, MediaAssetDnaStamp | undefined> | null;
  live: LiveMediaDnaTarget;
  /** If true, TTS platform/voice mismatch is fail (blocks ship when wired) */
  strictTts?: boolean;
  /** If true, image/video aspect mismatch is fail */
  strictAspect?: boolean;
}): MediaDnaMatchReport {
  const stamps = params.stamps || {};
  const mismatches: MediaDnaMismatch[] = [];
  const warnings: string[] = [];
  let checked = 0;
  let stamped = 0;
  let unstamped = 0;

  const push = (m: MediaDnaMismatch) => {
    mismatches.push(m);
    const line = `${m.key}: ${m.message}`;
    if (m.level === 'fail') warnings.push(`FAIL ${line}`);
    else warnings.push(line);
  };

  const checkAudio = (key: string) => {
    checked++;
    const s = stamps[key];
    if (!s || s.kind !== 'audio') {
      unstamped++;
      push({
        key,
        kind: 'audio',
        level: 'warn',
        field: 'stamp',
        expected: 'DNA stamp',
        actual: 'missing',
        message: 'TTS chưa gắn DNA — gen lại để khóa platform/voice',
      });
      return;
    }
    stamped++;
    if (
      params.live.ttsPlatform &&
      s.ttsPlatform &&
      norm(s.ttsPlatform) !== norm(params.live.ttsPlatform)
    ) {
      push({
        key,
        kind: 'audio',
        level: params.strictTts ? 'fail' : 'warn',
        field: 'ttsPlatform',
        expected: params.live.ttsPlatform,
        actual: s.ttsPlatform,
        message: `TTS platform lệch (asset ${s.ttsPlatform} ≠ cài ${params.live.ttsPlatform})`,
      });
    }
    if (
      params.live.ttsVoice &&
      s.ttsVoice &&
      norm(s.ttsVoice) !== norm(params.live.ttsVoice)
    ) {
      push({
        key,
        kind: 'audio',
        level: params.strictTts ? 'fail' : 'warn',
        field: 'ttsVoice',
        expected: params.live.ttsVoice,
        actual: s.ttsVoice,
        message: `TTS voice lệch (asset ${s.ttsVoice.slice(0, 24)} ≠ cài ${String(params.live.ttsVoice).slice(0, 24)})`,
      });
    }
    if (!near(s.ttsSpeed, params.live.ttsSpeed, 0.08)) {
      push({
        key,
        kind: 'audio',
        level: 'warn',
        field: 'ttsSpeed',
        expected: String(params.live.ttsSpeed),
        actual: String(s.ttsSpeed),
        message: `TTS speed lệch (${s.ttsSpeed} ≠ ${params.live.ttsSpeed})`,
      });
    }
    if (!near(s.ttsPitch, params.live.ttsPitch, 0.5)) {
      push({
        key,
        kind: 'audio',
        level: 'warn',
        field: 'ttsPitch',
        expected: String(params.live.ttsPitch),
        actual: String(s.ttsPitch),
        message: `TTS pitch lệch (${s.ttsPitch} ≠ ${params.live.ttsPitch})`,
      });
    }
  };

  const checkImage = (key: string) => {
    checked++;
    const s = stamps[key];
    if (!s || s.kind !== 'image') {
      unstamped++;
      push({
        key,
        kind: 'image',
        level: 'warn',
        field: 'stamp',
        expected: 'DNA stamp',
        actual: 'missing',
        message: 'Ảnh chưa gắn DNA — gen lại theo Ảnh/Video hiện tại',
      });
      return;
    }
    stamped++;
    if (
      params.live.imageProvider &&
      s.imageProvider &&
      norm(s.imageProvider) !== norm(params.live.imageProvider)
    ) {
      push({
        key,
        kind: 'image',
        level: 'warn',
        field: 'imageProvider',
        expected: params.live.imageProvider,
        actual: s.imageProvider,
        message: `Ảnh provider lệch (${s.imageProvider} ≠ ${params.live.imageProvider})`,
      });
    }
    if (
      params.live.imageAspectRatio &&
      s.imageAspectRatio &&
      norm(s.imageAspectRatio) !== norm(params.live.imageAspectRatio)
    ) {
      push({
        key,
        kind: 'image',
        level: params.strictAspect ? 'fail' : 'warn',
        field: 'imageAspectRatio',
        expected: params.live.imageAspectRatio,
        actual: s.imageAspectRatio,
        message: `Ảnh ratio lệch (${s.imageAspectRatio} ≠ ${params.live.imageAspectRatio})`,
      });
    }
  };

  const checkVideo = (key: string) => {
    checked++;
    const s = stamps[key];
    if (!s || s.kind !== 'video') {
      unstamped++;
      push({
        key,
        kind: 'video',
        level: 'warn',
        field: 'stamp',
        expected: 'DNA stamp',
        actual: 'missing',
        message: 'Video chưa gắn DNA — gen lại theo Ảnh/Video hiện tại',
      });
      return;
    }
    stamped++;
    if (
      params.live.videoProvider &&
      s.videoProvider &&
      norm(s.videoProvider) !== norm(params.live.videoProvider)
    ) {
      push({
        key,
        kind: 'video',
        level: 'warn',
        field: 'videoProvider',
        expected: params.live.videoProvider,
        actual: s.videoProvider,
        message: `Video provider lệch (${s.videoProvider} ≠ ${params.live.videoProvider})`,
      });
    }
    if (
      params.live.videoAspectRatio &&
      s.videoAspectRatio &&
      norm(s.videoAspectRatio) !== norm(params.live.videoAspectRatio)
    ) {
      push({
        key,
        kind: 'video',
        level: params.strictAspect ? 'fail' : 'warn',
        field: 'videoAspectRatio',
        expected: params.live.videoAspectRatio,
        actual: s.videoAspectRatio,
        message: `Video ratio lệch (${s.videoAspectRatio} ≠ ${params.live.videoAspectRatio})`,
      });
    }
  };

  for (const k of params.audioKeys || []) checkAudio(k);
  for (const k of params.imageKeys || []) checkImage(k);
  for (const k of params.videoKeys || []) checkVideo(k);

  // Dedupe warning lines
  const uniqWarn = Array.from(new Set(warnings));

  return {
    checked,
    stamped,
    unstamped,
    mismatches,
    warnings: uniqWarn,
    hasIssues: mismatches.length > 0,
  };
}

/** Collect chapter asset keys from path maps */
export function chapterAssetKeys(
  chapterNum: number,
  maps: {
    audio?: Record<string, { path?: string } | undefined>;
    images?: Record<string, string | undefined>;
    videos?: Record<string, string | undefined>;
  },
): { audioKeys: string[]; imageKeys: string[]; videoKeys: string[] } {
  const pref = chapterAssetPrefix(chapterNum);
  const audioKeys = Object.entries(maps.audio || {})
    .filter(([k, v]) => (k.startsWith(pref) || k.startsWith(`${chapterNum}-`)) && !!v?.path)
    .map(([k]) => k);
  const imageKeys = Object.entries(maps.images || {})
    .filter(([k, v]) => k.startsWith(pref) && !!v)
    .map(([k]) => k);
  const videoKeys = Object.entries(maps.videos || {})
    .filter(([k, v]) => k.startsWith(pref) && !!v)
    .map(([k]) => k);
  return { audioKeys, imageKeys, videoKeys };
}
