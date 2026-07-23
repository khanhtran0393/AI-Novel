/**
 * Workspace scene presentation helpers:
 * - Detect body cold-open [CẢNH 0] (often duplicates UI Hook ~30s)
 * - Group body scenes into collapsible «Phần» for denser workspace
 */

export type ParsedScene = { title: string; content: string };

/** True if this parsed row is chapter-body cold open (CẢNH 0), not synthetic preamble. */
export function isBodyColdOpenScene(scene: ParsedScene | undefined | null): boolean {
  if (!scene?.title) return false;
  const t = scene.title.normalize('NFC');
  // Official tag
  if (/\[CẢNH\s*0\s*:/i.test(t)) return true;
  // Loose titles some models emit
  if (/COLD\s*OPEN/i.test(t) && /HOOK|MỞ\s*ĐẦU|MO\s*DAU/i.test(t)) return true;
  return false;
}

/** Synthetic parseScenes preamble before first [CẢNH] (title «MỞ ĐẦU»). */
export function isSyntheticMoDauPreamble(scene: ParsedScene | undefined | null): boolean {
  if (!scene?.title) return false;
  const t = scene.title.normalize('NFC').trim().toUpperCase();
  return t === 'MỞ ĐẦU' || t === 'MO DAU' || t === 'KỊCH BẢN' || t === 'KICH BAN';
}

/**
 * Body scene indices to render as cards (skip CẢNH 0 cold open + empty synthetic MỞ ĐẦU).
 * CẢNH 0 is shown only via Hook UI (index 990) to avoid double-hook.
 */
export function bodySceneIndicesForWorkspace(scenes: ParsedScene[]): number[] {
  const out: number[] = [];
  for (let i = 0; i < scenes.length; i++) {
    const sc = scenes[i];
    if (isBodyColdOpenScene(sc)) continue;
    if (isSyntheticMoDauPreamble(sc) && !(sc.content || '').trim()) continue;
    // Short synthetic preamble → fold into hook; skip separate card
    if (
      isSyntheticMoDauPreamble(sc) &&
      (sc.content || '').trim().split(/\s+/).filter(Boolean).length < 40
    ) {
      continue;
    }
    out.push(i);
  }
  return out;
}

export type WorkspacePhan = {
  /** 1-based phần number */
  phan: number;
  label: string;
  /** parseScenes indices */
  sceneIndices: number[];
};

/**
 * Group body scene indices into «Phần» (~3 scenes each).
 * Labels: «Phần 1 · Cảnh 1–3» using display numbers (1-based among body cards).
 */
export function groupScenesIntoPhan(
  bodyIndices: number[],
  scenes: ParsedScene[],
  perPhan = 3,
): WorkspacePhan[] {
  const size = Math.max(1, Math.min(8, Math.round(perPhan) || 3));
  const groups: WorkspacePhan[] = [];
  for (let g = 0; g < bodyIndices.length; g += size) {
    const chunk = bodyIndices.slice(g, g + size);
    const phan = groups.length + 1;
    const titles = chunk.map((idx) => {
      const t = scenes[idx]?.title || `Cảnh ${idx + 1}`;
      const m = t.match(/CẢNH\s+(\d+)/i);
      return m ? `C${m[1]}` : `C${idx + 1}`;
    });
    const range =
      titles.length === 1
        ? titles[0]
        : `${titles[0]}–${titles[titles.length - 1]}`;
    groups.push({
      phan,
      label: `Phần ${phan} · ${range}`,
      sceneIndices: chunk,
    });
  }
  return groups;
}

/** Prefer hook store text; else body CẢNH 0 content. */
export function resolveHookDisplayContent(
  hookStore: string | undefined | null,
  scenes: ParsedScene[],
): string {
  const fromStore = (hookStore || '').trim();
  if (fromStore) return fromStore;
  const cold = scenes.find((s) => isBodyColdOpenScene(s));
  if (cold?.content?.trim()) return cold.content.trim();
  const pre = scenes.find((s) => isSyntheticMoDauPreamble(s));
  if (pre?.content?.trim()) return pre.content.trim();
  return '';
}

/** Index of first CẢNH 0 in parseScenes list, or -1. */
export function findColdOpenSceneIndex(scenes: ParsedScene[]): number {
  return scenes.findIndex((s) => isBodyColdOpenScene(s));
}
