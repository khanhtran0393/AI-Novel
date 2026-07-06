import type { Chuong, NovelState } from '@/store/useNovelStore';

type EngineScope =
  | { kind: 'global' }
  | { kind: 'chapter'; chapter: number }
  | { kind: 'scene'; chapter: number; scene: number };

interface SnapshotInput {
  ten_tac_pham: string;
  chuong_dang_chon: number;
  setup: NovelState['setup'];
  danh_sach_chuong: Chuong[];
  editorReviews: NovelState['editorReviews'];
  generatedAudioPaths: NovelState['generatedAudioPaths'];
  generatedImages: NovelState['generatedImages'];
  generatedVideos: NovelState['generatedVideos'];
}

export interface EngineStatusResponse {
  root: string;
  progress: {
    projectName: string;
    currentChapter: number;
    totalChapters: number;
    targetWords: number;
    chapters: Chuong[];
  } | null;
  checkpoints: unknown[];
  diagnostics: { severity: string; rule: string; message: string; evidence?: string }[];
  diagPath: string;
  nextStep: string;
}

export async function recordEngineCheckpoint(params: {
  step: string;
  scope?: EngineScope;
  payload: unknown;
  projectName?: string;
}): Promise<void> {
  try {
    await fetch('/api/engine', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'checkpoint',
        step: params.step,
        scope: params.scope,
        payload: params.payload,
        projectName: params.projectName,
      }),
    });
  } catch (error) {
    console.warn('[Engine] checkpoint skipped:', error);
  }
}

export async function recordEngineSnapshot(input: SnapshotInput): Promise<void> {
  try {
    await fetch('/api/engine', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'snapshot',
        snapshot: {
          projectName: input.ten_tac_pham,
          currentChapter: input.chuong_dang_chon,
          totalChapters: input.setup.so_chuong || input.danh_sach_chuong.length,
          targetWords: input.setup.so_tu_chuong || 4250,
          chapters: input.danh_sach_chuong,
          editorReviews: Object.fromEntries(
            Object.entries(input.editorReviews || {}).map(([chapter, review]) => [
              chapter,
              { verdict: review.verdict, summary: review.summary },
            ]),
          ),
          generatedAudioCount: Object.values(input.generatedAudioPaths || {}).filter((item) => item.path).length,
          generatedImageCount: Object.values(input.generatedImages || {}).filter(Boolean).length,
          generatedVideoCount: Object.values(input.generatedVideos || {}).filter(Boolean).length,
        },
      }),
    });
  } catch (error) {
    console.warn('[Engine] snapshot skipped:', error);
  }
}

export async function resetEngineAction(): Promise<void> {
  try {
    await fetch('/api/engine', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'reset' }),
    });
  } catch (error) {
    console.warn('[Engine] reset skipped:', error);
  }
}

export async function getEngineStatus(): Promise<EngineStatusResponse | null> {
  try {
    const res = await fetch('/api/engine', { cache: 'no-store' });
    if (!res.ok) return null;
    return await res.json();
  } catch (error) {
    console.warn('[Engine] status skipped:', error);
    return null;
  }
}
