/**
 * Hậu trường chuẩn bị catalog giọng TTS.
 * GET /api/tts/voices → static + Piper (disk) + OmniVoice (library SuperAudioTools/public) + Vina profiles
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
import { loadOmniLibrary } from '@/lib/omnivoiceLocal';
import {
  listLaStudioVoices,
  loadLocalKokoroViVoices,
  probeLaStudioHealth,
  resolveLaStudioApiKey,
  resolveLaStudioBaseUrl,
} from '@/lib/laStudioLocal';

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

/** Build Omni catalog from loadOmniLibrary (public + SuperAudioTools). */
function loadOmnivoiceLibrary(cwd: string): VoiceOption[] & { _byLang?: Record<string, VoiceOption[]> } {
  const raw = loadOmniLibrary(cwd);
  if (!raw.length) {
    return Object.assign([], { _byLang: {} });
  }
  const byLang: Record<string, VoiceOption[]> = {};
  for (const voice of raw) {
    if (!voice?.id) continue;
    let lang = 'vi';
    const l = String(voice.language || '').toLowerCase();
    if (l.includes('english') || l === 'en') lang = 'en';
    else if (l.includes('japan') || l === 'ja') lang = 'ja';
    else if (l.includes('korea') || l === 'ko') lang = 'ko';
    else if (l.includes('thai') || l === 'th') lang = 'th';
    else if (l.includes('chinese') || l === 'zh') lang = 'zh';
    else if (l.includes('french') || l === 'fr') lang = 'fr';
    else if (l.includes('german') || l === 'de') lang = 'de';
    else if (l.includes('spanish') || l === 'es') lang = 'es';
    else if (l.includes('portug') || l === 'pt') lang = 'pt';
    else if (l.includes('indonesia') || l === 'id') lang = 'id';

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
    // Static ref preview only if file is under public/ (browser-fetchable)
    let previewUrl: string | undefined =
      typeof voice.previewUrl === 'string' && voice.previewUrl.trim()
        ? voice.previewUrl.trim()
        : undefined;
    if (!previewUrl && voice.voiceId) {
      const base = path.basename(String(voice.voiceId));
      const publicRef = path.join(cwd, 'public', 'omnivoice-refs', base);
      if (fs.existsSync(publicRef)) {
        previewUrl = `/omnivoice-refs/${base}`;
      }
    }
    if (!previewUrl && voice.id) {
      const stem = String(voice.id).replace(/^omnivoice_preset_/, '');
      for (const ext of ['.wav', '.mp3']) {
        const publicRef = path.join(cwd, 'public', 'omnivoice-refs', `${stem}${ext}`);
        if (fs.existsSync(publicRef)) {
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
    const existIdx = byLang[lang].findIndex((x) => x.id === entry.id);
    if (existIdx >= 0) {
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

    // LA Studio — local Kokoro pack + live API voices when online
    {
      const staticLa = cloneVoiceCatalog(STATIC_VOICE_CATALOG).la_studio || {};
      const baseList: VoiceOption[] = [...(staticLa.vi || [])];
      const seen = new Set(baseList.map((x) => x.id));
      for (const kv of loadLocalKokoroViVoices()) {
        if (!kv.id || seen.has(kv.id)) continue;
        seen.add(kv.id);
        const gender: VoiceOption['gender'] = /mai_|my_|ngoc_|diem_|thuc_/i.test(kv.id)
          ? 'female'
          : /hung_|manh_|phat_|thanh_|tuan_|duc_/i.test(kv.id)
            ? 'male'
            : 'neutral';
        baseList.push({ id: kv.id, name: kv.name || kv.id, gender });
      }
      try {
        const base = resolveLaStudioBaseUrl();
        const health = await probeLaStudioHealth(base, 1200);
        if (health.online) {
          const live = await listLaStudioVoices(base, resolveLaStudioApiKey(), 3000);
          for (const v of live) {
            if (!v.id || seen.has(v.id)) continue;
            seen.add(v.id);
            baseList.push({
              id: v.id,
              name: `${v.name || v.id} (LA Studio)`,
              gender: 'neutral',
            });
          }
          sources.push('la-studio-api');
        } else {
          sources.push('la-studio-local-pack');
        }
      } catch {
        sources.push('la-studio-local-pack');
      }
      if (baseList.length) {
        setLangList(catalog, 'la_studio', 'vi', baseList);
        setLangList(
          catalog,
          'la_studio',
          'en',
          baseList.filter((x) => x.id === 'default').length
            ? baseList.filter((x) => x.id === 'default')
            : [{ id: 'default', name: 'Default (LA Studio)', gender: 'neutral' }],
        );
      }
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
