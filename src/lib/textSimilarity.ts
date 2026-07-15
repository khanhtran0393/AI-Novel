/**
 * Rough reuse / overlap score between source (YouTube) and generated script.
 * Higher % = more similar to source (worse for "viết lại gốc").
 */

function tokenize(text: string): string[] {
  return (text || '')
    .toLowerCase()
    .normalize('NFC')
    .replace(/\[cảnh[^\]]*\]/gi, ' ')
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .map((w) => w.trim())
    .filter((w) => w.length >= 2);
}

function shingles(tokens: string[], n: number): Set<string> {
  const s = new Set<string>();
  if (tokens.length < n) {
    if (tokens.length) s.add(tokens.join(' '));
    return s;
  }
  for (let i = 0; i <= tokens.length - n; i++) {
    s.add(tokens.slice(i, i + n).join(' '));
  }
  return s;
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const x of a) {
    if (b.has(x)) inter++;
  }
  const union = a.size + b.size - inter;
  return union <= 0 ? 0 : inter / union;
}

/** 0–100 integer: overlap of source vs generated (word unigrams + bigrams). */
export function computeTextSimilarityPercent(
  sourceText: string,
  generatedText: string,
): number {
  const src = tokenize(sourceText).slice(0, 4000);
  const gen = tokenize(generatedText).slice(0, 4000);
  if (src.length < 5 || gen.length < 5) return 0;

  const u = jaccard(new Set(src), new Set(gen));
  const bi = jaccard(shingles(src, 2), shingles(gen, 2));
  const tri = jaccard(shingles(src, 3), shingles(gen, 3));
  // Weight multi-grams higher (phrase reuse)
  const score = u * 0.25 + bi * 0.4 + tri * 0.35;
  return Math.max(0, Math.min(100, Math.round(score * 100)));
}

/** Short original-looking title from generated script + optional source title. */
export function suggestTitleFromRewrite(
  generatedContent: string,
  sourceTitle?: string,
): string {
  const plain = (generatedContent || '')
    .replace(/\[CẢNH[^\]]*\]/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const first = plain.split(/(?<=[.!?…])\s+|[\n\r]+/)[0]?.trim() || '';
  if (first.length >= 12 && first.length <= 90) {
    return first.replace(/^[""«]|[""»]$/g, '').trim();
  }
  if (first.length > 90) {
    const cut = first.slice(0, 87).replace(/\s+\S*$/, '');
    return `${cut}…`;
  }
  const st = (sourceTitle || '').trim();
  if (st) {
    // Soft rewrite label: keep theme words, mark as original work line
    return st.length > 80 ? `${st.slice(0, 77)}…` : st;
  }
  return 'Kịch bản viết lại';
}
