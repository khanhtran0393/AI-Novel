/**
 * OPEN product matrix — every feature is FREE for every user.
 * Commercial gates are neutralized: no tier required anywhere.
 */

export type PlanTier = 'free' | 'trial' | 'pro';

export type CommercialFeatureId =
  | 'write_chapter'
  | 'outline_ideas'
  | 'gen_prompt'
  | 'gen_image'
  | 'tts_edge'
  | 'tts_premium'
  | 'gen_video'
  | 'export_capcut'
  | 'ship_pack'
  | 'integrations_pipeline'
  | 'multi_channel'
  | 'toolbox_labs'
  | 'flow_multi_account'
  | 'portable_export';

export type FeatureAccess = {
  id: CommercialFeatureId;
  label: string;
  /** Minimum tier required (always 'free' — app is fully open) */
  minTier: PlanTier;
  /** Server also enforces via assertProAccess (always false — no gate) */
  serverGated: boolean;
  freeNote?: string;
};

const TIER_RANK: Record<PlanTier, number> = {
  free: 0,
  trial: 1,
  pro: 2,
};

/** Product catalog — every feature open to all users (no paid tier). */
export const FEATURE_MATRIX: FeatureAccess[] = [
  {
    id: 'write_chapter',
    label: 'Viết / sửa / đánh giá chương',
    minTier: 'free',
    serverGated: false,
    freeNote: 'Miễn phí cho mọi user',
  },
  {
    id: 'outline_ideas',
    label: 'Outline / Ideas / Setup genre',
    minTier: 'free',
    serverGated: false,
    freeNote: 'Miễn phí cho mọi user',
  },
  {
    id: 'gen_prompt',
    label: 'Gen Prompt Studio (storyboard)',
    minTier: 'free',
    serverGated: false,
    freeNote: 'Miễn phí cho mọi user',
  },
  {
    id: 'gen_image',
    label: 'Gen ảnh (BYOK / Flow)',
    minTier: 'free',
    serverGated: false,
    freeNote: 'Miễn phí cho mọi user',
  },
  {
    id: 'tts_edge',
    label: 'TTS Edge / Piper cơ bản',
    minTier: 'free',
    serverGated: false,
    freeNote: 'Miễn phí cho mọi user',
  },
  {
    id: 'tts_premium',
    label: 'TTS premium (LA Studio · CapCut · TikTok · Gemini · multi-cast)',
    minTier: 'free',
    serverGated: false,
    freeNote: 'Miễn phí cho mọi user',
  },
  {
    id: 'gen_video',
    label: 'Gen video',
    minTier: 'free',
    serverGated: false,
  },
  {
    id: 'export_capcut',
    label: 'Xuất CapCut',
    minTier: 'free',
    serverGated: false,
  },
  {
    id: 'ship_pack',
    label: 'Ship pack đa kênh',
    minTier: 'free',
    serverGated: false,
  },
  {
    id: 'integrations_pipeline',
    label: 'Integrations pipeline',
    minTier: 'free',
    serverGated: false,
  },
  {
    id: 'multi_channel',
    label: 'Multi-channel DNA',
    minTier: 'free',
    serverGated: false,
  },
  {
    id: 'toolbox_labs',
    label: 'Toolbox / Labs (NAV)',
    minTier: 'free',
    serverGated: false,
  },
  {
    id: 'flow_multi_account',
    label: 'Flow multi-account',
    minTier: 'free',
    serverGated: false,
  },
  {
    id: 'portable_export',
    label: 'Project portable export',
    minTier: 'free',
    serverGated: false,
  },
];

/**
 * ALL TTS platforms are free — no trial/pro token required on /api/generate-tts.
 */
export const FREE_TTS_PLATFORMS = new Set([
  'edge_tts',
  'piper',
  'vina_voice',
  'capcut_tts',
  'tiktok_tts',
  'gemini_tts',
  'la_studio',
  'omni_voice_local',
  'omnivoice_local',
]);

/** Features that must have a server assert when a matching API exists (none — app open) */
export const SERVER_GATED_FEATURES: CommercialFeatureId[] = FEATURE_MATRIX.filter(
  (f) => f.serverGated,
).map((f) => f.id);

export function tierAtLeast(have: PlanTier, need: PlanTier): boolean {
  return TIER_RANK[have] >= TIER_RANK[need];
}

export function resolvePlanTier(input: {
  openMode?: boolean;
  ownerUnlimited?: boolean;
  is_pro?: boolean;
  is_vip?: boolean;
  /** Explicit trial flag (store / claims) — checked BEFORE is_pro */
  is_trial?: boolean;
  trialActive?: boolean;
}): PlanTier {
  // App is fully open — every user gets Pro-equivalent access.
  return 'pro';
}

/** Map store flags → tier (single mapper for UI). */
export function storeFlagsToTier(flags: {
  is_pro?: boolean;
  is_vip?: boolean;
  is_trial?: boolean;
}): PlanTier {
  return resolvePlanTier(flags);

}

export function canAccessFeature(
  tier: PlanTier,
  featureId: CommercialFeatureId,
): boolean {
  const row = FEATURE_MATRIX.find((f) => f.id === featureId);
  if (!row) return false;
  return tierAtLeast(tier, row.minTier);
}

/** Features that require Pro-equivalent (trial|pro) for UI gray — none (app open) */
export const PRO_EQUIVALENT_FEATURES: CommercialFeatureId[] = FEATURE_MATRIX.filter(
  (f) => f.minTier !== 'free',
).map((f) => f.id);

export const PRICING_PLANS = [
  {
    id: 'free' as const,
    name: 'Free',
    priceLabel: '0đ',
    period: 'mãi',
    blurb:
      'Mọi tính năng mở hoàn toàn miễn phí cho mọi user — không giới hạn chương, từ, lượt dùng.',
    highlights: [
      'Viết kịch bản không giới hạn từ/chương',
      'Outline / Ideas · Gen Prompt · không giới hạn lượt',
      'Gen ảnh · Gen video · TTS premium · không giới hạn',
      'Xuất CapCut · Ship pack · Toolbox · Flow multi-account',
    ],
  },
  {
    id: 'trial' as const,
    name: 'Trial',
    priceLabel: 'Miễn phí',
    period: 'mãi',
    blurb: 'Không còn Trial — mọi quyền mở free cho tất cả.',
    highlights: ['Toàn bộ tính năng miễn phí'],
  },
  {
    id: 'pro' as const,
    name: 'Pro',
    priceLabel: 'Miễn phí',
    period: 'mãi',
    blurb: 'Không còn gói trả phí — mọi quyền Pro mở cho mọi user.',
    highlights: [
      'Integrations pipeline',
      'Multi-channel DNA',
      'Toolbox / Labs',
      'Flow multi-account',
    ],
  },
  {
    id: 'pro_lifetime' as const,
    name: 'Pro trọn đời',
    priceLabel: 'Miễn phí',
    period: 'mãi',
    blurb: 'Không còn gói trả phí — toàn bộ miễn phí.',
    highlights: ['Mọi tính năng miễn phí'],
  },
] as const;
