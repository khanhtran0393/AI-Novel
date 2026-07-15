/**
 * Output criteria derived from toolbar settings:
 *  - Ảnh / Video (Cấu hình đầu ra → ChannelOutputDna)
 *  - TTS (Giọng đọc toàn cục → ChannelTtsDna)
 *  - CapCut export targets (aspect / duration / media)
 *
 * Ship pack, CapCut export, and publish checks MUST consume these — not recipe-only defaults.
 */

import type {
  ChannelOutputDna,
  ChannelProfile,
  ChannelTtsDna,
  ShipMode,
  ShipRecipe,
} from './channelModel';
import {
  defaultOutputDna,
  defaultTtsDna,
  getRecipe,
  resolveChannelOutputDna,
  resolveChannelTtsDna,
} from './channelModel';

/** CapCut / FableCut accept a limited aspect set */
export type CapCutAspect = '16:9' | '9:16' | '1:1' | '4:5';

export type LiveMediaSettings = {
  mediaStylePreset?: string;
  visualDnaPrompt?: string;
  imageProvider?: string;
  imageModel?: string;
  imageAspectRatio?: string;
  imageCount?: number;
  videoProvider?: string;
  videoModel?: string;
  videoAspectRatio?: string;
  videoDuration?: number;
};

export type LiveTtsSettings = {
  platform?: string;
  voice?: string;
  language?: string;
  speed?: number;
  pitch?: number;
  syncMode?: 'default' | 'force_sync' | 'pro';
  vinaGender?: 'male' | 'female';
  vinaArea?: 'northern' | 'central' | 'southern';
  vinaGroup?: string;
  vinaEmotion?: string;
  vinaUseClone?: boolean;
  vinaSpeakerSeed?: number;
  vinaStyleSeed?: number;
};

export type OutputCriteriaBundle = {
  mode: ShipMode;
  recipe: ShipRecipe;
  /** Effective image ratio for gen / pack (from Ảnh/Video settings) */
  imageAspectRatio: string;
  /** Effective video ratio for gen / CapCut */
  videoAspectRatio: string;
  /** CapCut-normalized aspect */
  capCutAspect: CapCutAspect;
  imageProvider: string;
  imageModel: string;
  imageCount: number;
  videoProvider: string;
  videoModel: string;
  videoDuration: number;
  mediaStylePreset: string;
  visualDna: string;
  tts: ChannelTtsDna;
  outputDna: ChannelOutputDna;
  /** Human checklist lines for ship / CapCut */
  criteriaLines: string[];
};

/** Map free-form media ratio → CapCut/FableCut supported bucket */
export function toCapCutAspect(ratio: string | undefined | null): CapCutAspect {
  const r = String(ratio || '16:9').trim();
  if (r === '1:1') return '1:1';
  if (r === '4:5') return '4:5';
  if (r === '9:16' || r === '2:3' || r === '3:4') return '9:16';
  if (r === '16:9' || r === '3:2' || r === '4:3' || r === '21:9') return '16:9';
  // unknown → landscape default (safer for longform)
  if (/^\d+:\d+$/.test(r)) {
    const [a, b] = r.split(':').map(Number);
    if (a > 0 && b > 0 && a < b) return '9:16';
  }
  return '16:9';
}

/**
 * Merge live toolbar settings into channel DNA (prefer live store over stale channel).
 */
export function mergeLiveSettingsIntoChannel(
  channel: ChannelProfile,
  liveMedia?: LiveMediaSettings | null,
  liveTts?: LiveTtsSettings | null,
): ChannelProfile {
  const baseOut = resolveChannelOutputDna(channel);
  const baseTts = resolveChannelTtsDna(channel);

  const outputDna = defaultOutputDna({
    ...baseOut,
    ...(liveMedia?.mediaStylePreset
      ? { mediaStylePreset: liveMedia.mediaStylePreset }
      : {}),
    ...(liveMedia?.imageProvider ? { imageProvider: liveMedia.imageProvider } : {}),
    ...(liveMedia?.imageModel ? { imageModel: liveMedia.imageModel } : {}),
    ...(liveMedia?.imageAspectRatio
      ? { imageAspectRatio: liveMedia.imageAspectRatio }
      : {}),
    ...(typeof liveMedia?.imageCount === 'number'
      ? { imageCount: liveMedia.imageCount }
      : {}),
    ...(liveMedia?.videoProvider ? { videoProvider: liveMedia.videoProvider } : {}),
    ...(liveMedia?.videoModel ? { videoModel: liveMedia.videoModel } : {}),
    ...(liveMedia?.videoAspectRatio
      ? { videoAspectRatio: liveMedia.videoAspectRatio }
      : {}),
    ...(typeof liveMedia?.videoDuration === 'number'
      ? { videoDuration: liveMedia.videoDuration }
      : {}),
  });

  const ttsDna = defaultTtsDna({
    ...baseTts,
    ...(liveTts?.platform ? { platform: liveTts.platform } : {}),
    ...(liveTts?.voice ? { voice: liveTts.voice } : {}),
    ...(liveTts?.language ? { language: liveTts.language } : {}),
    ...(typeof liveTts?.speed === 'number' ? { speed: liveTts.speed } : {}),
    ...(typeof liveTts?.pitch === 'number' ? { pitch: liveTts.pitch } : {}),
    ...(liveTts?.syncMode ? { syncMode: liveTts.syncMode } : {}),
    ...(liveTts?.vinaGender ? { vinaGender: liveTts.vinaGender } : {}),
    ...(liveTts?.vinaArea ? { vinaArea: liveTts.vinaArea } : {}),
    ...(liveTts?.vinaGroup ? { vinaGroup: liveTts.vinaGroup } : {}),
    ...(liveTts?.vinaEmotion ? { vinaEmotion: liveTts.vinaEmotion } : {}),
    ...(typeof liveTts?.vinaUseClone === 'boolean'
      ? { vinaUseClone: liveTts.vinaUseClone }
      : {}),
    ...(typeof liveTts?.vinaSpeakerSeed === 'number'
      ? { vinaSpeakerSeed: liveTts.vinaSpeakerSeed }
      : {}),
    ...(typeof liveTts?.vinaStyleSeed === 'number'
      ? { vinaStyleSeed: liveTts.vinaStyleSeed }
      : {}),
  });

  const visualDna =
    (liveMedia?.visualDnaPrompt || '').trim() ||
    channel.visualDna ||
    outputDna.mediaStylePreset;

  return {
    ...channel,
    visualDna,
    narratorVoiceId: ttsDna.voice || channel.narratorVoiceId,
    ttsPlatform: ttsDna.platform || channel.ttsPlatform,
    outputDna,
    ttsDna,
  };
}

/**
 * Resolve full output criteria for ship / CapCut / audits.
 * Priority: channel.outputDna / ttsDna (already merged with live) → recipe fallback.
 */
export function resolveOutputCriteria(
  channel: ChannelProfile,
  mode?: ShipMode,
): OutputCriteriaBundle {
  const recipe = getRecipe(channel, mode);
  const outputDna = resolveChannelOutputDna(channel);
  const tts = resolveChannelTtsDna(channel);

  // Visual mode: prefer user video aspect (CapCut timeline), then image aspect, then recipe
  const imageAspectRatio =
    outputDna.imageAspectRatio || channel.aspectRatio || recipe.aspectRatio || '16:9';
  const videoAspectRatio =
    outputDna.videoAspectRatio ||
    (recipe.mode === 'short' ? '9:16' : imageAspectRatio) ||
    recipe.aspectRatio ||
    '16:9';

  const capCutAspect = toCapCutAspect(
    recipe.mode === 'short' ? videoAspectRatio || '9:16' : videoAspectRatio,
  );

  const criteriaLines = [
    `[Ảnh] provider=${outputDna.imageProvider} model=${outputDna.imageModel} ratio=${imageAspectRatio} count=${outputDna.imageCount}`,
    `[Video] provider=${outputDna.videoProvider} model=${outputDna.videoModel} ratio=${videoAspectRatio} duration=${outputDna.videoDuration}s`,
    `[Style] ${outputDna.mediaStylePreset?.slice(0, 80) || '(none)'}`,
    `[DNA] ${(channel.visualDna || '').slice(0, 80) || '(none)'}`,
    `[TTS] platform=${tts.platform} voice=${tts.voice} speed=${tts.speed} pitch=${tts.pitch} lang=${tts.language} sync=${tts.syncMode || 'default'}`,
    `[CapCut] aspect=${capCutAspect} (from video ${videoAspectRatio}) duration_hint=${outputDna.videoDuration}s`,
    `[Ship] mode=${recipe.mode} recipeAspect=${recipe.aspectRatio} visual=${recipe.includeVisual ? 'yes' : 'no'}`,
  ];

  return {
    mode: recipe.mode,
    recipe,
    imageAspectRatio,
    videoAspectRatio,
    capCutAspect,
    imageProvider: outputDna.imageProvider,
    imageModel: outputDna.imageModel,
    imageCount: outputDna.imageCount,
    videoProvider: outputDna.videoProvider,
    videoModel: outputDna.videoModel,
    videoDuration: outputDna.videoDuration,
    mediaStylePreset: outputDna.mediaStylePreset,
    visualDna: channel.visualDna || '',
    tts,
    outputDna,
    criteriaLines,
  };
}

export type SettingsCriteriaCheck = {
  id: string;
  ok: boolean;
  label: string;
  detail?: string;
};

/**
 * Hard checks: criteria bundle has required toolbar fields (settings present as targets).
 */
export function evaluateSettingsAsCriteria(
  criteria: OutputCriteriaBundle,
): { pass: boolean; checks: SettingsCriteriaCheck[] } {
  const checks: SettingsCriteriaCheck[] = [];
  const add = (id: string, ok: boolean, label: string, detail?: string) =>
    checks.push({ id, ok, label, detail });

  add(
    'image_provider',
    !!criteria.imageProvider,
    'Ảnh: có provider',
    criteria.imageProvider,
  );
  add(
    'image_aspect',
    /^\d+:\d+$/.test(criteria.imageAspectRatio),
    'Ảnh: có aspect ratio',
    criteria.imageAspectRatio,
  );
  add(
    'video_provider',
    !!criteria.videoProvider,
    'Video: có provider',
    criteria.videoProvider,
  );
  add(
    'video_aspect',
    /^\d+:\d+$/.test(criteria.videoAspectRatio),
    'Video: có aspect ratio',
    criteria.videoAspectRatio,
  );
  add(
    'video_duration',
    criteria.videoDuration >= 1 && criteria.videoDuration <= 30,
    'Video: duration trong 1–30s',
    String(criteria.videoDuration),
  );
  add(
    'tts_platform',
    !!criteria.tts.platform,
    'TTS: có platform',
    criteria.tts.platform,
  );
  add(
    'tts_voice',
    !!criteria.tts.voice,
    'TTS: có voice',
    criteria.tts.voice,
  );
  add(
    'tts_speed',
    typeof criteria.tts.speed === 'number' &&
      criteria.tts.speed >= 0.5 &&
      criteria.tts.speed <= 2,
    'TTS: speed hợp lệ',
    String(criteria.tts.speed),
  );
  add(
    'capcut_aspect',
    ['16:9', '9:16', '1:1', '4:5'].includes(criteria.capCutAspect),
    'CapCut: aspect map được',
    criteria.capCutAspect,
  );
  // Recipe visual modes must not drop user video ratio silently
  if (criteria.recipe.includeVisual) {
    add(
      'visual_uses_user_ratio',
      criteria.videoAspectRatio !== '' &&
        criteria.videoAspectRatio !== undefined,
      'Visual mode dùng ratio từ Ảnh/Video (không chỉ recipe)',
      `user=${criteria.videoAspectRatio} recipe=${criteria.recipe.aspectRatio}`,
    );
  }

  const pass = checks.every((c) => c.ok);
  return { pass, checks };
}
