/**
 * Phantom-X Bypass — Pipeline Builder (checkbox → FFmpeg Node-Graph).
 *
 * Grid architecture (filter_complex):
 *   1) Split     — clone [0:v] → N streams
 *   2) Transform — per-stream rotate (micro°) → crop black → scale 50%/half
 *   3) Stack     — xstack → [grid]
 *   4) Phantom-X — BỘ lọc chính on composite [grid]
 *      Canonical pixel order (Stealth):
 *        eq → noise → edge-mask (crop[+vignette]) → micro-zoom → scale → format → colorspace?
 *   5) Audio     — stealth spectral mask on [0:a]
 *
 * Params: defaults or ±% random (BypassParams).
 * CẤM hflip/vflip/transpose.
 */

import {
  resolveBypassParams,
  type BypassParams,
  type BypassVarianceOpts,
} from './variance';

export type { BypassParams, BypassVarianceOpts } from './variance';
export {
  BYPASS_DEFAULTS,
  VARIANCE_RECOMMENDED,
  normalizeVariance,
  resolveBypassParams,
} from './variance';

export type BypassFilterId =
  | 'phantom_subpixel'
  | 'dynamic_temporal_noise'
  | 'micro_colorspace'
  | 'tempo_audio_mask'
  | 'asymmetric_gop'
  | 'dynamic_zoom_pan'
  | 'ultimate';

/** Grid of the master frame after multi-stream transform + xstack. */
export type GridLayoutMode = 'none' | '1x2' | '2x1' | '2x2';

export const GRID_LAYOUT_OPTIONS: ReadonlyArray<{
  id: GridLayoutMode;
  label: string;
  cols: number;
  rows: number;
}> = [
  { id: 'none', label: '1 khung (không grid)', cols: 1, rows: 1 },
  { id: '1x2', label: 'Grid 1×2', cols: 2, rows: 1 },
  { id: '2x1', label: 'Grid 2×1', cols: 1, rows: 2 },
  { id: '2x2', label: 'Grid 2×2', cols: 2, rows: 2 },
];

/** Public labels only — never surface FFmpeg argv in UI. */
export const BYPASS_FILTER_CATALOG: ReadonlyArray<{
  id: BypassFilterId;
  label: string;
  master?: boolean;
}> = [
  { id: 'phantom_subpixel', label: 'Phantom Sub-Pixel Shift' },
  { id: 'dynamic_temporal_noise', label: 'Dynamic Temporal Noise' },
  { id: 'micro_colorspace', label: 'Micro Color-Space Shift' },
  { id: 'tempo_audio_mask', label: 'Tempo Shift & Audio Mask' },
  { id: 'asymmetric_gop', label: 'Asymmetric GOP Injection' },
  { id: 'dynamic_zoom_pan', label: 'Dynamic Zoom & Pan' },
  { id: 'ultimate', label: 'Ultimate Bypass', master: true },
];

const ALL_ATOMIC: BypassFilterId[] = [
  'phantom_subpixel',
  'dynamic_temporal_noise',
  'micro_colorspace',
  'tempo_audio_mask',
  'asymmetric_gop',
  'dynamic_zoom_pan',
];

/** Pad names after transform (before xstack). */
const GRID_PAD_NAMES: Record<Exclude<GridLayoutMode, 'none'>, string[]> = {
  '1x2': ['left', 'right'],
  '2x1': ['top', 'bot'],
  '2x2': ['top_left', 'top_right', 'bot_left', 'bot_right'],
};

/** xstack layout string for assembled master frame. */
const GRID_XSTACK_LAYOUT: Record<Exclude<GridLayoutMode, 'none'>, string> = {
  '1x2': '0_0|w0_0',
  '2x1': '0_0|0_h0',
  '2x2': '0_0|w0_0|0_h0|w0_h0',
};

const GRID_CELL_SCALE: Record<Exclude<GridLayoutMode, 'none'>, string> = {
  '1x2': 'scale=iw/2:ih',
  '2x1': 'scale=iw:ih/2',
  '2x2': 'scale=iw/2:ih/2',
};

export function resolveActiveFilters(selected: BypassFilterId[]): Set<BypassFilterId> {
  const set = new Set<BypassFilterId>();
  for (const id of selected) {
    if (id === 'ultimate') {
      for (const a of ALL_ATOMIC) set.add(a);
      set.add('ultimate');
      continue;
    }
    if ((ALL_ATOMIC as readonly string[]).includes(id)) {
      set.add(id);
    }
  }
  return set;
}

export function normalizeGridLayout(raw: unknown): GridLayoutMode {
  const s = String(raw || 'none');
  if (s === '1x2' || s === '2x1' || s === '2x2' || s === 'none') return s;
  return 'none';
}

export type BypassProbeMeta = {
  width: number;
  height: number;
  fps: number;
  duration: number;
  hasAudio: boolean;
  frameCount: number;
};

export type BypassGraphBuild = {
  videoFragments: string[];
  audioChain: string | null;
  gopArgs: string[];
  activeLabels: string[];
  hasVideoFx: boolean;
  hasAudioFx: boolean;
  hasGop: boolean;
  needsReencode: boolean;
  outW: number;
  outH: number;
  fps: number;
  params: BypassParams;
};

function even(n: number): number {
  const v = Math.max(2, Math.round(n));
  return v % 2 === 0 ? v : v - 1;
}

function fmt(n: number, digits = 5): string {
  // Trim trailing zeros for cleaner FFmpeg args
  const s = n.toFixed(digits);
  return s.replace(/\.?0+$/, '') || '0';
}

export type VideoFragmentOpts = {
  /**
   * Quality → lanczos; Turbo → fast_bilinear.
   * Default quality (lanczos).
   */
  turbo?: boolean;
  /** Skip trailing format=yuv420p (caller upscales then formats). */
  omitFormat?: boolean;
};

/**
 * Scale flags: Quality = lanczos (sharp edge restore); Turbo = fast_bilinear.
 */
export function scaleFlagsForMode(turbo?: boolean): string {
  return turbo ? 'fast_bilinear' : 'lanczos';
}

/**
 * Canonical Stealth pixel chain fragments (no stream labels).
 *
 * Order (critical):
 *   1) eq          — color/brightness first
 *   2) noise       — grain after grade (avoid amp noise via contrast)
 *   3) edge mask   — crop 1–2px + optional soft vignette
 *   4) micro zoom  — light zoompan (smaller step/max than legacy)
 *   5) scale+format + optional bt709 colorspace (when micro_colorspace)
 */
export function buildVideoFragmentsForCell(
  active: Set<BypassFilterId>,
  cellW: number,
  cellH: number,
  fps: number,
  params?: BypassParams,
  opts?: VideoFragmentOpts,
): string[] {
  const p = params ?? resolveBypassParams(null);
  const outW = even(cellW);
  const outH = even(cellH);
  // Cap zoompan internal fps to reduce CPU (still matches timeline via d=1)
  const srcFps = fps > 0 && Number.isFinite(fps) ? Math.round(fps * 1000) / 1000 : 30;
  const zFps = Math.min(srcFps, 30);
  const videoFragments: string[] = [];
  const border = Math.max(1, Math.round(p.phantomBorder));
  const cropOff = border * 2;
  const sFlags = scaleFlagsForMode(opts?.turbo);
  const needOutSize =
    active.has('phantom_subpixel') ||
    active.has('dynamic_zoom_pan') ||
    active.has('micro_colorspace') ||
    active.has('dynamic_temporal_noise');

  // 1) Color grade first
  if (active.has('micro_colorspace')) {
    videoFragments.push(
      `eq=brightness=${fmt(p.brightness)}:contrast=${fmt(p.contrast, 4)}:saturation=${fmt(p.saturation, 4)}:gamma=${fmt(p.gamma, 4)}`,
    );
  }

  // 2) Temporal noise after grade
  if (active.has('dynamic_temporal_noise')) {
    videoFragments.push(`noise=alls=${fmt(p.noiseAlls, 3)}:allf=t+u`);
  }

  // 3) Edge mask — crop 1–2px + optional soft vignette (pHash edge break)
  if (active.has('phantom_subpixel')) {
    const edge: string[] = [
      `crop=iw-${cropOff}:ih-${cropOff}:x=${border}:y=${border}`,
    ];
    if (p.vignetteAngle > 0.05) {
      // Mild corner falloff — complements edge crop without heavy look
      edge.push(`vignette=angle=${fmt(p.vignetteAngle, 4)}:mode=forward`);
    }
    // Restore canvas size immediately when no zoompan follows
    if (!active.has('dynamic_zoom_pan')) {
      edge.push(`scale=${outW}:${outH}:flags=${sFlags}`);
    }
    videoFragments.push(edge.join(','));
  }

  // 4) Micro zoom/pan — lighter step/max; fps capped at 30 for CPU
  if (active.has('dynamic_zoom_pan')) {
    videoFragments.push(
      `zoompan=z='min(zoom+${fmt(p.zoomStep, 6)},${fmt(p.zoomMax, 4)})':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=${outW}x${outH}:fps=${zFps}`,
    );
  }

  // 5) Ensure even dims + yuv420p + optional bt709 (micro_colorspace path)
  if (needOutSize && videoFragments.length > 0) {
    const tail: string[] = [];
    const last = videoFragments[videoFragments.length - 1] || '';
    const alreadyScaled =
      last.includes(`scale=${outW}:${outH}`) || last.includes(`s=${outW}x${outH}`);
    if (!alreadyScaled && !active.has('dynamic_zoom_pan')) {
      // Only needed if we had eq/noise without crop/zoom (rare size drift)
      if (!active.has('phantom_subpixel')) {
        tail.push(`scale=${outW}:${outH}:flags=${sFlags}`);
      }
    }
    if (!opts?.omitFormat) {
      tail.push('format=yuv420p');
      // Normalize matrix when Micro Color-Space is on.
      // iall=bt709: force assume unknown/source primaries (avoids "primaries 2 unknown").
      // Encode-side -colorspace bt709 tags remain the always-on path in buildCommand.
      if (active.has('micro_colorspace')) {
        tail.push(
          'colorspace=all=bt709:iall=bt709:fast=1:range=tv:format=yuv420p',
        );
      }
    }
    if (tail.length) videoFragments.push(tail.join(','));
  }

  return videoFragments;
}

/**
 * Turbo work size — max width 1280, keep aspect, even dims.
 * Filter graph (esp. 2×2 + zoompan) runs on this size when turbo=true.
 */
export function turboWorkSize(
  srcW: number,
  srcH: number,
  maxW = 1280,
): { w: number; h: number; scaled: boolean } {
  const W = even(srcW || 1920);
  const H = even(srcH || 1080);
  if (W <= maxW) return { w: W, h: H, scaled: false };
  const h = even(Math.max(2, Math.round((H * maxW) / W)));
  return { w: even(maxW), h, scaled: true };
}

/**
 * Post-[grid] Phantom-X chain with resolved params (same canonical order as cell).
 * @param opts.omitFormat — skip trailing format=yuv420p (caller upscales then formats)
 * @param opts.turbo — scale flag + lighter path
 */
export function buildPostGridPhantomChain(
  active: Set<BypassFilterId>,
  meta: BypassProbeMeta,
  params?: BypassParams,
  opts?: VideoFragmentOpts,
): string | null {
  const outW = even(meta.width || 1920);
  const outH = even(meta.height || 1080);
  const fps =
    meta.fps > 0 && Number.isFinite(meta.fps) ? Math.round(meta.fps * 1000) / 1000 : 30;
  const sFlags = scaleFlagsForMode(opts?.turbo || opts?.omitFormat);

  const frags = buildVideoFragmentsForCell(active, outW, outH, fps, params, {
    turbo: opts?.turbo || opts?.omitFormat,
    omitFormat: opts?.omitFormat,
  });

  if (frags.length === 0) {
    if (opts?.omitFormat) return `scale=${outW}:${outH}:flags=${sFlags}`;
    return `scale=${outW}:${outH}:flags=${sFlags},format=yuv420p`;
  }
  return frags.join(',');
}

export function buildBypassGraph(
  active: Set<BypassFilterId>,
  meta: BypassProbeMeta,
  variance?: BypassVarianceOpts | null,
): BypassGraphBuild {
  const params = resolveBypassParams(variance ?? null);

  const labels = BYPASS_FILTER_CATALOG.filter((c) => active.has(c.id) && !c.master).map(
    (c) => c.label,
  );
  if (active.has('ultimate')) {
    labels.unshift('Ultimate Bypass');
  }
  if (variance?.enabled && (variance.percent ?? 0) > 0) {
    labels.push(`Ngẫu nhiên ±${variance.percent}%`);
  }

  const outW = even(meta.width || 1920);
  const outH = even(meta.height || 1080);
  const fps =
    meta.fps > 0 && Number.isFinite(meta.fps) ? Math.round(meta.fps * 1000) / 1000 : 30;

  const videoFragments = buildVideoFragmentsForCell(active, outW, outH, fps, params);

  /**
   * Stage 3 — Stealth Audio Bypass (Tempo Shift & Audio Mask):
   *   L1 brown noise floor → L2 micro-chorus → L3 treble/bass shift
   *   → L4 comb delay + compand onset smear + micro-vibrato + pitch/tempo
   * Built as multi-pad filter_complex parts via buildAudioMaskComplexParts().
   */
  let audioChain: string | null = null;
  if (active.has('tempo_audio_mask') && meta.hasAudio) {
    // Marker: non-null means audio mask on; actual graph = buildAudioMaskComplexParts
    audioChain = 'stealth';
  }

  /**
   * GOP / keyframe args always available for encoder when re-encoding video.
   * Checkbox `asymmetric_gop` still gates *forcing* re-encode for GOP-only jobs;
   * buildCommand applies these whenever video is re-encoded (Stealth P1).
   */
  const gopArgs: string[] = [
    '-g',
    String(params.gop),
    '-keyint_min',
    String(params.keyintMin),
  ];
  const hasGop = active.has('asymmetric_gop');

  const hasVideoFx = videoFragments.length > 0;
  const hasAudioFx = Boolean(audioChain);

  return {
    videoFragments,
    audioChain,
    gopArgs,
    activeLabels: labels,
    hasVideoFx,
    hasAudioFx,
    hasGop,
    needsReencode: hasVideoFx || hasAudioFx || hasGop,
    outW,
    outH,
    fps,
    params,
  };
}

export function joinVideoChain(fragments: string[]): string {
  return fragments.join(',');
}

/**
 * Stage 3 — full Stealth + Spectral Audio Mask chain (filter_complex parts).
 *
 *   anoisesrc brown → amix → chorus → treble/bass
 *   → adelay 2ms|0 → compand onset smear → vibrato → atempo/asetrate → aformat
 *
 * Out pad always [a_out].
 */
export function buildAudioMaskComplexParts(
  params?: BypassParams,
): { parts: string[]; outLabel: string } {
  const p = params ?? resolveBypassParams(null);
  const delayMs = Math.max(1, Math.round(p.stereoDelayMs));
  const noiseA = fmt(p.brownNoiseAmp, 5);
  const mixW = fmt(p.brownNoiseMixWeight, 4);
  const chorusD = fmt(p.chorusDelay, 2);
  const trebleG = fmt(p.trebleGainDb, 3);
  const trebleF = Math.round(p.trebleFreq);
  const bassG = fmt(p.bassGainDb, 3);
  const bassF = Math.round(p.bassFreq);
  const vibF = fmt(p.vibratoFreq, 3);
  const vibD = fmt(p.vibratoDepth, 4);
  const atempo = fmt(p.atempo, 5);
  const asr = fmt(p.asetrateFactor, 5);

  // Continuous brown noise; amix duration=first follows [0:a] length
  const parts = [
    `anoisesrc=color=brown:r=44100:a=${noiseA}[noise]`,
    `[0:a][noise]amix=inputs=2:duration=first:dropout_transition=0:weights=1 ${mixW}[a1]`,
    // Micro-chorus (phase smear)
    `[a1]chorus=0.7:0.9:${chorusD}:0.4:0.02:2[a2]`,
    // Frequency band shift
    `[a2]treble=g=${trebleG}:f=${trebleF},bass=g=${bassG}:f=${bassF}[a3]`,
    // Comb mono-killer + onset smear + micro-vibrato + pitch/tempo
    // compand points: input dB must be strictly increasing (FFmpeg requirement)
    // attacks=0.005 ≈ 5ms onset smear — softens drum/transient landmarks
    `[a3]adelay=${delayMs}|0,compand=attacks=0.005:decays=0.1:points=-90/-90|-70/-70|-30/-25|0/-1|20/-1,vibrato=f=${vibF}:d=${vibD},atempo=${atempo},asetrate=44100*${asr},aformat=sample_rates=44100[a_out]`,
  ];

  return { parts, outLabel: 'a_out' };
}

function buildTransformNode(
  angleDeg: number,
  scaleExpr: string,
  cropRatio: number,
): string {
  return `rotate=${fmt(angleDeg, 4)}*PI/180:c=black:ow=iw:oh=ih,crop=iw*${fmt(cropRatio, 4)}:ih*${fmt(cropRatio, 4)},${scaleExpr}`;
}

export type GridBuildOptions = {
  /**
   * Turbo máy yếu: scale mid (~720p/max 1280) → Ultimate/Grid → scale về gốc.
   * Giữ đủ filter; chỉ giảm pixel + encode nhanh (encode ở buildCommand).
   */
  turbo?: boolean;
};

/**
 * Node-Graph: [optional turbo downscale] → Split → Transform → xstack → Phantom-X → [optional upscale].
 */
export function buildGridVideoFilterParts(
  active: Set<BypassFilterId>,
  meta: BypassProbeMeta,
  gridMode: GridLayoutMode,
  params?: BypassParams,
  opts?: GridBuildOptions,
): { parts: string[]; outLabel: string; usesFilterComplex: boolean; turbo: boolean } {
  const p = params ?? resolveBypassParams(null);
  const turbo = Boolean(opts?.turbo);
  const srcW = even(meta.width || 1920);
  const srcH = even(meta.height || 1080);
  const work = turbo ? turboWorkSize(srcW, srcH) : { w: srcW, h: srcH, scaled: false };
  const workMeta: BypassProbeMeta = { ...meta, width: work.w, height: work.h };
  const fps = meta.fps || 30;
  const parts: string[] = [];

  // ① Turbo: thu nhỏ sớm
  if (work.scaled) {
    parts.push(`[0:v]scale=${work.w}:${work.h}:flags=fast_bilinear,setsar=1[vin]`);
  }
  const vinLabel = work.scaled ? 'vin' : '0:v';

  if (gridMode === 'none') {
    const frags = buildVideoFragmentsForCell(active, work.w, work.h, fps, p, {
      turbo,
      omitFormat: work.scaled,
    });
    if (frags.length === 0) {
      if (work.scaled) {
        parts.push(`[vin]scale=${srcW}:${srcH}:flags=bilinear,format=yuv420p[v_out]`);
        return { parts, outLabel: 'v_out', usesFilterComplex: true, turbo };
      }
      return { parts: [], outLabel: '0:v', usesFilterComplex: false, turbo };
    }
    const chain = joinVideoChain(frags);
    if (work.scaled) {
      parts.push(`[vin]${chain}[v_fx]`);
      parts.push(`[v_fx]scale=${srcW}:${srcH}:flags=bilinear,format=yuv420p[v_out]`);
      return { parts, outLabel: 'v_out', usesFilterComplex: true, turbo };
    }
    parts.push(`[0:v]${chain}[v_grid]`);
    return { parts, outLabel: 'v_grid', usesFilterComplex: true, turbo };
  }

  const angles = p.rotateAngles[gridMode];
  const padNames = GRID_PAD_NAMES[gridMode];
  const scaleExpr = GRID_CELL_SCALE[gridMode];
  const layout = GRID_XSTACK_LAYOUT[gridMode];
  const n = angles.length;

  // ②–④ Grid Ultimate 2×2 (trên bản work)
  const splitPads = Array.from({ length: n }, (_, i) => `[v${i + 1}]`).join('');
  parts.push(`[${vinLabel}]split=${n}${splitPads}`);

  for (let i = 0; i < n; i++) {
    const src = `v${i + 1}`;
    const dst = padNames[i];
    parts.push(
      `[${src}]${buildTransformNode(angles[i], scaleExpr, p.rotateCropRatio)}[${dst}]`,
    );
  }

  const stackInputs = padNames.map((name) => `[${name}]`).join('');
  parts.push(`${stackInputs}xstack=inputs=${n}:layout=${layout}[grid]`);

  // ⑤ Phantom trên khung tổng (work size) → ⑥ upscale nếu turbo
  const post = buildPostGridPhantomChain(active, workMeta, p, {
    omitFormat: work.scaled,
    turbo,
  });
  if (post) {
    if (work.scaled) {
      parts.push(`[grid]${post}[v_fx]`);
      parts.push(`[v_fx]scale=${srcW}:${srcH}:flags=bilinear,format=yuv420p[v_out]`);
    } else {
      parts.push(`[grid]${post}[v_out]`);
    }
    return { parts, outLabel: 'v_out', usesFilterComplex: true, turbo };
  }

  if (work.scaled) {
    parts.push(`[grid]scale=${srcW}:${srcH}:flags=bilinear,format=yuv420p[v_out]`);
  } else {
    parts.push(`[grid]format=yuv420p[v_out]`);
  }
  return { parts, outLabel: 'v_out', usesFilterComplex: true, turbo };
}

/** @deprecated */
export function buildGridCells(
  mode: GridLayoutMode,
  fullW: number,
  fullH: number,
): Array<{ crop: string; cellW: number; cellH: number; label: string }> {
  const W = even(fullW || 1920);
  const H = even(fullH || 1080);
  if (mode === 'none') {
    return [{ crop: `crop=${W}:${H}:0:0`, cellW: W, cellH: H, label: 'c0' }];
  }
  const names = GRID_PAD_NAMES[mode];
  return names.map((label) => ({
    crop: 'rotate+crop',
    cellW: mode === '2x1' ? W : even(W / 2),
    cellH: mode === '1x2' ? H : even(H / 2),
    label,
  }));
}

/** @deprecated */
export function buildCellVideoCore(
  active: Set<BypassFilterId>,
  cellW: number,
  cellH: number,
  fps: number,
  params?: BypassParams,
): string {
  const frags = buildVideoFragmentsForCell(active, cellW, cellH, fps, params);
  if (frags.length > 0) return joinVideoChain(frags);
  return `scale=${even(cellW)}:${even(cellH)}:flags=lanczos`;
}

export const OVERLAY_FILTER = 'overlay=x=0:y=0:format=yuv420';
