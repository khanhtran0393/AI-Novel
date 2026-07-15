/** Cut at word boundary so title stays a complete, meaningful phrase. */
export function clipAtWordBoundary(text: string, maxChars: number): string {
  const t = (text || '').normalize('NFC').replace(/\s+/g, ' ').trim();
  if (!t) return '';
  if (t.length <= maxChars) return t;
  const slice = t.slice(0, maxChars);
  const sp = slice.lastIndexOf(' ');
  const cut = sp > Math.floor(maxChars * 0.45) ? slice.slice(0, sp) : slice;
  return cut.replace(/[,;:\-–—|]+$/g, '').trim();
}
