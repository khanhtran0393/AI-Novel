/**
 * Packaged customer → Vercel /api/cloud/ip/nav-analyzer
 * Dev / open → local crown (navAnalyzerCrown).
 *
 * License one-path: cloud_ip_execution (not f(token)).
 */
import {
  runScript2PromptLocal,
  runStoryboardLocal,
  type Script2PromptInput,
  type StoryboardInput,
} from '@/lib/commercial/ip/navAnalyzerCrown';
import {
  fetchPinnedLicenseApi,
  isCustomerPackagedRuntime,
  resolvePinnedLicenseApiUrl,
} from '@/lib/commercial/licenseTrust';
import { assertApprovedContentUnlock } from '@/lib/commercial/licenseOnePath';
import { AppError } from '@/lib/errors';

assertApprovedContentUnlock('cloud_ip_execution', 'navAnalyzerCloudBridge');

export type NavAnalyzerCloudAction = 'script2prompt' | 'storyboard' | 'capabilities';

export function shouldUseCloudNavAnalyzerIp(): boolean {
  if (
    process.env.AINOVEL_NAV_ANALYZER_CLOUD === '0' ||
    process.env.AINOVEL_NAV_ANALYZER_CLOUD === 'false'
  ) {
    return false;
  }
  if (
    process.env.AINOVEL_NAV_ANALYZER_CLOUD === '1' ||
    process.env.AINOVEL_NAV_ANALYZER_CLOUD === 'true'
  ) {
    return true;
  }
  return isCustomerPackagedRuntime();
}

type CloudOpts = {
  entitlementToken?: string | null;
};

async function postCloudNavAnalyzer<T>(
  action: NavAnalyzerCloudAction,
  payload: Record<string, unknown>,
  token: string,
): Promise<T> {
  const base = resolvePinnedLicenseApiUrl();
  const endpoint = new URL('/api/cloud/ip/nav-analyzer', base).toString();
  const { clientHwidPayload } = await import('@/lib/commercial/ip/cloudIpAuth');
  const hwidPart = await clientHwidPayload();
  const res = await fetchPinnedLicenseApi(endpoint, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-ainovel-entitlement': token,
    },
    body: JSON.stringify({ action, ...hwidPart, ...payload }),
    timeoutMs: 180_000,
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
      `NAV analyzer cloud IP: phản hồi không phải JSON (HTTP ${res.status}).`,
      { code: 'INFRA', status: 502 },
    );
  }
  if (res.status >= 400 || json.success === false || json.ok === false) {
    throw new AppError(
      json.error ||
        json.message ||
        `NAV analyzer cloud IP từ chối (HTTP ${res.status}).`,
      { code: res.status === 403 ? 'AUTH' : 'INFRA', status: res.status || 502 },
    );
  }
  if (json.result === undefined) {
    throw new AppError('NAV analyzer cloud IP thiếu result.', {
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
      `${label}: packaged build cần license token để chạy analyzer trên cloud. ` +
        'Kích hoạt Pro/Trial hoặc kết nối license API.',
      { code: 'AUTH', status: 403 },
    );
  }
  return t;
}

export async function resolveScript2Prompt(
  input: Script2PromptInput,
  opts: CloudOpts = {},
): Promise<Awaited<ReturnType<typeof runScript2PromptLocal>>> {
  if (!shouldUseCloudNavAnalyzerIp()) {
    return runScript2PromptLocal(input);
  }
  const token = requireToken(opts, 'script2prompt');
  const result = await postCloudNavAnalyzer<
    Awaited<ReturnType<typeof runScript2PromptLocal>>
  >('script2prompt', { input }, token);
  return { ...result, source: 'nav-analyzer-cloud' as const } as Awaited<
    ReturnType<typeof runScript2PromptLocal>
  > & { source: 'nav-analyzer-cloud' };
}

export async function resolveStoryboard(
  input: StoryboardInput,
  opts: CloudOpts = {},
): Promise<Awaited<ReturnType<typeof runStoryboardLocal>>> {
  if (!shouldUseCloudNavAnalyzerIp()) {
    return runStoryboardLocal(input);
  }
  const token = requireToken(opts, 'storyboard');
  const result = await postCloudNavAnalyzer<
    Awaited<ReturnType<typeof runStoryboardLocal>>
  >('storyboard', { input }, token);
  return { ...result, source: 'nav-analyzer-cloud' as const } as Awaited<
    ReturnType<typeof runStoryboardLocal>
  > & { source: 'nav-analyzer-cloud' };
}
