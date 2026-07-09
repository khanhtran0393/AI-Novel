/**
 * NovelEngineRunner — Host in-process thay ainovel-gui :8080.
 * Loop: Route(state) → tool → update progress → SSE log.
 */
import { type EngineProgress, type Instruction, nextChapter } from './domain';
import { route, formatHostMessage } from './flow/router';
import { emitEngineBus, logEngine } from './bus';
import {
  ensureProgress,
  listChapters,
  loadConfigFile,
  loadProgress,
  saveProgress,
} from './store/diskStore';
import { loadProjectContext } from './projectContext';
import {
  commitChapterTool,
  draftChapterTool,
  planChapterTool,
  saveReviewTool,
} from './tools/writerTools';
import {
  expandArcTool,
  saveArcSummaryTool,
  saveVolumeSummaryTool,
} from './tools/editorTools';
import { pullChaptersFromStoreBackup } from './sync/storeBridge';
import { recordSnapshot } from './engine';

export type RunnerStatus = 'running' | 'stopped';

interface RunnerState {
  status: RunnerStatus;
  abort: AbortController | null;
  loopPromise: Promise<void> | null;
  lastAction: string;
  lastError: string | null;
}

const g = globalThis as unknown as { __ainovelRunner?: RunnerState };

function state(): RunnerState {
  if (!g.__ainovelRunner) {
    g.__ainovelRunner = {
      status: 'stopped',
      abort: null,
      loopPromise: null,
      lastAction: 'Ready / Idle',
      lastError: null,
    };
  }
  return g.__ainovelRunner;
}

export function getRunnerStatus(): RunnerStatus {
  return state().status;
}

export function getRunnerMeta() {
  const s = state();
  const progress = loadProgress();
  return {
    status: s.status,
    lastAction: s.lastAction || progress?.lastAction || 'Ready / Idle',
    lastError: s.lastError,
    progress,
    engine: 'native-ts',
    independent: true,
    note: 'Không phụ thuộc ainovel-gui.exe / localhost:8080',
  };
}

export async function startEngine(): Promise<{ ok: boolean; error?: string }> {
  const s = state();
  if (s.status === 'running') {
    return { ok: true };
  }

  const ctx = loadProjectContext();
  if (!ctx.apiKeys.length && !ctx.openaiApiKeys.length && !ctx.grokApiKeys.length && ctx.aiMasterModel !== 'aistudio') {
    const msg = 'Chưa có API Key. Cấu hình Gemini/OpenAI/Grok ở Header rồi Start lại.';
    logEngine(msg, 'error');
    return { ok: false, error: msg };
  }

  // 2-way sync: store → engine disk
  pullChaptersFromStoreBackup();

  const progress = ensureProgress(ctx.ten_tac_pham, ctx.so_chuong);
  // Sync completed from disk chapters
  const diskChapters = listChapters();
  const completed = diskChapters
    .filter((c) => (c.status === 'committed' || c.status === 'draft') && c.content.trim().length > 500)
    .filter((c) => c.status === 'committed')
    .map((c) => c.id);
  if (completed.length) {
    progress.completedChapters = Array.from(
      new Set([...progress.completedChapters, ...completed]),
    ).sort((a, b) => a - b);
  }
  progress.phase = nextChapter(progress) > 0 ? 'writing' : 'complete';
  progress.projectName = ctx.ten_tac_pham;
  progress.totalChapters = ctx.so_chuong || progress.totalChapters;
  progress.lastAction = 'Engine started (native)';
  saveProgress(progress);

  s.abort = new AbortController();
  s.status = 'running';
  s.lastError = null;
  s.lastAction = 'Running';
  emitEngineBus({ type: 'status', status: 'running' });
  logEngine(
    `🚀 Native Engine START — "${ctx.ten_tac_pham}" · ${progress.totalChapters} chương · model=${ctx.aiMasterModel}`,
    'success',
  );

  s.loopPromise = runLoop(s.abort.signal).finally(() => {
    s.status = 'stopped';
    s.abort = null;
    s.loopPromise = null;
    emitEngineBus({ type: 'status', status: 'stopped' });
    logEngine('⏹ Engine STOPPED', 'info');
  });

  return { ok: true };
}

export async function stopEngine(): Promise<void> {
  const s = state();
  if (s.abort) {
    s.abort.abort();
    logEngine('Yêu cầu dừng engine…');
  }
  s.status = 'stopped';
  emitEngineBus({ type: 'status', status: 'stopped' });
}

function readMaxSteps(): number {
  try {
    const { config } = loadConfigFile();
    const parsed = JSON.parse(config || '{}') as { maxChaptersPerRun?: number };
    const n = Number(parsed.maxChaptersPerRun);
    if (Number.isFinite(n) && n > 0) return Math.min(200, Math.max(1, n));
  } catch {
    /* default */
  }
  return 50;
}

async function runLoop(signal: AbortSignal): Promise<void> {
  const maxSteps = readMaxSteps();
  let steps = 0;
  logEngine(`Loop budget: maxSteps=${maxSteps}`);

  while (!signal.aborted && steps < maxSteps) {
    steps += 1;
    let progress = loadProgress();
    if (!progress) {
      logEngine('Mất progress — dừng.', 'error');
      break;
    }

    if (progress.phase === 'complete') {
      logEngine('🎉 Phase=complete — toàn bộ chương đã commit.', 'success');
      break;
    }

    const instruction = route({
      progress,
      lastCompleted: progress.completedChapters[progress.completedChapters.length - 1] || 0,
      arcBoundary: null,
      hasArcReview: true,
      hasArcSummary: true,
      hasVolumeSummary: true,
      foundationMissing: [],
    });

    if (!instruction) {
      // Nếu còn chương trống nhưng route null → force writer next
      const n = nextChapter(progress);
      if (n > 0) {
        await executeInstruction(
          {
            agent: 'writer',
            task: `Viết chương ${n}`,
            reason: 'Fallback next chapter',
            chapter: n,
          },
          progress,
          signal,
        );
        continue;
      }
      progress.phase = 'complete';
      progress.lastAction = 'Complete';
      saveProgress(progress);
      logEngine('Không còn instruction — đánh dấu complete.', 'success');
      break;
    }

    logEngine(formatHostMessage(instruction));
    try {
      progress = await executeInstruction(instruction, progress, signal);
      state().lastAction = progress.lastAction;
      emitEngineBus({ type: 'chapter_update', chapterId: instruction.chapter || undefined });
      syncSnapshot(progress);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      state().lastError = msg;
      logEngine(`❌ Tool error: ${msg}`, 'error');
      // stop on hard failures (auth / no key)
      if (/API Key|Unauthorized|401|403/i.test(msg)) break;
      // soft fail: pause briefly then continue once
      await sleep(1500);
      if (steps > 3) break;
    }

    await sleep(800);
  }
}

async function executeInstruction(
  instruction: Instruction,
  progress: EngineProgress,
  signal: AbortSignal,
): Promise<EngineProgress> {
  if (signal.aborted) return progress;

  const ch = instruction.chapter;

  if (instruction.agent === 'writer' && ch > 0) {
    const isRewrite =
      progress.pendingRewrites.includes(ch) ||
      /viết lại|đánh bóng/i.test(instruction.task);

    await planChapterTool(ch, progress);
    if (signal.aborted) return progress;

    await draftChapterTool(ch, progress, { overwrite: isRewrite });
    if (signal.aborted) return progress;

    // Review then commit (or re-queue)
    const { progress: afterReview } = await saveReviewTool(ch, progress);
    return afterReview;
  }

  if (instruction.agent === 'editor') {
    if (/volume|tập/i.test(instruction.task)) {
      return saveVolumeSummaryTool(progress);
    }
    return saveArcSummaryTool(progress);
  }

  if (instruction.agent === 'architect_long' || instruction.agent === 'architect_short') {
    if (/complete_book|kết thúc/i.test(instruction.task)) {
      const updated = {
        ...progress,
        phase: 'complete' as const,
        lastAction: 'Book complete (architect)',
        updatedAt: new Date().toISOString(),
      };
      saveProgress(updated);
      logEngine('🎉 Architect complete_book', 'success');
      return updated;
    }
    return expandArcTool(progress);
  }

  // Fallback commit current draft if any
  if (ch > 0) {
    return commitChapterTool(ch, progress);
  }
  return progress;
}

function syncSnapshot(progress: EngineProgress): void {
  try {
    const chapters = listChapters().map((c) => ({
      so_chuong: c.id,
      tieu_de: c.title,
      dan_y: c.dan_y,
      noi_dung: c.content,
      trang_thai: c.status === 'committed' ? ('ready' as const) : ('empty' as const),
    }));
    recordSnapshot({
      projectName: progress.projectName,
      currentChapter: progress.currentChapter,
      totalChapters: progress.totalChapters,
      targetWords: 4250,
      chapters,
    });
  } catch {
    // non-fatal
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
