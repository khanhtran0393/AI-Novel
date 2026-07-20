/**
 * Phantom-X public types only (no formula constants / filter chains).
 * Safe to ship in customer bundles when crown formulas are sealed.
 */

export type BypassFilterId =
  | 'phantom_subpixel'
  | 'dynamic_temporal_noise'
  | 'micro_colorspace'
  | 'tempo_audio_mask'
  | 'asymmetric_gop'
  | 'dynamic_zoom_pan'
  | 'ultimate';

export type GridLayoutMode = 'none' | '1x2' | '2x1' | '2x2';

export type BypassVarianceOpts = {
  enabled: boolean;
  percent: number;
  seed?: number;
};

export type BypassParams = {
  phantomBorder: number;
  vignetteAngle: number;
  noiseAlls: number;
  brightness: number;
  contrast: number;
  saturation: number;
  gamma: number;
  zoomStep: number;
  zoomMax: number;
  atempo: number;
  asetrateFactor: number;
  stereoDelayMs: number;
  vibratoFreq: number;
  vibratoDepth: number;
  brownNoiseAmp: number;
  brownNoiseMixWeight: number;
  chorusDelay: number;
  trebleGainDb: number;
  trebleFreq: number;
  bassGainDb: number;
  bassFreq: number;
  gop: number;
  keyintMin: number;
  bFrames: number;
  refs: number;
  cqQuality: number;
  cqTurbo: number;
  crfQuality: number;
  crfTurbo: number;
  rotateCropRatio: number;
  rotateAngles: {
    '1x2': number[];
    '2x1': number[];
    '2x2': number[];
  };
  summary: string;
};

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

export type VideoFragmentOpts = {
  turbo?: boolean;
  omitFormat?: boolean;
};

export type GridBuildOptions = {
  turbo?: boolean;
};

export type PhantomPresetId = 'light' | 'balanced' | 'full' | 'full_grid';

export type PhantomPreset = {
  id: PhantomPresetId;
  label: string;
  speed: string;
  pcSpec: string;
  forWhom: string;
  filters: BypassFilterId[];
  gridLayout: GridLayoutMode;
  randomize: boolean;
  randomPercent: number;
  preferGpu: boolean;
};

export type PhantomPcRecommendation = {
  active: boolean;
  loadScore: number;
  tierLabel: string;
  speed: string;
  pcSpec: string;
  detail: string;
  tip: string;
};
