/**
 * P1 — Media Preflight (hard-fail, no silent defaults — B10)
 * Run before Gen Prompt / Ảnh / Video / TTS.
 */

import {
  assertChapterMediaReady,
  formatQualityGateReasons,
} from './qualityGate';
import { getChapterQuality } from './pipelineStore';
import { resolveFlowVideoModelForScene } from '@/lib/flow-bridge/flowSceneMode';
import type { MediaPreflightIssue, MediaPreflightResult, MediaStage } from './types';

export type MediaPreflightInput = {
  stage: MediaStage;
  chapter: number;
  sceneIndex?: number;
  /** Setup */
  chu_de?: string;
  phong_cach?: string;
  /** Visual DNA or media style */
  style?: string;
  wpm?: number;
  secondsPerBeat?: number;
  /** Scene duration seconds (TTS real or WPM estimate) */
  duration?: number;
  sceneText?: string;
  /** Require quality gate mediaReady (default true for prompt/image/video) */
  requireQualityGate?: boolean;
  /** Character names appearing in scene — need face_ref/concept for image */
  characterNamesInScene?: string[];
  /** Map name → has face_ref or concept image */
  characterHasIdentity?: Record<string, boolean>;
  imageProvider?: string;
  videoProvider?: string;
  /** Flow / provider video model id — used to block I2V/R2V/EXT mismatch */
  videoModel?: string;
  /** image_prompt / video_prompt present for later stages */
  hasImagePrompt?: boolean;
  hasVideoPrompt?: boolean;
  hasStartImage?: boolean;
  hasEndImage?: boolean;
  hasIngredients?: boolean;
  ttsPlatform?: string;
  ttsVoice?: string;
};

export function evaluateMediaPreflight(input: MediaPreflightInput): MediaPreflightResult {
  const issues: MediaPreflightIssue[] = [];
  const stage = input.stage;
  const chapter = input.chapter;

  const chu = String(input.chu_de || '').trim();
  const phong = String(input.phong_cach || '').trim();
  if (!chu && !phong) {
    // TTS can still run (audio of text); media gen must hard-fail
    issues.push({
      level: stage === 'tts' ? 'warn' : 'block',
      code: 'setup_genre',
      message:
        'Thiếu Setup Chủ đề + Phong cách. Mở Setup chọn trước. App không tự gán thể loại mặc định.',
    });
  }

  const style = String(input.style || '').trim();
  if ((stage === 'prompt' || stage === 'image' || stage === 'video') && !style) {
    issues.push({
      level: 'block',
      code: 'media_style',
      message: 'Thiếu Visual DNA / Media Style. Mở Media Config.',
    });
  }

  if (stage === 'prompt' || stage === 'video') {
    const wpm = Number(input.wpm);
    const beat = Number(input.secondsPerBeat);
    if (!Number.isFinite(wpm) || wpm <= 0) {
      issues.push({
        level: 'block',
        code: 'wpm',
        message: 'Thiếu WPM hợp lệ (Media Config). App không tự gán WPM.',
      });
    }
    if (!Number.isFinite(beat) || beat <= 0) {
      issues.push({
        level: 'block',
        code: 'seconds_per_beat',
        message: 'Thiếu secondsPerBeat. App không tự gán beat.',
      });
    }
  }

  if (stage === 'prompt') {
    const dur = Number(input.duration);
    if (!Number.isFinite(dur) || dur <= 0) {
      issues.push({
        level: 'block',
        code: 'duration',
        message:
          'Thiếu thời lượng scene (TTS thật hoặc ước WPM / nhập tay). App không tự gán duration.',
      });
    }
  }
  // TTS: duration is optional (engine measures length after synth)

  if ((stage === 'prompt' || stage === 'tts') && !String(input.sceneText || '').trim()) {
    issues.push({
      level: 'block',
      code: 'empty_scene',
      message: 'Cảnh trống — không gen prompt/TTS.',
    });
  }

  const requireQg = input.requireQualityGate !== false && stage !== 'tts';
  if (requireQg) {
    const q = getChapterQuality(chapter);
    if (!q) {
      issues.push({
        level: 'block',
        code: 'quality_missing',
        message: `Chưa có Quality Gate ch${chapter}. Viết xong chương (finish pipeline) trước Gen media.`,
      });
    } else if (!q.mediaReady) {
      const reasons = formatQualityGateReasons(q, {
        maxErrors: 4,
        maxWarnings: 1,
        includeMeta: false,
      });
      issues.push({
        level: 'block',
        code: 'quality_blocked',
        message:
          `Quality Gate chặn ch${chapter}: ${q.hardErrors} lỗi — sửa trước khi Gen Prompt/Ảnh/Video.\n` +
          (reasons || 'Bấm badge Gate để xem nguyên nhân.'),
      });
    }
  }

  if (stage === 'image' || stage === 'video') {
    if (stage === 'image' && input.hasImagePrompt === false) {
      issues.push({
        level: 'block',
        code: 'no_image_prompt',
        message:
          'Chưa có image_prompt — chạy Gen Prompt Studio trên cảnh (đồng bộ kịch bản) trước.',
      });
    }
    if (stage === 'video' && input.hasVideoPrompt === false) {
      issues.push({
        level: 'block',
        code: 'no_video_prompt',
        message:
          'Chưa có video_prompt — chạy Gen Prompt Studio trên cảnh trước. App không gen video từ chữ thô.',
      });
    }
    if (stage === 'video' && input.hasStartImage === false) {
      issues.push({
        level: 'warn',
        code: 'no_start_image',
        message:
          'Chưa có ảnh start. Model I2V sẽ được chuyển T2V hoặc chặn; khuyến nghị Gen ảnh trước (pipeline cảnh).',
      });
    }

    // Flow: model family vs scene assets — same auto-align as gen (T2V↔I2V);
    // block only true mismatches (R2V/EXT/upsample / missing prompt).
    if (
      stage === 'video' &&
      String(input.videoProvider || '').toLowerCase() === 'flow' &&
      String(input.videoModel || '').trim()
    ) {
      const r = resolveFlowVideoModelForScene({
        videoModel: String(input.videoModel || '').trim(),
        hasVideoPrompt: input.hasVideoPrompt !== false,
        hasStartImage: input.hasStartImage === true,
        hasEndImage: input.hasEndImage === true,
        hasIngredients: input.hasIngredients === true,
        autoAlign: true,
      });
      if (!r.ok) {
        issues.push({
          level: 'block',
          code: 'flow_scene_mode',
          message:
            r.message ||
            'Model video không khớp cảnh (prompt/ảnh). Chọn preset «Pipeline cảnh» trong Cấu hình đầu ra.',
        });
      } else if (r.changed && r.message) {
        issues.push({
          level: 'info',
          code: 'flow_scene_align',
          message: r.message,
        });
      }
    }
  }

  // Identity soft/hard for image when names present
  const names = input.characterNamesInScene || [];
  const idMap = input.characterHasIdentity || {};
  if (stage === 'image' && names.length > 0) {
    const missing = names.filter((n) => idMap[n] === false);
    if (missing.length > 0) {
      issues.push({
        level: 'warn',
        code: 'identity_missing',
        message: `NV thiếu face_ref/concept: ${missing.slice(0, 4).join(', ')} — identity lock yếu.`,
      });
    }
  }

  if (stage === 'tts') {
    if (!String(input.ttsPlatform || '').trim()) {
      issues.push({
        level: 'block',
        code: 'tts_platform',
        message: 'Chưa chọn platform TTS. App không fallback platform.',
      });
    }
    if (!String(input.ttsVoice || '').trim()) {
      issues.push({
        level: 'block',
        code: 'tts_voice',
        message: 'Chưa chọn voice TTS.',
      });
    }
  }

  const blocked = issues.filter((i) => i.level === 'block');
  const ok = blocked.length === 0;
  const summary = ok
    ? `Preflight ${stage} ch${chapter}: OK`
    : `Preflight ${stage} ch${chapter}: ${blocked.length} block — ${blocked[0]?.message || ''}`;

  return {
    ok,
    stage,
    chapter,
    sceneIndex: input.sceneIndex,
    issues,
    summary,
  };
}

/** Throw first block message (B10). */
export function assertMediaPreflight(result: MediaPreflightResult): void {
  if (result.ok) return;
  const blocks = result.issues.filter((i) => i.level === 'block');
  throw new Error(blocks.map((b) => b.message).join(' · ') || result.summary);
}

/** Convenience: quality assert + preflight. */
export function assertReadyForMedia(
  chapter: number,
  preflight: MediaPreflightResult,
): void {
  if (preflight.ok) {
    // Double-check quality store when required
    const needQ = preflight.stage !== 'tts';
    if (needQ) {
      try {
        assertChapterMediaReady(getChapterQuality(chapter), chapter);
      } catch (e) {
        throw e;
      }
    }
    return;
  }
  assertMediaPreflight(preflight);
}
