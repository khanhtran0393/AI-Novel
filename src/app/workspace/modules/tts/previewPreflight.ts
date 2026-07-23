/**
 * Client preflight for «Nghe thử» in Cấu Hình Giọng Đọc Toàn Cục.
 * Hard-fail before POST /api/generate-tts when local state is clearly invalid —
 * no silent engine swap (B10).
 */

import type { TTSConfig } from '@/store/useNovelStore';
import { FREE_TTS_PLATFORMS } from '@/lib/commercial/featureMatrix';
import {
  isActiveTtsPlatform,
  isRemovedTtsPlatform,
  removedTtsPlatformMessage,
} from '@/lib/tts/activePlatforms';

export type PreviewPreflightInput = {
  platform: string;
  voiceId: string;
  ttsConfig?: Partial<TTSConfig> | null;
  apiKeys?: string[];
  /** Multi TikTok sessions from store (may backfill primary) */
  tiktokSessionIds?: string[];
  isPro?: boolean;
  isTrial?: boolean;
  isVip?: boolean;
  /** Optional CapCut prep diag from /api/tts/voices */
  capcutOk?: boolean | null;
  capcutMessage?: string | null;
};

export type PreviewPreflightResult = {
  /** Config patch to merge before API call (e.g. TikTok session backfill) */
  ttsConfigPatch: Partial<TTSConfig>;
};

function isFreeTtsPlatform(platform: string): boolean {
  return FREE_TTS_PLATFORMS.has(String(platform || '').trim().toLowerCase());
}

function freeTtsBlockedMessage(platform: string): string {
  return (
    `Gói Free không dùng «${platform || '?'}» (TTS premium). ` +
    `Chọn tab Engine → Edge TTS hoặc Piper, hoặc nhấp logo → Trial/Pro.`
  );
}

/**
 * Throws Error with user-facing Vietnamese message when preview must not start.
 * Returns optional ttsConfig patches (TikTok session backfill).
 */
export function assertPreviewPreflight(
  input: PreviewPreflightInput,
): PreviewPreflightResult {
  const platform = String(input.platform || '').trim();
  const voiceId = String(input.voiceId || '').trim();
  const cfg = input.ttsConfig || {};
  const patch: Partial<TTSConfig> = {};

  if (!platform) {
    throw new Error(
      'Chưa chọn nền tảng TTS. Mở «Cấu Hình Giọng Đọc Toàn Cục» và chọn engine.',
    );
  }
  if (!voiceId) {
    throw new Error('Chưa chọn giọng để nghe thử.');
  }

  if (isRemovedTtsPlatform(platform) || !isActiveTtsPlatform(platform)) {
    throw new Error(removedTtsPlatformMessage(platform));
  }

  const freeTier = !input.isPro && !input.isTrial && !input.isVip;
  if (freeTier && !isFreeTtsPlatform(platform)) {
    throw new Error(freeTtsBlockedMessage(platform));
  }

  const keys = (input.apiKeys || []).map((k) => String(k || '').trim()).filter(Boolean);

  if (platform === 'gemini_tts' && keys.length === 0) {
    throw new Error(
      'Gemini TTS cần Gemini API Key (Settings). Không nghe thử được khi thiếu key.',
    );
  }

  if (platform === 'tiktok_tts') {
    const multi = (input.tiktokSessionIds || [])
      .map((s) => String(s || '').trim())
      .filter(Boolean);
    const primary =
      String(cfg.tiktokSessionId || '').trim() || multi[0] || '';
    if (!primary) {
      throw new Error(
        'TikTok TTS cần Session ID (Cấu hình giọng → SessionID TikTok). Không nghe thử khi thiếu.',
      );
    }
    if (!String(cfg.tiktokSessionId || '').trim() && primary) {
      patch.tiktokSessionId = primary;
    }
  }

  if (platform === 'capcut_tts' && input.capcutOk === false) {
    throw new Error(
      input.capcutMessage?.trim() ||
        'CapCut TTS chưa sẵn sàng (thiếu sscronet.dll / CapCut PC Apps). Cài CapCut rồi thử lại — không nhảy Edge ngầm.',
    );
  }

  return { ttsConfigPatch: patch };
}
