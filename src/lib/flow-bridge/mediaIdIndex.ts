/**
 * Persist Flow mediaId per app video/image asset key so Extend works after reload.
 */
import fs from 'fs';
import path from 'path';

type Index = Record<string, { mediaId: string; updatedAt: number }>;

function indexPath(): string {
  const root = process.env.AI_NOVEL_ROOT || process.cwd();
  const dir = path.join(root, 'data', 'flow-bridge');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, 'media-index.json');
}

function load(): Index {
  try {
    const p = indexPath();
    if (!fs.existsSync(p)) return {};
    const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
    return raw && typeof raw === 'object' ? (raw as Index) : {};
  } catch {
    return {};
  }
}

function save(idx: Index): void {
  fs.writeFileSync(indexPath(), JSON.stringify(idx, null, 2), 'utf8');
}

export function setFlowMediaId(assetKey: string, mediaId: string): void {
  const k = String(assetKey || '').trim();
  const mid = String(mediaId || '').trim();
  if (!k || !mid) return;
  const idx = load();
  idx[k] = { mediaId: mid, updatedAt: Date.now() };
  save(idx);
}

export function getFlowMediaId(assetKey: string): string | null {
  const k = String(assetKey || '').trim();
  if (!k) return null;
  const e = load()[k];
  return e?.mediaId || null;
}

export function setFlowMediaIdsFromTask(opts: {
  chapterNum?: number;
  sceneIndex?: number;
  promptIndex?: number;
  kind: 'image' | 'video' | 'extend' | 'edit';
  mediaIds?: string[];
}): void {
  const mid = opts.mediaIds?.[0];
  if (!mid) return;
  if (
    opts.chapterNum == null ||
    opts.sceneIndex == null ||
    opts.promptIndex == null
  ) {
    return;
  }
  const base = `${opts.chapterNum}_${opts.sceneIndex}_${opts.promptIndex}`;
  if (opts.kind === 'image' || opts.kind === 'edit') {
    setFlowMediaId(base, mid);
  } else {
    setFlowMediaId(`${base}_video`, mid);
  }
}
