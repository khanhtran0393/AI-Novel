/**
 * POST /api/tts-batch-srt
 *
 * CapAssist-style pipe:
 *   video | .srt | .txt → extract/STT → translate? → TTS parallel → CapCut draft inject
 * Optional full_mux: FFmpeg 04_final_dub.
 * Nhánh draft không hard-render full video.
 */
import { NextResponse } from 'next/server';
import { parseSrt, srtSummary, normalizeSubtitleInput } from '@/lib/ttsBatchSrt/parseSrt';
import { resolveTtsBatchConcurrency } from '@/lib/ttsBatchSrt/concurrency';
import { runTtsBatchFromVideo } from '@/lib/ttsBatchSrt/runVideoPipeline';
import type {
  TtsBatchAlignMode,
  TtsBatchPipelineMode,
  TtsBatchSttProvider,
} from '@/lib/ttsBatchSrt/types';
import { normalizePipelineMode } from '@/lib/ttsBatchSrt/types';
import { translateSrtViaGoogleStudio } from '@/lib/ttsBatchSrt/googleStudioTranslate';
import { warmupGoogleStudio } from '@/lib/ttsBatchSrt/googleStudioClient';
import {
  correlationIdFromRequest,
  slog,
} from '@/lib/requestContext';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 900;

function parsePipelineMode(raw: unknown): TtsBatchPipelineMode {
  return normalizePipelineMode(raw);
}

function parseSttProvider(raw: unknown): TtsBatchSttProvider | undefined {
  // Only Google AI Studio (local Whisper removed)
  if (raw === 'google_studio' || raw === 'cloud_gemini') return 'google_studio';
  return 'google_studio';
}

export async function POST(req: Request) {
  const correlationId = correlationIdFromRequest(req);
  const started = Date.now();
  try {
    const body = await req.json();

    // ── Tool Dịch SRT: chỉ dịch (Google Studio || anchor) ──
    if (body.action === 'translateOnly') {
      const rawText = String(body.srtText || body.textContent || '');
      if (!rawText.trim()) {
        return NextResponse.json(
          { error: 'translateOnly cần nội dung SRT.' },
          { status: 400 },
        );
      }
      const fromBody = Array.isArray(body.apiKeys)
        ? body.apiKeys.map(String).filter(Boolean)
        : [];
      // Fallback env (server) — cùng pattern generate-tts Gemini
      const fromEnv = [
        process.env.GEMINI_KEY_1,
        process.env.GEMINI_KEY_2,
        process.env.GEMINI_KEY_3,
        process.env.GEMINI_API_KEY,
        process.env.GOOGLE_API_KEY,
      ].filter((k): k is string => !!k && k.trim().length > 0);
      const apiKeys = [...new Set([...fromBody, ...fromEnv])];
      if (!apiKeys.length) {
        return NextResponse.json(
          {
            error:
              'Thiếu API key Gemini. Thêm key trong Cài đặt / header (apiKeys). ' +
              'Cookie Google Studio không dùng cho translateOnly REST.',
          },
          { status: 400 },
        );
      }
      const targetLang =
        body.targetLang != null ? String(body.targetLang) : 'vi';
      const ruleId = body.ruleId != null ? String(body.ruleId) : 'modern';
      const chunkSize =
        typeof body.chunkSize === 'number'
          ? body.chunkSize
          : body.chunkSize != null
            ? Number(body.chunkSize)
            : undefined;
      void warmupGoogleStudio(apiKeys);
      const srt = await translateSrtViaGoogleStudio({
        srtText: rawText,
        apiKeys,
        targetLang,
        ruleId,
        chunkSize,
      });
      const cues = parseSrt(srt);
      slog({
        level: 'info',
        msg: 'tts_batch_translate_only_done',
        correlationId,
        route: '/api/tts-batch-srt',
        ms: Date.now() - started,
        cueCount: cues.length,
      });
      return NextResponse.json({
        ok: true,
        action: 'translateOnly',
        srt,
        cueCount: cues.length,
        ...srtSummary(cues),
      });
    }

    const videoPath = body.videoPath != null ? String(body.videoPath).trim() : '';
    const rawText = String(body.srtText || body.textContent || '');
    const subtitleFileName =
      body.subtitleFileName != null ? String(body.subtitleFileName) : undefined;
    const ttsConfig =
      body.ttsConfig && typeof body.ttsConfig === 'object'
        ? (body.ttsConfig as Record<string, unknown>)
        : {};
    const voice = body.voice != null ? String(body.voice) : undefined;
    const apiKeys = Array.isArray(body.apiKeys)
      ? body.apiKeys.map(String).filter(Boolean)
      : [];
    const concurrency =
      typeof body.concurrency === 'number' ? body.concurrency : undefined;
    const alignMode: TtsBatchAlignMode =
      body.alignMode === 'sequential' ? 'sequential' : 'timeline';
    const applyLoudnorm = body.applyLoudnorm !== false;
    const padToCueEnd = body.padToCueEnd === true;
    const fitToCue = body.fitToCue !== false;
    const jobName = body.jobName != null ? String(body.jobName) : undefined;
    const audioLang = body.audioLang != null ? String(body.audioLang) : 'zh';
    const targetLang = body.targetLang != null ? String(body.targetLang) : 'vi';
    const translate =
      body.translate === false
        ? false
        : body.translate === true
          ? true
          : 'auto';
    const ruleId = body.ruleId != null ? String(body.ruleId) : 'modern';
    const pipelineMode = parsePipelineMode(body.pipelineMode);
    const sttProvider = parseSttProvider(body.sttProvider);
    const injectCapCutDraft =
      body.injectCapCutDraft === undefined
        ? undefined
        : body.injectCapCutDraft === true;
    const capcutDraftsDir =
      body.capcutDraftsDir != null ? String(body.capcutDraftsDir) : undefined;
    // draft: mux off unless explicitly true; full_mux can enable
    const muxFinalVideo = body.muxFinalVideo === true;
    const burnSubtitles = body.burnSubtitles === true;
    // CapAssist: chk_mute_orig default false
    const muteOriginal = body.muteOriginal === true;
    const originalVolume =
      typeof body.originalVolume === 'number' && Number.isFinite(body.originalVolume)
        ? body.originalVolume
        : undefined;
    const speakerVoiceMap =
      body.speakerVoiceMap && typeof body.speakerVoiceMap === 'object'
        ? (body.speakerVoiceMap as Record<string, string>)
        : undefined;
    const wantStream =
      body.stream === true ||
      (req.headers.get('accept') || '').includes('application/x-ndjson');

    let srtText = '';
    let subKind: string = 'empty';
    if (rawText.trim()) {
      const n = normalizeSubtitleInput(rawText, subtitleFileName);
      srtText = n.srtText;
      subKind = n.kind;
    }

    if (body.previewOnly === true) {
      if (!srtText.trim()) {
        return NextResponse.json(
          { error: 'previewOnly cần nội dung .srt hoặc .txt.' },
          { status: 400 },
        );
      }
      const cues = parseSrt(srtText);
      const summary = srtSummary(cues);
      const platform = String(ttsConfig.platform || '');
      return NextResponse.json({
        ok: true,
        preview: true,
        kind: subKind,
        ...summary,
        concurrency: resolveTtsBatchConcurrency(platform, concurrency),
        platform,
        pipelineMode,
        sample: cues.slice(0, 5).map((c) => ({
          index: c.index,
          startMs: c.startMs,
          endMs: c.endMs,
          speaker: c.speaker,
          text: c.text.slice(0, 120),
        })),
      });
    }

    const mode = videoPath ? 'video' : srtText ? `subtitle:${subKind}` : 'none';
    slog({
      level: 'info',
      msg: 'tts_batch_srt_start',
      correlationId,
      route: '/api/tts-batch-srt',
      mode,
      platform: String(ttsConfig.platform || ''),
      voice: String(voice || ttsConfig.voice || ''),
      alignMode,
      pipelineMode,
      sttProvider: sttProvider || 'default',
    });

    const run = async (
      onEv: (ev: Record<string, unknown>) => void,
    ): Promise<Record<string, unknown>> => {
      if (videoPath || srtText) {
        if (!videoPath && srtText) {
          const result = await runTtsBatchFromVideo(
            {
              srtText: rawText,
              subtitleFileName,
              audioLang,
              targetLang,
              translate,
              ttsConfig,
              voice,
              apiKeys,
              concurrency,
              alignMode,
              applyLoudnorm,
              padToCueEnd,
              fitToCue,
              ruleId,
              pipelineMode,
              sttProvider,
              injectCapCutDraft: false,
              muxFinalVideo: false,
              burnSubtitles,
              muteOriginal,
              originalVolume,
              speakerVoiceMap,
              jobName:
                jobName || subtitleFileName?.replace(/\.[^.]+$/, '') || 'srt',
            } as Parameters<typeof runTtsBatchFromVideo>[0],
            (ev) => onEv(ev as unknown as Record<string, unknown>),
          );
          return result as unknown as Record<string, unknown>;
        }

        if (videoPath) {
          const result = await runTtsBatchFromVideo(
            {
              videoPath,
              srtText: rawText.trim() || undefined,
              subtitleFileName,
              audioLang,
              targetLang,
              translate,
              ttsConfig,
              voice,
              apiKeys,
              concurrency,
              alignMode,
              applyLoudnorm,
              padToCueEnd,
              fitToCue,
              ruleId,
              pipelineMode,
              sttProvider,
              injectCapCutDraft,
              capcutDraftsDir,
              muxFinalVideo,
              burnSubtitles,
              muteOriginal,
              originalVolume,
              speakerVoiceMap,
              jobName,
            } as Parameters<typeof runTtsBatchFromVideo>[0],
            (ev) => onEv(ev as unknown as Record<string, unknown>),
          );
          return result as unknown as Record<string, unknown>;
        }
      }

      throw new Error(
        'Thiếu đầu vào: chọn video, hoặc file/nội dung .srt / .txt.',
      );
    };

    if (wantStream) {
      const encoder = new TextEncoder();
      const stream = new ReadableStream({
        async start(controller) {
          const send = (ev: Record<string, unknown>) => {
            controller.enqueue(encoder.encode(`${JSON.stringify(ev)}\n`));
          };
          try {
            await run(send);
            slog({
              level: 'info',
              msg: 'tts_batch_srt_done',
              correlationId,
              route: '/api/tts-batch-srt',
              ms: Date.now() - started,
              mode,
              pipelineMode,
            });
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            send({ type: 'error', error: msg });
            slog({
              level: 'error',
              msg: 'tts_batch_srt_fail',
              correlationId,
              route: '/api/tts-batch-srt',
              error: msg,
            });
          } finally {
            controller.close();
          }
        },
      });
      return new Response(stream, {
        headers: {
          'Content-Type': 'application/x-ndjson; charset=utf-8',
          'Cache-Control': 'no-store',
          'X-Correlation-Id': correlationId,
        },
      });
    }

    const result = await run(() => undefined);
    slog({
      level: 'info',
      msg: 'tts_batch_srt_done',
      correlationId,
      route: '/api/tts-batch-srt',
      ms: Date.now() - started,
      mode,
      pipelineMode,
    });
    return NextResponse.json(result, {
      headers: { 'X-Correlation-Id': correlationId },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    slog({
      level: 'error',
      msg: 'tts_batch_srt_fail',
      correlationId,
      route: '/api/tts-batch-srt',
      error: msg,
    });
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
