import { SHOT_SCALE_CYCLE } from './config';
import { clipAtWordBoundary } from './text';

/**
 * Nhãn mốc YouTube: chỉ thời gian + nội dung.
 * Bỏ "Cảnh 1", "CẢNH 2:", v.v.
 */
export function cleanYoutubeChapterLabel(
  title: string,
  contentHint?: string,
  index = 0,
): string {
  let label = (title || '').normalize('NFC').replace(/^\[+|\]+$/g, '').trim();

  // [CẢNH 1: …] / CẢNH 1: / Cảnh 1 —
  label = label.replace(/^CẢNH\s*\d+\s*[:：\-–—.]?\s*/i, '').trim();
  label = label.replace(/^Cảnh\s*\d+\s*[:：\-–—.]?\s*/i, '').trim();
  // Còn sót "Cảnh 1" đứng một mình
  label = label.replace(/^Cảnh\s*\d+\s*$/i, '').trim();

  // Gọn tag kỹ thuật: NỘI CẢNH. / NGOẠI CẢNH.
  label = label
    .replace(/^(NỘI\s*CẢNH|NGOẠI\s*CẢNH|INT\.?|EXT\.?)\s*[.:：\-]?\s*/i, '')
    .trim();

  // Nếu trống → lấy gợi ý nội dung ngắn
  if (!label || /^[\d\s.:\-–—]+$/.test(label)) {
    const hint = (contentHint || '')
      .normalize('NFC')
      .replace(/\[CẢNH[^\]]*\]/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    label = clipAtWordBoundary(hint, 48) || `Phân đoạn ${index + 1}`;
  }

  return label.slice(0, 80);
}

export function buildYoutubeChapters(
  scenes: { title: string; durationSec: number; content?: string }[],
): { startSec: number; label: string; line: string }[] {
  let t = 0;
  const out: { startSec: number; label: string; line: string }[] = [];
  scenes.forEach((sc, i) => {
    const mm = Math.floor(t / 60);
    const ss = Math.floor(t % 60);
    const label = cleanYoutubeChapterLabel(sc.title || '', sc.content, i);
    out.push({
      startSec: t,
      label,
      line: `${mm}:${String(ss).padStart(2, '0')} ${label}`,
    });
    t += Math.max(1, sc.durationSec || 0);
  });
  return out;
}

export function buildCutPlan(params: {
  chapter: number;
  sceneIndex: number;
  durationSec: number;
  prompts: { timestamp?: string; image_prompt?: string; video_prompt?: string; emotion?: string }[];
}): {
  chapter: number;
  sceneIndex: number;
  totalDuration: number;
  cuts: {
    index: number;
    start: number;
    end: number;
    shotScale: string;
    preferVideo: boolean;
    emotion?: string;
  }[];
} {
  const n = Math.max(1, params.prompts?.length || 1);
  const slice = params.durationSec / n;
  const cuts = (params.prompts || [{}]).map((p, i) => {
    const start = i * slice;
    const end = i === n - 1 ? params.durationSec : (i + 1) * slice;
    return {
      index: i,
      start: Math.round(start * 100) / 100,
      end: Math.round(end * 100) / 100,
      shotScale: SHOT_SCALE_CYCLE[i % SHOT_SCALE_CYCLE.length],
      preferVideo: i % 3 === 0 || !!(p.video_prompt && p.video_prompt.length > 20),
      emotion: p.emotion,
    };
  });
  return {
    chapter: params.chapter,
    sceneIndex: params.sceneIndex,
    totalDuration: params.durationSec,
    cuts,
  };
}

export function motionBudgetScore(imageCount: number, videoCount: number): {
  pct: number;
  ok: boolean;
  target: number;
} {
  const total = imageCount + videoCount;
  if (total === 0) return { pct: 0, ok: false, target: 25 };
  const pct = Math.round((videoCount / total) * 100);
  return { pct, ok: pct >= 20, target: 25 };
}
