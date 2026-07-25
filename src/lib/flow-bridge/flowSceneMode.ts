/**
 * Scene-script ↔ Flow model sync (pipeline kịch bản).
 *
 * Goals:
 * - Gen video/ảnh dùng prompt shot đã Gen Prompt Studio (đồng bộ kịch bản).
 * - User chọn nhầm T2V/I2V/R2V/EXT → chặn hoặc auto-align an toàn (không nâng credit).
 * - B10: không đổi provider; không soft-success; không auto-upgrade model đắt.
 */

import {
  findFlowModel,
  resolveFirstLastModel,
  type FlowVideoFamily,
} from './modelCatalog';

/** Preset gắn pipeline: Gen Prompt → Ảnh → Video (I2V). */
export type FlowScenePipelinePreset = {
  id: string;
  label: string;
  description: string;
  imageModel: string;
  videoModel: string;
  /** Ước credit Pro / shot ảnh + video 8s */
  estimateNote: string;
};

export const FLOW_SCENE_PIPELINE_PRESETS: FlowScenePipelinePreset[] = [
  {
    id: 'scene_zero',
    label: 'Pipeline cảnh · 0 cr',
    description:
      'Ảnh Nano Banana 2 Lite + Video I2V Lite Low Priority. Cần Gen Prompt → Gen ảnh → Gen video. Hàng chờ có thể chậm.',
    imageModel: 'NANO_BANANA_2_LITE',
    videoModel: 'veo_3_1_i2v_lite_low_priority',
    estimateNote: 'Ảnh ~0 · Video ~0 (low priority)',
  },
  {
    id: 'scene_fast',
    label: 'Pipeline cảnh · Fast',
    description:
      'Ảnh NARWHAL (Banana 2) + Video I2V Fast. Đồng bộ prompt cảnh; ổn định hơn 0 cr.',
    imageModel: 'NARWHAL',
    videoModel: 'veo_3_1_i2v_s_fast',
    estimateNote: 'Ảnh ~0–1 · Video ~20 cr / 8s (Pro)',
  },
  {
    id: 'scene_quality',
    label: 'Pipeline cảnh · Pro ảnh',
    description:
      'Ảnh GEM_PIX_2 (Banana Pro) + Video I2V Fast. Chất ảnh cao hơn.',
    imageModel: 'GEM_PIX_2',
    videoModel: 'veo_3_1_i2v_s_fast',
    estimateNote: 'Ảnh ~2 · Video ~20 cr / 8s (Pro)',
  },
  {
    id: 'scene_t2v_only',
    label: 'Chỉ text→video (không ảnh)',
    description:
      'Video T2V Fast — không cần gen ảnh. Vẫn cần Gen Prompt (video_prompt).',
    imageModel: 'NARWHAL',
    videoModel: 'veo_3_1_t2v_fast',
    estimateNote: 'Video ~20 cr / 8s · không I2V',
  },
  {
    id: 'scene_first_last',
    label: 'Pipeline Start+End (First+Last)',
    description:
      'Ảnh NARWHAL + Video I2V First+Last. Cần 2 still liền kề: bật «Start+End» trên shot, gen đủ ảnh N và N±1 rồi gen video.',
    imageModel: 'NARWHAL',
    videoModel: 'veo_3_1_i2v_s_fast_fl',
    estimateNote: 'Ảnh ×2 · Video ~20 cr / 8s · first+last',
  },
];

export type FlowSceneVideoContext = {
  videoModel: string;
  hasVideoPrompt: boolean;
  hasStartImage: boolean;
  hasEndImage?: boolean;
  /** Cast / ingredients paths count ≥ 1 */
  hasIngredients?: boolean;
  /**
   * When auto-aligning to I2V, prefer 0-credit low-priority if current model
   * is already 0-cr / lite. Never upgrades credits.
   */
  preferZeroCredit?: boolean;
  /** default true — remap T2V↔I2V when assets make intent clear */
  autoAlign?: boolean;
};

export type FlowSceneModeResult = {
  ok: boolean;
  modelId: string;
  family?: FlowVideoFamily;
  changed: boolean;
  fromModelId?: string;
  action: 'ok' | 'aligned' | 'block';
  /** Toast / preflight message (VN) */
  message?: string;
  blocks: string[];
  hints: string[];
};

/** T2V → I2V sibling (same tier band; never upgrade credit class). */
const T2V_TO_I2V: Record<string, string> = {
  veo_3_1_t2v_fast: 'veo_3_1_i2v_s_fast',
  veo_3_1_t2v_fast_ultra: 'veo_3_1_i2v_s_fast_ultra',
  veo_3_1_lite_t2v: 'veo_3_1_i2v_lite',
};

/** I2V → T2V sibling when no start still. */
const I2V_TO_T2V: Record<string, string> = {
  veo_3_1_i2v_s_fast: 'veo_3_1_t2v_fast',
  veo_3_1_i2v_s_fast_ultra: 'veo_3_1_t2v_fast_ultra',
  veo_3_1_i2v_lite: 'veo_3_1_lite_t2v',
  veo_3_1_i2v_lite_low_priority: 'veo_3_1_lite_t2v',
  veo_3_1_i2v_s_fast_ultra_relaxed: 'veo_3_1_t2v_fast',
  veo_3_1_i2v_s_fast_fl: 'veo_3_1_t2v_fast',
  veo_3_1_i2v_s_fast_ultra_fl: 'veo_3_1_t2v_fast_ultra',
};

function isZeroOrLiteVideo(modelId: string): boolean {
  const m = findFlowModel(modelId);
  if (!m) return false;
  if ((m.credits ?? 1) === 0) return true;
  return m.tier === 'lite' || m.tier === 'free';
}

/**
 * Resolve video model for scene-pipeline gen (prompt kịch bản + stills).
 * - Missing video_prompt → block
 * - Extend / upsample → block (không phải gen shot từ kịch bản)
 * - R2V without image/ingredients → block
 * - I2V without start → auto T2V sibling or block
 * - T2V with start → auto I2V sibling (đồng bộ still + prompt cảnh)
 * - Dual stills → first+last variant when available
 */
export function resolveFlowVideoModelForScene(
  ctx: FlowSceneVideoContext,
): FlowSceneModeResult {
  const blocks: string[] = [];
  const hints: string[] = [];
  const from = String(ctx.videoModel || '').trim();
  const autoAlign = ctx.autoAlign !== false;

  if (!from) {
    return {
      ok: false,
      modelId: '',
      changed: false,
      action: 'block',
      message:
        'Chưa chọn videoModel. Mở Cấu hình đầu ra → chọn model hoặc bấm preset «Pipeline cảnh».',
      blocks: ['missing_video_model'],
      hints: [],
    };
  }

  if (!ctx.hasVideoPrompt) {
    return {
      ok: false,
      modelId: from,
      changed: false,
      action: 'block',
      message:
        'Thiếu video_prompt — chạy Gen Prompt Studio trên cảnh trước. App không gen video từ chữ kịch bản thô và không dùng image_prompt thay thế.',
      blocks: ['no_video_prompt'],
      hints: ['Gen Prompt Studio → rồi Gen ảnh → Gen video'],
    };
  }

  const entry = findFlowModel(from);
  let family = entry?.family as FlowVideoFamily | undefined;
  let modelId = from;
  let changed = false;
  const fromModelId = from;

  // Extend / upsample: not scene shot gen
  if (family === 'extend' || family === 'upsample') {
    return {
      ok: false,
      modelId: from,
      family,
      changed: false,
      action: 'block',
      message:
        family === 'extend'
          ? 'Model Extend chỉ nối clip Flow đã có — không gen shot từ prompt cảnh. Chọn I2V (có ảnh) hoặc T2V, hoặc preset «Pipeline cảnh».'
          : 'Model Upsample chỉ scale video đã gen — không tạo clip mới từ kịch bản. Chọn I2V/T2V hoặc preset «Pipeline cảnh».',
      blocks: [`wrong_family_${family}`],
      hints: ['Preset: Pipeline cảnh · 0 cr / Fast'],
    };
  }

  // R2V needs ref/start
  if (family === 'reference') {
    if (!ctx.hasStartImage && !ctx.hasIngredients) {
      return {
        ok: false,
        modelId: from,
        family,
        changed: false,
        action: 'block',
        message:
          'Model R2V/Ingredients cần ảnh start hoặc ingredients. Gen ảnh shot trước, hoặc đổi sang T2V / preset «Pipeline cảnh». App không gửi job R2V trống (tránh tốn credit / MODEL_MISMATCH).',
        blocks: ['r2v_no_ref'],
        hints: ['Gen ảnh trước · hoặc chọn T2V'],
      };
    }
  }

  // I2V without start image
  if (family === 'i2v' && !ctx.hasStartImage) {
    if (autoAlign) {
      const mapped =
        I2V_TO_T2V[modelId] ||
        (entry?.supportsT2v ? modelId : 'veo_3_1_t2v_fast');
      if (mapped && mapped !== modelId) {
        modelId = mapped;
        changed = true;
        family = findFlowModel(modelId)?.family as FlowVideoFamily | undefined;
        hints.push(
          `Đã chuyển ${fromModelId} → ${modelId} (I2V không có ảnh start → T2V, tránh fail/tốn credit oan).`,
        );
      } else if (!entry?.supportsT2v) {
        return {
          ok: false,
          modelId: from,
          family,
          changed: false,
          action: 'block',
          message:
            'Model I2V cần ảnh start. Gen ảnh shot trước (đồng bộ image_prompt cảnh), hoặc chọn T2V / preset «Chỉ text→video».',
          blocks: ['i2v_no_start'],
          hints: ['Gen ảnh → rồi Gen video I2V'],
        };
      }
    } else {
      return {
        ok: false,
        modelId: from,
        family,
        changed: false,
        action: 'block',
        message:
          'Model I2V cần ảnh start. Gen ảnh trước hoặc chọn model T2V.',
        blocks: ['i2v_no_start'],
        hints: [],
      };
    }
  }

  // T2V with start image → prefer I2V (sync still + scene prompt)
  if (family === 't2v' && ctx.hasStartImage && autoAlign) {
    let mapped = T2V_TO_I2V[modelId];
    if (
      ctx.preferZeroCredit ||
      isZeroOrLiteVideo(fromModelId) ||
      isZeroOrLiteVideo(modelId)
    ) {
      // Prefer 0-cr I2V when user was on lite/zero path — never upgrade
      mapped = 'veo_3_1_i2v_lite_low_priority';
    }
    if (!mapped && entry?.supportsI2v) {
      mapped = modelId;
    }
    if (mapped && mapped !== modelId) {
      // Never upgrade credits: if mapped costs more than source, use lite i2v or keep t2v
      const srcCr = findFlowModel(fromModelId)?.credits ?? 20;
      const dstCr = findFlowModel(mapped)?.credits ?? 20;
      if (dstCr > srcCr && srcCr === 0) {
        mapped = 'veo_3_1_i2v_lite_low_priority';
      } else if (dstCr > srcCr) {
        // Keep same-or-cheaper: use i2v lite if source was lite tier
        const src = findFlowModel(fromModelId);
        if (src?.tier === 'lite') mapped = 'veo_3_1_i2v_lite';
        // else allow same-band map (t2v_fast 20 → i2v_s_fast 20)
      }
      modelId = mapped;
      changed = true;
      family = findFlowModel(modelId)?.family as FlowVideoFamily | undefined;
      hints.push(
        `Đã chuyển ${fromModelId} → ${modelId} (có ảnh start → I2V, khớp still + video_prompt cảnh).`,
      );
    }
  }

  // Dual stills (Start+End = 2 ảnh liền kề) → first+last I2V sibling
  // Product: checkbox Start+End trên shot lấy still N và N±1 — không ép R2V.
  if (ctx.hasEndImage && ctx.hasStartImage) {
    if (family === 'reference') {
      // R2V can use multi-ref; leave model, hint dual stills also work as first+last I2V
      hints.push(
        'Đang chọn R2V + 2 still: app gửi ingredients. Muốn first+last frame → chọn model I2V (preset Start+End).',
      );
    } else {
      const fl = resolveFirstLastModel(modelId, true);
      if (fl && fl !== modelId) {
        hints.push(
          `Start+End (2 ảnh liền kề) → model first+last ${fl}. Gen đủ 2 still trước khi gen video.`,
        );
        modelId = fl;
        changed = true;
        family = findFlowModel(modelId)?.family as FlowVideoFamily | undefined;
      } else if (family === 't2v' && autoAlign) {
        // T2V + dual still → I2V then FL if available
        let mapped = T2V_TO_I2V[modelId] || 'veo_3_1_i2v_s_fast';
        mapped = resolveFirstLastModel(mapped, true) || mapped;
        if (mapped !== modelId) {
          modelId = mapped;
          changed = true;
          family = findFlowModel(modelId)?.family as FlowVideoFamily | undefined;
          hints.push(
            `Start+End → ${modelId} (first+last / I2V). Không dùng T2V thuần khi đã có 2 still.`,
          );
        }
      } else {
        hints.push(
          'Start+End: dùng endpoint first+last (startImage+endImage mediaId). Cần 2 still khác nhau.',
        );
      }
    }
  }

  // OMNI_FLASH: ok with or without image
  if (!family && /omni_flash/i.test(modelId)) {
    family = 'i2v';
  }

  const ok = blocks.length === 0;
  const message = changed
    ? hints[0]
    : ok
      ? undefined
      : blocks.join('; ');

  return {
    ok,
    modelId,
    family,
    changed,
    fromModelId: changed ? fromModelId : undefined,
    action: changed ? 'aligned' : 'ok',
    message,
    blocks,
    hints,
  };
}

/**
 * Hard-assert for callers (throw B10 message). Applies resolve first.
 */
export function assertFlowVideoModelForScene(
  ctx: FlowSceneVideoContext,
): FlowSceneModeResult {
  const r = resolveFlowVideoModelForScene(ctx);
  if (!r.ok) {
    throw new Error(r.message || 'Flow video model không khớp cảnh.');
  }
  return r;
}

/** Recommend model ids from asset state (for UI banner). */
export function recommendFlowSceneModels(input: {
  hasVideoPrompt: boolean;
  hasStartImage: boolean;
  preferZeroCredit?: boolean;
}): {
  presetId: string;
  imageModel: string;
  videoModel: string;
  reason: string;
} {
  if (!input.hasVideoPrompt) {
    return {
      presetId: 'scene_zero',
      imageModel: 'NANO_BANANA_2_LITE',
      videoModel: 'veo_3_1_i2v_lite_low_priority',
      reason:
        'Chưa có video_prompt — chạy Gen Prompt Studio trước, rồi dùng preset Pipeline cảnh.',
    };
  }
  if (input.hasStartImage) {
    if (input.preferZeroCredit) {
      return {
        presetId: 'scene_zero',
        imageModel: 'NANO_BANANA_2_LITE',
        videoModel: 'veo_3_1_i2v_lite_low_priority',
        reason: 'Đã có ảnh start → I2V 0 cr (low priority).',
      };
    }
    return {
      presetId: 'scene_fast',
      imageModel: 'NARWHAL',
      videoModel: 'veo_3_1_i2v_s_fast',
      reason: 'Đã có ảnh start → I2V Fast (đồng bộ still + prompt cảnh).',
    };
  }
  return {
    presetId: 'scene_t2v_only',
    imageModel: 'NARWHAL',
    videoModel: 'veo_3_1_t2v_fast',
    reason:
      'Chưa có ảnh start → T2V, hoặc Gen ảnh trước rồi dùng I2V (khuyến nghị pipeline cảnh).',
  };
}
