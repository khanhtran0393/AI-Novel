/**
 * Pre-ship / pre-CapCut gate: toolbar settings as criteria + credential health.
 * Soft warns do not block; hard fails block unless force=true.
 */

import {
  evaluateCredentialHealth,
  type HealthInput,
  type HealthItem,
} from './credentialHealth';
import {
  evaluateSettingsAsCriteria,
  resolveOutputCriteria,
  type OutputCriteriaBundle,
} from './outputCriteria';
import type { ChannelProfile, ShipMode } from './channelModel';
import {
  chapterAssetKeys,
  evaluateMediaDnaMatch,
  liveDnaFromStoreLike,
  type MediaAssetDnaStamp,
  type MediaDnaMatchReport,
} from './mediaDnaMatch';

export type ShipGateInput = {
  channel: ChannelProfile;
  mode?: ShipMode;
  health: HealthInput;
  /** When true, only return report — caller may still proceed */
  force?: boolean;
  /** CapCut needs visual media paths */
  requireVisualAssets?: boolean;
  hasAudio?: boolean;
  hasImages?: boolean;
  hasVideos?: boolean;
  chapterNum?: number;
  /** Live store fields for DNA compare */
  liveMedia?: {
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
    generatedAudioPaths?: Record<string, { path?: string }>;
    generatedImages?: Record<string, string>;
    generatedVideos?: Record<string, string>;
    generatedAssetDna?: Record<string, MediaAssetDnaStamp>;
  };
  /** TTS platform/voice mismatch blocks ship when true */
  strictMediaDna?: boolean;
};

export type ShipGateResult = {
  ok: boolean;
  blocked: boolean;
  criteria: OutputCriteriaBundle;
  settingsPass: boolean;
  healthFail: number;
  healthWarn: number;
  healthItems: HealthItem[];
  blockers: string[];
  warnings: string[];
  summary: string;
  mediaDna?: MediaDnaMatchReport;
};

export function evaluateShipGate(input: ShipGateInput): ShipGateResult {
  const criteria = resolveOutputCriteria(input.channel, input.mode);
  const settings = evaluateSettingsAsCriteria(criteria);
  const health = evaluateCredentialHealth(input.health);

  const blockers: string[] = [];
  const warnings: string[] = [];

  if (!settings.pass) {
    for (const c of settings.checks.filter((x) => !x.ok)) {
      blockers.push(`Cài đặt: ${c.label}${c.detail ? ` (${c.detail})` : ''}`);
    }
  }

  for (const item of health.items) {
    if (item.level === 'fail') {
      blockers.push(`Credential: ${item.label} — ${item.detail}`);
    } else if (item.level === 'warn') {
      warnings.push(`Credential: ${item.label} — ${item.detail}`);
    }
  }

  // Mode-specific asset gates
  if (criteria.recipe.includeVisual || input.requireVisualAssets) {
    if (input.hasImages === false && input.hasVideos === false) {
      blockers.push(
        'Visual mode / CapCut: chưa có ảnh hoặc video chương (gen theo cài Ảnh/Video trước).',
      );
    } else if (input.hasImages === false && input.hasVideos !== true) {
      warnings.push('Chưa có ảnh scene — CapCut chỉ audio sẽ mỏng.');
    }
  }

  if (input.hasAudio === false) {
    if (criteria.recipe.mode === 'radio' || criteria.recipe.includeSrt) {
      blockers.push(
        `TTS: chưa có audio chương — gen TTS (${criteria.tts.platform}/${criteria.tts.voice}) trước.`,
      );
    } else {
      warnings.push('Chưa có TTS — pack thiếu voice-over.');
    }
  }

  // Media DNA vs live toolbar (Ảnh/Video · TTS)
  let mediaDna: MediaDnaMatchReport | undefined;
  if (input.liveMedia && typeof input.chapterNum === 'number') {
    const keys = chapterAssetKeys(input.chapterNum, {
      audio: input.liveMedia.generatedAudioPaths,
      images: input.liveMedia.generatedImages,
      videos: input.liveMedia.generatedVideos,
    });
    const live = liveDnaFromStoreLike({
      ttsConfig: input.liveMedia.ttsConfig || {
        platform: criteria.tts.platform,
        voice: criteria.tts.voice,
        speed: criteria.tts.speed,
        pitch: criteria.tts.pitch,
      },
      imageProvider: input.liveMedia.imageProvider || criteria.imageProvider,
      imageModel: input.liveMedia.imageModel || criteria.imageModel,
      imageAspectRatio:
        input.liveMedia.imageAspectRatio || criteria.imageAspectRatio,
      videoProvider: input.liveMedia.videoProvider || criteria.videoProvider,
      videoModel: input.liveMedia.videoModel || criteria.videoModel,
      videoAspectRatio:
        input.liveMedia.videoAspectRatio || criteria.videoAspectRatio,
      videoDuration: input.liveMedia.videoDuration ?? criteria.videoDuration,
    });
    mediaDna = evaluateMediaDnaMatch({
      chapterNum: input.chapterNum,
      audioKeys: keys.audioKeys,
      imageKeys: keys.imageKeys,
      videoKeys: keys.videoKeys,
      stamps: input.liveMedia.generatedAssetDna,
      live,
      strictTts: input.strictMediaDna === true,
      strictAspect: input.strictMediaDna === true,
    });
    const fails = mediaDna.mismatches.filter((m) => m.level === 'fail');
    const warns = mediaDna.mismatches.filter((m) => m.level === 'warn');
    for (const m of fails) blockers.push(`DNA media: ${m.message}`);
    for (const m of warns.slice(0, 4)) warnings.push(`DNA media: ${m.message}`);
    if (warns.length > 4) {
      warnings.push(
        `DNA media: +${warns.length - 4} lệch nữa — gen lại TTS/ảnh theo cài Ảnh/Video · TTS hiện tại.`,
      );
    }
  }

  const blocked = blockers.length > 0 && !input.force;
  const ok = blockers.length === 0;
  const summary = blocked
    ? `CHẶN: ${blockers.length} lỗi · ${warnings.length} cảnh báo`
    : ok
      ? warnings.length
        ? `OK với ${warnings.length} cảnh báo`
        : 'OK — đủ chỉ tiêu cài đặt + credential'
      : `Force qua ${blockers.length} blocker`;

  return {
    ok,
    blocked,
    criteria,
    settingsPass: settings.pass,
    healthFail: health.fail,
    healthWarn: health.warn,
    healthItems: health.items,
    blockers,
    warnings,
    summary,
    mediaDna,
  };
}

/** Build HealthInput from a loose store-like object (client or test). */
export function healthInputFromStore(store: {
  apiKey?: string;
  apiKeys?: string[];
  openaiApiKey?: string;
  openaiApiKeys?: string[];
  grokApiKey?: string;
  grokApiKeys?: string[];
  googleStudioCookie?: string;
  googleStudioCookies?: string[];
  tiktokSessionIds?: string[];
  imageProvider?: string;
  videoProvider?: string;
  ttsConfig?: HealthInput['ttsConfig'];
  lumaApiKey?: string;
  lumaApiKeys?: string[];
}): HealthInput {
  return {
    apiKey: store.apiKey,
    apiKeys: store.apiKeys,
    openaiApiKey: store.openaiApiKey,
    openaiApiKeys: store.openaiApiKeys,
    grokApiKey: store.grokApiKey,
    grokApiKeys: store.grokApiKeys,
    googleStudioCookie: store.googleStudioCookie,
    googleStudioCookies: store.googleStudioCookies,
    tiktokSessionIds: store.tiktokSessionIds,
    imageProvider: store.imageProvider,
    videoProvider: store.videoProvider,
    ttsConfig: store.ttsConfig,
    lumaApiKey: store.lumaApiKey,
    lumaApiKeys: store.lumaApiKeys,
  };
}
