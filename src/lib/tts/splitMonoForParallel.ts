/**
 * Split long mono narration into ordered chunks for parallel TTS + concat.
 * Keeps sentence boundaries when possible so crossfade stays natural.
 */
export function splitMonoForParallel(
  text: string,
  opts?: { maxChars?: number; minChars?: number },
): string[] {
  const raw = String(text || '').replace(/\s+/g, ' ').trim();
  if (!raw) return [];
  const maxChars = Math.max(80, opts?.maxChars ?? 240);
  const minChars = Math.max(40, opts?.minChars ?? 80);
  if (raw.length <= maxChars + 40) return [raw];

  // Split on sentence-ish boundaries (VI/EN)
  const parts = raw
    .split(/(?<=[.!?…。！？]["'”’)\]\s]*)\s+|(?<=[;；])\s+|\n+/)
    .map((s) => s.trim())
    .filter(Boolean);

  if (parts.length <= 1) {
    // Hard wrap long block
    const out: string[] = [];
    for (let i = 0; i < raw.length; i += maxChars) {
      out.push(raw.slice(i, i + maxChars).trim());
    }
    return out.filter(Boolean);
  }

  const chunks: string[] = [];
  let buf = '';
  for (const p of parts) {
    if (!buf) {
      buf = p;
      continue;
    }
    if (buf.length + 1 + p.length <= maxChars) {
      buf = `${buf} ${p}`;
    } else {
      chunks.push(buf);
      buf = p;
    }
  }
  if (buf) chunks.push(buf);

  // Merge tiny trailing chunk into previous
  if (chunks.length >= 2 && chunks[chunks.length - 1].length < minChars) {
    const last = chunks.pop()!;
    chunks[chunks.length - 1] = `${chunks[chunks.length - 1]} ${last}`;
  }

  return chunks.length ? chunks : [raw];
}

/** Use parallel+merge when text is long enough to pay off */
export function shouldParallelSplitMono(
  text: string,
  platform: string,
): boolean {
  const p = (platform || '').toLowerCase();
  const len = String(text || '').trim().length;
  if (len < 320) return false;
  // Omni/Vina: serial only (shared GPU/VRAM guard) — never chunk-parallel
  if (p === 'vina_voice' || p === 'omnivoice_local' || p === 'la_studio') return false;
  return (
    p === 'edge_tts' ||
    p === 'piper' ||
    p === 'vieneu_tts' ||
    p === 'gemini_tts' ||
    p === 'openai_tts'
  );
}
