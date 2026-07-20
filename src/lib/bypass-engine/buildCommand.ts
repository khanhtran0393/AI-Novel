/**
 * Phantom-X Bypass — Stealth Master Command assembler.
 *
 * Checkbox set → deterministic argv (+ optional ±% variance).
 * Stages:
 *   1) Input  — thread_queue, hwaccel, genpts
 *   2–3) filter_complex — video (eq→noise→edge→zoom) + audio stealth
 *   4) Encoder — NVENC/x264 B-frames, GOP, CQ/CRF jitter
 *   5) Mux    — strip metadata/chapters, bitexact, bt709 tags, faststart
 *
 * CẤM hflip/vflip/transpose. Micro-rotate per stream is intentional.
 */
import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import { resolveFfmpegPath, resolveFfprobePath } from '@/lib/capassistant/core';
import {
  probeH264Nvenc,
  type NvencProbeResult,
} from '@/lib/ffmpeg/nvencProbe';
import { buildH264NvencArgs } from '@/lib/ffmpeg/nvencEncoderArgs';
import {
  buildAudioMaskComplexParts,
  buildBypassGraph,
  buildGridVideoFilterParts,
  normalizeGridLayout,
  normalizeVariance,
  OVERLAY_FILTER,
  resolveActiveFilters,
  type BypassFilterId,
  type BypassGraphBuild,
  type BypassParams,
  type BypassProbeMeta,
  type BypassVarianceOpts,
  type GridLayoutMode,
} from './filters';

export type BypassEngineRequest = {
  inputPath: string;
  outputPath?: string;
  /**
   * Thư mục đầu ra — mặc định: {projectSaveRoot}/phantom-x-bypass
   * (projectSaveRoot = thư mục "Mở thư mục lưu" trên tab chính).
   */
  outputDir?: string;
  filters: BypassFilterId[];
  /** Prefer h264_nvenc when NVIDIA present (GPU checkbox) */
  preferGpu?: boolean;
  /** Frame PNG overlay — second input [1:v] */
  overlayPath?: string;
  /**
   * Main-frame grid layout.
   * none | 1x2 | 2x1 | 2x2
   */
  gridLayout?: GridLayoutMode;
  /**
   * Ngẫu nhiên ±% so với mặc định BỘ lọc chính.
   * { enabled, percent: 0–100 }
   */
  variance?: BypassVarianceOpts | { enabled?: boolean; percent?: number; randomPercent?: number };
  /**
   * false (mặc định) = Quality path máy mạnh:
   *   full-res filter, bicubic, filter_threads max, NVENC HQ / libx264 medium.
   * true = Turbo máy yếu:
   *   scale mid (~1280) → same Ultimate/Grid → scale back + ultrafast / NVENC p6.
   */
  turbo?: boolean;
  /**
   * Precompiled crown graph (cloud or local bridge).
   * When set, skips local formula compile — client only probes + encodes.
   */
  precompiled?: {
    graph: BypassGraphBuild;
    fcParts: string[];
    vMap: string | null;
    aMap: string | null;
    activeLabels: string[];
    needsReencode: boolean;
    source?: string;
  };
};

export type BypassEngineBuilt = {
  ffmpegPath: string;
  ffmpegArgs: string[];
  commandLine: string;
  outputPath: string;
  meta: BypassProbeMeta;
  activeLabels: string[];
  progressOnStdout: boolean;
  usedNvenc: boolean;
  /** Real NVENC probe (shared with Settings system-info) */
  nvencProbe: NvencProbeResult | null;
  /**
   * When user asked GPU but probe failed — encode continues on libx264;
   * message explains Settings / driver (not silent).
   */
  gpuFallbackNote: string | null;
  gridLayout: GridLayoutMode;
  params: BypassParams;
  variance: BypassVarianceOpts;
  turbo: boolean;
};

function shellQuote(value: string) {
  return `"${value.replace(/"/g, '\\"')}"`;
}

function displayCommand(ffmpegPath: string, args: string[]) {
  return [ffmpegPath, ...args]
    .map((arg) => (/[\s"'&()[\]{};!]/.test(arg) ? shellQuote(arg) : arg))
    .join(' ');
}

function parseFps(rate: string): number {
  const clean = String(rate || '').trim();
  if (clean.includes('/')) {
    const [num, den] = clean.split('/').map(Number);
    return den ? num / den : 30;
  }
  const parsed = parseFloat(clean);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 30;
}

export function probeBypassInput(videoPath: string): BypassProbeMeta {
  const ffprobe = resolveFfprobePath();
  const meta: BypassProbeMeta = {
    width: 1920,
    height: 1080,
    fps: 30,
    duration: 0,
    hasAudio: false,
    frameCount: 0,
  };

  const videoProbe = spawnSync(
    ffprobe,
    [
      '-v',
      'error',
      '-select_streams',
      'v:0',
      '-show_entries',
      'stream=width,height,r_frame_rate,nb_frames,duration',
      '-of',
      'json',
      videoPath,
    ],
    { windowsHide: true, encoding: 'utf8' },
  );

  try {
    const stream = JSON.parse(videoProbe.stdout || '{}')?.streams?.[0];
    if (stream) {
      meta.width = Number(stream.width) || meta.width;
      meta.height = Number(stream.height) || meta.height;
      meta.fps = parseFps(stream.r_frame_rate);
      meta.duration = parseFloat(stream.duration) || meta.duration;
      meta.frameCount = Number(stream.nb_frames) || Math.round(meta.duration * meta.fps) || 0;
    }
  } catch {
    // defaults
  }

  const formatProbe = spawnSync(
    ffprobe,
    ['-v', 'error', '-show_entries', 'format=duration', '-of', 'json', videoPath],
    { windowsHide: true, encoding: 'utf8' },
  );
  try {
    const duration = parseFloat(JSON.parse(formatProbe.stdout || '{}')?.format?.duration);
    if (Number.isFinite(duration) && duration > 0) {
      meta.duration = duration;
      if (!meta.frameCount) meta.frameCount = Math.round(duration * meta.fps);
    }
  } catch {
    // ignore
  }

  const audioProbe = spawnSync(
    ffprobe,
    [
      '-v',
      'error',
      '-select_streams',
      'a:0',
      '-show_entries',
      'stream=index',
      '-of',
      'csv=p=0',
      videoPath,
    ],
    { windowsHide: true, encoding: 'utf8' },
  );
  meta.hasAudio = Boolean(String(audioProbe.stdout || '').trim());

  return meta;
}

/**
 * Root của "Mở thư mục lưu" (Header alias `project`) —
 * public → output → .ainovel-app → cwd.
 */
export function resolveProjectSaveRoot(cwd = process.cwd()): string {
  const candidates = [
    path.join(cwd, 'public'),
    path.join(cwd, 'output'),
    path.join(cwd, '.ainovel-app'),
    cwd,
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return path.resolve(c);
  }
  return path.resolve(cwd);
}

/** Thư mục riêng Phantom-X: {Mở thư mục lưu}/phantom-x-bypass */
export function resolveBypassOutputDir(cwd = process.cwd()): string {
  const dir = path.join(resolveProjectSaveRoot(cwd), 'phantom-x-bypass');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * Tên đầu ra: bypass_<tên file gốc>.mp4
 * Trùng tên → bypass_<tên>_2.mp4 …
 */
export function buildBypassOutputPath(inputPath: string, outputDir?: string): string {
  const dir = (outputDir && outputDir.trim()) || resolveBypassOutputDir();
  fs.mkdirSync(dir, { recursive: true });
  const base = path.basename(inputPath, path.extname(inputPath)) || 'video';
  // Always remux to mp4 (encoder output)
  let name = `bypass_${base}.mp4`;
  let full = path.join(dir, name);
  let i = 2;
  while (fs.existsSync(full)) {
    name = `bypass_${base}_${i}.mp4`;
    full = path.join(dir, name);
    i += 1;
  }
  return full;
}

/**
 * Build Stage-1…5 argv from checkbox selection + optional Frame PNG + grid.
 */
export function buildBypassEngineCommand(req: BypassEngineRequest): BypassEngineBuilt {
  const inputPath = String(req.inputPath || '').trim();
  if (!inputPath) throw new Error('Thiếu đường dẫn video đầu vào.');
  if (!fs.existsSync(inputPath)) throw new Error(`Không tìm thấy file: ${inputPath}`);

  const filters = Array.isArray(req.filters) ? req.filters : [];
  if (filters.length === 0) throw new Error('Chọn ít nhất một bộ lọc Phantom-X.');

  const expanded = resolveActiveFilters(filters);
  if (expanded.size === 0) throw new Error('Chọn ít nhất một bộ lọc Phantom-X.');

  const gridLayout = normalizeGridLayout(req.gridLayout);
  const useGrid = gridLayout !== 'none';
  const variance = normalizeVariance(req.variance ?? null);
  const turbo = Boolean(req.turbo);

  const overlayPath = String(req.overlayPath || '').trim();
  const useOverlay = Boolean(overlayPath && fs.existsSync(overlayPath));
  if (overlayPath && !useOverlay) {
    throw new Error(`Không tìm thấy Frame PNG: ${overlayPath}`);
  }

  const meta = probeBypassInput(inputPath);

  // Crown formula: precompiled (cloud/local bridge) or local filters
  let graph: BypassGraphBuild;
  let fcParts: string[] = [];
  let vMap: string | null = null;
  let aMap: string | null = null;
  if (req.precompiled) {
    graph = req.precompiled.graph;
    fcParts = [...(req.precompiled.fcParts || [])];
    vMap = req.precompiled.vMap;
    aMap = req.precompiled.aMap;
  } else {
    graph = buildBypassGraph(expanded, meta, variance);
  }

  // Grid alone still re-layouts the master frame → needs encode
  if (!graph.needsReencode && !useOverlay && !useGrid) {
    throw new Error('Không có bộ lọc nào cần encode. Hãy chọn lại.');
  }

  const outputDir = req.outputDir ? String(req.outputDir).trim() : resolveBypassOutputDir();
  const outputPath =
    String(req.outputPath || '').trim() || buildBypassOutputPath(inputPath, outputDir);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });

  // Default FFmpeg; may switch to compat binary when NVENC probe succeeds on alt path
  let ffmpegPath = resolveFfmpegPath();
  const args: string[] = [];
  const p = graph.params;

  // ── Stage 1: Input init (Stealth P0) ───────────────────────────────────
  // thread_queue_size: widen demux buffer under heavy filter_complex
  // fflags+genpts: repair odd timestamps before filter graph
  args.push(
    '-y',
    '-hide_banner',
    '-v',
    'error',
    '-thread_queue_size',
    '4096',
    '-threads',
    '0',
    '-filter_threads',
    '0',
    '-filter_complex_threads',
    '0',
    '-fflags',
    '+genpts',
    '-hwaccel',
    'auto',
    '-progress',
    'pipe:1',
    '-nostats',
    '-i',
    inputPath,
  );
  if (useOverlay) {
    // Second input also gets a large queue (overlay PNG decode)
    args.push('-thread_queue_size', '4096', '-i', overlayPath);
  }

  // ── Stage 2–3: filter_complex ──────────────────────────────────────────
  // Turbo: scale mid → Ultimate/Grid graph → scale back (inside buildGridVideoFilterParts)
  const hasVideoPixelFx = graph.hasVideoFx;
  const needsVideoGraph = hasVideoPixelFx || useOverlay || useGrid;
  const hasAudioFx = graph.hasAudioFx;

  if (!req.precompiled) {
    if (needsVideoGraph) {
      // Unified path via buildGridVideoFilterParts (none | 1x2 | 2x1 | 2x2) + turbo
      if (useGrid || hasVideoPixelFx) {
        const grid = buildGridVideoFilterParts(
          expanded,
          meta,
          useGrid ? gridLayout : 'none',
          graph.params,
          { turbo },
        );
        if (grid.usesFilterComplex && grid.parts.length > 0) {
          fcParts.push(...grid.parts);
          if (useOverlay) {
            const last = fcParts[fcParts.length - 1];
            if (last.endsWith('[v_out]')) {
              fcParts[fcParts.length - 1] = last.replace(/\[v_out\]$/, '[v_pre_overlay]');
              fcParts.push(`[v_pre_overlay][1:v]${OVERLAY_FILTER}[v_out]`);
            } else {
              fcParts.push(`[${grid.outLabel}][1:v]${OVERLAY_FILTER}[v_out]`);
            }
            vMap = '[v_out]';
          } else {
            vMap = `[${grid.outLabel}]`;
          }
        } else if (useOverlay) {
          fcParts.push(
            `[0:v]scale=${graph.outW}:${graph.outH}:flags=bicubic[v_filtered]`,
          );
          fcParts.push(`[v_filtered][1:v]${OVERLAY_FILTER}[v_out]`);
          vMap = '[v_out]';
        }
      } else if (useOverlay) {
        fcParts.push(
          `[0:v]scale=${graph.outW}:${graph.outH}:flags=bicubic[v_filtered]`,
        );
        fcParts.push(`[v_filtered][1:v]${OVERLAY_FILTER}[v_out]`);
        vMap = '[v_out]';
      }
    }

    if (hasAudioFx && graph.audioChain) {
      // Stage 3 — Stealth Audio Bypass (4-layer spectral + heavy stealth weapons)
      const audio = buildAudioMaskComplexParts(graph.params);
      fcParts.push(...audio.parts);
      aMap = `[${audio.outLabel}]`;
    }
  }

  if (fcParts.length > 0) {
    // CẤM lật khung (hflip/vflip/transpose). Micro-rotate in grid Transform is allowed.
    const joined = fcParts.join(';');
    if (/\bhflip\b|\bvflip\b|\btranspose\b/i.test(joined)) {
      throw new Error('Phantom-X cấm lật khung hình (hflip/vflip/transpose).');
    }
    args.push('-filter_complex', joined);
    if (vMap) args.push('-map', vMap);
    else args.push('-map', '0:v:0');
    if (aMap) args.push('-map', aMap);
    else if (meta.hasAudio) args.push('-map', '0:a?');
  } else {
    args.push('-map', '0:v:0');
    if (meta.hasAudio) args.push('-map', '0:a?');
  }

  // ── Stage 4: Encoder + GOP / B-frames / CQ jitter (Stealth P1) ──────────
  // Quality: full-res + HQ encode. Turbo: mid-res graph + faster preset.
  // NVENC: real open-encoder probe (same logic as Settings system-info) — NOT nvidia-smi alone.
  const needVideoEncode = needsVideoGraph || graph.hasGop;
  let usedNvenc = false;
  let nvencProbe: NvencProbeResult | null = null;
  let gpuFallbackNote: string | null = null;

  if (needVideoEncode) {
    const wantGpu = req.preferGpu !== false;
    if (wantGpu) {
      // Multi-FFmpeg probe: bin/ may need driver 610+; python_core/7.x often works on GTX 10xx
      nvencProbe = probeH264Nvenc({ force: false });
      usedNvenc = nvencProbe.ok;
      if (usedNvenc && nvencProbe.ffmpegPath) {
        ffmpegPath = nvencProbe.ffmpegPath;
      }
      if (!usedNvenc) {
        gpuFallbackNote =
          `[GPU] NVENC không dùng được → encode libx264. ${nvencProbe.message}`;
      } else if (nvencProbe.usedCompatFfmpeg) {
        gpuFallbackNote =
          `[GPU] NVENC OK · FFmpeg compat: ${nvencProbe.ffmpegPath} · preset=${nvencProbe.preset}`;
      }
    }
    const bfMax = Math.max(0, Math.min(3, Math.round(p.bFrames)));
    // Only request B-frames on NVENC when probe confirmed -bf 2
    const bfNvenc = usedNvenc
      ? nvencProbe?.bf2Ok
        ? Math.min(bfMax, 2)
        : 0
      : bfMax;
    const bf = usedNvenc ? bfNvenc : bfMax;
    const refs = Math.max(1, Math.min(6, Math.round(p.refs)));
    const cq = String(turbo ? p.cqTurbo : p.cqQuality);
    const crf = String(turbo ? p.crfTurbo : p.crfQuality);

    if (usedNvenc) {
      args.push(
        '-c:v',
        'h264_nvenc',
        ...buildH264NvencArgs({
          mode: turbo ? 'turbo' : 'quality',
          cq,
          bf,
          presetHint: nvencProbe?.preset || 'p6',
        }),
      );
    } else if (turbo) {
      args.push(
        '-c:v',
        'libx264',
        '-preset',
        'ultrafast',
        '-crf',
        crf,
        '-bf',
        String(bf),
        '-refs',
        String(refs),
        '-coder',
        '1',
      );
    } else {
      // Quality — medium + stealth B-frames / CABAC / refs
      args.push(
        '-c:v',
        'libx264',
        '-preset',
        'medium',
        '-crf',
        crf,
        '-bf',
        String(bf),
        '-refs',
        String(refs),
        '-coder',
        '1',
        '-x264-params',
        `ref=${refs}:bframes=${bf}:cabac=1:me=hex:subme=7:trellis=1:scenecut=0`,
      );
    }

    args.push('-pix_fmt', 'yuv420p');

    // Stealth: always rewrite GOP structure on video re-encode
    args.push(...graph.gopArgs);
    // sc_threshold is libx264-only (NVENC ignores silently)
    if (!usedNvenc) {
      args.push('-sc_threshold', '0');
    }

    // P3 — encode-side color tags (normalize container signaling)
    args.push(
      '-colorspace',
      'bt709',
      '-color_primaries',
      'bt709',
      '-color_trc',
      'bt709',
      '-color_range',
      'tv',
    );
  } else {
    args.push('-c:v', 'copy');
  }

  if (hasAudioFx) {
    // Quality: bitrate audio cao hơn khi không turbo
    args.push(
      '-c:a',
      'aac',
      '-b:a',
      turbo ? '128k' : '192k',
      '-ar',
      '44100',
      '-ac',
      '2',
    );
  } else if (meta.hasAudio) {
    args.push('-c:a', 'copy');
  }

  // ── Stage 5: Mux — metadata sanitation (Stealth P0/P3) ────────────────
  // Strip source EXIF/container tags + chapters; neutralize Lavf/Lavc fingerprints.
  args.push(
    '-map_metadata',
    '-1',
    '-map_chapters',
    '-1',
    '-fflags',
    '+bitexact',
    '-flags',
    '+bitexact',
    '-metadata',
    'encoder=',
    '-metadata',
    'title=',
    '-metadata',
    'comment=',
    '-metadata',
    'description=',
    '-metadata',
    'synopsis=',
    '-metadata:s:v',
    'encoder=',
    '-metadata:s:v',
    'handler_name=',
    '-metadata:s:a',
    'encoder=',
    '-metadata:s:a',
    'handler_name=',
    '-movflags',
    '+faststart',
    outputPath,
  );

  const labels = [...graph.activeLabels];
  if (useGrid) {
    const gridLabel =
      gridLayout === '1x2'
        ? 'Grid 1×2'
        : gridLayout === '2x1'
          ? 'Grid 2×1'
          : 'Grid 2×2';
    labels.push(gridLabel);
  }
  if (turbo) {
    labels.push('Turbo (scale mid + encode nhanh)');
  } else {
    labels.push('Quality (full-res + HQ encode)');
  }

  return {
    ffmpegPath,
    ffmpegArgs: args,
    commandLine: displayCommand(ffmpegPath, args),
    outputPath,
    meta,
    activeLabels: labels,
    progressOnStdout: true,
    usedNvenc,
    nvencProbe,
    gpuFallbackNote,
    gridLayout,
    params: graph.params,
    variance,
    turbo,
  };
}
