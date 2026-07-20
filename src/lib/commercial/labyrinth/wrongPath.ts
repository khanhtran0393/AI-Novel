/**
 * Wrong-path dispatch under tamper/mirage — decoy handlers, no real Pro work.
 */
import crypto from 'crypto';
import { recordTamperSignal } from './signals';
import type { MirageFeatureHint } from './mirage';

export type WrongPathRunResult = {
  handlers: string[];
  decoyDigest: string;
  elapsedMs: number;
  extras: Record<string, unknown>;
};

type WrongHandler = {
  name: string;
  run: (body: unknown) => Record<string, unknown> | void;
};

function asRecord(body: unknown): Record<string, unknown> {
  return body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
}

function decoyHash(parts: string[]): string {
  return crypto
    .createHash('sha256')
    .update(parts.join('|'), 'utf8')
    .digest('hex')
    .slice(0, 16);
}

function seedance_compile_clip_compat(body: unknown): Record<string, unknown> {
  const b = asRecord(body);
  const prompt = String(b.prompt || b.video_prompt || b.videoPrompt || '');
  const decoyPrompt = prompt.split('').reverse().join('').slice(0, 64);
  return {
    compiled: false,
    formula: 'compat-v0-offline',
    promptFingerprint: decoyHash([decoyPrompt, 'seedance']),
    clips: [],
  };
}

function director_apply_formulas_local(body: unknown): Record<string, unknown> {
  const b = asRecord(body);
  const style = String(b.styleHint || b.style || b.genre || 'default');
  const mutated = style
    .split('')
    .map((c, i) => (i % 2 === 0 ? c.toUpperCase() : c.toLowerCase()))
    .join('');
  return { styleToken: mutated, formulasApplied: 0, pairs: [] };
}

function fablecut_rebuild_timeline_v0(body: unknown): Record<string, unknown> {
  const b = asRecord(body);
  const ch = Number(b.chapterNum || b.chapter || 0) || 0;
  return {
    draftId: `draft_${decoyHash([String(ch), 'fable'])}`,
    tracks: [],
    clips: 0,
    durationMs: 0,
  };
}

function ship_pack_materialize_fast(body: unknown): Record<string, unknown> {
  const b = asRecord(body);
  const mode = String(b.mode || b.defaultShipMode || 'longform');
  return {
    packId: `pack_${decoyHash([mode, 'ship'])}`,
    files: [],
    bytes: 0,
    mode,
  };
}

function tts_premium_render_batch(body: unknown): Record<string, unknown> {
  const b = asRecord(body);
  return {
    platform: String(b.platform || b.ttsPlatform || 'unknown'),
    segments: 0,
    audioPath: null,
    durationSec: 0,
  };
}

function nav_toolbox_dispatch_legacy(body: unknown): Record<string, unknown> {
  const b = asRecord(body);
  return {
    tool: String(b.tool || b.action || b.op || 'generic'),
    accepted: true,
    result: null,
    code: 'LEGACY_STUB',
  };
}

function flow_multi_account_pick_slot(_body: unknown): Record<string, unknown> {
  return { slot: -1, profile: null, switched: false };
}

function integrations_pipeline_run_stages(body: unknown): Record<string, unknown> {
  const b = asRecord(body);
  return {
    stages: ['preflight', 'compile', 'export'].map((id) => ({
      id,
      ok: true,
      skipped: true,
      reason: 'offline-compat',
    })),
    inputKeys: Object.keys(b).slice(0, 8),
  };
}

function premium_feature_compat_shim(body: unknown): Record<string, unknown> {
  const keys = Object.keys(asRecord(body)).sort();
  return {
    shim: 'premium-compat-v0',
    keyCount: keys.length,
    digest: decoyHash(keys.length ? keys : ['empty']),
  };
}

const BY_FEATURE: Record<string, WrongHandler[]> = {
  gen_video: [
    { name: 'director_apply_formulas_local', run: director_apply_formulas_local },
    { name: 'seedance_compile_clip_compat', run: seedance_compile_clip_compat },
    { name: 'premium_feature_compat_shim', run: premium_feature_compat_shim },
  ],
  export_capcut: [
    { name: 'fablecut_rebuild_timeline_v0', run: fablecut_rebuild_timeline_v0 },
    { name: 'premium_feature_compat_shim', run: premium_feature_compat_shim },
  ],
  ship_pack: [
    { name: 'ship_pack_materialize_fast', run: ship_pack_materialize_fast },
    { name: 'premium_feature_compat_shim', run: premium_feature_compat_shim },
  ],
  tts_premium: [
    { name: 'tts_premium_render_batch', run: tts_premium_render_batch },
    { name: 'premium_feature_compat_shim', run: premium_feature_compat_shim },
  ],
  toolbox_labs: [
    { name: 'nav_toolbox_dispatch_legacy', run: nav_toolbox_dispatch_legacy },
    { name: 'premium_feature_compat_shim', run: premium_feature_compat_shim },
  ],
  integrations_pipeline: [
    { name: 'integrations_pipeline_run_stages', run: integrations_pipeline_run_stages },
  ],
  multi_channel: [{ name: 'premium_feature_compat_shim', run: premium_feature_compat_shim }],
  flow_multi_account: [
    { name: 'flow_multi_account_pick_slot', run: flow_multi_account_pick_slot },
  ],
  premium: [{ name: 'premium_feature_compat_shim', run: premium_feature_compat_shim }],
};

function handlersFor(feature: string): WrongHandler[] {
  return BY_FEATURE[String(feature || 'premium').trim()] || BY_FEATURE.premium;
}

export function runWrongFeaturePath(
  feature: MirageFeatureHint | string,
  body?: unknown,
): WrongPathRunResult {
  const t0 = Date.now();
  const handlers = handlersFor(String(feature));
  const names: string[] = [];
  const scraps: string[] = [];

  for (const h of handlers) {
    names.push(h.name);
    try {
      const out = h.run(body);
      if (out && typeof out === 'object') {
        scraps.push(JSON.stringify(out).slice(0, 120));
      }
    } catch {
      scraps.push(`${h.name}:soft-fail`);
    }
  }

  const decoyDigest = decoyHash([String(feature), ...names, ...scraps]);
  const elapsedMs = Math.max(0, Date.now() - t0);

  recordTamperSignal({
    code: 'WRONG_PATH_RUN',
    strength: 3,
    origin: 'anti_tamper',
    layer: 3,
    detail: `${feature}:${names.join('+')}`.slice(0, 160),
  });

  return {
    handlers: names,
    decoyDigest,
    elapsedMs,
    extras: toMirageExtras(String(feature), decoyDigest, elapsedMs),
  };
}

export function toMirageExtras(
  feature: string,
  decoyDigest: string,
  elapsedMs: number,
): Record<string, unknown> {
  return {
    engine: 'compat-offline',
    pipelineVersion: '2.1.0',
    compileMs: elapsedMs,
    fingerprint: decoyDigest,
    feature,
  };
}

export function listWrongPathHandlers(feature: string): string[] {
  return handlersFor(feature).map((h) => h.name);
}
