/**
 * Soft project progress checklist (Printfilm adoption P3).
 * Derived from live store — never blocks workspace, never enforces Phase wizard.
 */

export type ProjectProgressStepId =
  | 'setup'
  | 'outline'
  | 'write'
  | 'tts'
  | 'prompt'
  | 'image'
  | 'video'
  | 'export';

export type ProjectProgressStep = {
  id: ProjectProgressStepId;
  label: string;
  hint: string;
  done: boolean;
};

export type ProjectProgressSnapshot = {
  steps: ProjectProgressStep[];
  doneCount: number;
  total: number;
  percent: number;
  nextHint: string;
};

/** Minimal store slice — avoid circular import of full NovelState */
export type ProjectProgressInput = {
  setup?: { chu_de?: string; phong_cach?: string } | null;
  dan_y_tong_the?: string;
  danh_sach_chuong?: Array<{
    so_chuong?: number;
    noi_dung?: string;
    trang_thai?: string;
  }>;
  generatedAudioPaths?: Record<string, { path?: string; duration?: number } | undefined>;
  generatedPrompts?: Record<string, unknown[] | undefined>;
  generatedImages?: Record<string, string | undefined>;
  generatedVideos?: Record<string, string | undefined>;
};

function hasNonEmpty(s: unknown): boolean {
  return String(s || '').trim().length > 0;
}

function countMapWithValue(
  map: Record<string, unknown> | undefined,
  pred: (v: unknown) => boolean,
): number {
  if (!map || typeof map !== 'object') return 0;
  let n = 0;
  for (const v of Object.values(map)) {
    if (pred(v)) n += 1;
  }
  return n;
}

/**
 * Compute soft production checklist from current project state.
 * Safe for SSR (no window). Pure function.
 */
export function computeProjectProgress(
  state: ProjectProgressInput,
): ProjectProgressSnapshot {
  const setupDone =
    hasNonEmpty(state.setup?.chu_de) && hasNonEmpty(state.setup?.phong_cach);
  const outlineDone = hasNonEmpty(state.dan_y_tong_the);

  const chapters = Array.isArray(state.danh_sach_chuong)
    ? state.danh_sach_chuong
    : [];
  const writeDone = chapters.some(
    (c) =>
      hasNonEmpty(c?.noi_dung) &&
      String(c.noi_dung || '').trim().length >= 200,
  );

  const ttsDone =
    countMapWithValue(
      state.generatedAudioPaths as Record<string, unknown> | undefined,
      (v) => {
        if (!v || typeof v !== 'object') return false;
        const path = String((v as { path?: string }).path || '').trim();
        return path.length > 0;
      },
    ) > 0;

  const promptDone =
    countMapWithValue(state.generatedPrompts as Record<string, unknown>, (v) =>
      Array.isArray(v) ? v.length > 0 : false,
    ) > 0;

  const imageDone =
    countMapWithValue(state.generatedImages, (v) => hasNonEmpty(v)) > 0;
  const videoDone =
    countMapWithValue(state.generatedVideos, (v) => hasNonEmpty(v)) > 0;

  // Export: video exists OR many images (ship/capcut offline heuristic)
  const exportDone = videoDone || imageDone;

  const steps: ProjectProgressStep[] = [
    {
      id: 'setup',
      label: 'Setup',
      hint: 'Chọn chủ đề + phong cách (Setup)',
      done: setupDone,
    },
    {
      id: 'outline',
      label: 'Dàn ý',
      hint: 'Sinh / nhập dàn ý tổng thể',
      done: outlineDone,
    },
    {
      id: 'write',
      label: 'Viết',
      hint: 'Viết ≥1 chương có nội dung',
      done: writeDone,
    },
    {
      id: 'tts',
      label: 'TTS',
      hint: 'Gen audio ≥1 scene',
      done: ttsDone,
    },
    {
      id: 'prompt',
      label: 'Prompt',
      hint: 'Gen Prompt Studio ≥1 scene',
      done: promptDone,
    },
    {
      id: 'image',
      label: 'Ảnh',
      hint: 'Gen ≥1 ảnh storyboard',
      done: imageDone,
    },
    {
      id: 'video',
      label: 'Video',
      hint: 'Gen ≥1 clip video',
      done: videoDone,
    },
    {
      id: 'export',
      label: 'Ship',
      hint: 'CapCut / Ship pack khi đã có media',
      done: exportDone,
    },
  ];

  const doneCount = steps.filter((s) => s.done).length;
  const total = steps.length;
  const percent = total ? Math.round((doneCount / total) * 100) : 0;
  const next = steps.find((s) => !s.done);
  const nextHint = next
    ? next.hint
    : 'Pipeline media đã có nền — kiểm tra Ship / CapCut khi sẵn sàng.';

  return { steps, doneCount, total, percent, nextHint };
}

/**
 * Resolve start/end prompt indices for video gen (P2 keyframe optional).
 * - use_end_frame: prefer this shot as start + next (or prev) as end
 * - singleClipPerPrompt (default **true**): one clip per prompt (Flow / modern) —
 *   middle shots do NOT force prev→current dual stills
 * - singleClipPerPrompt false: legacy middle = prev→current interpol
 *
 * Why default true: Flow path is «mỗi prompt 1 clip». Old middle dual forced
 * `wantsEndFrame` without checkbox → hard-fail «cần 2 ảnh» khi chỉ có 1 still.
 */
export function resolveVideoKeyframeRange(opts: {
  promptIndex: number;
  promptsLen: number;
  useEndFrame?: boolean;
  endImageKey?: string;
  chapter: number;
  sceneIndex: number;
  /**
   * true (default): single frame unless use_end_frame.
   * false: legacy middle prev→current dual interpol (non-Flow providers).
   */
  singleClipPerPrompt?: boolean;
}): { startPromptIndex: number; endPromptIndex: number; dualFrame: boolean } {
  const pIdx = Math.max(0, Number(opts.promptIndex) || 0);
  const len = Math.max(0, Number(opts.promptsLen) || 0);
  if (len <= 0) {
    return { startPromptIndex: 0, endPromptIndex: 0, dualFrame: false };
  }
  const clamped = Math.min(pIdx, len - 1);
  const singleClip = opts.singleClipPerPrompt !== false;

  if (opts.useEndFrame) {
    let endIdx = clamped + 1;
    const endKey = String(opts.endImageKey || '').trim();
    if (endKey) {
      const m = endKey.match(/^(\d+)_(\d+)_(\d+)$/);
      if (m) {
        const ch = Number(m[1]);
        const sc = Number(m[2]);
        const pi = Number(m[3]);
        if (
          ch === Number(opts.chapter) &&
          sc === Number(opts.sceneIndex) &&
          pi >= 0 &&
          pi < len
        ) {
          endIdx = pi;
        }
      }
    }
    if (endIdx >= len) endIdx = clamped - 1;
    if (endIdx < 0 || endIdx === clamped) {
      // Only one still available — hard dual-frame unavailable
      return {
        startPromptIndex: clamped,
        endPromptIndex: clamped,
        dualFrame: false,
      };
    }
    const start = Math.min(clamped, endIdx);
    const end = Math.max(clamped, endIdx);
    return { startPromptIndex: start, endPromptIndex: end, dualFrame: true };
  }

  // Modern / Flow: one clip per prompt (edge and middle)
  if (singleClip) {
    return {
      startPromptIndex: clamped,
      endPromptIndex: clamped,
      dualFrame: false,
    };
  }

  // Legacy non-Flow: edge = single; middle = prev→current interpol
  if (clamped === 0 || clamped === len - 1) {
    return {
      startPromptIndex: clamped,
      endPromptIndex: clamped,
      dualFrame: false,
    };
  }
  return {
    startPromptIndex: clamped - 1,
    endPromptIndex: clamped,
    dualFrame: true,
  };
}
