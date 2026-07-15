import { HIGH_RISK_TTS_PLATFORMS, type EditorVerdict } from './config';
import { motionBudgetScore } from './timeline';

export interface YoutubeChecklistItem {
  id: string;
  label: string;
  ok: boolean;
  level: 'pass' | 'warn' | 'fail';
  detail?: string;
}

export function buildYoutubeChecklist(params: {
  hasScript: boolean;
  wordOk: boolean;
  sceneCount: number;
  minScenes: number;
  editorVerdict?: EditorVerdict;
  ttsPlatform?: string;
  ttsPitch?: number;
  ttsSpeed?: number;
  hasVisualDna: boolean;
  hasAudio: boolean;
  imageCount: number;
  videoCount: number;
  enforceEditorGate: boolean;
  humanEdited?: boolean;
  requireHumanEdit?: boolean;
  hasHook?: boolean;
  hasSeoTitle?: boolean;
  hasSeoDescription?: boolean;
  hasThumbnailPrompt?: boolean;
}): YoutubeChecklistItem[] {
  const items: YoutubeChecklistItem[] = [];

  items.push({
    id: 'script',
    label: 'Có kịch bản chương',
    ok: params.hasScript,
    level: params.hasScript ? 'pass' : 'fail',
  });

  items.push({
    id: 'word_gate',
    label: 'Đạt Cổng Từ (Word-Gate)',
    ok: params.wordOk,
    level: params.wordOk ? 'pass' : 'warn',
  });

  items.push({
    id: 'scenes',
    label: `≥${params.minScenes} phân cảnh`,
    ok: params.sceneCount >= params.minScenes,
    level: params.sceneCount >= params.minScenes ? 'pass' : 'warn',
  });

  const v = params.editorVerdict;
  if (!v) {
    items.push({
      id: 'editor',
      label: 'AI Editor đã chấm',
      ok: false,
      level: params.enforceEditorGate ? 'fail' : 'warn',
    });
  } else if (v === 'rewrite') {
    items.push({
      id: 'editor',
      label: 'Editor: cần rewrite',
      ok: false,
      level: 'fail',
    });
  } else if (v === 'polish') {
    items.push({
      id: 'editor',
      label: 'Editor: nên polish',
      ok: false,
      level: 'warn',
    });
  } else {
    items.push({ id: 'editor', label: 'Editor: accept', ok: true, level: 'pass' });
  }

  if (params.requireHumanEdit) {
    items.push({
      id: 'human_edit',
      label: params.humanEdited ? 'Human Pass: đã tick' : 'Human Pass: chưa tick',
      ok: !!params.humanEdited,
      level: params.humanEdited ? 'pass' : 'fail',
      detail: 'Sửa tay hook/thoại rồi tick trước TTS',
    });
  }

  items.push({
    id: 'hook',
    label: params.hasHook ? 'Hook ~30s đã có' : 'Chưa có hook ~30s',
    ok: !!params.hasHook,
    level: params.hasHook ? 'pass' : 'warn',
    detail: 'Cold-open đọc ~30 giây (khoảng 55–80 từ)',
  });

  items.push({
    id: 'seo_title',
    label: params.hasSeoTitle ? 'SEO Title' : 'Thiếu SEO Title',
    ok: !!params.hasSeoTitle,
    level: params.hasSeoTitle ? 'pass' : 'warn',
  });

  items.push({
    id: 'seo_desc',
    label: params.hasSeoDescription ? 'SEO Description' : 'Thiếu mô tả YouTube',
    ok: !!params.hasSeoDescription,
    level: params.hasSeoDescription ? 'pass' : 'warn',
  });

  items.push({
    id: 'thumb_prompt',
    label: params.hasThumbnailPrompt ? 'Prompt thumbnail' : 'Thiếu prompt thumbnail',
    ok: !!params.hasThumbnailPrompt,
    level: params.hasThumbnailPrompt ? 'pass' : 'warn',
  });

  const platform = (params.ttsPlatform || '').toLowerCase();
  const voiceRisk = HIGH_RISK_TTS_PLATFORMS.has(platform);
  items.push({
    id: 'voice',
    label: voiceRisk ? `TTS risk: ${platform || '?'}` : `TTS: ${platform || 'chưa chọn'}`,
    ok: !voiceRisk && !!platform,
    level: !platform ? 'warn' : voiceRisk ? 'warn' : 'pass',
  });

  const pitch = Number(params.ttsPitch ?? 0);
  const speed = Number(params.ttsSpeed ?? 1);
  const dnaOk = pitch !== 0 || Math.abs(speed - 1) >= 0.02;
  items.push({
    id: 'voice_dna',
    label: 'Voice DNA (pitch/speed ≠ default phẳng)',
    ok: dnaOk,
    level: dnaOk ? 'pass' : 'warn',
  });

  items.push({
    id: 'visual_dna',
    label: 'Visual DNA / style riêng',
    ok: params.hasVisualDna,
    level: params.hasVisualDna ? 'pass' : 'warn',
  });

  items.push({
    id: 'audio',
    label: 'Đã có TTS audio',
    ok: params.hasAudio,
    level: params.hasAudio ? 'pass' : 'warn',
  });

  const visualOk = params.imageCount + params.videoCount > 0;
  items.push({
    id: 'visuals',
    label: visualOk
      ? `Media: ${params.imageCount} ảnh · ${params.videoCount} video`
      : 'Chưa có ảnh/video storyboard',
    ok: visualOk,
    level: visualOk ? 'pass' : 'warn',
  });

  const motion = motionBudgetScore(params.imageCount, params.videoCount);
  if (params.imageCount + params.videoCount > 0) {
    items.push({
      id: 'motion',
      label: `Motion budget ~${motion.pct}% video (mục tiêu ≥${motion.target}%)`,
      ok: motion.ok,
      level: motion.ok ? 'pass' : 'warn',
      detail: motion.ok ? undefined : 'Thêm clip motion — tránh pure slideshow',
    });
  }

  return items;
}

export function summarizeChecklist(items: YoutubeChecklistItem[]): {
  pass: number;
  warn: number;
  fail: number;
  ready: boolean;
} {
  let pass = 0;
  let warn = 0;
  let fail = 0;
  for (const i of items) {
    if (i.level === 'pass') pass += 1;
    else if (i.level === 'warn') warn += 1;
    else fail += 1;
  }
  return { pass, warn, fail, ready: fail === 0 };
}
