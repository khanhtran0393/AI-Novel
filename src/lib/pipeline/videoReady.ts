/**
 * Video-ready ladder — pure domain status for workflow UI.
 * Counts store maps (prompts / images / videos / TTS). No 1-click gen.
 * Client-safe (no fs); "has media" = non-empty path/url in store.
 */

import {
  imageAssetKey,
  sceneAssetKey,
  videoAssetKey,
} from '@/contracts';
import {
  countSceneTags,
  getWordCount,
  MIN_SCENE_COUNT,
  parseScenes as parseScenesFromBody,
} from '@/lib/storyWriting';
import {
  isHookSceneIndex,
  YOUTUBE_HOOK_SCENE_INDEX,
} from '@/lib/youtube-safe/assets';
import {
  bodySceneIndicesForWorkspace,
  type ParsedScene,
} from '@/lib/sceneWorkspaceGroups';

export type VideoReadyStationId =
  | 'setup'
  | 'script'
  | 'tts'
  | 'prompt'
  | 'image'
  | 'video'
  | 'export';

export type StationStatus = 'empty' | 'partial' | 'ready' | 'blocked';

export type VideoReadyStation = {
  id: VideoReadyStationId;
  label: string;
  short: string;
  status: StationStatus;
  detail: string;
  done: number;
  total: number;
  /** Weight toward overall percent (sum of weights = 100) */
  weight: number;
  nextHint: string;
};

export type SceneMediaReady = {
  sceneIndex: number;
  hasText: boolean;
  hasTts: boolean;
  ttsDurationSec: number;
  promptCount: number;
  promptsWithImageText: number;
  promptsWithVideoText: number;
  imageDone: number;
  videoDone: number;
  /** Script + TTS + prompts + all images + all videos */
  complete: boolean;
  /** partial production progress 0–1 for this scene */
  progress: number;
};

export type VideoReadyInput = {
  chapter: number;
  chu_de?: string;
  phong_cach?: string;
  visualDna?: string;
  mediaStylePreset?: string;
  wpm?: number;
  secondsPerBeat?: number;
  /** Full chapter body (for scene tags / word count) */
  chapterContent: string;
  wordGoal?: number;
  /** Hook cold-open text (index 990) */
  hookContent?: string;
  /** Parsed scenes from chapter body (optional — derived if missing) */
  scenes?: ParsedScene[];
  /** Quality gate mediaReady when known */
  qualityMediaReady?: boolean | null;
  qualityHardErrors?: number | null;
  generatedAudioPaths?: Record<string, { path?: string; duration?: number } | string | undefined>;
  generatedPrompts?: Record<string, Array<{
    prompt?: string;
    image_prompt?: string;
    video_prompt?: string;
    timestamp?: string;
  }> | undefined>;
  generatedImages?: Record<string, string | undefined>;
  generatedVideos?: Record<string, string | undefined>;
};

export type VideoReadyReport = {
  chapter: number;
  percent: number;
  stations: VideoReadyStation[];
  scenes: SceneMediaReady[];
  /** First incomplete station (workflow next step) */
  nextStationId: VideoReadyStationId | null;
  nextMessage: string;
  /** Enough assets to open CapCut pack (TTS + visuals) — not "exported MP4" */
  canPack: boolean;
  setupOk: boolean;
  scriptOk: boolean;
};

const STATION_META: Record<
  VideoReadyStationId,
  { label: string; short: string; weight: number }
> = {
  setup: { label: 'Setup', short: 'Setup', weight: 8 },
  script: { label: 'Nội dung', short: 'Chữ', weight: 14 },
  tts: { label: 'Giọng (TTS)', short: 'TTS', weight: 18 },
  prompt: { label: 'Storyboard', short: 'Prompt', weight: 15 },
  image: { label: 'Ảnh', short: 'Ảnh', weight: 18 },
  video: { label: 'Video', short: 'Video', weight: 22 },
  export: { label: 'Timeline / Xuất', short: 'Xuất', weight: 5 },
};

export function hasMediaPath(raw: unknown): boolean {
  if (raw == null) return false;
  if (typeof raw === 'string') return raw.trim().length > 0;
  if (typeof raw === 'object') {
    const o = raw as { path?: unknown };
    if (typeof o.path === 'string' && o.path.trim()) return true;
  }
  return false;
}

export function audioDurationSec(raw: unknown): number {
  if (!raw || typeof raw !== 'object') return 0;
  const d = Number((raw as { duration?: number }).duration);
  return Number.isFinite(d) && d > 0 ? d : 0;
}

function stationStatus(done: number, total: number, blocked = false): StationStatus {
  if (blocked) return 'blocked';
  if (total <= 0) return 'empty';
  if (done <= 0) return 'empty';
  if (done >= total) return 'ready';
  return 'partial';
}

function ratioScore(done: number, total: number): number {
  if (total <= 0) return 0;
  return Math.min(1, Math.max(0, done / total));
}

/**
 * Scene indices included in video-ready counts:
 * body workspace scenes + hook 990 when hook has text.
 */
export function resolveVideoReadySceneIndices(
  scenes: ParsedScene[],
  hookContent?: string,
): number[] {
  const body = bodySceneIndicesForWorkspace(scenes);
  const hook = String(hookContent || '').trim();
  if (hook) return [YOUTUBE_HOOK_SCENE_INDEX, ...body];
  return body;
}

export function evaluateSceneMediaReady(
  chapter: number,
  sceneIndex: number,
  sceneText: string,
  input: Pick<
    VideoReadyInput,
    | 'generatedAudioPaths'
    | 'generatedPrompts'
    | 'generatedImages'
    | 'generatedVideos'
  >,
): SceneMediaReady {
  const key = sceneAssetKey(chapter, sceneIndex);
  const text = String(sceneText || '').trim();
  const hasText = text.length > 0;
  const audio = input.generatedAudioPaths?.[key];
  const hasTts = hasMediaPath(audio);
  const ttsDurationSec = audioDurationSec(audio);
  const prompts = input.generatedPrompts?.[key] || [];
  const promptCount = prompts.length;
  let promptsWithImageText = 0;
  let promptsWithVideoText = 0;
  let imageDone = 0;
  let videoDone = 0;
  for (let p = 0; p < prompts.length; p++) {
    const pr = prompts[p] || {};
    const imgT = String(pr.image_prompt || pr.prompt || '').trim();
    const vidT = String(pr.video_prompt || '').trim();
    if (imgT) promptsWithImageText += 1;
    if (vidT) promptsWithVideoText += 1;
    if (hasMediaPath(input.generatedImages?.[imageAssetKey(chapter, sceneIndex, p)])) {
      imageDone += 1;
    }
    if (hasMediaPath(input.generatedVideos?.[videoAssetKey(chapter, sceneIndex, p)])) {
      videoDone += 1;
    }
  }
  // Progress: text 15% · tts 20% · prompt 20% · image 20% · video 25%
  let progress = 0;
  if (hasText) progress += 0.15;
  if (hasTts) progress += 0.2;
  if (promptCount > 0 && promptsWithImageText >= promptCount) progress += 0.2;
  else if (promptCount > 0) progress += 0.2 * ratioScore(promptsWithImageText, promptCount);
  if (promptCount > 0) {
    progress += 0.2 * ratioScore(imageDone, promptCount);
    progress += 0.25 * ratioScore(videoDone, promptCount);
  }
  const complete =
    hasText &&
    hasTts &&
    promptCount > 0 &&
    imageDone >= promptCount &&
    videoDone >= promptCount;

  return {
    sceneIndex,
    hasText,
    hasTts,
    ttsDurationSec,
    promptCount,
    promptsWithImageText,
    promptsWithVideoText,
    imageDone,
    videoDone,
    complete,
    progress,
  };
}

function sceneTextForIndex(
  sceneIndex: number,
  scenes: ParsedScene[],
  hookContent?: string,
): string {
  if (isHookSceneIndex(sceneIndex)) return String(hookContent || '').trim();
  return String(scenes[sceneIndex]?.content || '').trim();
}

/**
 * Build full video-ready report for one chapter (pure).
 */
export function evaluateVideoReady(input: VideoReadyInput): VideoReadyReport {
  const chapter = Number(input.chapter) || 0;
  const chu = String(input.chu_de || '').trim();
  const phong = String(input.phong_cach || '').trim();
  const setupOk = Boolean(chu && phong);
  const styleOk = Boolean(
    String(input.visualDna || '').trim() || String(input.mediaStylePreset || '').trim(),
  );
  const wpmOk = Number(input.wpm) > 0;
  const beatOk = Number(input.secondsPerBeat) > 0;

  const content = String(input.chapterContent || '');
  const sceneTagCount = countSceneTags(content);
  const wordCount = getWordCount(content);
  const wordGoal = Number(input.wordGoal) > 0 ? Number(input.wordGoal) : 0;
  const wordFloor = wordGoal > 0 ? Math.round(wordGoal * 0.92) : 0;
  const wordsOk = wordGoal > 0 ? wordCount >= wordFloor : wordCount > 80;
  const scenesOk = sceneTagCount >= MIN_SCENE_COUNT;
  const qgBlocked =
    input.qualityMediaReady === false &&
    Number(input.qualityHardErrors || 0) > 0;
  const scriptOk = wordsOk && scenesOk && !qgBlocked;

  // Prefer caller-provided parse; otherwise parse chapter body (client/server safe).
  const scenes =
    input.scenes !== undefined
      ? input.scenes
      : parseScenesFromBody(content);
  const indices = resolveVideoReadySceneIndices(scenes, input.hookContent);
  const sceneReports = indices.map((idx) =>
    evaluateSceneMediaReady(
      chapter,
      idx,
      sceneTextForIndex(idx, scenes, input.hookContent),
      input,
    ),
  );

  const textScenes = sceneReports.filter((s) => s.hasText);
  const sceneTotal = Math.max(1, textScenes.length || sceneReports.length || 1);
  const ttsDone = textScenes.filter((s) => s.hasTts).length;
  const ttsTotal = Math.max(1, textScenes.length);

  let promptSlots = 0;
  let promptFilled = 0;
  let imageSlots = 0;
  let imageDone = 0;
  let videoSlots = 0;
  let videoDone = 0;
  for (const s of textScenes) {
    if (s.promptCount > 0) {
      promptSlots += s.promptCount;
      promptFilled += s.promptsWithImageText;
      imageSlots += s.promptCount;
      imageDone += s.imageDone;
      videoSlots += s.promptCount;
      videoDone += s.videoDone;
    }
  }
  // Scenes with text but no prompts yet count as 1 missing prompt slot each
  const scenesMissingPrompt = textScenes.filter((s) => s.promptCount === 0).length;
  const promptTotal = promptSlots + scenesMissingPrompt;
  const promptDone = promptFilled;
  const imageTotal = imageSlots + scenesMissingPrompt;
  const videoTotal = videoSlots + scenesMissingPrompt;

  const setupDone =
    (setupOk ? 1 : 0) + (styleOk ? 1 : 0) + (wpmOk && beatOk ? 1 : 0);
  const setupTotal = 3;

  const canPack =
    setupOk &&
    scriptOk &&
    ttsDone > 0 &&
    (imageDone > 0 || videoDone > 0);

  const exportDone = canPack ? 1 : 0;
  const exportTotal = 1;

  const stations: VideoReadyStation[] = [];

  stations.push({
    id: 'setup',
    ...STATION_META.setup,
    status: stationStatus(setupDone, setupTotal),
    done: setupDone,
    total: setupTotal,
    detail: !setupOk
      ? 'Thiếu Chủ đề + Phong cách (Setup).'
      : !styleOk
        ? 'Thiếu Visual DNA / Media Style.'
        : !(wpmOk && beatOk)
          ? 'Thiếu WPM hoặc secondsPerBeat (Media Config).'
          : `Genre OK · style · WPM/beat`,
    nextHint: !setupOk
      ? 'Mở Setup · chọn Chủ đề + Phong cách.'
      : !styleOk
        ? 'Mở Media Config · Visual DNA / style.'
        : 'Kiểm tra WPM và secondsPerBeat trong Media Config.',
  });

  stations.push({
    id: 'script',
    ...STATION_META.script,
    status: qgBlocked
      ? 'blocked'
      : stationStatus(
          (wordsOk ? 1 : 0) + (scenesOk ? 1 : 0),
          2,
        ),
    done: (wordsOk ? 1 : 0) + (scenesOk ? 1 : 0),
    total: 2,
    detail: qgBlocked
      ? `Quality Gate chặn media (${input.qualityHardErrors} lỗi).`
      : `${wordCount} từ` +
        (wordGoal ? ` / mục tiêu ~${wordFloor}+` : '') +
        ` · ${sceneTagCount} tag cảnh (cần ≥${MIN_SCENE_COUNT})`,
    nextHint: qgBlocked
      ? 'Sửa kịch bản theo Quality Gate (badge QG).'
      : !scenesOk
        ? `Thêm tag [CẢNH N: …] (tối thiểu ${MIN_SCENE_COUNT}).`
        : !wordsOk
          ? 'Viết tiếp / word-gate đến đủ từ Setup.'
          : 'Nội dung đạt — sang TTS.',
  });

  stations.push({
    id: 'tts',
    ...STATION_META.tts,
    status: stationStatus(ttsDone, ttsTotal),
    done: ttsDone,
    total: ttsTotal,
    detail:
      textScenes.length === 0
        ? 'Chưa có cảnh có chữ để TTS.'
        : `TTS ${ttsDone}/${ttsTotal} cảnh (khuyến nghị trước Gen Prompt).`,
    nextHint:
      'Mở cảnh · tab TTS · Gen giọng (lấy duration thật cho storyboard).',
  });

  stations.push({
    id: 'prompt',
    ...STATION_META.prompt,
    status: stationStatus(promptDone, Math.max(1, promptTotal)),
    done: promptDone,
    total: Math.max(1, promptTotal),
    detail:
      promptSlots === 0
        ? `${scenesMissingPrompt} cảnh chưa Gen Prompt Studio.`
        : `Prompt slots ${promptDone}/${promptTotal}` +
          (scenesMissingPrompt
            ? ` · ${scenesMissingPrompt} cảnh chưa có shot`
            : ''),
    nextHint:
      ttsDone < ttsTotal
        ? 'Nên TTS đủ cảnh trước — Gen Prompt cần duration > 0.'
        : 'Gen Prompt Studio từng cảnh (không gộp 1-click).',
  });

  stations.push({
    id: 'image',
    ...STATION_META.image,
    status: stationStatus(imageDone, Math.max(1, imageTotal)),
    done: imageDone,
    total: Math.max(1, imageTotal),
    detail:
      imageSlots === 0
        ? 'Chưa có shot để gen ảnh.'
        : `Ảnh ${imageDone}/${imageSlots}` +
          (scenesMissingPrompt ? ` (+${scenesMissingPrompt} cảnh chưa prompt)` : ''),
    nextHint: 'Gen ảnh từng shot / Gen all images trong cảnh.',
  });

  stations.push({
    id: 'video',
    ...STATION_META.video,
    status: stationStatus(videoDone, Math.max(1, videoTotal)),
    done: videoDone,
    total: Math.max(1, videoTotal),
    detail:
      videoSlots === 0
        ? 'Chưa có shot để gen video.'
        : `Video ${videoDone}/${videoSlots}` +
          (scenesMissingPrompt ? ` (+${scenesMissingPrompt} cảnh chưa prompt)` : ''),
    nextHint: 'Gen video I2V từ ảnh start + video_prompt (Pro/Trial khi enforce).',
  });

  stations.push({
    id: 'export',
    ...STATION_META.export,
    status: canPack ? 'ready' : stationStatus(exportDone, exportTotal),
    done: exportDone,
    total: exportTotal,
    detail: canPack
      ? 'Đủ nguyên liệu tối thiểu để bấm CapCut / Ship (pack timeline).'
      : 'Cần Setup + chữ đạt + ≥1 TTS + ≥1 ảnh hoặc video trên store.',
    nextHint: canPack
      ? 'CapCut / Ship → xem timeline → Export MP4 trong editor.'
      : 'Hoàn thiện các trạm trước (TTS + media đĩa/store).',
  });

  let earned = 0;
  let maxW = 0;
  for (const st of stations) {
    maxW += st.weight;
    earned += st.weight * ratioScore(st.done, st.total);
  }
  const percent = maxW > 0 ? Math.round((earned / maxW) * 100) : 0;

  let nextStationId: VideoReadyStationId | null = null;
  for (const st of stations) {
    if (st.status !== 'ready') {
      nextStationId = st.id;
      break;
    }
  }
  const next =
    stations.find((s) => s.id === nextStationId) ||
    stations[stations.length - 1];
  const nextMessage = next
    ? `Tiếp: ${next.label} — ${next.nextHint}`
    : 'Đủ trạm — mở CapCut / Ship để đóng gói timeline.';

  return {
    chapter,
    percent,
    stations,
    scenes: sceneReports,
    nextStationId,
    nextMessage,
    canPack,
    setupOk,
    scriptOk,
  };
}

/** Stable fingerprint for React selector equality (cheap string). */
export function videoReadyFingerprint(report: VideoReadyReport): string {
  return [
    report.chapter,
    report.percent,
    report.nextStationId || '-',
    report.canPack ? 1 : 0,
    report.stations.map((s) => `${s.id[0]}${s.done}/${s.total}:${s.status[0]}`).join('|'),
  ].join(';');
}
