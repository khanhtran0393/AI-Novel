/**
 * Phase C — YouTube psych / SEO formula bridge.
 * Packaged paid path prefers cloud authority; free/dev stays local.
 *
 * License one-path: crown IP = cloud_ip_execution (docs/LICENSE_ONE_PATH.md).
 */
import {
  YOUTUBE_PSYCH_55,
  psychLawOrder,
  scoreTitleAgainstPsychLaws,
  detectPsychLawInTitle,
} from '@/lib/youtubePsych55';
import {
  generateYoutubeMetaWithQA,
  pickBestSeoTitle,
} from '@/lib/youtube-safe/seoMeta';
import {
  fetchPinnedLicenseApi,
  isCustomerPackagedRuntime,
  resolvePinnedLicenseApiUrl,
} from '@/lib/commercial/licenseTrust';
import { assertApprovedContentUnlock } from '@/lib/commercial/licenseOnePath';
import { AppError } from '@/lib/errors';

assertApprovedContentUnlock('cloud_ip_execution', 'psychCloudBridge');

export type PsychCloudAction =
  | 'list_laws'
  | 'score_title'
  | 'detect_law'
  | 'law_order'
  | 'pick_seo_title'
  | 'generate_youtube_meta';

export function shouldUseCloudPsychIp(): boolean {
  if (
    process.env.AINOVEL_PSYCH_CLOUD === '0' ||
    process.env.AINOVEL_PSYCH_CLOUD === 'false'
  ) {
    return false;
  }
  if (
    process.env.AINOVEL_PSYCH_CLOUD === '1' ||
    process.env.AINOVEL_PSYCH_CLOUD === 'true'
  ) {
    return true;
  }
  return isCustomerPackagedRuntime();
}

type CloudOpts = {
  entitlementToken?: string | null;
  /** Free path may fall back to local when no paid token. */
  allowLocalFreeFallback?: boolean;
};

async function postCloudPsych<T>(
  action: PsychCloudAction,
  payload: Record<string, unknown>,
  token: string,
): Promise<T> {
  const base = resolvePinnedLicenseApiUrl();
  const endpoint = new URL('/api/cloud/ip/psych', base).toString();
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
      `Psych cloud IP: phản hồi không phải JSON (HTTP ${res.status}).`,
      { code: 'INFRA', status: 502 },
    );
  }
  if (res.status >= 400 || json.success === false || json.ok === false) {
    throw new AppError(
      json.error ||
        json.message ||
        `Psych cloud IP từ chối (HTTP ${res.status}).`,
      { code: res.status === 403 ? 'AUTH' : 'INFRA', status: res.status || 502 },
    );
  }
  if (json.result === undefined) {
    throw new AppError('Psych cloud IP thiếu result.', {
      code: 'INFRA',
      status: 502,
    });
  }
  return json.result;
}

/** Local authority (Vercel host + dev). */
export function runPsychLocal(
  action: PsychCloudAction,
  input: Record<string, unknown>,
): unknown {
  if (action === 'list_laws') {
    return {
      count: YOUTUBE_PSYCH_55.length,
      laws: YOUTUBE_PSYCH_55.map((l) => ({
        id: l.id,
        key: l.key,
        nameVi: l.nameVi,
        thumbBias: l.thumbBias,
      })),
    };
  }
  if (action === 'law_order') {
    return {
      order: psychLawOrder(Number(input.seed) || 0).map((l) => ({
        id: l.id,
        key: l.key,
        nameVi: l.nameVi,
        thumbBias: l.thumbBias,
      })),
    };
  }
  if (action === 'score_title') {
    const title = String(input.title || '');
    return { score: scoreTitleAgainstPsychLaws(title) };
  }
  if (action === 'detect_law') {
    const title = String(input.title || '');
    const law = detectPsychLawInTitle(title);
    return {
      law: law
        ? {
            id: law.id,
            key: law.key,
            nameVi: law.nameVi,
            thumbBias: law.thumbBias,
          }
        : null,
    };
  }
  if (action === 'pick_seo_title') {
    const hook = String(input.hook || '');
    const novelTitle =
      typeof input.novelTitle === 'string' ? input.novelTitle : undefined;
    const opts = (input.opts || {}) as {
      seed?: number;
      usedTitles?: string[];
    };
    return pickBestSeoTitle(hook, novelTitle, opts);
  }
  if (action === 'generate_youtube_meta') {
    return generateYoutubeMetaWithQA({
      script: String(input.script || ''),
      novelTitle:
        typeof input.novelTitle === 'string' ? input.novelTitle : undefined,
      chaptersText:
        typeof input.chaptersText === 'string' ? input.chaptersText : undefined,
      maxRounds:
        typeof input.maxRounds === 'number' ? input.maxRounds : undefined,
      usedTitles: Array.isArray(input.usedTitles)
        ? (input.usedTitles as string[])
        : undefined,
      usedThumbLines: Array.isArray(input.usedThumbLines)
        ? (input.usedThumbLines as string[])
        : undefined,
      chapter:
        typeof input.chapter === 'number' ? input.chapter : undefined,
      visualDna:
        typeof input.visualDna === 'string' ? input.visualDna : undefined,
      characterHint:
        typeof input.characterHint === 'string'
          ? input.characterHint
          : undefined,
    });
  }
  throw new AppError(`Psych action unknown: ${action}`, {
    code: 'VALIDATION',
    status: 400,
  });
}

/**
 * Packaged + token → cloud. Free/no token → local (allowLocalFreeFallback).
 * Packaged + paid without cloud → fail-closed when not free fallback.
 */
export async function runPsychIp(
  action: PsychCloudAction,
  input: Record<string, unknown> = {},
  opts: CloudOpts = {},
): Promise<{ result: unknown; source: 'cloud' | 'local' }> {
  const token = String(opts.entitlementToken || '').trim();
  const useCloud = shouldUseCloudPsychIp() && !!token;
  const freeFallback = opts.allowLocalFreeFallback !== false && !token;

  if (useCloud) {
    try {
      const result = await postCloudPsych(action, input, token);
      return { result, source: 'cloud' };
    } catch (err) {
      if (isCustomerPackagedRuntime() && token && !opts.allowLocalFreeFallback) {
        throw err;
      }
      if (!freeFallback && isCustomerPackagedRuntime()) {
        throw err;
      }
      // Dev or free fallback
    }
  }

  if (
    isCustomerPackagedRuntime() &&
    token &&
    shouldUseCloudPsychIp() &&
    opts.allowLocalFreeFallback === false
  ) {
    throw new AppError(
      'Psych cloud IP không khả dụng — không fallback local trên packaged Pro.',
      { code: 'INFRA', status: 502 },
    );
  }

  return { result: runPsychLocal(action, input), source: 'local' };
}

export type YoutubeMetaPack = ReturnType<typeof generateYoutubeMetaWithQA>;

/**
 * Resolve YouTube meta (hook/title/thumb/desc) via cloud when packaged+token.
 * Free / dev: local formulas.
 */
export async function resolveYoutubeMetaIp(
  params: Parameters<typeof generateYoutubeMetaWithQA>[0],
  opts: CloudOpts = {},
): Promise<{ pack: YoutubeMetaPack; source: 'cloud' | 'local' }> {
  const token = String(opts.entitlementToken || '').trim();
  // Paid packaged: fail-closed without local formula execution
  const paidPackaged = isCustomerPackagedRuntime() && !!token;
  const { result, source } = await runPsychIp(
    'generate_youtube_meta',
    { ...params },
    {
      entitlementToken: token,
      allowLocalFreeFallback: paidPackaged
        ? opts.allowLocalFreeFallback === true
        : true,
    },
  );
  return { pack: result as YoutubeMetaPack, source };
}
