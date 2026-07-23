/**
 * Durable LA Studio / Omni user-clone library (disk).
 * Survives app restart — unlike LA Studio API session-only voices.
 *
 * Layout: data/la-studio/user-clones/<id>/
 *   meta.json + ref.wav|mp3
 */
import fs from 'fs';
import path from 'path';
import { randomBytes } from 'crypto';

export type LaStudioUserClone = {
  id: string;
  name: string;
  filename: string;
  language: string;
  createdAt: string;
  /** LA Studio API voice id if registered this session */
  laStudioApiId?: string;
  /** Omni profile id when registered to OmniVoice */
  omniProfileId?: string;
  /** Original upload name */
  sourceName?: string;
  bytes?: number;
};

const ROOT_REL = path.join('data', 'la-studio', 'user-clones');

export function getLaStudioClonesRoot(cwd = process.cwd()): string {
  const root = path.join(cwd, ROOT_REL);
  fs.mkdirSync(root, { recursive: true });
  return root;
}

function safeId(raw: string): string {
  return String(raw || '')
    .normalize('NFC')
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .slice(0, 64);
}

export function isLaStudioUserCloneId(id: string): boolean {
  const s = String(id || '').trim();
  return /^lsc_[a-zA-Z0-9_-]+$/i.test(s);
}

function metaPath(dir: string): string {
  return path.join(dir, 'meta.json');
}

function readMeta(dir: string): LaStudioUserClone | null {
  const p = metaPath(dir);
  if (!fs.existsSync(p)) return null;
  try {
    const j = JSON.parse(fs.readFileSync(p, 'utf8')) as LaStudioUserClone;
    if (!j?.id || !j?.filename) return null;
    return j;
  } catch {
    return null;
  }
}

export function resolveCloneDir(
  id: string,
  cwd = process.cwd(),
): string | null {
  const safe = safeId(id);
  if (!safe) return null;
  const dir = path.join(getLaStudioClonesRoot(cwd), safe);
  return fs.existsSync(dir) ? dir : null;
}

export function resolveCloneAudioPath(
  id: string,
  cwd = process.cwd(),
): { meta: LaStudioUserClone; path: string } | null {
  const dir = resolveCloneDir(id, cwd);
  if (!dir) return null;
  const meta = readMeta(dir);
  if (!meta) return null;
  const audio = path.join(dir, meta.filename);
  if (!fs.existsSync(audio)) return null;
  return { meta, path: audio };
}

export function listLaStudioUserClones(
  cwd = process.cwd(),
): LaStudioUserClone[] {
  const root = getLaStudioClonesRoot(cwd);
  let names: string[] = [];
  try {
    names = fs.readdirSync(root);
  } catch {
    return [];
  }
  const out: LaStudioUserClone[] = [];
  for (const name of names) {
    const dir = path.join(root, name);
    try {
      if (!fs.statSync(dir).isDirectory()) continue;
    } catch {
      continue;
    }
    const meta = readMeta(dir);
    if (!meta) continue;
    const audio = path.join(dir, meta.filename);
    if (!fs.existsSync(audio)) continue;
    out.push({
      ...meta,
      bytes: (() => {
        try {
          return fs.statSync(audio).size;
        } catch {
          return meta.bytes;
        }
      })(),
    });
  }
  out.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  return out;
}

export function getLaStudioUserClone(
  id: string,
  cwd = process.cwd(),
): LaStudioUserClone | null {
  const hit = resolveCloneAudioPath(id, cwd);
  return hit?.meta || null;
}

/**
 * Save user clone sample to disk. Id always `lsc_<hex>`.
 */
export function saveLaStudioUserClone(input: {
  name: string;
  audioBuffer: Buffer;
  ext?: string;
  language?: string;
  sourceName?: string;
  laStudioApiId?: string;
  omniProfileId?: string;
  cwd?: string;
}): LaStudioUserClone {
  const cwd = input.cwd || process.cwd();
  const id = `lsc_${Date.now().toString(36)}_${randomBytes(3).toString('hex')}`;
  const extRaw = (input.ext || '.wav').toLowerCase();
  const ext = ['.wav', '.mp3', '.m4a', '.flac', '.ogg', '.webm'].includes(extRaw)
    ? extRaw
    : '.wav';
  const filename = `ref${ext}`;
  const dir = path.join(getLaStudioClonesRoot(cwd), id);
  fs.mkdirSync(dir, { recursive: true });
  const audioPath = path.join(dir, filename);
  fs.writeFileSync(audioPath, input.audioBuffer);

  const meta: LaStudioUserClone = {
    id,
    name: String(input.name || id).trim().normalize('NFC') || id,
    filename,
    language: input.language || 'vi',
    createdAt: new Date().toISOString(),
    sourceName: input.sourceName,
    laStudioApiId: input.laStudioApiId,
    omniProfileId: input.omniProfileId,
    bytes: input.audioBuffer.length,
  };
  fs.writeFileSync(metaPath(dir), JSON.stringify(meta, null, 2), 'utf8');
  return meta;
}

export function updateLaStudioUserClone(
  id: string,
  patch: Partial<
    Pick<LaStudioUserClone, 'name' | 'laStudioApiId' | 'omniProfileId' | 'language'>
  >,
  cwd = process.cwd(),
): LaStudioUserClone | null {
  const dir = resolveCloneDir(id, cwd);
  if (!dir) return null;
  const meta = readMeta(dir);
  if (!meta) return null;
  const next: LaStudioUserClone = {
    ...meta,
    ...patch,
    id: meta.id,
    filename: meta.filename,
    createdAt: meta.createdAt,
  };
  if (patch.name) next.name = String(patch.name).trim().normalize('NFC') || meta.name;
  fs.writeFileSync(metaPath(dir), JSON.stringify(next, null, 2), 'utf8');
  return next;
}

export function deleteLaStudioUserClone(
  id: string,
  cwd = process.cwd(),
): boolean {
  const dir = resolveCloneDir(id, cwd);
  if (!dir) return false;
  try {
    fs.rmSync(dir, { recursive: true, force: true });
    return true;
  } catch {
    return false;
  }
}

/** Public URL for sample stream via sample-audio route */
export function cloneSamplePublicUrl(id: string): string {
  return `/api/la-studio/sample-audio?familyId=user-clones&voiceId=${encodeURIComponent(id)}`;
}

export function userClonesAsVoiceOptions(
  clones: LaStudioUserClone[],
): Array<{
  id: string;
  name: string;
  detail: string;
  source: 'user-clone';
  familyId: string;
  samplePublicUrl: string;
  previewUrl: string;
  gender: 'neutral';
}> {
  return clones.map((c) => ({
    id: c.id,
    name: c.name,
    detail: `user-clone · ${c.language || 'vi'}`,
    source: 'user-clone' as const,
    familyId: 'user-clones',
    samplePublicUrl: cloneSamplePublicUrl(c.id),
    previewUrl: cloneSamplePublicUrl(c.id),
    gender: 'neutral' as const,
  }));
}
