/**
 * Pre-publish audit — Ready to publish Yes/No + actionable fixes.
 */

import {
  chapterAssetPrefix,
  imageAssetKey,
  sceneAssetKey,
} from '@/contracts';
import {
  evaluateWordGate,
  countSceneTags,
  parseScenes,
} from './storyWriting';
import {
  mergeYoutubeSafe,
  scoreYoutubeMetaFields,
  YOUTUBE_META_PASS_SCORE,
  YOUTUBE_HOOK_SCENE_INDEX,
  YOUTUBE_THUMB_SCENE_INDEX,
  type YoutubeSafeConfig,
} from './youtubeSafe';

export type PublishFixTarget =
  | 'script'
  | 'word_gate'
  | 'hook'
  | 'tts'
  | 'images'
  | 'thumb_prompt'
  | 'thumb_image'
  | 'seo'
  | 'editor'
  | 'human_edit'
  | 'visual_dna'
  | 'tts_risk';

export type PublishIssue = {
  id: string;
  level: 'fail' | 'warn' | 'pass';
  label: string;
  detail?: string;
  target: PublishFixTarget;
};

export type PublishReadiness = {
  ready: boolean;
  pass: number;
  warn: number;
  fail: number;
  issues: PublishIssue[];
  summary: string;
};

export type PublishReadinessInput = {
  chapterNum: number;
  script: string;
  soTuChuong?: number;
  minScenes?: number;
  hook?: string;
  thumbnailLine?: string;
  seoTitle?: string;
  seoDescription?: string;
  thumbnailPrompt?: string;
  thumbnailImagePath?: string;
  editorVerdict?: string;
  humanEdited?: boolean;
  visualDna?: string;
  mediaStyle?: string;
  ttsPlatform?: string;
  ttsPitch?: number;
  ttsSpeed?: number;
  youtubeSafe?: Partial<YoutubeSafeConfig> | null;
  generatedAudioPaths?: Record<string, { path?: string; duration?: number }>;
  generatedImages?: Record<string, string>;
  /** Optional: count only scene images for this chapter */
};

const HIGH_RISK = new Set(['tiktok_tts', 'edge_tts']);

export function evaluatePublishReadiness(
  input: PublishReadinessInput,
): PublishReadiness {
  const ch = input.chapterNum;
  const script = (input.script || '').normalize('NFC');
  const yt = mergeYoutubeSafe(input.youtubeSafe);
  const gate = evaluateWordGate(script, input.soTuChuong || 4250);
  const sceneCount = countSceneTags(script) || parseScenes(script).length;
  const minScenes = input.minScenes ?? 3;

  const issues: PublishIssue[] = [];

  const add = (
    level: PublishIssue['level'],
    id: string,
    label: string,
    target: PublishFixTarget,
    detail?: string,
  ) => issues.push({ id, level, label, target, detail });

  // Script
  if (!script.trim()) {
    add('fail', 'script', 'Thiếu kịch bản chương', 'script');
  } else {
    add('pass', 'script', 'Có kịch bản', 'script');
  }

  if (script.trim()) {
    if (!gate.wordsOk) {
      add(
        'fail',
        'word_gate',
        `Word-gate: ${gate.wordCount}/${gate.wordGoal}`,
        'word_gate',
        'Viết thêm hoặc AI viết tiếp đến chỉ tiêu từ.',
      );
    } else {
      add('pass', 'word_gate', `Word-gate OK (${gate.wordCount})`, 'word_gate');
    }

    if (sceneCount < minScenes) {
      add(
        'warn',
        'scenes',
        `Cảnh: ${sceneCount}/${minScenes}`,
        'script',
        'Nên ≥3 phân cảnh rõ ràng.',
      );
    } else {
      add('pass', 'scenes', `Cảnh: ${sceneCount}`, 'script');
    }
  }

  // Hook
  const hook = (input.hook || '').trim();
  if (hook.length > 40) {
    add('pass', 'hook', 'Hook ~30s có nội dung', 'hook');
  } else {
    add('warn', 'hook', 'Thiếu / ngắn Hook cold-open', 'hook');
  }

  // TTS
  const audio = input.generatedAudioPaths || {};
  const chPrefix = chapterAssetPrefix(ch);
  const hasAnyTts = Object.keys(audio).some(
    (k) =>
      (k.startsWith(chPrefix) || k.startsWith(`${ch}-`)) &&
      !!(audio[k]?.path),
  );
  const hasHookTts = !!(audio[sceneAssetKey(ch, YOUTUBE_HOOK_SCENE_INDEX)]?.path);
  if (hasAnyTts) {
    add(
      'pass',
      'tts',
      hasHookTts ? 'TTS có (kèm Hook)' : 'TTS có (scene)',
      'tts',
    );
  } else {
    add('fail', 'tts', 'Chưa có TTS chương', 'tts', 'Gen giọng đọc ít nhất 1 cảnh.');
  }

  // Images
  const images = input.generatedImages || {};
  const sceneImgs = Object.keys(images).filter(
    (k) =>
      k.startsWith(chPrefix) &&
      !k.includes(`_${YOUTUBE_THUMB_SCENE_INDEX}_`) &&
      !!images[k],
  );
  if (sceneImgs.length >= 3) {
    add('pass', 'images', `Ảnh scene: ${sceneImgs.length}`, 'images');
  } else if (sceneImgs.length > 0) {
    add(
      'warn',
      'images',
      `Ảnh scene: ${sceneImgs.length} (ít)`,
      'images',
      'Nên gen đủ storyboard trước đăng.',
    );
  } else {
    add('fail', 'images', 'Chưa có ảnh scene', 'images');
  }

  // Thumb
  const thumbPrompt = (input.thumbnailPrompt || '').trim();
  const thumbImg =
    (input.thumbnailImagePath || '').trim() ||
    (images[imageAssetKey(ch, YOUTUBE_THUMB_SCENE_INDEX, 0)] || '').trim();
  if (thumbPrompt.length > 20) {
    add('pass', 'thumb_prompt', 'Có Thumb prompt', 'thumb_prompt');
  } else {
    add('warn', 'thumb_prompt', 'Thiếu Thumb prompt (EN)', 'thumb_prompt');
  }
  if (thumbImg) {
    add('pass', 'thumb_image', 'Có ảnh thumbnail', 'thumb_image');
  } else {
    add('warn', 'thumb_image', 'Chưa gen ảnh thumbnail', 'thumb_image');
  }

  // SEO meta
  const scores = scoreYoutubeMetaFields({
    seoTitle: input.seoTitle || '',
    thumbnailLine: input.thumbnailLine || '',
    seoDescription: input.seoDescription || '',
  });
  if (scores.pass) {
    add(
      'pass',
      'seo',
      `SEO meta ${scores.average}/10 (≥${YOUTUBE_META_PASS_SCORE})`,
      'seo',
    );
  } else if ((input.seoTitle || '').trim().length > 8) {
    add(
      'warn',
      'seo',
      `SEO meta ${scores.average}/10 (cần ≥${YOUTUBE_META_PASS_SCORE})`,
      'seo',
      `Title ${scores.title} · Thumb ${scores.thumbnail} · Desc ${scores.description}`,
    );
  } else {
    add('fail', 'seo', 'Thiếu SEO title / meta', 'seo', 'Bấm Meta trong YouTube Studio.');
  }

  // Editor / human
  if (yt.enforceEditorGate !== false) {
    const v = (input.editorVerdict || '').toLowerCase();
    if (v === 'pass' || v === 'ok' || v === 'approve') {
      add('pass', 'editor', 'Editor pass', 'editor');
    } else if (v === 'rewrite' || v === 'fail') {
      add('fail', 'editor', `Editor: ${input.editorVerdict}`, 'editor');
    } else {
      add('warn', 'editor', 'Chưa có verdict editor', 'editor');
    }
  }

  if (yt.requireHumanEdit === true) {
    if (input.humanEdited) {
      add('pass', 'human', 'Human pass đã tick', 'human_edit');
    } else {
      add('fail', 'human', 'Chưa tick Human Pass', 'human_edit');
    }
  }

  // Visual DNA
  if ((input.visualDna || input.mediaStyle || '').trim()) {
    add('pass', 'dna', 'Có visual DNA / style', 'visual_dna');
  } else {
    add('warn', 'dna', 'Chưa set visual DNA', 'visual_dna');
  }

  // TTS risk
  const plat = (input.ttsPlatform || '').toLowerCase();
  if (plat && HIGH_RISK.has(plat)) {
    add(
      'warn',
      'tts_risk',
      `TTS platform rủi ro YT: ${plat}`,
      'tts_risk',
      'Cân nhắc Vina/Gemini/Piper cho series dài.',
    );
  } else if (plat) {
    add('pass', 'tts_risk', `TTS: ${plat}`, 'tts_risk');
  }

  const pass = issues.filter((i) => i.level === 'pass').length;
  const warn = issues.filter((i) => i.level === 'warn').length;
  const fail = issues.filter((i) => i.level === 'fail').length;
  const ready = fail === 0;

  return {
    ready,
    pass,
    warn,
    fail,
    issues,
    summary: ready
      ? `Ready · ${pass} pass · ${warn} warn`
      : `Chưa sẵn sàng · ${fail} fail · ${warn} warn`,
  };
}
