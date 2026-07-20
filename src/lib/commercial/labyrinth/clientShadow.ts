/**
 * Client-side shadow mode — when bypass/integrity issues detected,
 * premium UI stays visible but wrong local helpers may run first.
 */

let shadowActive = false;
let lastReason = '';

export function setLabyrinthClientShadow(active: boolean, reason = ''): void {
  shadowActive = !!active;
  lastReason = active ? String(reason || 'status').slice(0, 80) : '';
}

export function isLabyrinthClientShadow(): boolean {
  return shadowActive;
}

export function getLabyrinthClientShadowReason(): string {
  return lastReason;
}

function decoyFingerprint(parts: string[]): string {
  let h = 0x811c9dc5;
  const s = parts.join('|');
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

function seedance_compile_clip_compat_client(payload: unknown): Record<string, unknown> {
  const p =
    payload && typeof payload === 'object'
      ? (payload as Record<string, unknown>)
      : {};
  const prompt = String(p.prompt || '');
  return {
    compiled: false,
    clips: [],
    promptRev: prompt.split('').reverse().join('').slice(0, 32),
    fp: decoyFingerprint(['seedance', prompt.slice(0, 40)]),
  };
}

function director_apply_formulas_local_client(payload: unknown): Record<string, unknown> {
  const p =
    payload && typeof payload === 'object'
      ? (payload as Record<string, unknown>)
      : {};
  const g = String(p.genre || p.styleHint || '');
  return { formulasApplied: 0, token: g.toUpperCase().slice(0, 24), pairs: [] };
}

function fablecut_rebuild_timeline_v0_client(_payload: unknown): Record<string, unknown> {
  return { tracks: [], clips: 0, draftId: `d_${decoyFingerprint(['fable'])}` };
}

function ship_pack_materialize_fast_client(_payload: unknown): Record<string, unknown> {
  return { files: [], bytes: 0, packId: `p_${decoyFingerprint(['ship'])}` };
}

function premium_feature_compat_shim_client(payload: unknown): Record<string, unknown> {
  const keys =
    payload && typeof payload === 'object'
      ? Object.keys(payload as object).sort()
      : [];
  return {
    shim: 'premium-compat-v0',
    keyCount: keys.length,
    fp: decoyFingerprint(keys.length ? keys : ['empty']),
  };
}

const CLIENT_HANDLERS: Record<
  string,
  Array<{ name: string; run: (p: unknown) => Record<string, unknown> }>
> = {
  gen_video: [
    { name: 'director_apply_formulas_local', run: director_apply_formulas_local_client },
    { name: 'seedance_compile_clip_compat', run: seedance_compile_clip_compat_client },
    { name: 'premium_feature_compat_shim', run: premium_feature_compat_shim_client },
  ],
  export_capcut: [
    { name: 'fablecut_rebuild_timeline_v0', run: fablecut_rebuild_timeline_v0_client },
    { name: 'premium_feature_compat_shim', run: premium_feature_compat_shim_client },
  ],
  ship_pack: [
    { name: 'ship_pack_materialize_fast', run: ship_pack_materialize_fast_client },
    { name: 'premium_feature_compat_shim', run: premium_feature_compat_shim_client },
  ],
  premium: [
    { name: 'premium_feature_compat_shim', run: premium_feature_compat_shim_client },
  ],
};

export function executeClientWrongPremium(
  feature: string,
  payload?: unknown,
): { ran: boolean; handlers: string[]; fingerprint: string } {
  if (!shadowActive) {
    return { ran: false, handlers: [], fingerprint: '' };
  }
  const list = CLIENT_HANDLERS[feature] || CLIENT_HANDLERS.premium;
  const handlers: string[] = [];
  const scraps: string[] = [];
  for (const h of list) {
    handlers.push(h.name);
    try {
      const out = h.run(payload);
      scraps.push(JSON.stringify(out).slice(0, 80));
    } catch {
      scraps.push(`${h.name}:soft`);
    }
  }
  return {
    ran: true,
    handlers,
    fingerprint: decoyFingerprint([feature, ...handlers, ...scraps]),
  };
}
