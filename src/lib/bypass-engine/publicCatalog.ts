/**
 * Client-safe Phantom-X catalog — labels / UX only.
 * FFmpeg graph math stays in filters.ts (crown-sealed for customer packs).
 */
import type {
  BypassFilterId,
  GridLayoutMode,
  PhantomPreset,
  PhantomPresetId,
} from './formulaTypes';

export type { BypassFilterId, GridLayoutMode, PhantomPreset, PhantomPresetId };

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

/** % lệch khuyến nghị — UX only */
export const VARIANCE_RECOMMENDED = {
  defaultPercent: 3,
  safeMaxPercent: 5,
  safeMaxPercentWithGrid: 5,
  dangerAbovePercent: 5,
} as const;

export const PHANTOM_PRESETS: readonly PhantomPreset[] = [
  {
    id: 'light',
    label: 'Ghost Pulse',
    speed: '⚡ Ultra Fast · ~3–5× realtime',
    pcSpec: 'i3 / Ryzen 3 · 8GB RAM · iGPU trở lên',
    forWhom:
      'Ghost Pulse — Spectral Noise + Color Drift + Keyframe Shatter. Máy yếu / batch hàng loạt. Đề nghị: Intel i3-10th / Ryzen 3 3000+, 8GB RAM, iGPU UHD/Vega; NVENC tùy chọn.',
    filters: ['dynamic_temporal_noise', 'micro_colorspace', 'asymmetric_gop'],
    gridLayout: 'none',
    randomize: false,
    randomPercent: 3,
    preferGpu: true,
  },
  {
    id: 'balanced',
    label: 'Phantom Core',
    speed: '◆ Balanced · ~1.5–3× realtime',
    pcSpec: 'i5 / Ryzen 5 · 16GB RAM · GTX 1650+',
    forWhom:
      'Phantom Core — pHash Break + Noise + Color + Audio Mask + GOP. Khuyến nghị hằng ngày. Đề nghị: Intel i5-11th / Ryzen 5 3600+, 16GB RAM, GTX 1650 / RTX 3050 (NVENC) hoặc CPU 6 nhân.',
    filters: [
      'phantom_subpixel',
      'dynamic_temporal_noise',
      'micro_colorspace',
      'tempo_audio_mask',
      'asymmetric_gop',
    ],
    gridLayout: 'none',
    randomize: true,
    randomPercent: 3,
    preferGpu: true,
  },
  {
    id: 'full',
    label: 'Apex Forge',
    speed: '◆ Heavy · ~0.8–1.5× realtime',
    pcSpec: 'i7 / Ryzen 7 · 16–32GB · RTX 3060+',
    forWhom:
      'Apex Forge — Ultimate Chain (đủ 6 lớp fingerprint). 1 clip làm kỹ. Đề nghị: Intel i7-12th / Ryzen 7 5700X+, 16–32GB RAM, RTX 3060 12GB trở lên (NVENC p4) hoặc CPU 8 nhân+.',
    filters: [
      'phantom_subpixel',
      'dynamic_temporal_noise',
      'micro_colorspace',
      'tempo_audio_mask',
      'asymmetric_gop',
      'dynamic_zoom_pan',
      'ultimate',
    ],
    gridLayout: 'none',
    randomize: true,
    randomPercent: 3,
    preferGpu: true,
  },
  {
    id: 'full_grid',
    label: 'Quantum Matrix',
    speed: '● Extreme · ~0.2–0.6× realtime',
    pcSpec: 'i7–i9 / R7–R9 · 32GB · RTX 3070+',
    forWhom:
      'Quantum Matrix — Ultimate + Multi-Stream Rotate Grid 2×2 + Variance. Unique tối đa, render lâu. Đề nghị: Intel i7-13th / Ryzen 7 7700X+, 32GB RAM, RTX 3070 / 4060 Ti trở lên; ưu tiên NVENC, SSD NVMe.',
    filters: [
      'phantom_subpixel',
      'dynamic_temporal_noise',
      'micro_colorspace',
      'tempo_audio_mask',
      'asymmetric_gop',
      'dynamic_zoom_pan',
      'ultimate',
    ],
    gridLayout: '2x2',
    randomize: true,
    randomPercent: 3,
    preferGpu: true,
  },
] as const;

export function getPhantomPreset(id: PhantomPresetId): PhantomPreset | undefined {
  return PHANTOM_PRESETS.find((p) => p.id === id);
}

export type PhantomPcRecommendation = {
  active: boolean;
  loadScore: number;
  tierLabel: string;
  speed: string;
  pcSpec: string;
  detail: string;
  tip: string;
};

const FILTER_LOAD: Partial<Record<BypassFilterId, number>> = {
  dynamic_temporal_noise: 1.2,
  micro_colorspace: 0.8,
  phantom_subpixel: 1.0,
  tempo_audio_mask: 0.6,
  asymmetric_gop: 0.5,
  dynamic_zoom_pan: 3.5,
  ultimate: 0,
};

const GRID_LOAD: Record<GridLayoutMode, number> = {
  none: 1,
  '1x2': 2.2,
  '2x1': 2.2,
  '2x2': 4.0,
};

/** Đề xuất PC theo filter + grid (UI) — không chứa FFmpeg graph. */
export function recommendPcForSelection(
  selected: Iterable<BypassFilterId>,
  gridLayout: GridLayoutMode = 'none',
): PhantomPcRecommendation {
  const set = new Set(selected);
  const atomics: BypassFilterId[] = [
    'phantom_subpixel',
    'dynamic_temporal_noise',
    'micro_colorspace',
    'tempo_audio_mask',
    'asymmetric_gop',
    'dynamic_zoom_pan',
  ];
  const effective = new Set<BypassFilterId>();
  if (set.has('ultimate')) {
    for (const a of atomics) effective.add(a);
  } else {
    for (const id of set) {
      if (id !== 'ultimate') effective.add(id);
    }
  }

  if (effective.size === 0) {
    return {
      active: false,
      loadScore: 0,
      tierLabel: '—',
      speed: 'Chưa chọn filter',
      pcSpec: 'Tích BỘ lọc chính để xem PC đề nghị',
      detail: '',
      tip: '',
    };
  }

  let score = 0;
  for (const id of effective) {
    score += FILTER_LOAD[id] ?? 1;
  }
  score *= GRID_LOAD[gridLayout] ?? 1;
  const loadScore = Math.min(100, Math.round((score / 28) * 100));

  if (score < 3.5 && gridLayout === 'none') {
    return {
      active: true,
      loadScore,
      tierLabel: 'Ghost Pulse class',
      speed: '⚡ Ultra Fast · ~3–5× realtime',
      pcSpec: 'i3 / Ryzen 3 · 8GB RAM · iGPU trở lên',
      detail:
        'CPU: Intel i3-10th / Ryzen 3 3000+ (4 nhân). RAM: 8GB. GPU: iGPU UHD/Vega đủ; NVENC tùy chọn.',
      tip: 'Phù hợp batch nhiều file. Tránh bật Zoom & Pan và Grid nếu máy yếu.',
    };
  }

  if (score < 7 && gridLayout === 'none' && !effective.has('dynamic_zoom_pan')) {
    return {
      active: true,
      loadScore,
      tierLabel: 'Phantom Core class',
      speed: '◆ Balanced · ~1.5–3× realtime',
      pcSpec: 'i5 / Ryzen 5 · 16GB RAM · GTX 1650+',
      detail:
        'CPU: Intel i5-11th / Ryzen 5 3600+ (6 nhân). RAM: 16GB. GPU: GTX 1650 / RTX 3050 (NVENC) hoặc CPU 6 nhân.',
      tip: 'Cấu hình khuyến nghị hằng ngày. Bật GPU (NVENC) nếu có card NVIDIA.',
    };
  }

  if (gridLayout !== 'none' || score >= 12) {
    const extreme =
      gridLayout === '2x2' ||
      (gridLayout !== 'none' && effective.has('dynamic_zoom_pan'));
    if (extreme) {
      return {
        active: true,
        loadScore: Math.max(loadScore, 75),
        tierLabel: 'Quantum Matrix class',
        speed: '● Extreme · ~0.2–0.6× realtime',
        pcSpec: 'i7–i9 / R7–R9 · 32GB RAM · RTX 3070+',
        detail:
          'CPU: Intel i7-13th / Ryzen 7 7700X+. RAM: 32GB. GPU: RTX 3070 / 4060 Ti+ (NVENC bắt buộc khuyến nghị). Ổ: SSD NVMe.',
        tip: 'Grid × Zoom rất nặng. Ưu tiên NVENC; giảm Grid xuống 1×2 hoặc tắt Zoom nếu render quá chậm.',
      };
    }
    return {
      active: true,
      loadScore: Math.max(loadScore, 55),
      tierLabel: 'Apex Forge class',
      speed: '◆ Heavy · ~0.8–1.5× realtime',
      pcSpec: 'i7 / Ryzen 7 · 16–32GB RAM · RTX 3060+',
      detail:
        'CPU: Intel i7-12th / Ryzen 7 5700X+ (8 nhân). RAM: 16–32GB. GPU: RTX 3060 12GB+ (NVENC p4) hoặc CPU 8 nhân+.',
      tip: 'Ultimate / Zoom pan tốn encode. Giữ GPU bật; clip dài nên render từng đoạn.',
    };
  }

  return {
    active: true,
    loadScore,
    tierLabel: 'Phantom Core class',
    speed: '◆ Balanced · ~1.5–3× realtime',
    pcSpec: 'i5 / Ryzen 5 · 16GB RAM · GTX 1650+',
    detail:
      'CPU: Intel i5-11th / Ryzen 5 3600+. RAM: 16GB. GPU: GTX 1650+ hoặc CPU 6 nhân.',
    tip: 'Bật GPU nếu có NVIDIA.',
  };
}
