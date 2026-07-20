/**
 * Phase C — IP / authority catalog.
 *
 * Maps “crown jewel” logic to local path vs cloud authority.
 * Does not move code by itself; gates + docs + future cloud extraction use this list.
 */

import type { CommercialFeatureId } from '@/lib/commercial/featureMatrix';

export type IpCloudStatus =
  /** Must never ship private material; issue/revoke only on Vercel/seller */
  | 'cloud_authority'
  /** Still local in this release; cataloged for future server extraction */
  | 'cataloged_for_cloud'
  /** Intentional local (user data / offline UX) */
  | 'local_ok';

export type IpCatalogEntry = {
  id: string;
  title: string;
  /** Repo path hint (documentation / audits) */
  localPathHint: string;
  cloudStatus: IpCloudStatus;
  /** Related commercial features when applicable */
  features?: CommercialFeatureId[];
  notes: string;
};

/**
 * Single source of truth for “what belongs on Vercel vs desktop”.
 */
export const IP_CATALOG: IpCatalogEntry[] = [
  {
    id: 'license_one_path',
    title: 'License one-path policy (ticket · ledger · crown IP)',
    localPathHint:
      'src/lib/commercial/licenseOnePath.ts + docs/LICENSE_ONE_PATH.md',
    cloudStatus: 'cloud_authority',
    notes:
      'Canonical policy: private sign-only; token=ticket not AES; crown via cloud_ip_execution. Status field onePath.',
  },
  {
    id: 'license_issue',
    title: 'Issue entitlement / activation codes',
    localPathHint: 'src/lib/entitlement.ts + seller CLI /api/entitlement/*',
    cloudStatus: 'cloud_authority',
    notes: 'Private Ed25519 key + admin issue — Vercel/Telegram bridge only',
  },
  {
    id: 'license_revoke',
    title: 'Revoke / trial anti-abuse / orders',
    localPathHint: 'src/lib/cloud/licenseBridge.ts + Supabase',
    cloudStatus: 'cloud_authority',
    notes: 'Central DB + admin; desktop only verifies + heartbeat',
  },
  {
    id: 'license_verify_offline',
    title: 'Offline token verify (public key)',
    localPathHint: 'src/lib/entitlement.ts',
    cloudStatus: 'local_ok',
    notes: 'Public verify + HWID — required for offline Pro',
  },
  {
    id: 'heartbeat',
    title: 'Online heartbeat / revoke cache',
    localPathHint: 'src/lib/commercial/licenseHeartbeat.ts',
    cloudStatus: 'cloud_authority',
    features: ['gen_video', 'export_capcut', 'ship_pack', 'integrations_pipeline'],
    notes: 'Probe /api/cloud/license/verify; grace offline on desktop',
  },
  {
    id: 'seedance_formula',
    title: 'Seedance / video director formulas',
    localPathHint:
      'src/lib/integrations/seedance.ts + src/lib/commercial/ip/seedanceCloudBridge.ts',
    cloudStatus: 'cloud_authority',
    features: ['gen_video', 'integrations_pipeline'],
    notes:
      'Packaged: POST /api/cloud/ip/seedance on Vercel (pinned host). Dev/open: local. Free without token: local director only.',
  },
  {
    id: 'director_formulas',
    title: 'Director / shot graph formulas',
    localPathHint: 'imagePrompt handler + seedanceCloudBridge',
    cloudStatus: 'cloud_authority',
    features: ['gen_prompt', 'integrations_pipeline'],
    notes:
      'Paid token + packaged → cloud apply_director_pair; free offline → local still/pair',
  },
  {
    id: 'youtube_psych',
    title: 'YouTube psych / SEO formulas',
    localPathHint:
      'src/lib/youtubePsych55.ts + src/lib/commercial/ip/psychCloudBridge.ts',
    cloudStatus: 'cloud_authority',
    features: ['multi_channel'],
    notes:
      'Packaged + multi_channel: POST /api/cloud/ip/psych (pinned). Dev/free: local formulas.',
  },
  {
    id: 'quality_gate',
    title: 'Pipeline quality gate',
    localPathHint: 'src/lib/pipeline/qualityGate.ts',
    cloudStatus: 'local_ok',
    notes: 'Product UX; not a license boundary',
  },
  {
    id: 'user_story_canvas',
    title: 'User novel / scene / media paths',
    localPathHint: 'src/store + disk exports',
    cloudStatus: 'local_ok',
    notes: 'User content stays on machine unless explicit sync product',
  },
  {
    id: 'nav_toolbox',
    title: 'NAV toolbox gateway',
    localPathHint: 'python_core/gateway + /api/navtools',
    cloudStatus: 'local_ok',
    features: ['toolbox_labs'],
    notes: 'Local process; Pro gate + heartbeat; no private license secrets',
  },
];

/**
 * Paid features that get stricter online revalidate on packaged builds.
 * Expanded mesh: trial revenue features + Pro IP features.
 */
export const STRICT_ONLINE_FEATURES: CommercialFeatureId[] = [
  'tts_premium',
  'gen_video',
  'export_capcut',
  'ship_pack',
  'integrations_pipeline',
  'toolbox_labs',
  'multi_channel',
  'flow_multi_account',
];

export function listIpByStatus(status: IpCloudStatus): IpCatalogEntry[] {
  return IP_CATALOG.filter((e) => e.cloudStatus === status);
}

export function isStrictOnlineFeature(featureId: CommercialFeatureId): boolean {
  return STRICT_ONLINE_FEATURES.includes(featureId);
}
