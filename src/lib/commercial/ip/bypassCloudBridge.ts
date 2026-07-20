/**
 * Phantom-X crown compile — packaged → cloud; dev → local formulas.
 * Client still runs FFmpeg locally with returned filter graph (thin execution).
 */
import {
  buildAudioMaskComplexParts,
  buildBypassGraph,
  buildGridVideoFilterParts,
  normalizeGridLayout,
  normalizeVariance,
  OVERLAY_FILTER,
  resolveActiveFilters,
  type BypassFilterId,
  type BypassGraphBuild,
  type BypassProbeMeta,
  type BypassVarianceOpts,
  type GridLayoutMode,
} from '@/lib/bypass-engine/filters';
import {
  fetchPinnedLicenseApi,
  isCustomerPackagedRuntime,
  resolvePinnedLicenseApiUrl,
} from '@/lib/commercial/licenseTrust';
import { assertApprovedContentUnlock } from '@/lib/commercial/licenseOnePath';
import { AppError } from '@/lib/errors';

assertApprovedContentUnlock('cloud_ip_execution', 'bypassCloudBridge');

export type BypassCompileInput = {
  filters: BypassFilterId[];
  meta: BypassProbeMeta;
  gridLayout?: GridLayoutMode | string;
  variance?: BypassVarianceOpts | null;
  turbo?: boolean;
  useOverlay?: boolean;
};

export type BypassCompileResult = {
  graph: BypassGraphBuild;
  /** filter_complex parts (video + optional overlay labels) */
  fcParts: string[];
  vMap: string | null;
  aMap: string | null;
  activeLabels: string[];
  needsReencode: boolean;
  source: 'local' | 'cloud';
};

export function shouldUseCloudBypassIp(): boolean {
  if (
    process.env.AINOVEL_BYPASS_CLOUD === '0' ||
    process.env.AINOVEL_BYPASS_CLOUD === 'false'
  ) {
    return false;
  }
  if (
    process.env.AINOVEL_BYPASS_CLOUD === '1' ||
    process.env.AINOVEL_BYPASS_CLOUD === 'true'
  ) {
    return true;
  }
  return isCustomerPackagedRuntime();
}

/** Pure crown compile — no disk I/O (safe for Vercel). */
export function compileBypassCrownLocal(input: BypassCompileInput): BypassCompileResult {
  const expanded = resolveActiveFilters(input.filters || []);
  if (expanded.size === 0) {
    throw new AppError('Chọn ít nhất một bộ lọc Phantom-X.', {
      code: 'VALIDATION',
      status: 400,
    });
  }
  const gridLayout = normalizeGridLayout(input.gridLayout);
  const useGrid = gridLayout !== 'none';
  const variance = normalizeVariance(input.variance ?? null);
  const turbo = Boolean(input.turbo);
  const useOverlay = Boolean(input.useOverlay);
  const meta = input.meta;
  if (!meta || !meta.width) {
    throw new AppError('Thiếu probe meta video.', { code: 'VALIDATION', status: 400 });
  }

  const graph = buildBypassGraph(expanded, meta, variance);
  if (!graph.needsReencode && !useOverlay && !useGrid) {
    throw new AppError('Không có bộ lọc nào cần encode. Hãy chọn lại.', {
      code: 'VALIDATION',
      status: 400,
    });
  }

  const fcParts: string[] = [];
  let vMap: string | null = null;
  let aMap: string | null = null;

  const hasVideoPixelFx = graph.hasVideoFx;
  const needsVideoGraph = hasVideoPixelFx || useOverlay || useGrid;
  const hasAudioFx = graph.hasAudioFx;

  if (needsVideoGraph) {
    if (useGrid || hasVideoPixelFx) {
      const grid = buildGridVideoFilterParts(
        expanded,
        meta,
        useGrid ? gridLayout : 'none',
        graph.params,
        { turbo },
      );
      if (grid.usesFilterComplex && grid.parts.length > 0) {
        fcParts.push(...grid.parts);
        if (useOverlay) {
          const last = fcParts[fcParts.length - 1];
          if (last.endsWith('[v_out]')) {
            fcParts[fcParts.length - 1] = last.replace(/\[v_out\]$/, '[v_pre_overlay]');
            fcParts.push(`[v_pre_overlay][1:v]${OVERLAY_FILTER}[v_out]`);
          } else {
            fcParts.push(`[${grid.outLabel}][1:v]${OVERLAY_FILTER}[v_out]`);
          }
          vMap = '[v_out]';
        } else {
          vMap = `[${grid.outLabel}]`;
        }
      } else if (useOverlay) {
        fcParts.push(
          `[0:v]scale=${graph.outW}:${graph.outH}:flags=bicubic[v_filtered]`,
        );
        fcParts.push(`[v_filtered][1:v]${OVERLAY_FILTER}[v_out]`);
        vMap = '[v_out]';
      }
    } else if (useOverlay) {
      fcParts.push(
        `[0:v]scale=${graph.outW}:${graph.outH}:flags=bicubic[v_filtered]`,
      );
      fcParts.push(`[v_filtered][1:v]${OVERLAY_FILTER}[v_out]`);
      vMap = '[v_out]';
    }
  }

  if (hasAudioFx && meta.hasAudio) {
    const audio = buildAudioMaskComplexParts(graph.params);
    fcParts.push(...audio.parts);
    aMap = `[${audio.outLabel}]`;
  }

  return {
    graph,
    fcParts,
    vMap,
    aMap,
    activeLabels: graph.activeLabels,
    needsReencode: graph.needsReencode || useOverlay || useGrid,
    source: 'local',
  };
}

async function postCloudBypass<T>(
  action: string,
  payload: Record<string, unknown>,
  token: string,
): Promise<T> {
  const base = resolvePinnedLicenseApiUrl();
  const endpoint = new URL('/api/cloud/ip/bypass', base).toString();
  const { clientHwidPayload } = await import('@/lib/commercial/ip/cloudIpAuth');
  const hwidPart = await clientHwidPayload();
  const res = await fetchPinnedLicenseApi(endpoint, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-ainovel-entitlement': token,
    },
    body: JSON.stringify({ action, ...hwidPart, ...payload }),
    timeoutMs: 60_000,
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
      `Bypass cloud IP: phản hồi không phải JSON (HTTP ${res.status}).`,
      { code: 'INFRA', status: 502 },
    );
  }
  if (res.status >= 400 || json.success === false || json.ok === false) {
    throw new AppError(
      json.error ||
        json.message ||
        `Bypass cloud IP từ chối (HTTP ${res.status}).`,
      { code: res.status === 403 ? 'AUTH' : 'INFRA', status: res.status || 502 },
    );
  }
  if (json.result === undefined) {
    throw new AppError('Bypass cloud IP thiếu result.', {
      code: 'INFRA',
      status: 502,
    });
  }
  return json.result;
}

export async function resolveBypassCompile(
  input: BypassCompileInput,
  opts: { entitlementToken?: string | null } = {},
): Promise<BypassCompileResult> {
  if (!shouldUseCloudBypassIp()) {
    return compileBypassCrownLocal(input);
  }
  const token = String(opts.entitlementToken || '').trim();
  if (!token) {
    throw new AppError(
      'Phantom-X: packaged build cần license token để compile graph trên cloud.',
      { code: 'AUTH', status: 403 },
    );
  }
  const result = await postCloudBypass<BypassCompileResult>(
    'compile_graph',
    { input },
    token,
  );
  return { ...result, source: 'cloud' };
}
