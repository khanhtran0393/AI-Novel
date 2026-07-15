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
  createBatchJob,
  setJobRunner,
  patchBatchJobItem,
  setBatchJobStatus,
  touchBatchJob,
} from '@/lib/jobQueue';
import { scheduleSilentChapterTimeline } from '../modules/integrationsModule';
import {
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

/**
 * Gen TTS cả chương qua queue nền (sống sót remount React / đổi tab).
 * Tách khỏi useTTSActions để scene TTS và chapter TTS không chồng chéo.
 */
export async function generateChapterTts(
  chapterOpts: ChapterTTSOptions = {},
): Promise<{ ok: number; fail: number; skipped: number }> {
    const {
      includeHook = true,
      onlyFailed = false,
      force = false,
      silent = false,
      bypassYoutubeGate = true, // chapter batch: default run; gate is advisory
    } = chapterOpts;
    // force = re-gen all; onlyFailed ignores skipExisting for failed set
    let skipExisting = force ? false : chapterOpts.skipExisting !== false && !onlyFailed;

    const notice = (msg: string) => {
      console.info('[Chapter TTS]', msg);
      setChapterQueueNotice(msg);
    };

    if (getChapterQueueState().running) {
      notice('⛔ Đang có job TTS chương — bấm 「Dừng」 trước.');
      return { ok: 0, fail: 0, skipped: 0 };
    }

    let state = useNovelStore.getState();
    const chapterNumber = state.chuong_dang_chon;
    const chapter = state.danh_sach_chuong.find((c) => c.so_chuong === chapterNumber);
    if (!chapter?.noi_dung?.trim() && !state.chapterHooks?.[chapterNumber]?.hook?.trim()) {
      notice('❌ Chương trống — viết kịch bản hoặc Hook trước khi TTS.');
      return { ok: 0, fail: 0, skipped: 0 };
    }

    // Auto-fill empty voice so preflight is not 100% blocked
    const voiceRes = resolveDefaultTtsVoice(state);
    state = useNovelStore.getState();
    const defaultVoice = voiceRes.voice || state.ttsConfig.voice || 'vi-VN-HoaiMyNeural';
    if (voiceRes.autoFilled) {
      notice(`ℹ️ Chưa chọn giọng → tự gán ${defaultVoice}`);
    }

    let jobs = buildChapterTtsJobs({
      chapterText: chapter?.noi_dung || '',
      hook: state.chapterHooks?.[chapterNumber]?.hook,
      includeHook,
    });

    if (onlyFailed) {
      const failed = new Set(loadChapterFailLog(chapterNumber));
      if (!failed.size) {
        const missing = jobs.filter((j) => !hasGeneratedAudio(state, chapterNumber, j.sceneIndex));
        if (missing.length) {
          notice(`↺ Không có fail-log → gen ${missing.length} cảnh chưa có audio`);
          jobs = missing;
          skipExisting = false;
        } else {
          notice('❌ Không có fail-log và mọi cảnh đã có audio — dùng 「Gen lại toàn bộ」');
          return { ok: 0, fail: 0, skipped: jobs.length };
        }
      } else {
        jobs = jobs.filter((j) => failed.has(j.sceneIndex));
        notice(`↺ Retry ${jobs.length} cảnh trong fail-log`);
      }
    }

    if (!jobs.length) {
      notice('❌ Không tách được cảnh — cần thẻ [CẢNH n:…] hoặc đoạn văn.');
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
      notice(`🚫 Gate chặn: ${gate.reasons[0] || 'youtube-safe'}`);
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
      language: state.ttsConfig.language || 'vi',
      globalSpeed: state.ttsConfig.speed ?? 1,
      globalPitch: state.ttsConfig.pitch ?? 0,
    };

    let chPf = runChapterCastPreflight(preflightParams);
    let castBypassNote = '';
    // If cast resolution blocks everything, fall back to mono default voice
    if (!chPf.runnable.length) {
      chPf = runChapterCastPreflight({ ...preflightParams, cast: null });
      castBypassNote = ' · Cast OFF tạm (mono)';
    }

    if (!chPf.runnable.length) {
      const why =
        chPf.blocked[0]?.result.issues.find((i) => i.level === 'block')?.message ||
        'preflight block';
      notice(`🚫 0 cảnh chạy được: ${why}`);
      return { ok: 0, fail: chPf.blocked.length, skipped: 0 };
    }

    // If skipExisting would skip ALL — auto force so button is not a no-op
    let effectiveSkip = skipExisting;
    if (effectiveSkip && !onlyFailed && !force) {
      const allHaveAudio = chPf.runnable.every((j) =>
        hasGeneratedAudio(useNovelStore.getState(), chapterNumber, j.sceneIndex),
      );
      if (allHaveAudio) {
        effectiveSkip = false;
        notice(
          `ℹ️ ${chPf.runnable.length} cảnh đã có audio → tự gen đè (tránh bỏ qua 100%)`,
        );
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

    const platform = state.ttsConfig.platform || 'edge_tts';
    let concurrency = resolveChapterTtsConcurrency(platform);

    // Pre-warm Zero-Shot ONNX worker pool (multi-process → true parallel + later concat)
    if (platform === 'vina_voice') {
      notice('🔥 Warm pool não ONNX (nhiều worker song song)…');
      try {
        const wr = await fetch(API.vinaVoiceWarm, { method: 'POST' });
        const wj = await wr.json().catch(() => ({}));
        if (wj?.ok && Number(wj.workers) > 0) {
          concurrency = Math.max(
            1,
            Math.min(3, Math.trunc(Number(wj.workers))),
          );
        }
        notice(
          wj?.ok
            ? `✅ Pool ×${concurrency} · ~${wj?.brain?.totalGB || '?'}GB/worker — chia đoạn → gen song song → ghép`
            : `⚠️ Warm: ${wj?.error || wj?.message || 'fallback one-shot'}`,
        );
      } catch (e) {
        notice(`⚠️ Warm fail: ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    notice(
      `▶️ Bắt đầu TTS ch.${chapterNumber}: ${jobs.length} cảnh · ${defaultVoice}` +
        (effectiveSkip ? ' · skip có audio' : ' · gen đè') +
        (concurrency > 1
          ? ` · song song ×${concurrency} (ghép trong từng cảnh dài)`
          : ' · tuần tự') +
        castBypassNote,
    );

    // Mirror into global Jobs panel (status + retry failed)
    const batchJob = createBatchJob({
      title: `TTS chương ${chapterNumber}`,
      kind: 'tts',
      concurrency,
      items: jobs.map((j) => ({
        label: j.title,
        meta: { sceneIndex: j.sceneIndex, text: j.text, title: j.title },
      })),
    });
    setBatchJobStatus(batchJob.id, 'running');

    const genOneScene = async (job: TtsSceneJob) => {
      const st = useNovelStore.getState();
      const creds = getTTSApiCredentials(st);
      const voice =
        (st.ttsConfig.voice || '').trim() || defaultVoice || 'vi-VN-HoaiMyNeural';
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
        ten_tac_pham: st.ten_tac_pham || 'Kịch Bản Vô Danh',
        ttsConfig: ttsCfg,
        syncMode: st.ttsConfig.syncMode,
        forceFullMulti: force === true,
        forceMono: Boolean(castBypassNote),
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
            toast.success(
              'TTS chương xong',
              `OK ${r.ok} · lỗi ${r.fail} · bỏ qua ${r.skipped}`,
            );
          } else if (r.fail > 0) {
            toast.warn(
              'TTS chương có lỗi',
              `OK ${r.ok} · lỗi ${r.fail} — Jobs → Retry hoặc Gen lại lỗi`,
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
      return result;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      notice(`❌ Queue lỗi: ${msg}`);
      setBatchJobStatus(batchJob.id, 'failed');
      toast.error('TTS chương', msg);
      throw e;
    }
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

    const voiceRes = resolveDefaultTtsVoice(state);
    state = useNovelStore.getState();

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
      defaultVoice: voiceRes.voice,
      platform: state.ttsConfig.platform,
      language: state.ttsConfig.language || 'vi',
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
      `# Platform: ${state.ttsConfig.platform || '?'} · Voice: ${voiceRes.voice}${voiceRes.autoFilled ? ' (auto)' : ''}\n` +
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
      '• Gen TTS cả chương: skip audio đã có; hỏi force nếu 100% đã có.\n' +
      '• Gen lại cảnh lỗi: theo fail-log; nếu không có log → gen cảnh chưa audio.\n' +
      '• Gen lại toàn bộ: force đè audio cũ.\n';

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
