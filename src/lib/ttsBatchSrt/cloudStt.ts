/**
 * Google AI Studio STT only (CapAssist cloud path).
 * No local Whisper. Parallel audio chunks for 30′ ≈ tens of seconds on Studio.
 */
import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import { resolveFfmpegPath } from '@/lib/capassistant/core';
import type { BatchLangCode } from './languages';
import {
  orderKeys,
  orderModels,
  studioLangLabel,
  warmupGoogleStudio,
  GOOGLE_STUDIO_MODELS,
} from './googleStudioClient';

export type CloudSttOptions = {
  audioPath: string;
  language: BatchLangCode | string;
  apiKeys: string[];
  workDir?: string;
  onProgress?: (label: string, percent?: number) => void;
};

const CHUNK_SEC = 300; // 5 min — smaller = more parallel, better for 30′
const STT_PARALLEL = 4;

function compressForCloud(inputPath: string, outMp3: string): void {
  const ffmpeg = resolveFfmpegPath();
  const res = spawnSync(
    ffmpeg,
    [
      '-y',
      '-i',
      inputPath,
      '-acodec',
      'libmp3lame',
      '-b:a',
      '48k',
      '-ar',
      '16000',
      '-ac',
      '1',
      outMp3,
    ],
    { encoding: 'utf8', windowsHide: true, timeout: 600_000 },
  );
  if (res.status !== 0 || !fs.existsSync(outMp3)) {
    throw new Error(
      `Nén audio Google Studio STT thất bại: ${(res.stderr || res.stdout || '').slice(0, 400)}`,
    );
  }
}

function probeDurationSec(filePath: string): number {
  try {
    const ffprobe = resolveFfmpegPath().replace(/ffmpeg(\.exe)?$/i, 'ffprobe$1');
    const res = spawnSync(
      ffprobe,
      [
        '-v',
        'error',
        '-show_entries',
        'format=duration',
        '-of',
        'default=noprint_wrappers=1:nokey=1',
        filePath,
      ],
      { encoding: 'utf8', windowsHide: true, timeout: 60_000 },
    );
    const n = parseFloat(String(res.stdout || '').trim());
    return Number.isFinite(n) && n > 0 ? n : 0;
  } catch {
    return 0;
  }
}

function shiftSrtTimestamps(srt: string, offsetMs: number): string {
  if (!offsetMs) return srt;
  return srt.replace(
    /(\d{1,2}:\d{2}:\d{2}[,.]\d{1,3})\s*-->\s*(\d{1,2}:\d{2}:\d{2}[,.]\d{1,3})/g,
    (_m, a: string, b: string) => {
      const toMs = (t: string) => {
        const p = t.replace(',', '.').split(':');
        const h = Number(p[0]) || 0;
        const m = Number(p[1]) || 0;
        const s = Number(p[2]) || 0;
        return Math.round(((h * 60 + m) * 60 + s) * 1000);
      };
      const fmt = (ms: number) => {
        const n = Math.max(0, ms);
        const h = Math.floor(n / 3_600_000);
        const m = Math.floor((n % 3_600_000) / 60_000);
        const s = Math.floor((n % 60_000) / 1000);
        const milli = n % 1000;
        const pad = (x: number, w = 2) => String(x).padStart(w, '0');
        return `${pad(h)}:${pad(m)}:${pad(s)},${pad(milli, 3)}`;
      };
      return `${fmt(toMs(a) + offsetMs)} --> ${fmt(toMs(b) + offsetMs)}`;
    },
  );
}

async function geminiTranscribeChunk(
  mp3Path: string,
  apiKey: string,
  language: string,
): Promise<string> {
  const audioData = fs.readFileSync(mp3Path).toString('base64');
  const langLabel = studioLangLabel(language);
  const prompt = `You are a precise subtitle extractor on Google AI Studio.
Listen to this audio and produce a complete SRT subtitle file.
HARD RULES:
1. Output pure SRT only (index, start --> end, text, blank line). No markdown.
2. Language of text: ${langLabel}.
3. Timestamps relative to THIS audio chunk start at 00:00:00,000.`;

  const models = orderModels(GOOGLE_STUDIO_MODELS);
  let lastErr: Error | null = null;

  for (const model of models) {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                { text: prompt },
                { inlineData: { mimeType: 'audio/mp3', data: audioData } },
              ],
            },
          ],
          generationConfig: { temperature: 0.15, maxOutputTokens: 8192 },
        }),
        signal: AbortSignal.timeout(180_000),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        lastErr = new Error(data?.error?.message || `Studio STT HTTP ${res.status}`);
        continue;
      }
      let text = String(
        data?.candidates?.[0]?.content?.parts?.[0]?.text || '',
      )
        .replace(/```(?:srt|text)?/gi, '')
        .trim();
      if (text.includes('-->')) return text;
      lastErr = new Error('Google Studio STT returned non-SRT');
    } catch (e) {
      lastErr = e instanceof Error ? e : new Error(String(e));
    }
  }
  throw lastErr || new Error('Google Studio STT failed');
}

async function mapPool<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  let fail: Error | null = null;
  const runners = Array.from(
    { length: Math.min(concurrency, Math.max(1, items.length)) },
    async () => {
      while (!fail) {
        const i = cursor++;
        if (i >= items.length) break;
        try {
          results[i] = await worker(items[i], i);
        } catch (e) {
          fail = e instanceof Error ? e : new Error(String(e));
        }
      }
    },
  );
  await Promise.all(runners);
  if (fail) throw fail;
  return results;
}

/**
 * Google AI Studio STT only. Parallel 5-min chunks for ~30′ video.
 */
export async function runCloudGeminiStt(opts: CloudSttOptions): Promise<string> {
  const keys = orderKeys(opts.apiKeys || []);
  if (!keys.length) {
    throw new Error(
      'Google Studio STT cần API key Gemini. Không dùng local Whisper. ' +
        'Cấu hình keys hoặc cung cấp file .srt sẵn (skip STT — nhanh hơn).',
    );
  }
  if (!fs.existsSync(opts.audioPath)) {
    throw new Error(`Google Studio STT: audio không tồn tại: ${opts.audioPath}`);
  }

  void warmupGoogleStudio(keys);

  const workDir =
    opts.workDir ||
    path.join(path.dirname(opts.audioPath), `_studio_stt_${Date.now()}`);
  fs.mkdirSync(workDir, { recursive: true });

  opts.onProgress?.('Nén audio 48kbps → Google Studio…', 14);
  const compact = path.join(workDir, 'stt_compact.mp3');
  compressForCloud(opts.audioPath, compact);
  const totalSec = probeDurationSec(compact) || 0;

  type ChunkJob = { path: string; offsetSec: number; index: number };
  const jobs: ChunkJob[] = [];

  if (totalSec <= CHUNK_SEC + 20) {
    jobs.push({ path: compact, offsetSec: 0, index: 0 });
  } else {
    const ffmpeg = resolveFfmpegPath();
    let offset = 0;
    let partIdx = 0;
    while (offset < totalSec - 0.5) {
      const out = path.join(workDir, `chunk_${partIdx}.mp3`);
      const res = spawnSync(
        ffmpeg,
        [
          '-y',
          '-ss',
          String(offset),
          '-t',
          String(CHUNK_SEC),
          '-i',
          compact,
          '-c',
          'copy',
          out,
        ],
        { encoding: 'utf8', windowsHide: true, timeout: 120_000 },
      );
      if (res.status !== 0 || !fs.existsSync(out)) {
        throw new Error(`Cắt chunk STT fail @${offset}s`);
      }
      jobs.push({ path: out, offsetSec: offset, index: partIdx });
      offset += CHUNK_SEC;
      partIdx += 1;
    }
  }

  opts.onProgress?.(
    `Google Studio STT ${jobs.length} chunk × parallel ${STT_PARALLEL}…`,
    18,
  );

  const parts = await mapPool(jobs, STT_PARALLEL, async (job, i) => {
    const key = keys[i % keys.length];
    const srt = await geminiTranscribeChunk(job.path, key, opts.language);
    opts.onProgress?.(`  · STT chunk ${i + 1}/${jobs.length} OK`);
    return shiftSrtTimestamps(srt, Math.round(job.offsetSec * 1000));
  });

  let idx = 1;
  const blocks: string[] = [];
  for (const srt of parts) {
    const segs = srt
      .replace(/^\uFEFF/, '')
      .trim()
      .split(/\n\s*\n+/);
    for (const seg of segs) {
      const lines = seg.split(/\r?\n/).filter((l) => l.trim().length);
      if (lines.length < 2) continue;
      let timeIdx = 0;
      if (/^\d+$/.test(lines[0].trim()) && lines.length >= 3) timeIdx = 1;
      if (!lines[timeIdx]?.includes('-->')) continue;
      const text = lines.slice(timeIdx + 1).join('\n').trim();
      if (!text) continue;
      blocks.push(`${idx}\n${lines[timeIdx]}\n${text}`);
      idx += 1;
    }
  }
  if (!blocks.length) {
    throw new Error('Google Studio STT: SRT rỗng sau merge. Không fallback local.');
  }
  return blocks.join('\n\n') + '\n';
}

/** @deprecated alias — only Google Studio */
export const runGoogleStudioStt = runCloudGeminiStt;
