/**
 * Portable project pack — multi-machine friendly.
 * Paths under public/ are stored relative; absolute drive paths stripped or relativized.
 */
import {
  BACKUP_STATE_KEYS,
  PROJECT_BACKUP_VERSION,
  type ProjectBackupEnvelope,
  buildProjectBackup,
  parseProjectBackup,
} from '@/lib/projectBackup';

export const PORTABLE_VERSION = 2 as const;

export type PortableProject = ProjectBackupEnvelope & {
  portableVersion: typeof PORTABLE_VERSION;
  /** Relative media index for hand-off (paths only, no binary) */
  mediaIndex: {
    audio: string[];
    images: string[];
    videos: string[];
  };
  /** Secrets intentionally excluded when stripSecrets=true */
  secretsStripped: boolean;
};

const SECRET_KEYS = new Set([
  'apiKey',
  'apiKeys',
  'openaiApiKey',
  'openaiApiKeys',
  'grokApiKey',
  'grokApiKeys',
  'lumaApiKey',
  'lumaApiKeys',
  'googleStudioCookie',
  'googleStudioCookies',
  'tiktokSessionIds',
  'runwayApiKey',
  'falaiApiKey',
  'entitlementToken',
]);

/** Convert absolute/public URL paths → portable relative form */
export function toRelativeMediaPath(p: string): string {
  if (!p || typeof p !== 'string') return p;
  let s = p.trim().replace(/\\/g, '/');
  // strip origin
  s = s.replace(/^https?:\/\/[^/]+/i, '');
  // common prefixes
  const markers = ['/public/', 'public/', '/audio/', '/images/', '/video/', '/renders/'];
  for (const m of markers) {
    const i = s.toLowerCase().indexOf(m.toLowerCase());
    if (i >= 0) {
      const rest = s.slice(i + (m.startsWith('/') && !m.startsWith('/public') ? 0 : 0));
      if (m.includes('public')) {
        return rest.replace(/^\/?public\//i, '').replace(/^\//, '');
      }
      // keep audio/images/video/...
      const sub = s.slice(i).replace(/^\//, '');
      return sub.startsWith('public/') ? sub.slice('public/'.length) : sub;
    }
  }
  // Windows absolute → keep basename under guessed folder
  if (/^[a-zA-Z]:\//.test(s) || s.startsWith('//')) {
    const base = s.split('/').pop() || s;
    if (/\.(mp3|wav|m4a|ogg)$/i.test(base)) return `audio/${base}`;
    if (/\.(png|jpe?g|webp|gif)$/i.test(base)) return `images/${base}`;
    if (/\.(mp4|webm|mov)$/i.test(base)) return `video/${base}`;
    return base;
  }
  return s.replace(/^\//, '');
}

function mapStringRecord(
  rec: unknown,
  mapVal: (v: string) => string,
): Record<string, string> | unknown {
  if (!rec || typeof rec !== 'object' || Array.isArray(rec)) return rec;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(rec as Record<string, unknown>)) {
    if (typeof v === 'string') out[k] = mapVal(v);
    else if (v != null) out[k] = String(v);
  }
  return out;
}

function collectMediaPaths(state: Record<string, unknown>): PortableProject['mediaIndex'] {
  const audio = new Set<string>();
  const images = new Set<string>();
  const videos = new Set<string>();

  const push = (raw: unknown) => {
    if (typeof raw !== 'string' || !raw.trim()) return;
    const rel = toRelativeMediaPath(raw);
    if (/\.(mp3|wav|m4a|ogg)$/i.test(rel) || rel.includes('audio/')) audio.add(rel);
    else if (/\.(png|jpe?g|webp|gif)$/i.test(rel) || rel.includes('images/')) images.add(rel);
    else if (/\.(mp4|webm|mov)$/i.test(rel) || rel.includes('video/')) videos.add(rel);
  };

  const walk = (v: unknown, depth = 0) => {
    if (depth > 6 || v == null) return;
    if (typeof v === 'string') {
      push(v);
      return;
    }
    if (Array.isArray(v)) {
      v.forEach((x) => walk(x, depth + 1));
      return;
    }
    if (typeof v === 'object') {
      for (const x of Object.values(v as object)) walk(x, depth + 1);
    }
  };

  for (const key of [
    'generatedAudioPaths',
    'generatedImages',
    'generatedImageVariants',
    'generatedVideos',
  ]) {
    walk(state[key]);
  }

  return {
    audio: [...audio].sort(),
    images: [...images].sort(),
    videos: [...videos].sort(),
  };
}

export type BuildPortableOptions = {
  stripSecrets?: boolean;
  /** Extra state keys beyond BACKUP_STATE_KEYS */
  extraKeys?: string[];
};

/** Build portable pack from store-like object */
export function buildPortableProject(
  state: Record<string, unknown>,
  opts: BuildPortableOptions = {},
): PortableProject {
  const stripSecrets = opts.stripSecrets !== false;
  const base = buildProjectBackup(state);
  const slice: Record<string, unknown> = { ...base.state };

  for (const k of opts.extraKeys || []) {
    if (k in state) slice[k] = state[k];
  }

  // Relativize known media maps
  if (slice.generatedAudioPaths) {
    slice.generatedAudioPaths = mapStringRecord(slice.generatedAudioPaths, toRelativeMediaPath);
  }
  if (slice.generatedImages) {
    slice.generatedImages = mapStringRecord(slice.generatedImages, toRelativeMediaPath);
  }
  if (slice.generatedVideos) {
    slice.generatedVideos = mapStringRecord(slice.generatedVideos, toRelativeMediaPath);
  }

  // Strip absolute save paths (machine-specific)
  for (const k of [
    'savePathTTS',
    'savePathImage',
    'savePathCharacter',
    'savePathVideo',
    'googleDrivePath',
  ]) {
    if (typeof slice[k] === 'string' && /^[a-zA-Z]:[\\/]/.test(String(slice[k]))) {
      slice[k] = '';
    }
  }

  if (stripSecrets) {
    for (const k of SECRET_KEYS) {
      delete slice[k];
    }
    // ttsConfig may embed session
    if (slice.ttsConfig && typeof slice.ttsConfig === 'object') {
      const t = { ...(slice.ttsConfig as Record<string, unknown>) };
      delete t.tiktokSessionId;
      delete t.apiKey;
      slice.ttsConfig = t;
    }
  }

  const mediaIndex = collectMediaPaths(slice);

  return {
    ...base,
    version: PROJECT_BACKUP_VERSION,
    portableVersion: PORTABLE_VERSION,
    secretsStripped: stripSecrets,
    mediaIndex,
    state: slice,
  };
}

export function parsePortableProject(raw: string): PortableProject {
  const data = parseProjectBackup(raw) as PortableProject;
  if (!data.state) throw new Error('Portable thiếu state.');
  // Accept v1 backup as portable v1
  return {
    ...data,
    portableVersion: data.portableVersion === PORTABLE_VERSION ? PORTABLE_VERSION : PORTABLE_VERSION,
    secretsStripped: !!data.secretsStripped,
    mediaIndex: data.mediaIndex || { audio: [], images: [], videos: [] },
  };
}

/** Keys safe to merge into zustand from portable import */
export function portableStatePatch(
  portable: PortableProject,
): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  const allowed = new Set<string>([...BACKUP_STATE_KEYS]);
  for (const [k, v] of Object.entries(portable.state || {})) {
    if (!allowed.has(k)) continue;
    if (SECRET_KEYS.has(k)) continue;
    patch[k] = v;
  }
  return patch;
}

export function downloadPortableProject(pack: PortableProject, filename?: string) {
  if (typeof window === 'undefined') return;
  const blob = new Blob([JSON.stringify(pack, null, 2)], {
    type: 'application/json;charset=utf-8',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  const title =
    typeof pack.state.ten_tac_pham === 'string' ? pack.state.ten_tac_pham : 'project';
  const safe = String(title)
    .normalize('NFC')
    .replace(/[<>:"/\\|?*]+/g, '_')
    .slice(0, 40);
  a.download =
    filename || `ainovel_portable_${safe}_${Date.now().toString(36)}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

export function summarizePortable(pack: PortableProject): string {
  const ch = Array.isArray(pack.state.danh_sach_chuong)
    ? pack.state.danh_sach_chuong.length
    : 0;
  const m = pack.mediaIndex || { audio: [], images: [], videos: [] };
  return `${ch} chương · ${m.audio.length} audio · ${m.images.length} ảnh · ${m.videos.length} video${
    pack.secretsStripped ? ' · (đã strip secret)' : ''
  }`;
}
