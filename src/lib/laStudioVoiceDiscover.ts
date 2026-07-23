/**
 * Discover where voices live after a family is downloaded (or ship pack).
 *
 * Sources (priority when merging for UI):
 * 1) Pack disk: voices.json / voicepacks / *.bin under portable root
 * 2) Kokoro-VI ship + ~/.lastudio (same as loadLocalKokoroViVoices)
 * 3) LA Studio API /v1/audio/voices (only if desktop model loaded)
 *
 * Non-Kokoro families often only have runtime libs until API loads weights —
 * then voice ids appear from API, not from empty zip.
 */

import fs from 'fs';
import path from 'path';
import {
  parseKokoroVoicesJson,
  loadLocalKokoroViVoices,
  type LaStudioVoice,
} from './laStudioLocal';
import {
  getLaStudioFamily,
  resolveFamilyPortableRoot,
  LA_STUDIO_DEFAULT_FAMILY,
  LA_STUDIO_FAMILY_MANIFEST,
} from './laStudioRuntimes';
import {
  attachSampleUrlIfPresent,
  listManifestSampleVoices,
} from './laStudioSampleVoices';

export type DiscoveredVoice = LaStudioVoice & {
  /** disk | api | static-catalog | sample */
  source: 'disk' | 'api' | 'catalog' | 'sample';
  familyId: string;
  /** absolute path of voices.json or pack dir (disk only) */
  originPath?: string;
  /** /audio/... for baked sample preview */
  samplePublicUrl?: string;
};

function humanize(id: string): string {
  return String(id || '')
    .split(/[_-]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

function pushVoice(
  map: Map<string, DiscoveredVoice>,
  v: DiscoveredVoice,
): void {
  const id = String(v.id || '').trim();
  if (!id) return;
  const prev = map.get(id);
  // Prefer disk > api > sample > catalog
  const rank = { disk: 4, api: 3, sample: 2, catalog: 1 } as const;
  if (!prev || rank[v.source] >= rank[prev.source]) {
    map.set(id, { ...v, id });
  }
}

/** Scan a directory tree for voices.json and loose voice bins (depth ≤ 4). */
export function scanVoicesUnderDir(
  root: string,
  familyId: string,
  maxDepth = 4,
): DiscoveredVoice[] {
  if (!root || !fs.existsSync(root)) return [];
  const found = new Map<string, DiscoveredVoice>();

  const walk = (dir: string, depth: number) => {
    if (depth > maxDepth) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of entries) {
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        if (
          /node_modules|\.git|__pycache__|qml|platforms|imageformats/i.test(
            ent.name,
          )
        ) {
          continue;
        }
        walk(full, depth + 1);
        continue;
      }
      if (!ent.isFile()) continue;
      const lower = ent.name.toLowerCase();
      // voices.json, voices_v3_turbo.json, voices_v3.json, …
      if (
        lower === 'voices.json' ||
        /^voices(_v\d+)?(_turbo)?\.json$/i.test(lower) ||
        /^voices_v\d+.*\.json$/i.test(lower)
      ) {
        try {
          const raw = JSON.parse(fs.readFileSync(full, 'utf8')) as unknown;
          for (const v of parseKokoroVoicesJson(raw)) {
            pushVoice(found, {
              ...v,
              source: 'disk',
              familyId,
              originPath: full,
              detail: v.detail || `disk:${familyId}`,
            });
          }
        } catch {
          /* skip bad json */
        }
        continue;
      }
      // Loose packs: diem_trinh.bin / voicepacks/foo.pt
      if (
        /\.(bin|pt|onnx|safetensors)$/i.test(lower) &&
        /voice|speaker|spk/i.test(dir + ent.name)
      ) {
        const id = ent.name.replace(/\.(bin|pt|onnx|safetensors)$/i, '');
        if (id.length < 2 || /kokoro_vi|model|config/i.test(id)) continue;
        pushVoice(found, {
          id,
          name: humanize(id),
          detail: `disk-file:${familyId}`,
          source: 'disk',
          familyId,
          originPath: full,
        });
      }
    }
  };

  walk(root, 0);
  return [...found.values()];
}

/**
 * Resolve voices for one family (or default Kokoro).
 * Always returns at least Kokoro catalog when family is kokoro-vietnamese.
 */
export function discoverVoicesForFamily(familyId?: string): {
  familyId: string;
  familyTitle: string;
  portableRoot: string | null;
  voices: DiscoveredVoice[];
  howToPreview: string;
} {
  const id = String(familyId || LA_STUDIO_DEFAULT_FAMILY).trim() || LA_STUDIO_DEFAULT_FAMILY;
  const fam = getLaStudioFamily(id);
  const title = fam?.title || id;
  const portableRoot = resolveFamilyPortableRoot(id);
  const map = new Map<string, DiscoveredVoice>();

  // ONLY Vietnamese Kokoro ship pack — never attach to other families (incl. "kokoro" 82M)
  if (id === 'kokoro-vietnamese') {
    for (const v of loadLocalKokoroViVoices()) {
      pushVoice(map, {
        ...v,
        source: 'disk',
        familyId: 'kokoro-vietnamese',
        detail: v.detail || 'Kokoro-VI pack',
      });
    }
  }

  if (portableRoot) {
    // Guard: portable root for another family must not be the VI pack unless id is kokoro-vietnamese
    const rootNorm = portableRoot.replace(/\\/g, '/').toLowerCase();
    const isViPack =
      /la-studio-kokoro|kokoro-vietnamese/i.test(rootNorm) &&
      !/kokoro-82|hexgrad/i.test(rootNorm);
    if (!(isViPack && id !== 'kokoro-vietnamese')) {
      for (const v of scanVoicesUnderDir(portableRoot, id)) {
        pushVoice(map, v);
      }
    }
  }

  // ~/.lastudio models — path must match THIS family; "kokoro" ≠ "kokoro-vietnamese"
  if (id !== 'kokoro-vietnamese') {
    try {
      const homeModels = path.join(
        process.env.USERPROFILE || process.env.HOME || '',
        '.lastudio',
        'models',
      );
      if (fs.existsSync(homeModels)) {
        for (const v of scanVoicesUnderDir(homeModels, id, 5)) {
          const origin = String(v.originPath || '').toLowerCase().replace(/\\/g, '/');
          if (id === 'kokoro') {
            // multilingual 82M only
            if (/kokoro-vietnamese|kokoro_vi|la-studio-kokoro/i.test(origin)) continue;
            if (!/kokoro-82|hexgrad\/kokoro|\/kokoro\//i.test(origin)) continue;
          } else {
            const idLower = id.toLowerCase();
            // require family id as path segment-ish (avoid short false positives)
            if (!origin.includes(idLower) && !origin.includes(idLower.replace(/-/g, ''))) {
              continue;
            }
            if (/kokoro-vietnamese|la-studio-kokoro/i.test(origin) && !idLower.includes('vietnamese')) {
              continue;
            }
          }
          pushVoice(map, { ...v, familyId: id });
        }
      }
    } catch {
      /* ignore */
    }
  }

  // Giọng mẫu manifest — zip runtime (Vibe/Vox/VieNeu…) thường không có voices.json
  for (const s of listManifestSampleVoices(id)) {
    pushVoice(map, {
      id: s.id,
      name: s.name,
      detail: s.demoNote,
      source: 'sample',
      familyId: id,
      samplePublicUrl: s.samplePublicUrl,
      originPath: s.sampleWavPath,
    });
  }

  // Gắn URL WAV mẫu (nếu đã bake) cho mọi id — kể cả preset disk VieNeu
  for (const [vid, row] of map) {
    if (row.samplePublicUrl) continue;
    const url = attachSampleUrlIfPresent(id, vid);
    if (url) {
      map.set(vid, {
        ...row,
        samplePublicUrl: url,
        // disk preset + demo WAV vẫn giữ source disk; sample thuần giữ sample
        detail: row.detail || (row.source === 'sample' ? 'mẫu bake' : row.detail),
      });
    }
  }

  const voices = [...map.values()].sort((a, b) => a.name.localeCompare(b.name, 'vi'));
  const sampleN = voices.filter((v) => v.source === 'sample').length;
  const withDemoWav = voices.filter((v) => !!v.samplePublicUrl).length;
  const diskN = voices.filter((v) => v.source === 'disk').length;

  let howToPreview: string;
  if (id === 'kokoro-vietnamese') {
    howToPreview = voices.length
      ? `Giọng Kokoro-VI (${voices.length}). Bấm ▶ nghe thử CLI offline.`
      : 'Chưa thấy voices.json — tải family Kokoro Vietnamese.';
  } else if (fam?.kind === 'external') {
    howToPreview =
      sampleN > 0
        ? `${sampleN} giọng mẫu Omni — ▶ nghe demo; gen thật: Engine → OmniVoice Local.`
        : 'OmniVoice: tab Engine → OmniVoice Local.';
  } else if (voices.length) {
    const parts: string[] = [`«${title}»: ${voices.length} giọng`];
    if (diskN) parts.push(`${diskN} preset pack`);
    if (sampleN) parts.push(`${sampleN} mẫu catalog`);
    if (withDemoWav) parts.push(`${withDemoWav} có WAV ▶ nhanh`);
    else parts.push('đang bake WAV mẫu…');
    howToPreview = parts.join(' · ') + '. Gen engine family cần model/API (B10).';
  } else {
    howToPreview =
      `Family «${title}» chưa có giọng mẫu — kiểm tra sampleVoices manifest hoặc tải pack.`;
  }

  return {
    familyId: id,
    familyTitle: title,
    portableRoot,
    voices,
    howToPreview,
  };
}

/** All families that currently have any disk voices (for UI strip). */
export function discoverAllFamilyVoiceCounts(): Array<{
  familyId: string;
  count: number;
  portableRoot: string | null;
}> {
  return LA_STUDIO_FAMILY_MANIFEST.map((f) => {
    const d = discoverVoicesForFamily(f.id);
    return {
      familyId: f.id,
      count: d.voices.length,
      portableRoot: d.portableRoot,
    };
  });
}
