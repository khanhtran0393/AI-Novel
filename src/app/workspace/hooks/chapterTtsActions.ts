import { useNovelStore } from '@/store/useNovelStore';
import { generateTTSAction } from '../modules/ttsModule';
import { recordEngineCheckpoint } from '../modules/engineModule';
import {
  evaluateYoutubeTtsGate,
  mergeYoutubeSafe,
} from '@/lib/youtubeSafe';
import {
  clearChapterFailLog,
  loadChapterFailLog,
  pruneDeadPartialParts,
  saveChapterFailLog,
} from '@/lib/multiTtsPartialCache';
import {
  formatChapterPreflightConfirm,
  runChapterCastPreflight,
} from '../modules/castPreflight';
import { persistTextReport } from '@/lib/downloadText';
import { toast } from '@/lib/toastBus';
import {
  resyncPromptTimestamps,
  timestampsNeedResync,
} from '@/lib/timestampSync';
import {
  setJobRunner,
  patchBatchJobItem,
  setBatchJobStatus,
  touchBatchJob,
} from '@/lib/jobQueue';
import { scheduleSilentChapterTimeline } from '../modules/integrationsModule';
import {
  beginChapterQueuePrepare,
  clearChapterQueuePrepare,
  getChapterQueueState,
  setChapterQueueNotice,
  startChapterQueue,
  resolveChapterTtsConcurrency,
} from '@/lib/ttsChapterQueue';
import {
  buildChapterTtsJobs,
  getGeneratedAudioAssetKey,
  getTTSApiCredentials,
  hasGeneratedAudio,
  resolveDefaultTtsVoice,
  summarizeChapterTtsResult,
  type ChapterTTSOptions,
  type TtsSceneJob,
} from './ttsActionHelpers';
import { API } from '@/contracts';
import { assertTtsMediaPreflight } from '@/lib/pipeline';
import {
  buildChapterSrt,
  resolveChapterTtsOutputDir,
  type ChapterExportScene,
} from '@/lib/tts/chapterTtsExport';
import { yieldToUi } from '@/store/persistStorage';
import { scheduleAppWork } from '@/lib/appWork';

/**
 * Gen TTS cả chương (force đè) → ghép 1 MP3 + SRT → lưu thư mục đầu ra kênh.
 * GUI chỉ hiển thị progress (ttsChapterQueue) — job chạy luồng nền tách click stack.
 * Persist mute + yield do scheduleAppWork (tránh stringify/IPC đơ Electron).
 */
export function generateChapterTts(
  chapterOpts: ChapterTTSOptions = {},
): Promise<{
  ok: number;
  fail: number;
  skipped: number;
  exportPath?: string;
  srtPath?: string;
}> {
  const chapterHint = useNovelStore.getState().chuong_dang_chon;
  // Reserve queue immediately (sync) so double-click cannot schedule two flows
  const q0 = getChapterQueueState();
  if (q0.running) {
    setChapterQueueNotice('⛔ Đang có job TTS chương — bấm 「Dừng」 trước.');
    return Promise.resolve({ ok: 0, fail: 0, skipped: 0 });
  }
  beginChapterQueuePrepare(chapterHint, 'Đang xếp luồng nền TTS chương…');

  const { promise } = scheduleAppWork({
    kind: 'tts',
    title: `TTS chương ${chapterHint || ''}`.trim(),
    mutePersist: true,
    yieldBeforeStart: true,
    meta: { force: chapterOpts.force !== false, chapter: chapterHint },
    run: async (ctl) => {
      ctl.setMessage('Đang chuẩn bị TTS chương trên luồng nền…');
      return generateChapterTtsInner(chapterOpts);
    },
  });
  return promise;
}

async function generateChapterTtsInner(
  chapterOpts: ChapterTTSOptions = {},
): Promise<{
  ok: number;
  fail: number;
  skipped: number;
  exportPath?: string;
  srtPath?: string;
}> {
    const {
      includeHook = true,
      /** Default true: nút chính = gen đè toàn bộ */
      force = true,
      silent = false,
      bypassYoutubeGate = true, // chapter batch: default run; gate is advisory
      exportFull = true,
    } = chapterOpts;
    // force = re-gen all (overrides skipExisting)
    let skipExisting = force ? false : chapterOpts.skipExisting !== false;

    const notice = (msg: string) => {
      console.info('[Chapter TTS]', msg);
      setChapterQueueNotice(msg);
    };

    // Outer generateChapterTts already reserved queue (prepare). Only block a real worker loop.
    const q0 = getChapterQueueState();
    if (q0.running && q0.total > 0) {
      notice('⛔ Đang có job TTS chương — bấm 「Dừng」 trước.');
      return { ok: 0, fail: 0, skipped: 0 };
    }

    let state = useNovelStore.getState();
    const chapterNumber = state.chuong_dang_chon;

    // Refresh prepare status + paint before preflight / warm (GUI stays responsive)
    beginChapterQueuePrepare(chapterNumber, 'Đang chuẩn bị TTS chương…');
    await yieldToUi();
    if (getChapterQueueState().cancelled || !getChapterQueueState().running) {
      return { ok: 0, fail: 0, skipped: 0 };
    }
    const chapter = state.danh_sach_chuong.find((c) => c.so_chuong === chapterNumber);
    if (!chapter?.noi_dung?.trim() && !state.chapterHooks?.[chapterNumber]?.hook?.trim()) {
      clearChapterQueuePrepare('❌ Chương trống — viết kịch bản hoặc Hook trước khi TTS.');
      return { ok: 0, fail: 0, skipped: 0 };
    }

    // Hard fail when no TTS voice is configured.
    let defaultVoice = '';
    try {
      defaultVoice = resolveDefaultTtsVoice(state).voice;
      state = useNovelStore.getState();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      clearChapterQueuePrepare(`❌ ${msg}`);
      if (!silent) toast.error('TTS chương', msg);
      return { ok: 0, fail: 0, skipped: 0 };
    }

    // P1 — chapter-level TTS media preflight (sample first scene text later; platform/voice now)
    try {
      assertTtsMediaPreflight({
        chapter: chapterNumber,
        sceneText: (chapter?.noi_dung || state.chapterHooks?.[chapterNumber]?.hook || ' ').slice(
          0,
          500,
        ),
        platform: state.ttsConfig.platform,
        voice: defaultVoice,
        chu_de: state.setup?.chu_de,
        phong_cach: state.setup?.phong_cach,
        chapterContent: chapter?.noi_dung,
        characterNames: state.nhan_vat,
        wordGoal: state.setup?.so_tu_chuong || 4250,
        userRules: state.userRules,
        editorVerdict: state.editorReviews?.[chapterNumber]?.verdict,
      });
    } catch (pfErr) {
      const msg = pfErr instanceof Error ? pfErr.message : String(pfErr);
      clearChapterQueuePrepare(`🚫 Media preflight TTS: ${msg}`);
      if (!silent) toast.error('TTS preflight', msg);
      return { ok: 0, fail: 0, skipped: 0 };
    }

    notice('Đang tách cảnh + cast preflight…');
    await yieldToUi();
    if (getChapterQueueState().cancelled || !getChapterQueueState().running) {
      return { ok: 0, fail: 0, skipped: 0 };
    }

    let jobs = buildChapterTtsJobs({
      chapterText: chapter?.noi_dung || '',
      hook: state.chapterHooks?.[chapterNumber]?.hook,
      includeHook,
    });

    if (!jobs.length) {
      clearChapterQueuePrepare('❌ Không tách được cảnh — cần thẻ [CẢNH n:…] hoặc đoạn văn.');
      return { ok: 0, fail: 0, skipped: 0 };
    }

    // YouTube gate: advisory only for chapter batch (auto bypass)
    const yt = mergeYoutubeSafe(state.youtubeSafe);
    const gate = evaluateYoutubeTtsGate({
      enforceEditorGate: yt.enforceEditorGate !== false,
      requireHumanEdit: yt.requireHumanEdit === true,
      humanEdited: !!state.humanEditFlags?.[chapterNumber]?.edited,
      chapterNumber,
      hasScript: true,
      editorReview: state.editorReviews[chapterNumber],
      ttsPlatform: state.ttsConfig.platform,
      ttsPitch: state.ttsConfig.pitch,
      ttsSpeed: state.ttsConfig.speed,
      bypass: bypassYoutubeGate,
    });
    if (gate.hardBlock && !bypassYoutubeGate) {
      clearChapterQueuePrepare(`🚫 Gate chặn: ${gate.reasons[0] || 'youtube-safe'}`);
      return { ok: 0, fail: 0, skipped: 0 };
    }
    if (gate.hardBlock && bypassYoutubeGate) {
      notice(`⚠️ Bỏ qua YouTube gate: ${gate.reasons.slice(0, 2).join(' · ')}`);
    }

    const preflightParams = {
      jobs,
      chapter: chapterNumber,
      cast: state.voiceCast,
      characterNames: state.nhan_vat || [],
      nhanVatPrompts: state.nhan_vat_prompts || {},
      defaultVoice,
      platform: state.ttsConfig.platform,
      language: (state.ttsConfig.language || '').trim(),
      globalSpeed: state.ttsConfig.speed ?? 1,
      globalPitch: state.ttsConfig.pitch ?? 0,
    };

    const chPf = runChapterCastPreflight(preflightParams);

    if (!chPf.runnable.length) {
      const why =
        chPf.blocked[0]?.result.issues.find((i) => i.level === 'block')?.message ||
        'preflight block';
      clearChapterQueuePrepare(`🚫 0 cảnh chạy được: ${why}`);
      return { ok: 0, fail: chPf.blocked.length, skipped: 0 };
    }

    // If skipExisting would skip ALL — auto force so button is not a no-op
    let effectiveSkip = skipExisting;
    if (effectiveSkip && !force) {
      const allHaveAudio = chPf.runnable.every((j) =>
        hasGeneratedAudio(useNovelStore.getState(), chapterNumber, j.sceneIndex),
      );
      if (allHaveAudio) {
        clearChapterQueuePrepare(
          `Info: ${chPf.runnable.length} cảnh đã có audio. Không tự gen đè — bật force nếu muốn gen lại.`,
        );
        return { ok: 0, fail: 0, skipped: chPf.runnable.length };
      }
    }

    const blockedSet = new Set(chPf.blocked.map((b) => b.job.sceneIndex));
    jobs = jobs.filter((j) => !blockedSet.has(j.sceneIndex));
    const initialErrors = chPf.blocked.map(
      (b) =>
        `${b.job.title}: block — ${
          b.result.issues.find((i) => i.level === 'block')?.message || 'preflight'
        }`,
    );

    const platform = (state.ttsConfig.platform || '').trim();
    if (!platform) {
      clearChapterQueuePrepare('❌ Chưa chọn engine TTS (platform).');
      return { ok: 0, fail: 0, skipped: 0 };
    }
    let concurrency = resolveChapterTtsConcurrency(platform);

    // Pre-warm Zero-Shot ONNX worker pool (multi-process → true parallel + later concat)
    if (platform === 'vina_voice') {
      notice('🔥 Warm pool não ONNX (nhiều worker song song)…');
      await yieldToUi();
      try {
        const wr = await fetch(API.vinaVoiceWarm, { method: 'POST' });
        const wj = await wr.json().catch(() => ({}));
        if (wj?.ok && Number(wj.workers) > 0) {
          concurrency = Math.max(
            1,
            Math.min(3, Math.trunc(Number(wj.workers))),
          );
        }
        const warmMessage = wj?.ok
          ? 'Pool x' + concurrency + ' - ' + (wj?.brain?.totalGB || '?') + 'GB/worker - split parallel concat'
          : 'Warm pool error: ' + (wj?.error || wj?.message || 'unknown');
        notice(warmMessage);
        if (!wj?.ok) {
          throw new Error(wj?.error || wj?.message || 'Vina warm pool failed');
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        clearChapterQueuePrepare('Warm fail: ' + msg);
        if (!silent) toast.error('Vina warm pool', msg);
        return { ok: 0, fail: jobs.length, skipped: 0 };
      }
    }

    if (!getChapterQueueState().running) {
      return { ok: 0, fail: 0, skipped: 0 };
    }

    notice(
      `▶️ Bắt đầu TTS ch.${chapterNumber}: ${jobs.length} cảnh · ${defaultVoice}` +
        (effectiveSkip ? ' · skip có audio' : ' · gen đè') +
        (concurrency > 1
          ? ` · song song ×${concurrency} (ghép trong từng cảnh dài)`
          : ' · tuần tự')
    );

    // P1 — stage batch job (Jobs panel pause/cancel/retry)
    const { createStageBatchJob } = await import('@/lib/pipeline');
    const batchJob = createStageBatchJob({
      stage: 'tts',
      chapter: chapterNumber,
      title: `TTS chương ${chapterNumber}`,
      concurrency,
      items: jobs.map((j) => ({
        label: j.title,
        chapter: chapterNumber,
        sceneIndex: j.sceneIndex,
        meta: { text: j.text, title: j.title },
      })),
    });
    setBatchJobStatus(batchJob.id, 'running');

    const genOneScene = async (job: TtsSceneJob) => {
      const st = useNovelStore.getState();
      const creds = getTTSApiCredentials(st);
      const voice = (st.ttsConfig.voice || '').trim();
      if (!voice) {
        throw new Error('Chua chon voice TTS. App khong tu gan voice.');
      }
      const title = (st.ten_tac_pham || '').trim();
      if (!title) {
        throw new Error('Chua nhap ten_tac_pham. App khong tu gan ten truyen.');
      }
      const ttsCfg = { ...st.ttsConfig, voice };
      const { audioPath, duration, multi, segmentCount } = await generateTTSAction({
        apiKey: creds.apiKey,
        apiKeys: creds.apiKeys,
        sceneText: job.text,
        chuong_dang_chon: chapterNumber,
        sceneIndex: job.sceneIndex,
        savePathTTS: st.savePathTTS || '',
        googleDrivePath: st.googleDrivePath || '',
        voice,
        ten_tac_pham: title,
        ttsConfig: ttsCfg,
        syncMode: st.ttsConfig.syncMode,
        forceFullMulti: force === true,
      });
      if (!audioPath) throw new Error('API TTS không trả path audio');
      const assetKey = getGeneratedAudioAssetKey(chapterNumber, job.sceneIndex);
      useNovelStore.getState().addGeneratedAudio(assetKey, audioPath, duration);
      try {
        const prompts = useNovelStore.getState().generatedPrompts?.[assetKey] || [];
        if (prompts.length && duration > 0 && timestampsNeedResync(prompts as import('@/lib/timestampSync').TimedPrompt[], duration, 0.15)) {
          useNovelStore
            .getState()
            .addGeneratedPrompts(
              assetKey,
              resyncPromptTimestamps(
                prompts as import('@/lib/timestampSync').TimedPrompt[],
                duration,
              ) as typeof prompts,
            );
        }
      } catch {
        /* ignore */
      }
      void recordEngineCheckpoint({
        step: 'tts_audio',
        scope: { kind: 'scene', chapter: chapterNumber, scene: job.sceneIndex },
        projectName: st.ten_tac_pham,
        payload: {
          assetKey,
          audioPath,
          duration,
          multi: !!multi,
          segmentCount: segmentCount || 1,
          backgroundQueue: true,
        },
      });
    };

    setJobRunner(batchJob.id, async (item) => {
      const meta = item.meta || {};
      await genOneScene({
        sceneIndex: Number(meta.sceneIndex),
        text: String(meta.text || ''),
        title: String(meta.title || item.label),
      });
    });

    try {
      const result = await startChapterQueue({
        chapterNumber,
        jobs,
        skipExisting: effectiveSkip,
        concurrency,
        initialSkipped: chPf.blocked.length,
        initialErrors,
        hasExistingAudio: (sceneIndex) =>
          hasGeneratedAudio(useNovelStore.getState(), chapterNumber, sceneIndex),
        deductCredit: () => useNovelStore.getState().deductCredits(1),
        generateOne: async (job) => genOneScene(job),
        onItemStart: (_job, index) => {
          patchBatchJobItem(batchJob.id, index, { status: 'running' });
        },
        onItemDone: (_job, index) => {
          patchBatchJobItem(batchJob.id, index, { status: 'done', error: undefined });
        },
        onItemSkip: (_job, index) => {
          patchBatchJobItem(batchJob.id, index, { status: 'done', error: undefined });
        },
        onItemFail: (_job, index, error) => {
          patchBatchJobItem(batchJob.id, index, { status: 'failed', error });
        },
        onComplete: (r) => {
          setBatchJobStatus(
            batchJob.id,
            r.cancelled ? 'cancelled' : r.fail > 0 ? 'failed' : 'done',
          );
          touchBatchJob(batchJob.id);
          if (r.failedIndexes.length) {
            saveChapterFailLog(chapterNumber, r.failedIndexes);
          } else if (!r.cancelled && r.ok > 0) {
            clearChapterFailLog(chapterNumber);
          }
          if (r.ok > 0 && !r.cancelled) {
            scheduleSilentChapterTimeline({ chapterNum: chapterNumber, delayMs: 600 });
          } else if (r.fail > 0 && !silent) {
            toast.warn(
              'TTS chương có lỗi',
              `OK ${r.ok} · lỗi ${r.fail} — Jobs panel có thể retry item`,
            );
          }
          const summary = summarizeChapterTtsResult(chapterNumber, r);
          setChapterQueueNotice(summary, {
            lastResult: { ok: r.ok, fail: r.fail, skipped: r.skipped },
          });
          if (!silent && (r.fail > 0 || r.ok === 0)) {
            const detail = r.errors.slice(0, 3).join(' · ');
            toast.warn(
              `TTS ch.${chapterNumber}`,
              `OK ${r.ok} · lỗi ${r.fail} · bỏ qua ${r.skipped}${detail ? ` · ${detail}` : ''}`,
            );
          }
        },
      });

      // Force-gen xong → ghép full + SRT → thư mục đầu ra kênh
      let exportPath: string | undefined;
      let srtPath: string | undefined;
      if (exportFull && !result.cancelled && result.ok > 0) {
        try {
          const exp = await exportChapterFullAudioAndSrt({
            chapterNumber,
            jobs,
            notice,
          });
          exportPath = exp.driveFilePath || exp.audioPath;
          srtPath = exp.driveSrtPath || exp.srtPath;
          if (exportPath && !silent) {
            toast.success(
              'TTS chương + file full',
              `OK ${result.ok} · full: ${exportPath}` +
                (srtPath ? `\nSRT: ${srtPath}` : ''),
            );
          } else if (result.ok > 0 && !silent) {
            toast.success(
              'TTS chương xong',
              `OK ${result.ok} · lỗi ${result.fail} · bỏ qua ${result.skipped}`,
            );
          }
        } catch (expErr) {
          const msg =
            expErr instanceof Error ? expErr.message : String(expErr);
          notice(`⚠️ Ghép full/SRT: ${msg}`);
          if (!silent) {
            toast.warn(
              'TTS xong — ghép full lỗi',
              `Audio từng cảnh OK nhưng full/SRT: ${msg}`,
            );
          }
        }
      } else if (result.ok > 0 && !result.cancelled && !silent) {
        toast.success(
          'TTS chương xong',
          `OK ${result.ok} · lỗi ${result.fail} · bỏ qua ${result.skipped}`,
        );
      }

      return { ...result, exportPath, srtPath };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      notice(`❌ Queue lỗi: ${msg}`);
      setBatchJobStatus(batchJob.id, 'failed');
      toast.error('TTS chương', msg);
      throw e;
    }
}

/**
 * Collect per-scene audio (job order) → concat → MP3 + SRT under channel output.
 */
async function exportChapterFullAudioAndSrt(input: {
  chapterNumber: number;
  jobs: TtsSceneJob[];
  notice: (msg: string) => void;
}): Promise<{
  audioPath: string;
  duration: number;
  driveFilePath?: string;
  driveSrtPath?: string;
  srtPath?: string;
}> {
  const st = useNovelStore.getState();
  const scenes: ChapterExportScene[] = [];
  for (const job of input.jobs) {
    const key = getGeneratedAudioAssetKey(input.chapterNumber, job.sceneIndex);
    const audio = st.generatedAudioPaths?.[key];
    const p = String(audio?.path || '').trim();
    if (!p) continue;
    scenes.push({
      sceneIndex: job.sceneIndex,
      title: job.title,
      text: job.text,
      audioPath: p,
      durationSec: Number(audio?.duration) || 0,
    });
  }
  if (scenes.length < 1) {
    throw new Error('Không có audio cảnh nào để ghép full.');
  }

  let channel: { savePathRoot?: string } | null = null;
  try {
    channel =
      typeof st.getActiveChannel === 'function'
        ? st.getActiveChannel()
        : null;
  } catch {
    channel = null;
  }
  if (!channel && st.channels && st.activeChannelId) {
    channel = st.channels[st.activeChannelId] || null;
  }
  const drivePath = resolveChapterTtsOutputDir({
    channelSavePathRoot: channel?.savePathRoot,
    savePathTTS: st.savePathTTS,
    googleDrivePath: st.googleDrivePath,
  });

  const srtContent = buildChapterSrt({
    scenes,
    cast: st.voiceCast,
    characterNames: st.nhan_vat || [],
    wpm: st.wpm || 140,
  });

  input.notice(
    `🔗 Ghép ${scenes.length} audio → 1 file full + SRT` +
      (drivePath ? ` → ${drivePath}` : ' (chỉ public/audio — chưa set thư mục kênh)'),
  );

  const res = await fetch(API.concatAudio, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      paths: scenes.map((s) => s.audioPath),
      chapterNum: input.chapterNumber,
      sceneIndex: 0,
      outputRole: 'chapter',
      drivePath: drivePath || undefined,
      ten_tac_pham: st.ten_tac_pham || '',
      srtContent,
      applyLoudnorm: true,
      cleanup: false,
    }),
  });
  const data = (await res.json().catch(() => ({}))) as {
    success?: boolean;
    error?: string;
    audioPath?: string;
    duration?: number;
    driveFilePath?: string;
    driveSrtPath?: string;
    srtPath?: string;
  };
  if (!res.ok || !data.success || !data.audioPath) {
    throw new Error(data.error || `concat-audio HTTP ${res.status}`);
  }

  // Store chapter master as special key for convenience
  const fullKey = `${input.chapterNumber}_full`;
  try {
    st.addGeneratedAudio(
      fullKey,
      data.audioPath,
      Number(data.duration) || scenes.reduce((a, s) => a + (s.durationSec || 0), 0),
    );
    // Full narration is authoritative: persist absolute CapCut slots against it.
    scheduleSilentChapterTimeline({
      chapterNum: input.chapterNumber,
      delayMs: 250,
    });
  } catch {
    /* optional */
  }

  input.notice(
    `✅ Full ch.${input.chapterNumber}: ${data.driveFilePath || data.audioPath}` +
      (data.driveSrtPath || data.srtPath
        ? ` · SRT ${data.driveSrtPath || data.srtPath}`
        : ''),
  );

  return {
    audioPath: data.audioPath,
    duration: Number(data.duration) || 0,
    driveFilePath: data.driveFilePath,
    driveSrtPath: data.driveSrtPath,
    srtPath: data.srtPath,
  };
}

/** Dry-run preflight + export report file */
export async function runChapterCastPreflightReport(
  opts?: { exportFile?: boolean },
): Promise<string | null> {
    let state = useNovelStore.getState();
    const chapterNumber = state.chuong_dang_chon;
    const chapter = state.danh_sach_chuong.find((c) => c.so_chuong === chapterNumber);
    const jobs = buildChapterTtsJobs({
      chapterText: chapter?.noi_dung || '',
      hook: state.chapterHooks?.[chapterNumber]?.hook,
    });
    if (!jobs.length) {
      toast.warn('Preflight', 'Chương trống — viết kịch bản / tách cảnh trước.');
      return null;
    }

    let defaultVoice = '';
    try {
      defaultVoice = resolveDefaultTtsVoice(state).voice;
      state = useNovelStore.getState();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error('Preflight TTS', msg);
      return null;
    }

    let pruned = 0;
    for (const j of jobs) {
      try {
        pruned += await pruneDeadPartialParts(chapterNumber, j.sceneIndex);
      } catch {
        /* ignore */
      }
    }

    const yt = mergeYoutubeSafe(state.youtubeSafe);
    const gate = evaluateYoutubeTtsGate({
      enforceEditorGate: yt.enforceEditorGate !== false,
      requireHumanEdit: yt.requireHumanEdit === true,
      humanEdited: !!state.humanEditFlags?.[chapterNumber]?.edited,
      chapterNumber,
      hasScript: true,
      editorReview: state.editorReviews[chapterNumber],
      ttsPlatform: state.ttsConfig.platform,
      ttsPitch: state.ttsConfig.pitch,
      ttsSpeed: state.ttsConfig.speed,
      bypass: false,
    });

    const chPf = runChapterCastPreflight({
      jobs,
      chapter: chapterNumber,
      cast: state.voiceCast,
      characterNames: state.nhan_vat || [],
      nhanVatPrompts: state.nhan_vat_prompts || {},
      defaultVoice,
      platform: state.ttsConfig.platform,
      language: (state.ttsConfig.language || '').trim(),
      globalSpeed: state.ttsConfig.speed ?? 1,
      globalPitch: state.ttsConfig.pitch ?? 0,
    });

    const withAudio = jobs.filter((j) =>
      hasGeneratedAudio(state, chapterNumber, j.sceneIndex),
    ).length;
    const failLog = loadChapterFailLog(chapterNumber);

    let report = formatChapterPreflightConfirm(chPf).replace('\n\nTiếp tục?', '');
    report =
      `# AI Novel — Cast / TTS Preflight Report\n` +
      `# Chương ${chapterNumber} · ${new Date().toISOString()}\n` +
      `# Tác phẩm: ${state.ten_tac_pham || '(chưa đặt)'}\n` +
      `# Platform: ${state.ttsConfig.platform || '?'} - Voice: ${defaultVoice}\n` +
      `# Jobs: ${jobs.length} · Đã có audio: ${withAudio} · Fail-log: ${failLog.length}\n\n` +
      report;

    report += '\n\n## YouTube-safe gate';
    if (gate.hardBlock) {
      report += `\n🚫 HARD BLOCK:\n• ${gate.reasons.join('\n• ')}`;
      report += '\n→ Nút Gen TTS sẽ hỏi bỏ qua gate (OK) hoặc dừng (Cancel).';
    } else if (gate.warnings.length) {
      report += `\n⚠️ Warnings:\n• ${gate.warnings.join('\n• ')}`;
    } else {
      report += '\n✅ Gate OK';
    }

    if (pruned > 0) {
      report += `\n\n🧹 Đã dọn ${pruned} partial path chết (file không còn).`;
    }
    report +=
      '\n\n## Cách dùng nút\n' +
      '• Gen TTS cả chương: FORCE gen đè mọi cảnh → ghép 1 MP3 + SRT → thư mục đầu ra kênh.\n' +
      '• Jobs panel: retry item lỗi trong batch TTS.\n';

    const shouldExport = opts?.exportFile !== false;
    let saveNote = '';
    if (shouldExport) {
      const fname = `cast-preflight-ch${chapterNumber}-${Date.now()}.txt`;
      const saved = await persistTextReport(fname, report);
      if (saved.via === 'electron' && saved.path) {
        saveNote = `\n\n📁 Đã lưu: ${saved.path}`;
      } else {
        saveNote = `\n\n📥 Đã tải file: ${fname}`;
      }
    }

    setChapterQueueNotice(
      `🔎 Preflight ch.${chapterNumber}: chạy được ${chPf.runnable.length}/${jobs.length}` +
        (gate.hardBlock ? ' · gate HARD (Gen TTS vẫn chạy, đã bypass)' : '') +
        (saveNote ? ' · đã xuất report' : ''),
    );

    // Cap alert length — full report still in file
    const preview =
      report.length > 1800 ? report.slice(0, 1800) + '\n…(xem file report đầy đủ)' : report;
    toast.info('Preflight report', (preview + saveNote).slice(0, 400));
    return report;
}
