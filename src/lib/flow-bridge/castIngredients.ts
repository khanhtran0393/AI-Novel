/**
 * B — Auto cast ingredients: match names in prompt/script → concept/face refs (max 3).
 */
import { characterImageKey } from '@/contracts';

export type CastProfileLite = {
  prompt?: string;
  face_ref?: string;
  identity_lock?: string;
};

function stripQuery(p: string): string {
  return String(p || '').trim().split('?')[0] || '';
}

/** Mention check: name appears as whole-ish token in haystack */
function mentionsName(haystack: string, name: string): boolean {
  const h = haystack.normalize('NFC').toLowerCase();
  const n = name.normalize('NFC').toLowerCase().trim();
  if (!n || n.length < 2) return false;
  if (h.includes(n)) return true;
  // first token of multi-word name
  const first = n.split(/\s+/)[0];
  return first.length >= 2 && h.includes(first);
}

/**
 * Resolve up to 3 local/public image paths for ingredients / face-lock.
 * Priority per cast: face_ref → concept sheet (char_Name) → angle sheets.
 */
export function resolveCastIngredientPaths(opts: {
  prompt: string;
  sentence?: string;
  nhan_vat?: string[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  nhan_vat_prompts?: Record<string, any>;
  generatedImages?: Record<string, string>;
  max?: number;
}): string[] {
  const max = Math.max(1, Math.min(3, opts.max ?? 3));
  const text = `${opts.prompt || ''}\n${opts.sentence || ''}`;
  const names = [
    ...(opts.nhan_vat || []),
    ...Object.keys(opts.nhan_vat_prompts || {}),
  ].filter(Boolean);
  const uniqNames = [...new Set(names.map((n) => String(n).normalize('NFC').trim()))];
  const images = opts.generatedImages || {};
  const paths: string[] = [];
  const seen = new Set<string>();

  const push = (raw?: string) => {
    const p = stripQuery(raw || '');
    if (!p || seen.has(p)) return;
    seen.add(p);
    paths.push(p);
  };

  for (const name of uniqNames) {
    if (paths.length >= max) break;
    if (!mentionsName(text, name)) continue;

    const prof = opts.nhan_vat_prompts?.[name];
    if (prof && typeof prof === 'object') {
      push((prof as CastProfileLite).face_ref);
    }
    // Concept sheet from gen map
    push(images[characterImageKey(name)]);
    // Any key starting with char_Name_
    const prefix = characterImageKey(name);
    for (const [k, v] of Object.entries(images)) {
      if (paths.length >= max) break;
      if (k === prefix || k.startsWith(`${prefix}_`)) push(v);
    }
  }

  // If no name match but only 1 cast with concept — still use for consistency
  if (!paths.length && uniqNames.length === 1) {
    const only = uniqNames[0];
    const prof = opts.nhan_vat_prompts?.[only];
    if (prof && typeof prof === 'object') push(prof.face_ref);
    push(images[characterImageKey(only)]);
  }

  return paths.slice(0, max);
}

/** First cast ref for single face-lock image gen */
export function resolvePrimaryCastReference(opts: {
  prompt: string;
  sentence?: string;
  nhan_vat?: string[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  nhan_vat_prompts?: Record<string, any>;
  generatedImages?: Record<string, string>;
}): string | undefined {
  return resolveCastIngredientPaths({ ...opts, max: 1 })[0];
}
