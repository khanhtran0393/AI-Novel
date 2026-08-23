/**
 * Phase C — Seedance IP bridge: packaged customer → Vercel license API;
 * Vercel / dev open → local compile (source of truth for the cloud host).
 *
 * Free offline path (no token): local director only.
 * Packaged + paid compile/sequence: fail-closed without cloud.
 *
 * License one-path (docs/LICENSE_ONE_PATH.md): crown IP = cloud_ip_execution.
 * NEVER derive AES/module keys from token text (rejectTokenDerivedContentKey).
 */
import {
  applyDirectorFormulasToPromptPair,
  compileDirectedClip,
  compileSeedancePrompt,
  compileStillImagePrompt,
  type SeedanceCompileInput,
  type SeedanceCompileInputV2,
  type SeedanceCompileResult,
} from '@/lib/integrations/seedance';
import type { PromptShotInput } from '@/lib/integrations/seedanceAuto';
import {
  fetchPinnedLicenseApi,
  isCustomerPackagedRuntime,
  resolvePinnedLicenseApiUrl,
} from '@/lib/commercial/licenseTrust';
import { assertApprovedContentUnlock } from '@/lib/commercial/licenseOnePath';
import { getEntitlementMode } from '@/lib/entitlement';
import { AppError } from '@/lib/errors';

// Policy pin: this module is the approved crown unlock path (not f(token)).
assertApprovedContentUnlock('cloud_ip_execution', 'seedanceCloudBridge');

export type SeedanceCloudAction =
  | 'compile_prompt'
  | 'compile_still'
  | 'apply_director_pair'
  | 'compile_directed_clip'
  | 'apply_sequence';

export function shouldUseCloudSeedanceIp(): boolean {
  // Open mode: never route Seedance to cloud — always local compile
  if (getEntitlementMode() === 'open') return false;

  if (
    process.env.AINOVEL_SEEDANCE_CLOUD === '0' ||
    process.env.AINOVEL_SEEDANCE_CLOUD === 'false'
  ) {
    return false;
  }
  if (
    process.env.AINOVEL_SEEDANCE_CLOUD === '1' ||
    process.env.AINOVEL_SEEDANCE_CLOUD === 'true'
  ) {
    return true;
  }
  // Packaged customer desktop always prefers cloud authority for IP compile
  return isCustomerPackagedRuntime();
}

type CloudOpts = {
  entitlementToken?: string | null;
  /** When true, packaged without token still attempts local (free path only). */
  allowLocalFreeFallback?: boolean;
};

async function postCloudIp<T>(
  action: SeedanceCloudAction,
  payload: Record<string, unknown>,
  token: string,
): Promise<T> {
  const base = resolvePinnedLicenseApiUrl();
  const endpoint = new URL('/api/cloud/ip/seedance', base).toString();
  const { clientHwidPayload } = await import('@/lib/commercial/ip/cloudIpAuth');
  const hwidPart = await clientHwidPayload();
  const res = await fetchPinnedLicenseApi(endpoint, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-ainovel-entitlement': token,
    },
    body: JSON.stringify({ action, ...hwidPart, ...payload }),
    timeoutMs: 45_000,
  });
  let json: {
    success?: boolean;
    ok?: boolean;
    error?: string;
    message?: string;
    result?: T;
  } = {};
  try {
    json = JSON.parse(res.bodyText) as typeof json;
  } catch {
    throw new AppError(
      `Seedance cloud IP: phản hồi không phải JSON (HTTP ${res.status}).`,
      { code: 'INFRA', status: 502 },
    );
  }
  if (res.status >= 400 || json.success === false || json.ok === false) {
    throw new AppError(
      json.error ||
        json.message ||
        `Seedance cloud IP từ chối (HTTP ${res.status}).`,
      { code: res.status === 403 ? 'AUTH' : 'INFRA', status: res.status || 502 },
    );
  }
  if (json.result === undefined) {
    throw new AppError('Seedance cloud IP thiếu result.', {
      code: 'INFRA',
      status: 502,
    });
  }
  return json.result;
}

function requireToken(opts: CloudOpts, label: string): string {
  const t = String(opts.entitlementToken || '').trim();
  if (!t) {
    throw new AppError(
      `${label}: packaged build cần license token để compile Seedance trên cloud. ` +
        'Kích hoạt Pro/Trial hoặc kết nối mạng tới license API.',
      { code: 'AUTH', status: 403 },
    );
  }
  return t;
}

export async function resolveCompileSeedancePrompt(
  input: SeedanceCompileInput | SeedanceCompileInputV2,
  opts: CloudOpts = {},
): Promise<SeedanceCompileResult> {
  if (!shouldUseCloudSeedanceIp()) {
    return compileSeedancePrompt(input);
  }
  const token = requireToken(opts, 'compileSeedancePrompt');
  return postCloudIp<SeedanceCompileResult>('compile_prompt', { input }, token);
}

export async function resolveCompileStillImagePrompt(
  input: Parameters<typeof compileStillImagePrompt>[0],
  opts: CloudOpts = {},
): Promise<SeedanceCompileResult> {
  if (!shouldUseCloudSeedanceIp()) {
    return compileStillImagePrompt(input);
  }
  // Free path: still formula may run local without token
  if (!opts.entitlementToken && opts.allowLocalFreeFallback !== false) {
    return compileStillImagePrompt(input);
  }
  const token = requireToken(opts, 'compileStillImagePrompt');
  return postCloudIp<SeedanceCompileResult>('compile_still', { input }, token);
}

export async function resolveApplyDirectorFormulasToPromptPair(
  input: Parameters<typeof applyDirectorFormulasToPromptPair>[0],
  opts: CloudOpts = {},
): Promise<ReturnType<typeof applyDirectorFormulasToPromptPair>> {
  if (!shouldUseCloudSeedanceIp()) {
    return applyDirectorFormulasToPromptPair(input);
  }
  // Free gen-prompt offline: no token → local (honest barrier for free tier)
  if (!String(opts.entitlementToken || '').trim()) {
    return applyDirectorFormulasToPromptPair(input);
  }
  try {
    return await postCloudIp('apply_director_pair', { input }, opts.entitlementToken!.trim());
  } catch (err) {
    // Paid token but cloud down: fail closed on packaged (no silent local IP bypass for Pro)
    if (isCustomerPackagedRuntime()) throw err;
    return applyDirectorFormulasToPromptPair(input);
  }
}

export async function resolveCompileDirectedClip(
  input: Parameters<typeof compileDirectedClip>[0],
  opts: CloudOpts = {},
): Promise<ReturnType<typeof compileDirectedClip>> {
  if (!shouldUseCloudSeedanceIp()) {
    return compileDirectedClip(input);
  }
  const token = requireToken(opts, 'compileDirectedClip');
  return postCloudIp('compile_directed_clip', { input }, token);
}

export async function resolveApplySequenceToVideoPrompts(
  input: Parameters<
    typeof import('@/lib/integrations/seedanceAuto').applySequenceToVideoPrompts
  >[0],
  opts: CloudOpts = {},
): Promise<{
  prompts: PromptShotInput[];
  projectId: string;
  clipIds: string[];
  sequenceApplied: boolean;
  source?: 'local' | 'cloud';
}> {
  const { applySequenceToVideoPrompts } = await import(
    '@/lib/integrations/seedanceAuto'
  );

  if (!shouldUseCloudSeedanceIp()) {
    return { ...applySequenceToVideoPrompts(input), source: 'local' };
  }

  // Prefer full cloud sequence when token present (no local formula stack execution)
  if (String(opts.entitlementToken || '').trim()) {
    try {
      const result = await postCloudIp<{
        prompts: PromptShotInput[];
        projectId: string;
        clipIds: string[];
        sequenceApplied: boolean;
      }>('apply_sequence', { input }, opts.entitlementToken!.trim());
      return { ...result, source: 'cloud' };
    } catch (err) {
      if (isCustomerPackagedRuntime()) throw err;
      return { ...applySequenceToVideoPrompts(input), source: 'local' };
    }
  }

  // Packaged free without token: sequence is Pro path — hard-fail
  if (isCustomerPackagedRuntime()) {
    throw new AppError(
      'Seedance sequence (Pro IP) trên bản đóng gói cần license + cloud. ' +
        'Kích hoạt Trial/Pro và kết nối license API.',
      { code: 'AUTH', status: 403 },
    );
  }
  return { ...applySequenceToVideoPrompts(input), source: 'local' };
}
