/**
 * Preflight checks before multi / cast TTS generation.
 */
import type { NhanVatPromptsMap } from '@/lib/characterProfile';
import type { ProjectVoiceCast, ResolvedSeg } from '@/lib/voiceCast';
import { isCastActive, normalizeVoiceCast } from '@/lib/voiceCast';
import {
  countPartialParts,
  loadMultiPartial,
} from '@/lib/multiTtsPartialCache';
import { resolveSceneCast } from './castModule';

export type CastPreflightLevel = 'info' | 'warn' | 'block';

export type CastPreflightIssue = {
  level: CastPreflightLevel;
  code: string;
  message: string;
};

export type CastPreflightResult = {
  ok: boolean;
  multi: boolean;
  segmentCount: number;
  voiceCount: number;
  partialCached: number;
  partialTotal: number;
  issues: CastPreflightIssue[];
  segments: ResolvedSeg[];
};

export function runCastPreflight(params: {
  sceneText: string;
  chapter: number;
  sceneIndex: number;
  cast?: ProjectVoiceCast | null;
  characterNames: string[];
  nhanVatPrompts: NhanVatPromptsMap;
  defaultVoice: string;
  platform: string;
  language?: string;
  globalSpeed: number;
  globalPitch: number;
}): CastPreflightResult {
  const issues: CastPreflightIssue[] = [];
  const cast = normalizeVoiceCast(params.cast);
  const castActive = isCastActive(cast);

  if (!params.sceneText?.trim()) {
    issues.push({
      level: 'block',
      code: 'empty_scene',
      message: 'Cảnh không có nội dung để TTS.',
    });
    return {
      ok: false,
      multi: false,
      segmentCount: 0,
      voiceCount: 0,
      partialCached: 0,
      partialTotal: 0,
      issues,
      segments: [],
    };
  }

  if (!params.defaultVoice?.trim()) {
    issues.push({
      level: 'block',
      code: 'no_default_voice',
      message: 'Chưa chọn giọng mặc định (TTS Config).',
    });
  }

  if (!castActive) {
    issues.push({
      level: 'info',
      code: 'cast_off',
      message: 'Cast OFF — dùng legacy đơn giọng / parse Name: đơn giản.',
    });
  }

  let segments: ResolvedSeg[] = [];
  let multi = false;

  if (castActive) {
    try {
      const resolved = resolveSceneCast({
        sceneText: params.sceneText,
        chapter: params.chapter,
        sceneIndex: params.sceneIndex,
        cast,
        characterNames: params.characterNames,
        nhanVatPrompts: params.nhanVatPrompts,
        defaultVoice: params.defaultVoice,
        platform: params.platform,
        language: params.language || '',
        globalSpeed: params.globalSpeed,
        globalPitch: params.globalPitch,
      });
      segments = resolved.segments;
      multi = resolved.useMulti;
    } catch (e) {
      issues.push({
        level: 'block',
        code: 'resolve_fail',
        message: e instanceof Error ? e.message : String(e),
      });
    }

    for (const r of cast.roles) {
      if (r.kind === 'narrator') {
        if (!r.voiceId?.trim() && !params.defaultVoice?.trim()) {
          issues.push({
            level: 'warn',
            code: 'narrator_no_voice',
            message: 'Người kể chưa gán voice (sẽ dùng default).',
          });
        }
        continue;
      }
      if (!r.voiceId?.trim()) {
        issues.push({
          level: 'block',
          code: 'role_no_voice',
          message: `Vai「${r.label}」chưa có voiceId.`,
        });
      }
    }

    const emptyVoiceSegs = segments.filter((s) => !s.voice?.trim());
    if (emptyVoiceSegs.length) {
      issues.push({
        level: 'block',
        code: 'seg_no_voice',
        message: `${emptyVoiceSegs.length} đoạn thiếu voice sau resolve.`,
      });
    }

    if (segments.length > 1 && !multi) {
      issues.push({
        level: 'info',
        code: 'single_path',
        message:
          'Nhiều đoạn nhưng cùng giọng/prosody → single path. Gán giọng khác NV để multi.',
      });
    }

    const charLines = segments.filter((s) => s.speaker != null).length;
    if (cast.roles.filter((r) => r.kind === 'character').length > 0 && charLines === 0) {
      issues.push({
        level: 'warn',
        code: 'no_dialogue',
        message:
          'Không bắt được thoại NV (cần「Tên: …」hoặc AI auto-tag). Toàn bộ là người kể.',
      });
    }

    const ambiguous = segments.filter((s) => s.source === 'ambiguous').length;
    if (ambiguous > 0) {
      issues.push({
        level: 'warn',
        code: 'ambiguous',
        message: `${ambiguous} dòng 🟡 mơ hồ — nên Auto-tag hoặc gán tay.`,
      });
    }
  }

  const partial = loadMultiPartial(params.chapter, params.sceneIndex);
  const partialCached = countPartialParts(partial);
  const partialTotal = partial?.total || 0;
  if (partialCached > 0 && partialTotal > 0) {
    issues.push({
      level: 'info',
      code: 'partial_resume',
      message: `Cache resume ${partialCached}/${partialTotal} đoạn (gen sẽ nối tiếp).`,
    });
  }

  const voices = new Set(segments.map((s) => s.voice).filter(Boolean));
  const hasBlock = issues.some((i) => i.level === 'block');

  return {
    ok: !hasBlock,
    multi,
    segmentCount: segments.length,
    voiceCount: voices.size,
    partialCached,
    partialTotal,
    issues,
    segments,
  };
}

export function formatPreflightConfirm(result: CastPreflightResult): string {
  const lines = result.issues
    .filter((i) => i.level !== 'info' || i.code === 'partial_resume')
    .map((i) => {
      const tag = i.level === 'block' ? '🚫' : i.level === 'warn' ? '⚠️' : 'ℹ️';
      return `${tag} ${i.message}`;
    });
  const head = result.multi
    ? `Multi ${result.voiceCount} giọng · ${result.segmentCount} đoạn`
    : `Single · ${result.segmentCount || 1} đoạn`;
  return `${head}\n\n${lines.join('\n') || 'Sẵn sàng gen.'}\n\nTiếp tục?`;
}

export type ChapterJobInput = {
  sceneIndex: number;
  text: string;
  title: string;
};

export type ChapterPreflightScene = {
  job: ChapterJobInput;
  result: CastPreflightResult;
};

export type ChapterPreflightResult = {
  scenes: ChapterPreflightScene[];
  runnable: ChapterJobInput[];
  blocked: ChapterPreflightScene[];
  warned: ChapterPreflightScene[];
  multiScenes: number;
  totalSegments: number;
  resumeScenes: number;
  resumeParts: number;
  /** 1 credit / runnable scene (batch accounting) */
  estimatedCredits: number;
};

/**
 * Aggregate preflight for a chapter batch of scene jobs.
 */
export function runChapterCastPreflight(params: {
  jobs: ChapterJobInput[];
  chapter: number;
  cast?: ProjectVoiceCast | null;
  characterNames: string[];
  nhanVatPrompts: NhanVatPromptsMap;
  defaultVoice: string;
  platform: string;
  language?: string;
  globalSpeed: number;
  globalPitch: number;
}): ChapterPreflightResult {
  const scenes: ChapterPreflightScene[] = params.jobs.map((job) => ({
    job,
    result: runCastPreflight({
      sceneText: job.text,
      chapter: params.chapter,
      sceneIndex: job.sceneIndex,
      cast: params.cast,
      characterNames: params.characterNames,
      nhanVatPrompts: params.nhanVatPrompts,
      defaultVoice: params.defaultVoice,
      platform: params.platform,
      language: params.language,
      globalSpeed: params.globalSpeed,
      globalPitch: params.globalPitch,
    }),
  }));

  const blocked = scenes.filter((s) => !s.result.ok);
  const warned = scenes.filter(
    (s) => s.result.ok && s.result.issues.some((i) => i.level === 'warn'),
  );
  const runnable = scenes.filter((s) => s.result.ok).map((s) => s.job);
  const multiScenes = scenes.filter((s) => s.result.multi).length;
  const totalSegments = scenes.reduce((a, s) => a + (s.result.segmentCount || 0), 0);
  const resumeScenes = scenes.filter((s) => s.result.partialCached > 0).length;
  const resumeParts = scenes.reduce((a, s) => a + s.result.partialCached, 0);

  return {
    scenes,
    runnable,
    blocked,
    warned,
    multiScenes,
    totalSegments,
    resumeScenes,
    resumeParts,
    estimatedCredits: runnable.length,
  };
}

export function formatChapterPreflightConfirm(
  ch: ChapterPreflightResult,
  opts?: { onlyFailed?: boolean },
): string {
  // Rough ETA: ~4s/seg multi + 8s single overhead per scene
  const etaSec = Math.max(
    15,
    ch.totalSegments * 4 + ch.runnable.length * 3 - ch.resumeParts * 3,
  );
  const etaMin = Math.ceil(etaSec / 60);

  const lines: string[] = [
    opts?.onlyFailed ? 'Gen lại cảnh lỗi — preflight:' : 'Gen TTS cả chương — preflight:',
    `• Chạy được: ${ch.runnable.length}/${ch.scenes.length} cảnh`,
    `• Multi: ${ch.multiScenes} cảnh · ~${ch.totalSegments} đoạn`,
    `• Ước tính: ~${ch.estimatedCredits} credit · ~${etaMin} phút`,
    ch.resumeScenes
      ? `• Resume cache: ${ch.resumeScenes} cảnh (${ch.resumeParts} đoạn partial)`
      : null,
    ch.blocked.length ? `• 🚫 Block: ${ch.blocked.length}` : null,
    ch.warned.length ? `• ⚠️ Cảnh báo: ${ch.warned.length}` : null,
  ].filter(Boolean) as string[];

  if (ch.blocked.length) {
    lines.push('', 'Cảnh bị chặn:');
    for (const b of ch.blocked.slice(0, 5)) {
      const msg =
        b.result.issues.find((i) => i.level === 'block')?.message || 'block';
      lines.push(`  · ${b.job.title}: ${msg}`);
    }
    if (ch.blocked.length > 5) lines.push(`  … +${ch.blocked.length - 5}`);
    lines.push('', 'Sẽ BỎ QUA cảnh block và gen phần còn lại.');
  } else if (ch.warned.length) {
    lines.push('', 'Cảnh báo (sẽ vẫn gen):');
    for (const w of ch.warned.slice(0, 4)) {
      const msg =
        w.result.issues.find((i) => i.level === 'warn')?.message || 'warn';
      lines.push(`  · ${w.job.title}: ${msg}`);
    }
  }

  lines.push('', 'Tiếp tục?');
  return lines.join('\n');
}
