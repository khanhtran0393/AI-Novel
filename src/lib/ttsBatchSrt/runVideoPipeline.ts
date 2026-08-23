/**
 * CapAssist-style data pipe — Google AI Studio only (no local Whisper/TTS):
 *
 *   Video/SRT/TXT
 *     → extract audio (hwaccel)
 *     → STT Google Studio (parallel chunks)  | skip nếu có SRT
 *     → dịch Google Studio (|| anchor ×50, parallel batches)
 *     → TTS gemini_tts|google concurrent + sanitize
 *     → CapCut draft inject (default)
 *     → [optional] FFmpeg mux
 *
 * Nhánh draft = text+audio+timeline CapCut. Render MP4 full = CapCut Export / full_mux.
 */

import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import { resolveFfmpegPath } from '@/lib/capassistant/core';
import { normalizeBatchLang, type BatchLangCode } from './languages';
import { normalizeSubtitleInput } from './parseSrt';
import { runTtsBatchSrt } from './runBatch';
import { muxVideoWithTts } from './muxFinalVideo';
import { injectCapCutDraft } from './injectCapCutDraft';
import { runCloudGeminiStt } from './cloudStt';
import { translateSrtViaGoogleStudio } from './googleStudioTranslate';
import { warmupGoogleStudio } from './googleStudioClient';
import type {
  CapCutDraftArtifact,
  TtsBatchAlignMode,
  TtsBatchPipelineMode,
  TtsBatchProgressEvent,
  TtsBatchRequest,
  TtsBatchResult,
  TtsBatchSttProvider,
} from './types';
import { normalizePipelineMode } from './types';

export type VideoBatchLang = BatchLangCode | string;

export type TtsBatchVideoRequest = {
  /** Optional when srtText / textPath provided */
  videoPath?: string;
  audioLang?: VideoBatchLang;
  targetLang?: VideoBatchLang;
  translate?: boolean | 'auto';
  /** Raw .srt or .txt content (từ file chọn, không dán UI) */
  srtText?: string;
  /** Hint: file.srt | file.txt */
  subtitleFileName?: string;
  ttsConfig: Record<string, unknown>;
  voice?: string;
  apiKeys?: string[];
  concurrency?: number;
  alignMode?: TtsBatchAlignMode;
  applyLoudnorm?: boolean;
  padToCueEnd?: boolean;
  fitToCue?: boolean;
  jobName?: string;
  ruleId?: string;
  /** CapAssist "chia" — dòng mỗi batch dịch */
  chunkSize?: number;
  /** Packaged cloud crown prompt for translate */
  entitlementToken?: string | null;
  /**
   * draft (default): CapCut draft inject, no full re-encode
   * full_mux: optional FFmpeg 04_final_dub
   */
  pipelineMode?: TtsBatchPipelineMode;
  /** STT: only google_studio (local Whisper removed) */
  sttProvider?: TtsBatchSttProvider;
  /** Inject CapCut draft (default true on draft mode when video present) */
  injectCapCutDraft?: boolean;
  /** CapCut drafts dir override */
  capcutDraftsDir?: string;
  /**
   * Khi bật: FFmpeg ghép TTS (+ phụ đề) → 04_final_dub.mp4 (chậm).
   * Default false trên nhánh draft.
   */
  muxFinalVideo?: boolean;
  /** Hardsub burn — only with mux; default false on draft path */
  burnSubtitles?: boolean;
  /**
   * Tắt tiếng gốc khi draft/mux.
   * CapAssist default: false (giữ BGM, TTS đè lên) — `user_configs.chk_mute_orig`.
   */
  muteOriginal?: boolean;
  /** 0–1 volume tiếng gốc khi không mute (Cap slider_vol_orig) */
  originalVolume?: number;
  /** speaker NFC name → voice id */
  speakerVoiceMap?: Record<string, string>;
};

export type TtsBatchVideoResult = TtsBatchResult & {
  videoPath?: string;
  inputMode: 'video' | 'srt' | 'txt' | 'video+srt';
  audioWavPath?: string;
  originSrtPath?: string;
  originSrt?: string;
  translatedSrtPath?: string;
  translatedSrt?: string;
  translated: boolean;
  voiceoverPath?: string;
  finalVideoPath?: string;
  pipelineMode: TtsBatchPipelineMode;
  sttProvider?: TtsBatchSttProvider;
  /** CapCut draft artifact (05) */
  capcutDraft?: CapCutDraftArtifact;
  capcutDraftPath?: string;
  capcutDraftsDir?: string;
};

export type TtsBatchVideoProgressEvent =
  | { type: 'phase'; phase: string; label: string; percent?: number }
  | TtsBatchProgressEvent
  | { type: 'done_video'; result: TtsBatchVideoResult };

function ensureDir(d: string) {
  fs.mkdirSync(d, { recursive: true });
}

/**
 * Extract mono 16k wav. Prefer hardware decode when available (CUDA/D3D11/QSV),
 * fall back to software — extract audio never requires NVENC encode.
 */
function extractAudioWav(videoPath: string, outWav: string): void {
  const ffmpeg = resolveFfmpegPath();
  const attempts: string[][] = [
    // NVIDIA CUDA decode
    [
      '-y',
      '-hwaccel',
      'cuda',
      '-i',
      videoPath,
      '-vn',
      '-ac',
      '1',
      '-ar',
      '16000',
      '-c:a',
      'pcm_s16le',
      outWav,
    ],
    // D3D11VA (Windows)
    [
      '-y',
      '-hwaccel',
      'd3d11va',
      '-i',
      videoPath,
      '-vn',
      '-ac',
      '1',
      '-ar',
      '16000',
      '-c:a',
      'pcm_s16le',
      outWav,
    ],
    // Software
    [
      '-y',
      '-i',
      videoPath,
      '-vn',
      '-ac',
      '1',
      '-ar',
      '16000',
      '-c:a',
      'pcm_s16le',
      outWav,
    ],
  ];

  let lastErr = '';
  for (const args of attempts) {
    try {
      if (fs.existsSync(outWav)) fs.unlinkSync(outWav);
    } catch {
      /* ignore */
    }
    const res = spawnSync(ffmpeg, args, {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 600_000,
    });
    if (res.status === 0 && fs.existsSync(outWav)) return;
    lastErr = (res.stderr || res.stdout || '').slice(0, 400);
  }
  throw new Error(`Tách audio thất bại: ${lastErr}`);
}

/**
 * Full pipe: video and/or srt/txt → Google Studio STT/translate → cloud TTS → draft.
 */
export async function runTtsBatchFromVideo(
  req: TtsBatchVideoRequest,
  onProgress?: (ev: TtsBatchVideoProgressEvent) => void,
): Promise<TtsBatchVideoResult> {
  const videoPath = String(req.videoPath || '').trim();
  const hasVideo = Boolean(videoPath);
  if (hasVideo && !fs.existsSync(videoPath)) {
    throw new Error(`Video không tồn tại: ${videoPath}`);
  }

  const rawSub = String(req.srtText || '').trim();
  if (!hasVideo && !rawSub) {
    throw new Error('Cần videoPath hoặc nội dung .srt/.txt.');
  }

  const pipelineMode: TtsBatchPipelineMode = normalizePipelineMode(
    req.pipelineMode,
  );

  // STT: Google AI Studio only (local Whisper removed)
  const sttProvider: TtsBatchSttProvider = 'google_studio';

  // draft defaults: CapCut inject ON, mux OFF, burn OFF
  const wantDraft =
    req.injectCapCutDraft !== undefined
      ? req.injectCapCutDraft === true
      : pipelineMode === 'draft' && hasVideo;
  const wantMux =
    req.muxFinalVideo === true ||
    (pipelineMode === 'full_mux' && req.muxFinalVideo !== false && hasVideo);
  const burnSubtitles =
    pipelineMode === 'draft'
      ? req.burnSubtitles === true
      : req.burnSubtitles !== false;
  // CapAssist user_configs: chk_mute_orig default false
  const muteOriginal = req.muteOriginal === true;
  const originalVolume =
    typeof req.originalVolume === 'number' && Number.isFinite(req.originalVolume)
      ? Math.max(0, Math.min(1, req.originalVolume))
      : muteOriginal
        ? 0
        : 1;

  const srcLang = normalizeBatchLang(req.audioLang, 'zh');
  const tgtLang = normalizeBatchLang(req.targetLang, 'vi');
  if (tgtLang === 'auto') {
    throw new Error('targetLang không được là auto — chọn ngôn ngữ đích cụ thể.');
  }

  const apiKeys = (req.apiKeys || []).filter(Boolean);
  if (apiKeys.length) {
    void warmupGoogleStudio(apiKeys);
  }
  const stamp = Date.now();
  const jobBase =
    String(
      req.jobName ||
        (hasVideo
          ? path.basename(videoPath, path.extname(videoPath))
          : req.subtitleFileName?.replace(/\.[^.]+$/, '') || 'subtitle'),
    )
      .replace(/[^\w\-]+/g, '_')
      .slice(0, 48) || 'job';
  const workDir = path.join(
    process.cwd(),
    'public',
    'audio',
    'srt-batch',
    `${jobBase}_${stamp}`,
  );
  ensureDir(workDir);

  const emit = (ev: TtsBatchVideoProgressEvent) => onProgress?.(ev);

  emit({
    type: 'phase',
    phase: 'mode',
    label:
      pipelineMode === 'draft'
        ? 'Mode Draft: Google Studio + CapCut draft (không local / không hard-render full video)'
        : 'Mode Full mux: Google Studio + FFmpeg encode (tuỳ chọn)',
    percent: 2,
  });

  let audioWavPath: string | undefined;
  let wavAbs: string | undefined;
  if (hasVideo && !rawSub) {
    // Only extract when STT needed
    emit({
      type: 'phase',
      phase: 'extract',
      label: 'Tách audio (ffmpeg hwaccel→soft, không render video)…',
      percent: 5,
    });
    wavAbs = path.join(workDir, 'extract_16k.wav');
    extractAudioWav(videoPath, wavAbs);
    audioWavPath = `/audio/srt-batch/${path.basename(workDir)}/extract_16k.wav`;
    emit({
      type: 'phase',
      phase: 'extract_ok',
      label: `Audio OK · ${path.basename(wavAbs)}`,
      percent: 12,
    });
  } else if (hasVideo) {
    emit({
      type: 'phase',
      phase: 'extract_skip',
      label: 'Có SRT — skip extract/STT',
      percent: 12,
    });
  }

  let originSrt = '';
  let originSrtPath: string | undefined;
  let inputMode: TtsBatchVideoResult['inputMode'] = hasVideo ? 'video' : 'srt';
  let subKind: 'srt' | 'txt' | 'empty' = 'empty';

  const ART_ORIGIN = '01_srt_chua_dich.srt';
  const ART_TRANSLATED = '02_srt_da_dich.srt';
  const ART_VOICE = '03_voiceover.mp3';
  const ART_FINAL = '04_final_dub.mp4';

  if (wantMux && !hasVideo) {
    throw new Error('Đã bật mux FFmpeg nhưng chưa chọn video nguồn.');
  }
  if (wantDraft && !hasVideo) {
    emit({
      type: 'phase',
      phase: 'draft_skip_novideo',
      label: 'Không có video — skip CapCut draft inject',
      percent: 14,
    });
  }

  if (rawSub) {
    const norm = normalizeSubtitleInput(rawSub, req.subtitleFileName);
    originSrt = norm.srtText;
    subKind = norm.kind;
    inputMode = hasVideo ? 'video+srt' : norm.kind === 'txt' ? 'txt' : 'srt';
    originSrtPath = path.join(workDir, ART_ORIGIN);
    fs.writeFileSync(originSrtPath, originSrt, 'utf8');
    emit({
      type: 'phase',
      phase: 'stt_skip',
      label:
        norm.kind === 'txt'
          ? `TXT → SRT · lưu ${ART_ORIGIN}`
          : `SRT file · lưu ${ART_ORIGIN}`,
      percent: 28,
    });
  } else if (hasVideo) {
    emit({
      type: 'phase',
      phase: 'stt',
      label: `Google AI Studio STT (lang=${srcLang}) — parallel chunks, no local…`,
      percent: 15,
    });
    if (!wavAbs || !fs.existsSync(wavAbs)) {
      wavAbs = path.join(workDir, 'extract_16k.wav');
      extractAudioWav(videoPath, wavAbs);
      audioWavPath = `/audio/srt-batch/${path.basename(workDir)}/extract_16k.wav`;
    }
    originSrt = await runCloudGeminiStt({
      audioPath: wavAbs,
      language: srcLang,
      apiKeys,
      workDir: path.join(workDir, '_studio_stt'),
      onProgress: (label, pct) =>
        emit({
          type: 'phase',
          phase: 'stt_prog',
          label,
          percent: pct ?? 20,
        }),
    });
    originSrtPath = path.join(workDir, ART_ORIGIN);
    fs.writeFileSync(originSrtPath, originSrt, 'utf8');
    emit({
      type: 'phase',
      phase: 'stt_ok',
      label: `STT Google Studio xong · ${ART_ORIGIN}`,
      percent: 32,
    });
  }

  let translatedSrt = originSrt;
  let translated = false;
  let translatedSrtPath: string | undefined;

  const sameLang = srcLang !== 'auto' && srcLang === tgtLang;
  const wantTranslate =
    req.translate === true
      ? true
      : req.translate === false
        ? false
        : !sameLang;

  if (wantTranslate && !sameLang) {
    emit({
      type: 'phase',
      phase: 'translate',
      label: `Google Studio dịch ${srcLang}→${tgtLang} (|| ×50, parallel)…`,
      percent: 38,
    });
    translatedSrt = await translateSrtViaGoogleStudio({
      srtText: originSrt,
      apiKeys,
      targetLang: tgtLang,
      ruleId: req.ruleId || 'modern',
      chunkSize: req.chunkSize,
      entitlementToken: req.entitlementToken,
      onProgress: (label, pct) =>
        emit({
          type: 'phase',
          phase: 'translate_prog',
          label,
          percent: pct ?? 42,
        }),
    });
    translated = true;
    emit({
      type: 'phase',
      phase: 'translate_ok',
      label: `Dịch Google Studio xong · ${ART_TRANSLATED}`,
      percent: 48,
    });
  } else {
    emit({
      type: 'phase',
      phase: 'translate_skip',
      label: sameLang
        ? `Cùng ngôn ngữ — copy sang ${ART_TRANSLATED}`
        : `Bỏ dịch — copy sang ${ART_TRANSLATED}`,
      percent: 45,
    });
  }
  translatedSrtPath = path.join(workDir, ART_TRANSLATED);
  fs.writeFileSync(translatedSrtPath, translatedSrt, 'utf8');

  emit({
    type: 'phase',
    phase: 'tts',
    label: 'TTS Google Studio/Cloud song song (sanitize + fan-out)…',
    percent: 52,
  });

  const ttsReq: TtsBatchRequest = {
    srtText: translatedSrt,
    ttsConfig: req.ttsConfig,
    voice: req.voice,
    apiKeys,
    concurrency: req.concurrency,
    alignMode: req.alignMode || 'timeline',
    applyLoudnorm: req.applyLoudnorm,
    padToCueEnd: req.padToCueEnd,
    fitToCue: req.fitToCue !== false,
    jobName: jobBase,
    speakerVoiceMap: req.speakerVoiceMap,
    forceGoogleStudioCloud: true,
  };

  const ttsResult = await runTtsBatchSrt(ttsReq, (ev) => {
    if (ev.type === 'start') {
      emit({
        type: 'phase',
        phase: 'tts_start',
        label: `TTS ${ev.cueCount} cue ×${ev.concurrency} · ${ev.platform}`,
        percent: 55,
      });
    }
    onProgress?.(ev);
  });

  const voiceoverAbs = path.join(workDir, ART_VOICE);
  try {
    const finalAbs = path.join(
      process.cwd(),
      'public',
      ttsResult.audioPath.replace(/^\//, ''),
    );
    if (fs.existsSync(finalAbs)) {
      fs.copyFileSync(finalAbs, voiceoverAbs);
    }
  } catch {
    /* keep */
  }

  const baseUrl = `/audio/srt-batch/${path.basename(workDir)}`;
  let finalVideoPath: string | undefined;
  let capcutDraft: CapCutDraftArtifact | undefined;

  // ── CapAssist Draft Bypass: per-cue TTS on CapCut timeline ──
  if (wantDraft && hasVideo) {
    const cueAudios = (ttsResult.cues || [])
      .filter((c) => c.diskPath && fs.existsSync(c.diskPath))
      .map((c) => ({
        path: String(c.diskPath),
        startMs: c.startMs,
        endMs: c.endMs,
        text: c.text,
        index: c.index,
      }));

    emit({
      type: 'phase',
      phase: 'draft',
      label: cueAudios.length
        ? `CapCut draft inject · ${cueAudios.length} cue TTS @ timestamp (không render MP4)…`
        : 'CapCut draft inject · full voiceover fallback…',
      percent: 88,
    });

    if (!cueAudios.length && !fs.existsSync(voiceoverAbs)) {
      throw new Error('Thiếu cue TTS / voiceover để inject CapCut draft.');
    }

    try {
      const injected = await injectCapCutDraft({
        videoPath,
        cueAudios,
        voiceoverPath: fs.existsSync(voiceoverAbs) ? voiceoverAbs : undefined,
        srtText: translatedSrt,
        muteOriginal,
        originalVolume,
        draftName: jobBase,
        draftsDir: req.capcutDraftsDir,
        workDir,
      });
      capcutDraft = injected;
      emit({
        type: 'phase',
        phase: 'draft_ok',
        label: `Draft CapCut · ${injected.audioClipCount} audio clip · ${injected.captionCount} caption · ${injected.filePath}`,
        percent: 94,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (pipelineMode === 'draft' && req.injectCapCutDraft !== false) {
        throw new Error(
          `CapCut draft inject thất bại: ${msg}. ` +
            `Kiểm tra CapCut drafts folder / cutsdk. ` +
            `Cue/voiceover vẫn có trong job folder.`,
        );
      }
      emit({
        type: 'phase',
        phase: 'draft_warn',
        label: `Draft inject skip: ${msg}`,
        percent: 90,
      });
    }
  }

  // ── Optional slow path: FFmpeg mux (Audio-only) ──
  if (wantMux && hasVideo) {
    emit({
      type: 'phase',
      phase: 'mux',
      label: 'FFmpeg mux -c:v copy (lồng tiếng audio, sub -> CapCut)…',
      percent: 92,
    });
    if (!fs.existsSync(voiceoverAbs)) {
      throw new Error('Thiếu voiceover để ghép video.');
    }
    const finalVideoAbs = path.join(workDir, ART_FINAL);
    muxVideoWithTts({
      videoPath,
      ttsAudioPath: voiceoverAbs,
      outPath: finalVideoAbs,
      muteOriginal,
    });
    finalVideoPath = `${baseUrl}/${ART_FINAL}`;
    emit({
      type: 'phase',
      phase: 'mux_ok',
      label: `Sản phẩm lồng tiếng · ${ART_FINAL} (CapCut Sub)`,
      percent: 96,
    });
  }

  const publicAudio = fs.existsSync(voiceoverAbs)
    ? `${baseUrl}/${ART_VOICE}`
    : ttsResult.audioPath;

  const result: TtsBatchVideoResult = {
    ...ttsResult,
    audioPath: publicAudio,
    videoPath: hasVideo ? videoPath : undefined,
    inputMode,
    audioWavPath,
    originSrtPath: originSrtPath
      ? `${baseUrl}/${path.basename(originSrtPath)}`
      : undefined,
    originSrt,
    translatedSrtPath: translatedSrtPath
      ? `${baseUrl}/${path.basename(translatedSrtPath)}`
      : undefined,
    translatedSrt,
    translated,
    voiceoverPath: publicAudio,
    finalVideoPath,
    pipelineMode,
    sttProvider: rawSub ? undefined : sttProvider,
    capcutDraft,
    capcutDraftPath: capcutDraft?.filePath,
    capcutDraftsDir: capcutDraft?.draftsDir,
    jobDir: baseUrl,
  };

  emit({ type: 'done_video', result });
  void subKind;
  return result;
}
