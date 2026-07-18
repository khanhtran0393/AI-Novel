/**
 * P0 — Memory after commit
 * Enrich short-term pack + foreshadow ledger (local extract, no fake AI success).
 * Inject block into WRITE / Gen Prompt context.
 */

import type { ForeshadowEntry, MemoryPackSnapshot } from './types';
import {
  getForeshadowLedger,
  setForeshadowLedger,
  setMemoryPack,
  getMemoryPack,
} from './pipelineStore';

const CURIOSITY_MARKERS =
  /(?:bí mật|chưa biết|sẽ phải|lần sau|mầm mống|gợi mở|còn điều|không ngờ|đáng ngờ|dấu hiệu|manh mối|foreshadow|câu hỏi|tại sao lại)/i;

/**
 * Extract open foreshadow candidates from chapter text (heuristic, capped).
 * B10: empty extract → empty list, never invent plot points.
 */
export function extractForeshadowCandidates(
  chapter: number,
  content: string,
  max = 5,
): ForeshadowEntry[] {
  const text = (content || '').normalize('NFC').trim();
  if (!text) return [];

  const sentences = text
    .split(/(?<=[.!?…])\s+|\n+/)
    .map((s) => s.replace(/\s+/g, ' ').trim())
    .filter((s) => s.length >= 24 && s.length <= 280);

  const hits: ForeshadowEntry[] = [];
  const now = new Date().toISOString();
  for (const s of sentences) {
    if (!CURIOSITY_MARKERS.test(s)) continue;
    hits.push({
      id: `fs_${chapter}_${hits.length}_${s.slice(0, 12).replace(/\s/g, '_')}`,
      chapter,
      text: s,
      status: 'open',
      createdAt: now,
    });
    if (hits.length >= max) break;
  }
  return hits;
}

/** Merge new open entries; drop oldest beyond cap; mark paid if phrase reappears as resolution (simple). */
export function mergeForeshadowLedger(
  existing: ForeshadowEntry[],
  incoming: ForeshadowEntry[],
  latestChapterContent: string,
  cap = 40,
): ForeshadowEntry[] {
  const body = (latestChapterContent || '').toLowerCase();
  const next = existing.map((e) => {
    if (e.status !== 'open') return e;
    // If older open hook text appears again heavily → still open; if "hóa ra" near similar — skip heavy NLP
    if (e.chapter < incoming[0]?.chapter && body.includes(e.text.slice(0, 20).toLowerCase())) {
      return e;
    }
    return e;
  });

  const seen = new Set(next.map((e) => e.text.toLowerCase()));
  for (const e of incoming) {
    const k = e.text.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    next.push(e);
  }

  return next
    .filter((e) => e.status === 'open' || e.status === 'paid')
    .slice(-cap);
}

export function buildForeshadowPromptBlock(entries: ForeshadowEntry[]): string {
  const open = entries.filter((e) => e.status === 'open').slice(-12);
  if (!open.length) return '';
  return (
    '=== FORESHADOW LEDGER (open — phải trả/nuôi, không quên) ===\n' +
    open.map((e) => `- [ch${e.chapter}] ${e.text}`).join('\n')
  );
}

export function buildMemoryPromptBlock(pack: MemoryPackSnapshot): string {
  return [
    pack.scrollSummary
      ? `=== CUỐN CHIẾU ===\n${pack.scrollSummary.slice(0, 4000)}`
      : '',
    pack.shortTerm.length
      ? `=== NGẮN HẠN ===\n${pack.shortTerm.join('\n')}`
      : '',
    pack.characterBible ? `=== NHÂN VẬT ===\n${pack.characterBible}` : '',
    buildForeshadowPromptBlock(pack.foreshadowOpen),
  ]
    .filter(Boolean)
    .join('\n\n');
}

/**
 * Call after successful COMMIT_MEMORY (or engine commit).
 * Updates foreshadow ledger + memory pack snapshot in pipelineStore.
 */
export function enrichMemoryAfterCommit(input: {
  chapter: number;
  content: string;
  scrollSummary: string;
  shortTerm: string[];
  characterNames?: string[];
  characterBible?: string;
}): MemoryPackSnapshot {
  const extracted = extractForeshadowCandidates(input.chapter, input.content);
  const merged = mergeForeshadowLedger(
    getForeshadowLedger(),
    extracted,
    input.content,
  );
  setForeshadowLedger(merged);

  const open = merged.filter((e) => e.status === 'open');
  const bible =
    input.characterBible ||
    (input.characterNames || []).map((n) => `- ${n}`).join('\n');

  const pack: MemoryPackSnapshot = {
    chapter: input.chapter,
    scrollSummary: (input.scrollSummary || '').normalize('NFC'),
    shortTerm: (input.shortTerm || []).map((s) => s.normalize('NFC')),
    foreshadowOpen: open,
    characterBible: bible,
    promptBlock: '',
    updatedAt: new Date().toISOString(),
  };
  pack.promptBlock = buildMemoryPromptBlock(pack);
  setMemoryPack(pack);
  return pack;
}

/** Lorebook inject — append foreshadow without inventing world rules. */
export function lorebookWithMemoryPack(lorebook: string): string {
  const pack = getMemoryPack();
  const fs = pack ? buildForeshadowPromptBlock(pack.foreshadowOpen) : '';
  const base = (lorebook || '').trim();
  if (!fs) return base;
  if (!base) return fs;
  if (base.includes('FORESHADOW LEDGER')) return base;
  return `${base}\n\n${fs}`;
}
