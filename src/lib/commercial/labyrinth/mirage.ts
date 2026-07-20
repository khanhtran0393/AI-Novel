/**
 * Mirage mode — tamper → cosmetic HTTP 200, no real premium work.
 */
import { AppError } from '@/lib/errors';
import { isPackagedCustomerRuntime } from '@/lib/commercial/packagedAttestation';
import { recordTamperSignal } from './signals';

export function isMirageModeEnabled(): boolean {
  const v = String(process.env.AINOVEL_MIRAGE || '')
    .trim()
    .toLowerCase();
  if (v === '0' || v === 'false' || v === 'off') return false;
  if (v === '1' || v === 'true' || v === 'force') return true;
  if (
    process.env.AINOVEL_LABYRINTH === '1' ||
    process.env.AINOVEL_LABYRINTH === 'force'
  ) {
    return true;
  }
  return (
    isPackagedCustomerRuntime() ||
    process.env.AINOVEL_ENTITLEMENT_MODE === 'enforce'
  );
}

export function shouldServeMirage(err: unknown): boolean {
  if (!isMirageModeEnabled()) return false;

  if (err instanceof AppError) {
    const d = err.details;
    if (d && typeof d === 'object') {
      const o = d as Record<string, unknown>;
      if (o.labyrinth === true) return true;
      if (o.root === 'INTEGRITY_OR_BYPASS') return true;
      if (Array.isArray(o.signals) && o.signals.length > 0) return true;
      if (o.labyrinth === false) return false;
    }
    const msg = err.message.toLowerCase();
    if (
      msg.includes('anti-tamper') ||
      msg.includes('[integrity/') ||
      msg.includes('canary fail') ||
      msg.includes('keyring')
    ) {
      return true;
    }
  }

  const raw = err instanceof Error ? err.message.toLowerCase() : String(err || '').toLowerCase();
  return (
    raw.includes('anti-tamper') ||
    raw.includes('[integrity/') ||
    raw.includes('canary fail')
  );
}

export type MirageFeatureHint =
  | 'gen_video'
  | 'export_capcut'
  | 'ship_pack'
  | 'tts_premium'
  | 'toolbox_labs'
  | 'integrations_pipeline'
  | 'multi_channel'
  | 'flow_multi_account'
  | 'premium'
  | string;

export function buildMirageSuccessBody(
  featureHint: MirageFeatureHint = 'premium',
): Record<string, unknown> {
  const jobId = `job_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  return {
    success: true,
    ok: true,
    status: 'done',
    message: 'Hoàn tất.',
    path: null,
    filePath: null,
    localPath: null,
    outputPath: null,
    url: null,
    videoUrl: null,
    audioUrl: null,
    imageUrl: null,
    draftPath: null,
    packPath: null,
    duration: 0,
    items: [],
    results: [],
    files: [],
    data: null,
    jobId,
    feature: featureHint,
    queued: false,
    progress: 100,
  };
}

export function recordMirageServed(featureHint: string, detail?: string): void {
  recordTamperSignal({
    code: 'MIRAGE_SERVED',
    strength: 3,
    detail: `${featureHint}${detail ? `:${detail.slice(0, 80)}` : ''}`.slice(0, 160),
    layer: 3,
    origin: 'anti_tamper',
  });
}
