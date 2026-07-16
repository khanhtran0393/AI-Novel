/**
 * Hậu trường chuẩn bị catalog giọng TTS.
 * GET /api/tts/voices → static + Piper (disk) + OmniVoice (public JSON) + Vina profiles
 */
import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import {
  STATIC_VOICE_CATALOG,
  cloneVoiceCatalog,
  countCatalogVoices,
  type VoiceCatalog,
  type VoiceOption,
} from '@/lib/voiceCatalog';
import { loadVinaProfiles, resolveSamplePath } from '@/lib/vinaVoice/profiles';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function loadPiperModels(cwd: string): VoiceOption[] {
  const piperDir = path.join(cwd, 'bin', 'piper_vn');
  if (!fs.existsSync(piperDir)) return [];
  try {
    return fs
      .readdirSync(piperDir)
      .filter((f) => f.endsWith('.onnx'))
      .map((f) => {
        let name = f.replace(/\.onnx$/i, '');
        name = name.charAt(0).toUpperCase() + name.slice(1);
        let gender: VoiceOption['gender'];
        if (f === 'ngochuyen.onnx') {
          name = 'Ngọc Huyền (Nữ)';
          gender = 'female';
        }
        if (f === 'manhdung.onnx') {
          name = 'Mạnh Dũng (Nam)';
          gender = 'male';
        }
        if (/nu|female|girl|my|huyen|chi|linh|huong/i.test(f)) gender = gender || 'female';
        if (/nam|male|boy|dung|minh|hung/i.test(f)) gender = gender || 'male';
        return { id: f, name, gender };
      });
  } catch {
    return [];
  }
}

function loadOmnivoiceLibrary(cwd: string): VoiceOption[] & { _byLang?: Record<string, VoiceOption[]> } {
  const candidates = [
    path.join(cwd, 'public', 'omnivoice-library.json'),
    path.join(cwd, 'omnivoice-library.json'),
  ];
  for (const file of candidates) {
    if (!fs.existsSync(file)) continue;
    try {
      const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (!Array.isArray(raw)) continue;
      const byLang: Record<string, VoiceOption[]> = {};
      for (const voice of raw) {
        if (!voice?.id) continue;
        let lang = 'vi';
        const l = String(voice.language || '').toLowerCase();
        if (l.includes('english')) lang = 'en';
        else if (l.includes('japan')) lang = 'ja';
        else if (l.includes('korea')) lang = 'ko';
        else if (l.includes('thai')) lang = 'th';
        else if (l.includes('chinese')) lang = 'zh';
        else if (l.includes('french')) lang = 'fr';
        else if (l.includes('german')) lang = 'de';
        else if (l.includes('spanish')) lang = 'es';
        else if (l.includes('portug')) lang = 'pt';
        else if (l.includes('indonesia')) lang = 'id';

        const gender =
          voice.gender === 'male' || voice.gender === 'female'
            ? voice.gender
            : undefined;
        const name = `${voice.name || voice.id}${
          gender ? ` - ${gender === 'male' ? 'Nam' : 'Nữ'}` : ''
        }${
          voice.location || voice.style
            ? ` (${voice.location || voice.style || ''})`
            : ''
        }`;
        // Resolve preview: library previewUrl OR /omnivoice-refs/<basename of voiceId>
        let previewUrl: string | undefined =
          typeof voice.previewUrl === 'string' && voice.previewUrl.trim()
            ? voice.previewUrl.trim()
            : undefined;
        if (!previewUrl && voice.voiceId) {
          const base = path.basename(String(voice.voiceId));
          const localRef = path.join(cwd, 'public', 'omnivoice-refs', base);
          if (fs.existsSync(localRef)) {
            previewUrl = `/omnivoice-refs/${base}`;
          }
        }
        if (!previewUrl && voice.id) {
          // omnivoice_preset_ref_nhat_narrative → ref_nhat_narrative.wav
          const stem = String(voice.id).replace(/^omnivoice_preset_/, '');
          for (const ext of ['.wav', '.mp3']) {
            const localRef = path.join(cwd, 'public', 'omnivoice-refs', `${stem}${ext}`);
            if (fs.existsSync(localRef)) {
              previewUrl = `/omnivoice-refs/${stem}${ext}`;
              break;
            }
          }
        }

        if (!byLang[lang]) byLang[lang] = [];
        const entry: VoiceOption = {
          id: String(voice.id),
          name,
          gender,
          previewUrl,
        };
        // Library JSON có thể lặp id (vd. omnivoice_preset_ref_vn_trang ×2) → React key warning
        const existIdx = byLang[lang].findIndex((x) => x.id === entry.id);
        if (existIdx >= 0) {
          // Giữ bản name/style dài hơn (thường mô tả đầy đủ hơn)
          const prev = byLang[lang][existIdx];
          if ((entry.name || '').length >= (prev.name || '').length) {
            byLang[lang][existIdx] = entry;
          }
        } else {
          byLang[lang].push(entry);
        }
      }
      return Object.assign([], { _byLang: byLang }) as VoiceOption[] & {
        _byLang?: Record<string, VoiceOption[]>;
      };
    } catch {
      /* try next */
    }
  }
  return Object.assign([], { _byLang: {} });
}

function loadVinaAsVoices(cwd: string): VoiceOption[] {
  try {
    const profiles = loadVinaProfiles(cwd);
    return profiles.flatMap((p) => {
      const sample = resolveSamplePath(p, {}, cwd);
      if (!sample) return [];
      const label = p.name;
      const plain = label
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/đ/g, 'd')
        .replace(/Đ/g, 'D')
        .toLowerCase();
      const gender: VoiceOption['gender'] = /nu |female|co |chi |ba /.test(plain)
        ? 'female'
        : /nam |male|ong |anh /.test(plain)
          ? 'male'
          : undefined;
      return {
        id: p.name,
        name: p.name,
        gender,
      };
    });
  } catch {
    return [];
  }
}
function setLangList(catalog: VoiceCatalog, platform: string, language: string, list: VoiceOption[]) {
  if (!catalog[platform]) catalog[platform] = {};
  catalog[platform][language] = list;
}

export async function GET(req: NextRequest) {
  try {
    const cwd = process.cwd();
    const sources: string[] = ['static'];
    const catalog = cloneVoiceCatalog(STATIC_VOICE_CATALOG);

    // CapCut: re-merge full matrix + install diagnose (sscronet)
    let capcutDiag: {
      ok: boolean;
      dllPath: string | null;
      version: string | null;
      voiceCount: number;
      message: string;
    } | null = null;
    try {
      const { diagnoseCapCutInstall } = await import(
        '@/app/api/generate-tts/engines/capcut'
      );
      const { buildCapCutVoiceCatalog, listCapCutVoicesSummary } = await import(
        '@/lib/capcutVoices'
      );
      const capMap = buildCapCutVoiceCatalog();
      catalog.capcut_tts = capMap;
      sources.push(`capcut-voices:${listCapCutVoicesSummary().total}`);
      capcutDiag = diagnoseCapCutInstall();
    } catch {
      capcutDiag = null;
    }

    // Piper disk models
    const piper = loadPiperModels(cwd);
    if (piper.length) {
      setLangList(catalog, 'piper', 'vi', piper);
      // VieNeu chỉ hiện model có file thật (tránh Adam 2/3… 404)
      setLangList(
        catalog,
        'vieneu_tts',
        'vi',
        piper.map((p) => ({
          ...p,
          name: p.name.includes('Piper') ? p.name : `${p.name} (VieNeu→Piper)`,
        })),
      );
      sources.push('piper-disk');
    }

    // OmniVoice library — keep design presets (alloy/nova/…) at top of each lang
    // so UI can always preview presets without relying only on clone library.
    const omni = loadOmnivoiceLibrary(cwd);
    const byLang = omni._byLang || {};
    if (Object.keys(byLang).length) {
      if (!catalog.omnivoice_local) catalog.omnivoice_local = {};
      const staticOmni = cloneVoiceCatalog(STATIC_VOICE_CATALOG).omnivoice_local || {};
      for (const [lang, list] of Object.entries(byLang)) {
        const presets = staticOmni[lang] || staticOmni.vi || [];
        const presetIds = new Set(presets.map((p) => p.id));
        const libOnly = (list || []).filter((v) => !presetIds.has(v.id));
        catalog.omnivoice_local[lang] = [...presets, ...libOnly];
      }
      // langs only in static (no library entries)
      for (const [lang, presets] of Object.entries(staticOmni)) {
        if (!catalog.omnivoice_local[lang]?.length) {
          catalog.omnivoice_local[lang] = presets;
        }
      }
      sources.push('omnivoice-library+presets');
    }

    // Vina profiles
    const vina = loadVinaAsVoices(cwd);
    if (vina.length) {
      setLangList(catalog, 'vina_voice', 'vi', vina);
      setLangList(
        catalog,
        'vina_voice',
        'en',
        vina.filter((x) => /en|english|nam|minh|my|hoai/i.test(x.id + x.name)).length
          ? vina
          : vina.slice(0, 4),
      );
      sources.push('vina-profiles');
    }

    const counts = countCatalogVoices(catalog);
    const total = Object.values(counts).reduce((a, b) => a + b, 0);

    console.log(
      `[TTS Voices Prep] sources=${sources.join('+')} totalUniqueByPlatform=${total} counts=${JSON.stringify(counts)}`,
    );

    const refresh = req.nextUrl.searchParams.get('refresh') === '1';

    return NextResponse.json({
      ok: true,
      catalog,
      counts,
      sources,
      preparedAt: new Date().toISOString(),
      refresh,
      totalPlatforms: Object.keys(catalog).length,
      capcut: capcutDiag,
    });
  } catch (err: unknown) {
    console.error('[TTS Voices Prep] failed:', err);
    const catalog = cloneVoiceCatalog(STATIC_VOICE_CATALOG);
    return NextResponse.json(
      {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
        catalog,
        counts: countCatalogVoices(catalog),
        sources: ['static-fallback'],
        preparedAt: new Date().toISOString(),
      },
      { status: 200 },
    );
  }
}
