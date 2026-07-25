/**
 * Cache concept / character sheet prompts by profile hash — skip regen when unchanged.
 */

function simpleHash(s: string): string {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}

export function profilePromptCacheKey(
  charName: string,
  profile: Record<string, unknown> | null | undefined,
): string {
  const payload = JSON.stringify({
    n: (charName || '').normalize('NFC'),
    g: profile?.gioi_tinh,
    t: profile?.tuoi,
    d: profile?.dang_nguoi,
    h: profile?.chieu_cao,
    q: profile?.quan_ao,
    pk: profile?.phu_kien,
    th: profile?.thoi_quen,
    st: profile?.so_thich,
    ngoai: profile?.ngoai_hinh,
    dac: profile?.dac_diem_nhan_dang,
    k: profile?.khuet_tat,
    m: profile?.mau_sac,
    p: profile?.prompt,
    poses: profile?.pose_prompts,
  });
  return `char_prompt_${simpleHash(payload)}`;
}

const mem = new Map<string, { prompt: string; at: number }>();

export function getCachedConceptPrompt(key: string): string | null {
  const hit = mem.get(key);
  if (!hit) return null;
  // 24h
  if (Date.now() - hit.at > 86400000) {
    mem.delete(key);
    return null;
  }
  return hit.prompt;
}

export function setCachedConceptPrompt(key: string, prompt: string) {
  if (!key || !prompt?.trim()) return;
  mem.set(key, { prompt: prompt.trim(), at: Date.now() });
  try {
    if (typeof window !== 'undefined') {
      window.sessionStorage.setItem(
        `ainovel_${key}`,
        JSON.stringify({ prompt: prompt.trim(), at: Date.now() }),
      );
    }
  } catch {
    /* ignore */
  }
}

export function getCachedConceptPromptDurable(key: string): string | null {
  const m = getCachedConceptPrompt(key);
  if (m) return m;
  try {
    if (typeof window === 'undefined') return null;
    const raw = window.sessionStorage.getItem(`ainovel_${key}`);
    if (!raw) return null;
    const data = JSON.parse(raw) as { prompt?: string; at?: number };
    if (data.prompt && data.at && Date.now() - data.at < 86400000) {
      mem.set(key, { prompt: data.prompt, at: data.at });
      return data.prompt;
    }
  } catch {
    /* ignore */
  }
  return null;
}
