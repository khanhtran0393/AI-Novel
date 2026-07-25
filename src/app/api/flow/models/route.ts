import { NextResponse } from 'next/server';
import {
  FLOW_IMAGE_MODELS,
  FLOW_VIDEO_MODELS,
  FLOW_QUALITY_PRESETS,
  FLOW_VIDEO_DURATIONS_SEC,
  FLOW_DEFAULT_VIDEO_DURATION_SEC,
  FLOW_VIDEO_ASPECT_RATIOS,
  FLOW_IMAGE_ASPECT_RATIOS,
  FLOW_CATALOG_META,
  estimateTaskCredits,
  findFlowModel,
  listFlowVideoModelsForUi,
  listFlowImageModelsForUi,
  getModelDurations,
  clampFlowVideoDuration,
  resolveFlowImageModelName,
  flowModelUserHint,
  flowVideoFamilyBadge,
  flowVideoFamilyBadgeVi,
  flowModelGooglePackage,
  formatFlowCreditsPart,
  formatFlowModelDropdownLabel,
  flowVideoModelRequirements,
} from '@/lib/flow-bridge/modelCatalog';
import { loadFlowOps } from '@/lib/flow-bridge/opsStore';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function serializeModel(m: (typeof FLOW_VIDEO_MODELS)[number]) {
  const userHint = flowModelUserHint(m);
  const familyBadge = flowVideoFamilyBadge(m.family);
  const idLow = String(m.id || '').toLowerCase();
  const isFl =
    idLow.endsWith('_fl') ||
    idLow.includes('_fl_') ||
    idLow.includes('first_last') ||
    idLow.includes('start_end') ||
    String(m.label || '').toLowerCase().includes('2 khung');
  const familyBadgeVi =
    m.kind === 'video'
      ? flowVideoFamilyBadgeVi(m.family, { isFirstLast: isFl })
      : undefined;
  const googlePackage =
    m.kind === 'video' ? flowModelGooglePackage(m) : undefined;
  const creditsLabel = formatFlowCreditsPart(m);
  const dropdownLabel = formatFlowModelDropdownLabel(m);
  const requirements =
    m.kind === 'video' ? flowVideoModelRequirements(m.id) : undefined;
  return {
    id: m.id,
    label: m.label,
    /** Full option text for Media Config select */
    dropdownLabel,
    kind: m.kind,
    credits: m.credits,
    creditsUltra: m.creditsUltra ?? m.credits,
    creditsLabel,
    tier: m.tier,
    family: m.family,
    familyBadge: familyBadge || undefined,
    familyBadgeVi: familyBadgeVi || undefined,
    googlePackage,
    durationsSec: m.durationsSec,
    defaultDurationSec: m.defaultDurationSec,
    nativeScale: m.nativeScale,
    portraitVariant: m.portraitVariant,
    firstLastVariant: m.firstLastVariant,
    supportsIngredients: m.supportsIngredients,
    supportsExtend: m.supportsExtend,
    supportsI2v: m.supportsI2v,
    supportsT2v: m.supportsT2v,
    supportsFirstLast: m.supportsFirstLast,
    paygateNote: m.paygateNote,
    note: m.note,
    /** VN hint for Cấu hình đầu ra */
    userHint,
    /** Yêu cầu + cách dùng khi chọn model (UI Cấu hình đầu ra) */
    requirements,
    uiHidden: m.uiHidden,
  };
}

export async function GET() {
  const ops = loadFlowOps();
  const imageModels = listFlowImageModelsForUi().map(serializeModel);
  const videoModels = listFlowVideoModelsForUi().map(serializeModel);

  return NextResponse.json({
    meta: FLOW_CATALOG_META,
    imageModels,
    videoModels,
    /** Full matrix including portrait-only / hidden keys (for advanced tools) */
    allVideoModels: FLOW_VIDEO_MODELS.map(serializeModel),
    allImageModels: FLOW_IMAGE_MODELS.map(serializeModel),
    qualityPresets: FLOW_QUALITY_PRESETS,
    videoDurationsSec: [...FLOW_VIDEO_DURATIONS_SEC],
    defaultVideoDurationSec: FLOW_DEFAULT_VIDEO_DURATION_SEC,
    videoAspectRatios: FLOW_VIDEO_ASPECT_RATIOS,
    imageAspectRatios: FLOW_IMAGE_ASPECT_RATIOS,
    defaultQuality: ops.defaultQuality,
    defaults: {
      imageModel: FLOW_IMAGE_MODELS[0]?.id,
      videoModel: 'OMNI_FLASH',
      videoDurationSec: FLOW_DEFAULT_VIDEO_DURATION_SEC,
      nativeVideoScale: '720p',
    },
    creditNote: FLOW_CATALOG_META.creditNote,
  });
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const kind = body.kind === 'video' ? 'video' : 'image';
  const modelId = body.modelId ? String(body.modelId) : undefined;
  const resolvedImage =
    kind === 'image' ? resolveFlowImageModelName(modelId) : modelId;
  const durationSec =
    kind === 'video'
      ? clampFlowVideoDuration(
          body.durationSec != null ? Number(body.durationSec) : undefined,
          modelId,
        )
      : undefined;
  const paygate = body.paygate === 'ultra' ? 'ultra' : 'pro';
  const credits = estimateTaskCredits({
    kind,
    modelId: resolvedImage,
    imageCount: body.imageCount != null ? Number(body.imageCount) : 1,
    quality: body.quality ? String(body.quality) : loadFlowOps().defaultQuality,
    durationSec,
    paygate,
  });
  const model = findFlowModel(resolvedImage || '') || null;
  return NextResponse.json({
    model: model ? serializeModel(model) : null,
    resolvedModelId: resolvedImage || null,
    durationSec: durationSec ?? null,
    durationsSec: kind === 'video' ? getModelDurations(modelId) : null,
    estimatedCredits: credits,
    paygate,
    creditNote: FLOW_CATALOG_META.creditNote,
  });
}
