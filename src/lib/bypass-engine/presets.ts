/**
 * Phantom-X — cấu hình tham khảo (preset) cho người dùng.
 * Chỉ set checkbox / grid / variance / GPU — không đổi thuật toán lõi.
 */

import type { BypassFilterId, GridLayoutMode } from './filters';

export type PhantomPresetId = 'light' | 'balanced' | 'full' | 'full_grid';

export type PhantomPreset = {
  id: PhantomPresetId;
  /** Codename kêu — dòng chính trên nút */
  label: string;
  /** Tốc độ render (ước lượng tương đối) */
  speed: string;
  /** Cấu hình PC đề nghị (ngắn) */
  pcSpec: string;
  /** Tooltip đầy đủ */
  forWhom: string;
  filters: BypassFilterId[];
  gridLayout: GridLayoutMode;
  randomize: boolean;
  randomPercent: number;
  preferGpu: boolean;
};

/**
 * 4 cấu hình tham khảo — tên codename + tốc độ + PC đề nghị.
 * User vẫn sửa tay sau khi bấm preset.
 */
export const PHANTOM_PRESETS: readonly PhantomPreset[] = [
  {
    id: 'light',
    label: 'Ghost Pulse',
    speed: '⚡ Ultra Fast · ~3–5× realtime',
    pcSpec: 'i3 / Ryzen 3 · 8GB RAM · iGPU trở lên',
    forWhom:
      'Ghost Pulse — Spectral Noise + Color Drift + Keyframe Shatter. Máy yếu / batch hàng loạt. Đề nghị: Intel i3-10th / Ryzen 3 3000+, 8GB RAM, iGPU UHD/Vega; NVENC tùy chọn.',
    filters: [
      'dynamic_temporal_noise',
      'micro_colorspace',
      'asymmetric_gop',
    ],
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

/** Trọng số tải theo từng filter (tương đối). */
const FILTER_LOAD: Partial<Record<BypassFilterId, number>> = {
  dynamic_temporal_noise: 1.2,
  micro_colorspace: 0.8,
  phantom_subpixel: 1.0,
  tempo_audio_mask: 0.6,
  asymmetric_gop: 0.5,
  dynamic_zoom_pan: 3.5,
  ultimate: 0, // đã tính qua atomics
};

const GRID_LOAD: Record<GridLayoutMode, number> = {
  none: 1,
  '1x2': 2.2,
  '2x1': 2.2,
  '2x2': 4.0,
};

export type PhantomPcRecommendation = {
  /** Có filter nào được tích không */
  active: boolean;
  /** Mức tải 0–100 */
  loadScore: number;
  /** Ghost Pulse / Phantom Core / … gần nhất */
  tierLabel: string;
  /** ⚡ Ultra Fast / … */
  speed: string;
  /** Dòng PC ngắn */
  pcSpec: string;
  /** Chi tiết CPU · RAM · GPU */
  detail: string;
  /** Gợi ý thêm */
  tip: string;
};

/**
 * Đề xuất cấu hình PC theo bộ lọc + grid đang chọn (live).
 */
export function recommendPcForSelection(
  selected: Iterable<BypassFilterId>,
  gridLayout: GridLayoutMode = 'none',
): PhantomPcRecommendation {
  const set = new Set(selected);
  // Ultimate = đủ atomics
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

  // Normalize roughly: max ~ (sum filters ~7.6) * 4 ≈ 30
  const loadScore = Math.min(100, Math.round((score / 28) * 100));

  // Map score bands → tier copy (aligned with presets)
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
    const extreme = gridLayout === '2x2' || (gridLayout !== 'none' && effective.has('dynamic_zoom_pan'));
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

  // Mid with zoom or higher filter count, no grid
  if (effective.has('dynamic_zoom_pan')) {
    return {
      active: true,
      loadScore: Math.max(loadScore, 50),
      tierLabel: 'Apex Forge class',
      speed: '◆ Heavy · ~0.8–1.5× realtime',
      pcSpec: 'i7 / Ryzen 7 · 16–32GB RAM · RTX 3060+',
      detail:
        'CPU: Intel i7-12th / Ryzen 7 5700X+. RAM: 16–32GB. GPU: RTX 3060+ (NVENC) — Zoom & Pan là bottleneck chính.',
      tip: 'Zoom & Pan đẩy tải mạnh. Máy yếu: bỏ Zoom, giữ Noise + Color + GOP.',
    };
  }

  return {
    active: true,
    loadScore,
    tierLabel: 'Phantom Core class',
    speed: '◆ Balanced · ~1.5–3× realtime',
    pcSpec: 'i5 / Ryzen 5 · 16GB RAM · GTX 1650+',
    detail:
      'CPU: Intel i5 / Ryzen 5 (6 nhân+). RAM: 16GB. GPU: GTX 1650+ hoặc CPU đủ mạnh.',
    tip: 'Cấu hình ổn cho hầu hết case. Thêm Grid hoặc Zoom sẽ nhảy lên hạng máy khỏe hơn.',
  };
}
