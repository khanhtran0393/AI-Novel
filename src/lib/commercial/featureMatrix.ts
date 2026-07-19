/**
 * Free / Trial / Pro product matrix — single source of truth for commercial gates.
 * Server routes still call assertProAccess; UI uses this for gray/disable + copy.
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
  /** Minimum tier required */
  minTier: PlanTier;
  /** Server also enforces via assertProAccess */
  serverGated: boolean;
  freeNote?: string;
};

const TIER_RANK: Record<PlanTier, number> = {
  free: 0,
  trial: 1,
  pro: 2,
};

/** Product catalog for pricing + UI */
export const FEATURE_MATRIX: FeatureAccess[] = [
  {
    id: 'write_chapter',
    label: 'Viết / sửa / đánh giá chương',
    minTier: 'free',
    serverGated: false,
  },
  {
    id: 'outline_ideas',
    label: 'Outline / Ideas / Setup genre',
    minTier: 'free',
    serverGated: false,
  },
  {
    id: 'gen_prompt',
    label: 'Gen Prompt Studio (storyboard)',
    minTier: 'free',
    serverGated: false,
  },
  {
    id: 'gen_image',
    label: 'Gen ảnh (BYOK / Flow)',
    minTier: 'free',
    serverGated: false,
    freeNote: 'Khách tự mang API key / cookie Flow (BYOK)',
  },
  {
    id: 'tts_edge',
    label: 'TTS Edge / Piper cơ bản',
    minTier: 'free',
    serverGated: false,
  },
  {
    id: 'tts_premium',
    label: 'TTS Vina / multi-voice cast',
    minTier: 'trial',
    serverGated: true,
  },
  {
    id: 'gen_video',
    label: 'Gen video',
    minTier: 'trial',
    serverGated: true,
  },
  {
    id: 'export_capcut',
    label: 'Xuất CapCut / FableCut',
    minTier: 'trial',
    serverGated: true,
  },
  {
    id: 'ship_pack',
    label: 'Ship pack đa kênh',
    minTier: 'trial',
    serverGated: true,
  },
  {
    id: 'integrations_pipeline',
    label: 'Integrations pipeline',
    minTier: 'pro',
    serverGated: true,
  },
  {
    id: 'multi_channel',
    label: 'Multi-channel DNA',
    minTier: 'pro',
    serverGated: true,
  },
  {
    id: 'toolbox_labs',
    label: 'Toolbox / Labs (NAV)',
    minTier: 'pro',
    serverGated: true,
  },
  {
    id: 'flow_multi_account',
    label: 'Flow multi-account',
    minTier: 'pro',
    serverGated: true,
  },
  {
    id: 'portable_export',
    label: 'Project portable export',
    minTier: 'free',
    serverGated: false,
  },
];

/** Free TTS platforms — no trial/pro token required on /api/generate-tts */
export const FREE_TTS_PLATFORMS = new Set(['edge_tts', 'piper']);

/** Features that must have a server assert when a matching API exists */
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
  // Dev open / CISO unlimited → Pro full access (NOT VIP badge)
  if (input.openMode || input.ownerUnlimited) return 'pro';
  // Legacy is_vip tokens collapse to Pro (product: Free | Trial | Pro only)
  if (input.is_vip) return 'pro';
  // Trial before paid Pro (store often keeps is_pro=true during trial)
  if (input.is_trial || input.trialActive) return 'trial';
  if (input.is_pro) return 'pro';
  return 'free';
}

/** Map store flags → tier (single mapper for UI). */
export function storeFlagsToTier(flags: {
  is_pro?: boolean;
  is_vip?: boolean;
  is_trial?: boolean;
}): PlanTier {
  return resolvePlanTier({
    is_pro: flags.is_pro,
    is_vip: flags.is_vip,
    is_trial: flags.is_trial,
  });
}

export function canAccessFeature(
  tier: PlanTier,
  featureId: CommercialFeatureId,
): boolean {
  const row = FEATURE_MATRIX.find((f) => f.id === featureId);
  if (!row) return false;
  return tierAtLeast(tier, row.minTier);
}

/** Features that require Pro-equivalent (trial|pro) for UI gray */
export const PRO_EQUIVALENT_FEATURES: CommercialFeatureId[] = FEATURE_MATRIX.filter(
  (f) => f.minTier !== 'free',
).map((f) => f.id);

export const PRICING_PLANS = [
  {
    id: 'free' as const,
    name: 'Free',
    priceLabel: '0đ',
    period: 'mãi',
    blurb: 'Viết kịch bản + prompt + TTS cơ bản + gen ảnh BYOK',
    highlights: [
      'Setup genre / outline / viết chương',
      'Gen Prompt Studio',
      'TTS Edge/Piper',
      'Gen ảnh (tự mang key)',
      'Project portable',
    ],
  },
  {
    id: 'trial' as const,
    name: 'Trial',
    priceLabel: 'Miễn phí',
    period: '3 ngày / 1 máy',
    blurb: 'Mở Pro tạm để đánh giá video + CapCut + ship',
    highlights: [
      'Mọi quyền Free',
      'Gen video',
      'Xuất CapCut',
      'Ship pack',
      'TTS premium / multi-voice',
    ],
  },
  {
    id: 'pro' as const,
    name: 'Pro',
    priceLabel: '478.000đ',
    period: 'tháng · năm 4.780.000đ',
    blurb: 'License gắn HWID + BYOK — CK Techcombank',
    highlights: [
      'Mọi quyền Trial',
      'Integrations pipeline',
      'Multi-channel DNA',
      'Toolbox / Labs',
      'Flow multi-account',
    ],
  },
  {
    id: 'pro_lifetime' as const,
    name: 'Pro trọn đời',
    priceLabel: '8.999.000đ',
    period: 'lifetime',
    blurb: 'Pro trọn đời — CK Techcombank TRAN HUU KHANH',
    highlights: ['Mọi quyền Pro', 'Không gia hạn', 'Hỗ trợ Zalo seller'],
  },
] as const;
