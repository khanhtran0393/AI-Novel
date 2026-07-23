/**
 * Giọng mẫu cho family tải xuống (runtime zip thường không kèm voices.json).
 *
 * - Catalog: từ LA_STUDIO_FAMILY_MANIFEST.sampleVoices
 * - Audio nghe thử: bake WAV bằng Kokoro-VI ship (ghi rõ demo) → public + pack dir
 * - Gen cảnh thật: family kokoro-cli / API load model — không đổi engine ngầm (B10)
 */

import fs from 'fs';
import path from 'path';
import {
  getLaStudioFamily,
  resolveFamilyPortableRoot,
  type LaStudioSampleVoice,
  LA_STUDIO_DEFAULT_FAMILY,
} from './laStudioRuntimes';
import { synthesizeKokoroCli } from './laStudioLocal';

export type SampleVoiceRow = LaStudioSampleVoice & {
  familyId: string;
  familyTitle: string;
  /** Absolute path on disk if baked */
  sampleWavPath?: string;
  /** Browser URL /audio/... */
  samplePublicUrl?: string;
  isDemo: true;
  demoNote: string;
};

function appRoot(): string {
  return (process.env.AI_NOVEL_ROOT || process.cwd()).trim() || process.cwd();
}

/**
 * Writable root on ship machines:
 * - Electron packaged: resources/ is often read-only → use userData
 * - Dev: cwd/data
 */
export function sampleWritableRoot(): string {
  const userData = (
    process.env.AI_NOVEL_USER_DATA ||
    process.env.AINOVEL_USER_DATA ||
    ''
  ).trim();
  if (userData) return path.join(userData, 'la-studio-family-samples');
  return path.join(appRoot(), 'data', 'la-studio-family-samples');
}

/** Primary bake dir (always writable when possible). */
export function sampleDataDir(familyId: string): string {
  return path.join(sampleWritableRoot(), familyId);
}

/** Dev/static mirror under public/ when writable (optional). */
export function samplePublicDir(familyId: string): string {
  return path.join(
    appRoot(),
    'public',
    'audio',
    'la-studio-family-samples',
    familyId,
  );
}

export function samplePublicUrl(familyId: string, voiceId: string): string {
  /**
   * Ship-safe URL: served by /api/la-studio/sample-audio from
   * userData|data|pack|public (not only Next public/ which is read-only when packaged).
   */
  return (
    `/api/la-studio/sample-audio?familyId=${encodeURIComponent(familyId)}` +
    `&voiceId=${encodeURIComponent(voiceId)}`
  );
}

/** NFC + space variants — Windows/Unicode filenames. */
function voiceIdVariants(voiceId: string): string[] {
  const raw = String(voiceId || '').trim();
  if (!raw) return [];
  const nfc = raw.normalize('NFC');
  const nfd = raw.normalize('NFD');
  const underscored = nfc.replace(/\s+/g, '_');
  const spaced = nfc.replace(/_+/g, ' ');
  return [...new Set([raw, nfc, nfd, underscored, spaced].filter(Boolean))];
}

function sampleWavCandidates(familyId: string, voiceId: string): string[] {
  const portable = resolveFamilyPortableRoot(familyId);
  const out: string[] = [];
  for (const id of voiceIdVariants(voiceId)) {
    out.push(path.join(sampleDataDir(familyId), `${id}.wav`));
    out.push(path.join(samplePublicDir(familyId), `${id}.wav`));
    if (portable) {
      out.push(path.join(portable, 'models', 'samples', `${id}.wav`));
    }
  }
  return out;
}

function findExistingSample(
  familyId: string,
  voiceId: string,
): string | null {
  for (const p of sampleWavCandidates(familyId, voiceId)) {
    try {
      if (fs.existsSync(p) && fs.statSync(p).size > 800) return p;
    } catch {
      /* next */
    }
  }
  return null;
}

const SAMPLE_SCAN_FAMILIES = [
  LA_STUDIO_DEFAULT_FAMILY,
  'vieneu-tts-v3-turbo',
  'vibevoice',
  'voxcpm2',
  'kokoro',
  'omnivoice',
  'kokoro-vietnamese',
] as const;

export function listManifestSampleVoices(familyId: string): SampleVoiceRow[] {
  const fam = getLaStudioFamily(familyId);
  if (!fam?.sampleVoices?.length) return [];
  return fam.sampleVoices.map((s) => {
    const wav = findExistingSample(fam.id, s.id);
    return {
      ...s,
      familyId: fam.id,
      familyTitle: fam.title,
      sampleWavPath: wav || undefined,
      samplePublicUrl: wav ? samplePublicUrl(fam.id, s.id) : undefined,
      isDemo: true as const,
      demoNote:
        fam.kind === 'kokoro-cli'
          ? 'Giọng Kokoro-VI thật (ship).'
          : 'Mẫu nghe thử (tự bake trên máy user sau khi tải family) — pack runtime thường không có voice pack.',
    };
  });
}

/** Resolve baked sample for preview (absolute path). */
export function resolveSampleWav(
  familyId: string | undefined,
  voiceId: string,
): { path: string; publicUrl: string; familyId: string } | null {
  const voice = String(voiceId || '').trim().normalize('NFC');
  if (!voice) return null;
  // Prefer requested family, then scan others (UI often still has kokoro family while voice is VieNeu).
  const preferred = familyId?.trim() || '';
  const families = [
    ...(preferred ? [preferred] : []),
    ...SAMPLE_SCAN_FAMILIES.filter((f) => f !== preferred),
  ];
  for (const fid of families) {
    const hit = findExistingSample(fid, voice);
    if (hit) {
      return {
        path: hit,
        publicUrl: samplePublicUrl(fid, voice),
        familyId: fid,
      };
    }
  }
  return null;
}

/** Write sample WAV to data/ (ship-safe) + best-effort public/ + pack mirror. */
function writeSampleWav(
  familyId: string,
  voiceId: string,
  buffer: Buffer,
  portable: string | null,
): string {
  const dataPath = path.join(sampleDataDir(familyId), `${voiceId}.wav`);
  fs.mkdirSync(path.dirname(dataPath), { recursive: true });
  fs.writeFileSync(dataPath, buffer);
  // Optional public mirror (dev / writable installs)
  try {
    const pub = path.join(samplePublicDir(familyId), `${voiceId}.wav`);
    fs.mkdirSync(path.dirname(pub), { recursive: true });
    fs.writeFileSync(pub, buffer);
  } catch {
    /* packaged resources often read-only — OK, data/ is enough */
  }
  if (portable) {
    try {
      const packSample = path.join(
        portable,
        'models',
        'samples',
        `${voiceId}.wav`,
      );
      fs.mkdirSync(path.dirname(packSample), { recursive: true });
      fs.writeFileSync(packSample, buffer);
    } catch {
      /* ignore */
    }
  }
  return dataPath;
}

async function ensureKokoroReadyForBake(): Promise<void> {
  try {
    const { isKokoroCliReady, resolveKokoroViRuntime } = await import(
      './laStudioLocal'
    );
    if (isKokoroCliReady() && resolveKokoroViRuntime()) return;
    const { ensurePortableKokoroRuntime } = await import('./laStudioKokoroEnsure');
    await ensurePortableKokoroRuntime();
  } catch (e) {
    console.warn(
      '[LA Studio samples] Kokoro ensure',
      e instanceof Error ? e.message : e,
    );
  }
}

function sampleLine(name: string, familyTitle: string): string {
  return `Xin chào. Đây là giọng mẫu ${name} của ${familyTitle}. Cảm ơn bạn đã nghe thử.`;
}

/**
 * Bake missing sample WAVs for a family (Kokoro CLI).
 * Safe to call after download / on voices GET.
 */
export async function ensureFamilySamplePack(
  familyId: string,
  opts?: { maxVoices?: number },
): Promise<{
  familyId: string;
  baked: string[];
  skipped: string[];
  errors: string[];
  voices: SampleVoiceRow[];
}> {
  const fam = getLaStudioFamily(familyId);
  const baked: string[] = [];
  const skipped: string[] = [];
  const errors: string[] = [];
  if (!fam?.sampleVoices?.length) {
    return {
      familyId,
      baked,
      skipped,
      errors: ['no sampleVoices in manifest'],
      voices: [],
    };
  }

  // Ship machines: need Kokoro CLI bundled before bake
  await ensureKokoroReadyForBake();
  fs.mkdirSync(sampleDataDir(familyId), { recursive: true });

  // Also write catalog into portable root when installed
  const portable = resolveFamilyPortableRoot(familyId);
  if (portable) {
    try {
      const modelsDir = path.join(portable, 'models');
      fs.mkdirSync(modelsDir, { recursive: true });
      const catalog = {
        schema: 'ainovel.family-sample-voices.v1',
        familyId,
        note: 'Giọng mẫu AI Novel — audio bake bằng Kokoro-VI để nghe thử khi pack runtime chưa có voice pack.',
        voices: fam.sampleVoices.map((s) => ({
          id: s.id,
          label: s.name,
          gender: s.gender || 'neutral',
          demoKokoroVoice: s.demoKokoroVoice || null,
        })),
      };
      fs.writeFileSync(
        path.join(modelsDir, 'voices-samples.json'),
        JSON.stringify(catalog, null, 2),
        'utf8',
      );
      // NEVER overwrite real engine catalogs:
      // - kokoro-vietnamese ship pack (voicepacks/*.bin + voices.json)
      // - VieNeu presets (voices_v3_*.json)
      // Sample list lives only in voices-samples.json + data/ WAV bake.
      const hasRealCatalog = (() => {
        if (familyId === 'kokoro-vietnamese' || fam.kind === 'kokoro-cli') {
          return true;
        }
        try {
          const names = fs.readdirSync(modelsDir);
          const voicepacks = path.join(modelsDir, 'voicepacks');
          if (fs.existsSync(voicepacks)) {
            const bins = fs
              .readdirSync(voicepacks)
              .filter((f) => /\.(bin|pt)$/i.test(f));
            if (bins.length > 0) return true;
          }
          // root-level voice bins
          if (names.some((n) => /\.bin$/i.test(n))) return true;
          for (const n of names) {
            const low = n.toLowerCase();
            if (low === 'voices-samples.json') continue;
            if (
              low === 'voices_v3_turbo.json' ||
              /^voices_v\d+.*\.json$/i.test(low)
            ) {
              return true;
            }
            if (low === 'voices.json') {
              const raw = JSON.parse(
                fs.readFileSync(path.join(modelsDir, n), 'utf8'),
              ) as Record<string, unknown>;
              if (raw.presets && typeof raw.presets === 'object') return true;
              // Real Kokoro cpp catalog: entries have file *.bin (not samples/*.wav)
              if (Array.isArray(raw.voices)) {
                const arr = raw.voices as Array<Record<string, unknown>>;
                if (
                  arr.some((v) =>
                    String(v.file || '').toLowerCase().endsWith('.bin'),
                  )
                ) {
                  return true;
                }
                if (arr.length > (fam.sampleVoices?.length || 0)) return true;
              }
            }
          }
        } catch {
          /* treat as no real catalog */
        }
        return false;
      })();
      // Only write a demo voices.json for pure runtime packs (no real voice bins)
      if (!hasRealCatalog) {
        fs.writeFileSync(
          path.join(modelsDir, 'voices.json'),
          JSON.stringify(
            {
              schema: 'ainovel.family-sample-voices.v1',
              default_voice: fam.sampleVoices[0]?.id,
              note: 'Demo catalog only — real engine voice packs not present.',
              voices: fam.sampleVoices.map((s) => ({
                id: s.id,
                label: s.name,
                file: `samples/${s.id}.wav`,
              })),
            },
            null,
            2,
          ),
          'utf8',
        );
      }
    } catch (e) {
      errors.push(e instanceof Error ? e.message : String(e));
    }
  }

  const limit = Math.max(1, opts?.maxVoices ?? fam.sampleVoices.length);
  const slice = fam.sampleVoices.slice(0, limit);

  for (const s of slice) {
    try {
      const existing = findExistingSample(familyId, s.id);
      if (existing) {
        skipped.push(s.id);
        // ensure pack mirror
        if (portable) {
          const packSample = path.join(
            portable,
            'models',
            'samples',
            `${s.id}.wav`,
          );
          if (!fs.existsSync(packSample)) {
            try {
              fs.mkdirSync(path.dirname(packSample), { recursive: true });
              fs.copyFileSync(existing, packSample);
            } catch {
              /* ignore */
            }
          }
        }
        continue;
      }
      const demoVoice =
        s.demoKokoroVoice ||
        (s.gender === 'male' ? 'hung_thinh' : 'ngoc_huyen');
      const r = await synthesizeKokoroCli({
        text: sampleLine(s.name, fam.title),
        voice: demoVoice,
        timeoutMs: 120_000,
      });
      writeSampleWav(familyId, s.id, r.buffer, portable);
      baked.push(s.id);
    } catch (e) {
      errors.push(
        `${s.id}: ${e instanceof Error ? e.message : String(e)}`.slice(0, 200),
      );
    }
  }

  // Bake WAV for real pack presets (VieNeu voices_v3_turbo.json, etc.)
  // so every listed voice can ▶ nghe thử even without full family engine.
  try {
    const presets = collectDiskPresetMetas(familyId, portable);
    if (presets.length) {
      const extra = await ensureDiskPresetSampleWavs(familyId, presets, {
        maxVoices: 32,
      });
      baked.push(...extra.baked);
      skipped.push(...extra.skipped);
      errors.push(...extra.errors);
    }
  } catch (e) {
    errors.push(
      `disk-presets: ${e instanceof Error ? e.message : String(e)}`.slice(0, 200),
    );
  }

  return {
    familyId,
    baked,
    skipped,
    errors,
    voices: listManifestSampleVoices(familyId),
  };
}

/** Read preset names/gender from pack voices_*.json (no circular import to discover). */
function collectDiskPresetMetas(
  familyId: string,
  portable: string | null,
): Array<{ id: string; name?: string; gender?: string }> {
  const roots: string[] = [];
  if (portable) roots.push(path.join(portable, 'models'), portable);
  roots.push(path.join(appRoot(), 'bin', 'la-studio-runtimes', familyId, 'models'));
  const out: Array<{ id: string; name?: string; gender?: string }> = [];
  const seen = new Set<string>();
  for (const dir of roots) {
    if (!dir || !fs.existsSync(dir)) continue;
    let names: string[] = [];
    try {
      names = fs.readdirSync(dir);
    } catch {
      continue;
    }
    for (const n of names) {
      const low = n.toLowerCase();
      if (
        low !== 'voices.json' &&
        low !== 'voices_v3_turbo.json' &&
        !/^voices_v\d+.*\.json$/i.test(low)
      ) {
        continue;
      }
      if (low === 'voices-samples.json') continue;
      try {
        const raw = JSON.parse(
          fs.readFileSync(path.join(dir, n), 'utf8'),
        ) as Record<string, unknown>;
        const presets =
          raw.presets && typeof raw.presets === 'object'
            ? (raw.presets as Record<string, unknown>)
            : null;
        if (presets) {
          for (const [id, meta] of Object.entries(presets)) {
            if (!id || seen.has(id)) continue;
            seen.add(id);
            const m =
              meta && typeof meta === 'object'
                ? (meta as Record<string, unknown>)
                : {};
            out.push({
              id,
              name: id,
              gender: String(m.gender || ''),
            });
          }
        }
      } catch {
        /* next file */
      }
    }
  }
  return out;
}

/**
 * Bake demo WAVs for extra voice ids (e.g. VieNeu real presets) that aren't
 * in sampleVoices manifest. Gender → Kokoro demo voice.
 */
export async function ensureDiskPresetSampleWavs(
  familyId: string,
  presets: Array<{ id: string; name?: string; gender?: string }>,
  opts?: { maxVoices?: number },
): Promise<{ baked: string[]; skipped: string[]; errors: string[] }> {
  const baked: string[] = [];
  const skipped: string[] = [];
  const errors: string[] = [];
  const fam = getLaStudioFamily(familyId);
  const title = fam?.title || familyId;
  await ensureKokoroReadyForBake();
  fs.mkdirSync(sampleDataDir(familyId), { recursive: true });
  const portable = resolveFamilyPortableRoot(familyId);
  const limit = Math.max(1, opts?.maxVoices ?? 24);
  let n = 0;
  for (const p of presets) {
    if (n >= limit) break;
    const id = String(p.id || '').trim();
    if (!id || id === 'default') continue;
    // Skip pure sample-manifest ids already handled by ensureFamilySamplePack
    if (fam?.sampleVoices?.some((s) => s.id === id)) continue;
    try {
      if (findExistingSample(familyId, id)) {
        skipped.push(id);
        n += 1;
        continue;
      }
      const g = String(p.gender || '').toLowerCase();
      const demoVoice =
        g === 'male' || g === 'nam'
          ? 'hung_thinh'
          : g === 'female' || g === 'nữ' || g === 'nu'
            ? 'ngoc_huyen'
            : 'storyvert';
      const r = await synthesizeKokoroCli({
        text: sampleLine(p.name || id, title),
        voice: demoVoice,
        timeoutMs: 120_000,
      });
      writeSampleWav(familyId, id, r.buffer, portable);
      baked.push(id);
      n += 1;
    } catch (e) {
      errors.push(
        `${id}: ${e instanceof Error ? e.message : String(e)}`.slice(0, 200),
      );
    }
  }
  return { baked, skipped, errors };
}

/** Ensure samples for every family that has sampleVoices (best-effort). */
export async function ensureAllFamilySamplePacks(): Promise<void> {
  const { LA_STUDIO_FAMILY_MANIFEST } = await import('./laStudioRuntimes');
  for (const f of LA_STUDIO_FAMILY_MANIFEST) {
    if (!f.sampleVoices?.length) continue;
    try {
      await ensureFamilySamplePack(f.id);
    } catch {
      /* next family */
    }
  }
}

/** Attach sample URL if baked WAV exists anywhere (data/userData/public/pack). */
export function attachSampleUrlIfPresent(
  familyId: string,
  voiceId: string,
): string | undefined {
  return findExistingSample(familyId, voiceId)
    ? samplePublicUrl(familyId, voiceId)
    : undefined;
}

/**
 * Post-download on any machine: bake ALL sample + disk-preset demos,
 * return count ready for ▶. Used by families ensure + voices?ensureSamples=1.
 */
export async function prepareFamilySamplesForShip(familyId: string): Promise<{
  familyId: string;
  voiceCount: number;
  readyCount: number;
  baked: string[];
  skipped: string[];
  errors: string[];
  sampleUrls: Array<{ id: string; url: string }>;
}> {
  const pack = await ensureFamilySamplePack(familyId);
  const { discoverVoicesForFamily } = await import('./laStudioVoiceDiscover');
  // Re-discover after bake so samplePublicUrl attaches
  let discovered = discoverVoicesForFamily(familyId);
  const stillMissing = discovered.voices
    .filter((v) => !v.samplePublicUrl)
    .map((v) => ({
      id: v.id,
      name: v.name,
      gender: /female|nữ/i.test(String(v.detail || v.name || ''))
        ? 'female'
        : /male|nam/i.test(String(v.detail || v.name || ''))
          ? 'male'
          : 'neutral',
    }));
  let extraBaked: string[] = [];
  let extraSkipped: string[] = [];
  let extraErrors: string[] = [];
  if (stillMissing.length) {
    const extra = await ensureDiskPresetSampleWavs(familyId, stillMissing, {
      maxVoices: 32,
    });
    extraBaked = extra.baked;
    extraSkipped = extra.skipped;
    extraErrors = extra.errors;
    discovered = discoverVoicesForFamily(familyId);
  }
  const withUrl = discovered.voices.filter((v) => v.samplePublicUrl);
  return {
    familyId,
    voiceCount: discovered.voices.length,
    readyCount: withUrl.length,
    baked: [...pack.baked, ...extraBaked],
    skipped: [...pack.skipped, ...extraSkipped],
    errors: [...pack.errors, ...extraErrors],
    sampleUrls: withUrl.map((v) => ({
      id: v.id,
      url: v.samplePublicUrl!,
    })),
  };
}
