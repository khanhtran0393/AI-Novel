/**
 * Dịch SRT crown prompt/rules — packaged → cloud; dev → local seal/plain.
 */
import {
  buildTranslateBatchPrompt,
  TRANSLATE_ANCHOR,
  translateSoftSplitPatternSource,
} from '@/lib/ttsBatchSrt/translatePromptCrown';
import {
  resolveTranslateRuleDescription,
  clampTranslateChunk,
  DEFAULT_TRANSLATE_CHUNK,
} from '@/lib/ttsBatchSrt/translateRules';
import {
  fetchPinnedLicenseApi,
  isCustomerPackagedRuntime,
  resolvePinnedLicenseApiUrl,
} from '@/lib/commercial/licenseTrust';
import { assertApprovedContentUnlock } from '@/lib/commercial/licenseOnePath';
import { AppError } from '@/lib/errors';

assertApprovedContentUnlock('cloud_ip_execution', 'translateCloudBridge');

export type TranslatePromptCloudInput = {
  langName: string;
  ruleId?: string;
  texts: string[];
  anchor?: string;
};

export type TranslatePromptCloudResult = {
  prompt: string;
  ruleDesc: string;
  anchor: string;
  softSplitPattern: string;
  source: 'local' | 'cloud';
};

export function shouldUseCloudTranslateIp(): boolean {
  if (
    process.env.AINOVEL_TRANSLATE_CLOUD === '0' ||
    process.env.AINOVEL_TRANSLATE_CLOUD === 'false'
  ) {
    return false;
  }
  if (
    process.env.AINOVEL_TRANSLATE_CLOUD === '1' ||
    process.env.AINOVEL_TRANSLATE_CLOUD === 'true'
  ) {
    return true;
  }
  return isCustomerPackagedRuntime();
}

export function buildTranslatePromptLocal(
  input: TranslatePromptCloudInput,
): TranslatePromptCloudResult {
  const ruleDesc = resolveTranslateRuleDescription(input.ruleId);
  const anchor = input.anchor ?? TRANSLATE_ANCHOR;
  const prompt = buildTranslateBatchPrompt({
    langName: input.langName,
    ruleDesc,
    texts: input.texts,
    anchor,
  });
  return {
    prompt,
    ruleDesc,
    anchor,
    softSplitPattern: translateSoftSplitPatternSource,
    source: 'local',
  };
}

async function postCloudTranslate<T>(
  action: string,
  payload: Record<string, unknown>,
  token: string,
): Promise<T> {
  const base = resolvePinnedLicenseApiUrl();
  const endpoint = new URL('/api/cloud/ip/translate', base).toString();
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
      `Translate cloud IP: phản hồi không phải JSON (HTTP ${res.status}).`,
      { code: 'INFRA', status: 502 },
    );
  }
  if (res.status >= 400 || json.success === false || json.ok === false) {
    throw new AppError(
      json.error ||
        json.message ||
        `Translate cloud IP từ chối (HTTP ${res.status}).`,
      { code: res.status === 403 ? 'AUTH' : 'INFRA', status: res.status || 502 },
    );
  }
  if (json.result === undefined) {
    throw new AppError('Translate cloud IP thiếu result.', {
      code: 'INFRA',
      status: 502,
    });
  }
  return json.result;
}

export async function resolveTranslateBatchPrompt(
  input: TranslatePromptCloudInput,
  opts: { entitlementToken?: string | null } = {},
): Promise<TranslatePromptCloudResult> {
  if (!shouldUseCloudTranslateIp()) {
    return buildTranslatePromptLocal(input);
  }
  const token = String(opts.entitlementToken || '').trim();
  if (!token) {
    throw new AppError(
      'Dịch SRT: packaged build cần license token để lấy prompt crown trên cloud.',
      { code: 'AUTH', status: 403 },
    );
  }
  const result = await postCloudTranslate<TranslatePromptCloudResult>(
    'build_prompt',
    { input },
    token,
  );
  return { ...result, source: 'cloud' };
}

export { clampTranslateChunk, DEFAULT_TRANSLATE_CHUNK };
