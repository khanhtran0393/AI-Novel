/**
 * Real h264_nvenc capability probe — Settings + Phantom-X + generate-video.
 *
 * nvidia-smi alone is NOT enough. Probe encodes ~0.3s lavfi with each candidate
 * FFmpeg until one opens h264_nvenc.
 *
 * GTX 10xx / driver ~580.x:
 *   bin/ffmpeg (nightly) often needs NVENC API 13.1 / driver ≥610 → fail
 *   python_core/ffmpeg 7.x often succeeds → use that path for GPU encode
 */
import { spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import {
  getPrimaryFfmpegPath,
  isSameFfmpegPath,
  listFfmpegCandidates,
} from './ffmpegPaths';

export type NvencProbeResult = {
  ok: boolean;
  smiOk: boolean;
  encoderListed: boolean;
  openOk: boolean;
  bf2Ok: boolean;
  /** Binary that opened NVENC — must be used for GPU encode */
  ffmpegPath: string;
  /** Working NVENC preset for this binary */
  preset: 'p6' | 'p4' | 'hq';
  message: string;
  errorDetail: string;
  probedAt: string;
  fromCache: boolean;
  usedCompatFfmpeg: boolean;
};

const CACHE_TTL_MS = 10 * 60 * 1000;

type CacheEntry = { result: NvencProbeResult; expiresAt: number };
let memoryCache: CacheEntry | null = null;

function nullSink(): string {
  return process.platform === 'win32' ? 'NUL' : '/dev/null';
}

function summarizeError(raw: string): string {
  const lines = String(raw || '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const hit = lines.find((l) =>
    /nvenc|driver|error|not implemented|invalid|required|found:/i.test(l),
  );
  return (hit || lines[0] || raw.slice(0, 240) || '').slice(0, 280);
}

/** @deprecated use listFfmpegCandidates — kept for callers */
export function listFfmpegNvencCandidates(preferred?: string): string[] {
  return listFfmpegCandidates(preferred);
}

function runNvencOpen(
  ffmpegPath: string,
  bf: number,
  preset: 'p6' | 'hq',
): { ok: boolean; detail: string } {
  const args = [
    '-hide_banner',
    '-loglevel',
    'error',
    '-y',
    '-f',
    'lavfi',
    '-i',
    'testsrc=size=640x360:rate=30',
    '-t',
    '0.3',
    '-pix_fmt',
    'yuv420p',
    '-c:v',
    'h264_nvenc',
    '-preset',
    preset,
    '-bf',
    String(Math.max(0, bf)),
    '-f',
    'null',
    nullSink(),
  ];
  const r = spawnSync(ffmpegPath, args, {
    encoding: 'utf8',
    windowsHide: true,
    timeout: 20000,
  });
  const detail = summarizeError(String(r.stderr || r.stdout || ''));
  return { ok: r.status === 0, detail };
}

/** Try p6 then hq; return first working preset */
function openNvencWithPresets(
  ffmpegPath: string,
  bf: number,
): { ok: boolean; detail: string; preset: 'p6' | 'hq' } {
  for (const preset of ['p6', 'hq'] as const) {
    const r = runNvencOpen(ffmpegPath, bf, preset);
    if (r.ok) return { ok: true, detail: '', preset };
    if (/required nvenc API|minimum required Nvidia driver/i.test(r.detail)) {
      return { ok: false, detail: r.detail, preset: 'p6' };
    }
    // try next preset
    if (preset === 'hq') return { ok: false, detail: r.detail, preset: 'hq' };
  }
  return { ok: false, detail: 'open failed', preset: 'p6' };
}

function checkSmi(): boolean {
  try {
    const nvidia = spawnSync('nvidia-smi', [], {
      windowsHide: true,
      encoding: 'utf8',
      timeout: 2500,
    });
    return nvidia.status === 0;
  } catch {
    return false;
  }
}

function checkEncoderListed(ffmpegPath: string): boolean {
  try {
    const enc = spawnSync(ffmpegPath, ['-hide_banner', '-encoders'], {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 8000,
    });
    return /h264_nvenc/.test(String(enc.stdout || ''));
  } catch {
    return false;
  }
}

function buildMessage(opts: {
  smiOk: boolean;
  encoderListed: boolean;
  openOk: boolean;
  detail: string;
  usedCompat: boolean;
  ffmpegPath: string;
}): string {
  if (opts.openOk) {
    const base = 'NVENC sẵn sàng (h264_nvenc mở được).';
    if (opts.usedCompat) {
      return (
        `${base} Dùng FFmpeg tương thích driver (` +
        `${path.basename(opts.ffmpegPath)}). ` +
        `bin/ffmpeg mới cần driver ≥610; GTX 10xx chỉ ~580.x.`
      );
    }
    return base;
  }
  if (!opts.smiOk) {
    return (
      'Không thấy NVIDIA (nvidia-smi). Cài driver hoặc dùng libx264. ' +
      'Cài đặt → Tăng tốc phần cứng → Quét lại.'
    );
  }
  if (!opts.encoderListed) {
    return (
      'Không có h264_nvenc trong FFmpeg của app (bin/ + python_core/). Quét lại.'
    );
  }
  const d = opts.detail || '';
  if (/required nvenc API|Driver does not support|minimum required Nvidia driver/i.test(d)) {
    return (
      'Không FFmpeg nào mở được NVENC với driver hiện tại. ' +
      'GTX 10xx: giữ python_core/ffmpeg 7.x hoặc dùng libx264. ' +
      (d ? `Chi tiết: ${d}` : '')
    );
  }
  return (
    `NVENC không mở được. Cài đặt → Quét lại.` + (d ? ` (${d})` : '')
  );
}

export function probeH264Nvenc(opts?: {
  force?: boolean;
  ffmpegPath?: string;
  skipBf2?: boolean;
}): NvencProbeResult {
  const now = Date.now();
  if (!opts?.force && memoryCache && memoryCache.expiresAt > now) {
    return { ...memoryCache.result, fromCache: true };
  }

  const primary = getPrimaryFfmpegPath();
  const candidates = listFfmpegCandidates(opts?.ffmpegPath);
  const smiOk = checkSmi();

  let openOk = false;
  let bf2Ok = false;
  let errorDetail = '';
  let encoderListed = false;
  let chosenPath = primary;
  let usedCompatFfmpeg = false;
  let preset: 'p6' | 'p4' | 'hq' = 'p6';

  if (!smiOk) {
    errorDetail = 'nvidia-smi failed or missing';
  } else {
    const details: string[] = [];
    for (const cand of candidates) {
      if (!checkEncoderListed(cand)) {
        details.push(`${path.basename(cand)}: no h264_nvenc`);
        continue;
      }
      encoderListed = true;
      const open = openNvencWithPresets(cand, 0);
      if (open.ok) {
        openOk = true;
        chosenPath = cand;
        preset = open.preset === 'hq' ? 'hq' : 'p6';
        usedCompatFfmpeg = !isSameFfmpegPath(cand, primary);
        if (!opts?.skipBf2) {
          const bf2 = runNvencOpen(cand, 2, open.preset);
          bf2Ok = bf2.ok;
        }
        errorDetail = '';
        break;
      }
      details.push(`${path.basename(cand)}: ${open.detail || 'fail'}`);
      errorDetail = open.detail || errorDetail;
    }
    if (!openOk && details.length) {
      errorDetail = details.slice(0, 3).join(' | ');
    }
    if (!encoderListed && !errorDetail) {
      errorDetail = 'h264_nvenc not listed in any candidate';
    }
  }

  const result: NvencProbeResult = {
    ok: openOk,
    smiOk,
    encoderListed,
    openOk,
    bf2Ok: openOk && bf2Ok,
    ffmpegPath: chosenPath,
    preset,
    message: buildMessage({
      smiOk,
      encoderListed,
      openOk,
      detail: errorDetail,
      usedCompat: usedCompatFfmpeg,
      ffmpegPath: chosenPath,
    }),
    errorDetail,
    probedAt: new Date().toISOString(),
    fromCache: false,
    usedCompatFfmpeg,
  };

  memoryCache = { result, expiresAt: now + CACHE_TTL_MS };
  return result;
}

export function clearNvencProbeCache(): void {
  memoryCache = null;
}

/**
 * FFmpeg path for encode: NVENC-capable binary when preferGpu and probe ok,
 * else primary app FFmpeg.
 */
export function resolveFfmpegForEncode(opts?: {
  preferGpu?: boolean;
  forceProbe?: boolean;
}): {
  ffmpegPath: string;
  usedNvenc: boolean;
  probe: NvencProbeResult | null;
} {
  const primary = getPrimaryFfmpegPath();
  if (!opts?.preferGpu) {
    return { ffmpegPath: primary, usedNvenc: false, probe: null };
  }
  const probe = probeH264Nvenc({ force: Boolean(opts.forceProbe) });
  if (probe.ok) {
    return { ffmpegPath: probe.ffmpegPath, usedNvenc: true, probe };
  }
  return { ffmpegPath: primary, usedNvenc: false, probe };
}

export function readGpuProfileNvencHint(): {
  nvencSupported: boolean | null;
  nvencError: string;
  scannedAt: string | null;
} {
  try {
    const p = path.join(process.cwd(), 'python_core', 'gpu_profile.json');
    if (!fs.existsSync(p)) {
      return { nvencSupported: null, nvencError: '', scannedAt: null };
    }
    const j = JSON.parse(fs.readFileSync(p, 'utf8')) as {
      scannedAt?: string;
      ffmpeg?: { nvencSupported?: boolean; nvencError?: string };
    };
    return {
      nvencSupported:
        typeof j.ffmpeg?.nvencSupported === 'boolean' ? j.ffmpeg.nvencSupported : null,
      nvencError: String(j.ffmpeg?.nvencError || ''),
      scannedAt: j.scannedAt || null,
    };
  } catch {
    return { nvencSupported: null, nvencError: '', scannedAt: null };
  }
}
