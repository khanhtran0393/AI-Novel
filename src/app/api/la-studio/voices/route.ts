/**
 * GET  /api/la-studio/voices?familyId=...
 *   → giọng **theo family** (không gộp 14 Kokoro cho mọi nền tảng)
 *   + userClones durable (data/la-studio/user-clones)
 * POST /api/la-studio/voices — save clone to disk + best-effort LA Studio API / Omni
 * DELETE /api/la-studio/voices?id=lsc_… — xóa clone đã lưu
 */
import { NextRequest, NextResponse } from 'next/server';
import {
  createLaStudioVoice,
  ensureLaStudioApiReady,
  isKokoroCliReady,
  listLaStudioVoices,
  loadLocalKokoroViVoices,
  probeLaStudioHealth,
  resolveLaStudioApiKey,
  resolveLaStudioBaseUrl,
} from '@/lib/laStudioLocal';
import {
  discoverVoicesForFamily,
  discoverAllFamilyVoiceCounts,
} from '@/lib/laStudioVoiceDiscover';
import { LA_STUDIO_DEFAULT_FAMILY } from '@/lib/laStudioRuntimes';
import { requireFeature } from '@/lib/commercial/apiGate';
import {
  cloneSamplePublicUrl,
  deleteLaStudioUserClone,
  listLaStudioUserClones,
  saveLaStudioUserClone,
  updateLaStudioUserClone,
  userClonesAsVoiceOptions,
} from '@/lib/laStudioClones';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function GET(req: NextRequest) {
  const denied = await requireFeature(req, 'tts_premium');
  if (denied) return denied;
  const familyId =
    req.nextUrl.searchParams.get('familyId')?.trim() ||
    LA_STUDIO_DEFAULT_FAMILY;
  /** Sau tải family trên máy user: await bake để ▶ sẵn sàng ngay */
  const ensureSamples =
    req.nextUrl.searchParams.get('ensureSamples') === '1' ||
    req.nextUrl.searchParams.get('ensureSamples') === 'true';

  let sampleBake: Record<string, unknown> = {
    status: 'background',
    note: 'Baking sample WAVs in background if missing',
  };

  if (ensureSamples) {
    try {
      const { prepareFamilySamplesForShip } = await import(
        '@/lib/laStudioSampleVoices'
      );
      const prep = await prepareFamilySamplesForShip(familyId);
      sampleBake = {
        status: 'done',
        readyCount: prep.readyCount,
        voiceCount: prep.voiceCount,
        baked: prep.baked,
        skipped: prep.skipped,
        errors: prep.errors.slice(0, 8),
      };
    } catch (e) {
      sampleBake = {
        status: 'error',
        note: e instanceof Error ? e.message : String(e),
      };
    }
  } else {
    // Fast path: list ngay; bake nền (lần GET sau có URL)
    void (async () => {
      try {
        const { prepareFamilySamplesForShip } = await import(
          '@/lib/laStudioSampleVoices'
        );
        await prepareFamilySamplesForShip(familyId);
      } catch {
        /* optional */
      }
    })();
  }

  const discovered = discoverVoicesForFamily(familyId);
  const base = resolveLaStudioBaseUrl();
  const health = await probeLaStudioHealth(base, 1200);

  // API voices only when desktop has model loaded AND we request that family
  // (API list is for currently loaded model — not a shared 14-voice dump)
  let apiVoices: Array<{
    id: string;
    name: string;
    detail?: string;
    source: 'api';
    familyId: string;
  }> = [];
  if (health.online && health.ttsLoaded) {
    try {
      const live = await listLaStudioVoices(base, resolveLaStudioApiKey(), 3500);
      // Only attach API voices when family is not pure kokoro-cli offline, or API is only source
      const apiOnly =
        discovered.voices.length === 0 ||
        familyId !== 'kokoro-vietnamese';
      if (apiOnly || familyId !== 'kokoro-vietnamese') {
        // For kokoro family: prefer disk; for other families: merge API if loaded
        if (familyId !== 'kokoro-vietnamese') {
          apiVoices = live
            .filter((v) => v.id && v.id !== 'default')
            .map((v) => ({
              id: v.id,
              name: v.name || v.id,
              detail: v.detail || 'api',
              source: 'api' as const,
              familyId,
            }));
        }
      }
    } catch {
      apiVoices = [];
    }
  }

  // Merge: disk first (discovered), then API ids not already present
  const byId = new Map<string, (typeof discovered.voices)[0]>();
  for (const v of discovered.voices) {
    byId.set(v.id, v);
  }
  for (const v of apiVoices) {
    if (!byId.has(v.id)) {
      byId.set(v.id, {
        id: v.id,
        name: v.name,
        detail: v.detail,
        source: 'api',
        familyId,
      });
    }
  }

  const voices = [...byId.values()].sort((a, b) =>
    a.name.localeCompare(b.name, 'vi'),
  );

  // Kokoro list only when this family is kokoro — never as global fallback
  const kokoroOnly =
    familyId === 'kokoro-vietnamese' ? loadLocalKokoroViVoices() : [];

  // Enrich: samplePublicUrl + source for UI ▶ nhanh
  const voicesOut = voices.map((v) => ({
    id: v.id,
    name: v.name,
    detail: v.detail,
    source: v.source,
    familyId: v.familyId,
    samplePublicUrl: v.samplePublicUrl,
    previewUrl: v.samplePublicUrl,
  }));

  const userClones = listLaStudioUserClones();
  const userCloneVoices = userClonesAsVoiceOptions(userClones);
  const includeClones =
    req.nextUrl.searchParams.get('includeClones') === '1' ||
    req.nextUrl.searchParams.get('includeClones') === 'true' ||
    familyId === 'user-clones' ||
    familyId === 'omnivoice';

  // Merge durable clones into list when requested / Omni / user-clones family
  const mergedVoices = includeClones
    ? [
        ...userCloneVoices,
        ...voicesOut.filter((v) => !userCloneVoices.some((c) => c.id === v.id)),
      ]
    : voicesOut;

  return NextResponse.json({
    ok: mergedVoices.length > 0 || userClones.length > 0 || isKokoroCliReady() || health.online,
    familyId: discovered.familyId,
    familyTitle: discovered.familyTitle,
    portableRoot: discovered.portableRoot,
    howToPreview: discovered.howToPreview,
    voiceCount: mergedVoices.length,
    /** Voices for THIS family only (kèm samplePublicUrl nếu đã bake) */
    voices: mergedVoices,
    /** Durable user clones (always, for Voice Clone tab) */
    userClones: userCloneVoices,
    userCloneCount: userClones.length,
    /** Deprecated alias: only filled for kokoro-vietnamese */
    kokoro: kokoroOnly,
    online: health.online,
    ttsLoaded: health.ttsLoaded ?? null,
    baseUrl: health.baseUrl,
    kokoroCliReady: isKokoroCliReady(),
    /** Per-family voice counts — debug why UI looked "shared" */
    familyVoiceCounts: discoverAllFamilyVoiceCounts(),
    sampleBake,
  });
}

export async function POST(req: NextRequest) {
  let body: {
    name?: string;
    audioBase64?: string;
    language?: string;
    sourceName?: string;
    familyId?: string;
    /** Prefer Omni profile when family is omnivoice */
    preferOmni?: boolean;
  } = {};
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: 'JSON body required' }, { status: 400 });
  }
  const denied = await requireFeature(req, 'tts_premium', body);
  if (denied) return denied;
  const name = String(body.name || '').trim() || `clone_${Date.now().toString(36)}`;
  const audioBase64 = String(body.audioBase64 || '')
    .replace(/^data:audio\/[^;]+;base64,/, '')
    .trim();
  if (!audioBase64) {
    return NextResponse.json(
      { error: 'Thiếu audioBase64 (WAV/MP3 mẫu).' },
      { status: 400 },
    );
  }

  let audioBuf: Buffer;
  try {
    audioBuf = Buffer.from(audioBase64, 'base64');
  } catch {
    return NextResponse.json({ error: 'audioBase64 không hợp lệ.' }, { status: 400 });
  }
  if (audioBuf.length < 1000) {
    return NextResponse.json(
      { error: 'File mẫu quá nhỏ / rỗng (tối thiểu ~1KB).' },
      { status: 400 },
    );
  }
  if (audioBuf.length > 40 * 1024 * 1024) {
    return NextResponse.json({ error: 'File mẫu tối đa 40MB.' }, { status: 400 });
  }

  // Detect container from magic bytes (prefer wav/mp3)
  let ext = '.wav';
  if (audioBuf[0] === 0x49 && audioBuf[1] === 0x44 && audioBuf[2] === 0x33) {
    ext = '.mp3';
  } else if (audioBuf[0] === 0xff && (audioBuf[1] & 0xe0) === 0xe0) {
    ext = '.mp3';
  } else if (
    audioBuf[0] === 0x52 &&
    audioBuf[1] === 0x49 &&
    audioBuf[2] === 0x46 &&
    audioBuf[3] === 0x46
  ) {
    ext = '.wav';
  } else if (String(body.sourceName || '').toLowerCase().endsWith('.mp3')) {
    ext = '.mp3';
  }

  // 1) Always persist to disk first — user can list / ▶ / reuse after restart
  const saved = saveLaStudioUserClone({
    name,
    audioBuffer: audioBuf,
    ext,
    language: body.language || 'vi',
    sourceName: body.sourceName,
  });

  const familyId = String(body.familyId || '').trim();
  const preferOmni =
    body.preferOmni === true ||
    familyId === 'omnivoice' ||
    familyId === 'omnivoice_local';

  let laStudioApiId: string | undefined;
  let omniProfileId: string | undefined;
  const registerNotes: string[] = [];

  // 2) Best-effort register on LA Studio desktop API (session)
  try {
    await ensureLaStudioApiReady({ spawnApp: true, hidden: true, pollMs: 12_000 });
    const voice = await createLaStudioVoice({
      name: saved.name,
      audioBase64,
      language: body.language || 'vi',
    });
    laStudioApiId = voice.id;
    updateLaStudioUserClone(saved.id, { laStudioApiId });
    registerNotes.push(`LA Studio API id=${voice.id}`);
  } catch (e) {
    registerNotes.push(
      `LA Studio API: ${e instanceof Error ? e.message : String(e)}`.slice(0, 160),
    );
  }

  // 3) Best-effort Omni profile (when Omni family or LA Studio API failed)
  if (preferOmni || !laStudioApiId) {
    try {
      const { ensureOmniCloneProfile, ensureOmniServer } = await import(
        '@/lib/omnivoiceLocal'
      );
      const hit = (
        await import('@/lib/laStudioClones')
      ).resolveCloneAudioPath(saved.id);
      if (hit?.path) {
        const base = await ensureOmniServer();
        const profileId = saved.id
          .replace(/^lsc_/, 'omni_')
          .replace(/[^a-zA-Z0-9_-]/g, '')
          .slice(0, 48);
        const pid = await ensureOmniCloneProfile(base, profileId, hit.path);
        omniProfileId = pid;
        updateLaStudioUserClone(saved.id, { omniProfileId: pid });
        registerNotes.push(`Omni profile=${pid}`);
      }
    } catch (e) {
      registerNotes.push(
        `Omni: ${e instanceof Error ? e.message : String(e)}`.slice(0, 160),
      );
    }
  }

  const platform = omniProfileId && preferOmni ? 'omnivoice_local' : 'la_studio';
  // Prefer durable local id so list/preview always work; synth re-registers if needed
  const voiceId = saved.id;
  const synthVoice =
    platform === 'omnivoice_local' && omniProfileId
      ? omniProfileId.startsWith('clone:')
        ? omniProfileId
        : `clone:${omniProfileId}`
      : laStudioApiId || saved.id;

  return NextResponse.json({
    ok: true,
    saved: true,
    voice: {
      id: voiceId,
      name: saved.name,
      synthVoice,
      laStudioApiId: laStudioApiId || null,
      omniProfileId: omniProfileId || null,
      previewUrl: cloneSamplePublicUrl(saved.id),
      samplePublicUrl: cloneSamplePublicUrl(saved.id),
      source: 'user-clone',
    },
    platform,
    userClones: userClonesAsVoiceOptions(listLaStudioUserClones()),
    registerNotes,
    message: laStudioApiId || omniProfileId
      ? `Đã lưu «${saved.name}» (id=${saved.id}). ${registerNotes.join(' · ')}. Bấm ▶ nghe mẫu hoặc Nghe thử TTS.`
      : `Đã lưu «${saved.name}» trên máy (id=${saved.id}). Engine clone offline — bật Engine ẩn / Omni rồi Nghe thử. Mẫu WAV vẫn ▶ được.`,
  });
}

export async function DELETE(req: NextRequest) {
  const denied = await requireFeature(req, 'tts_premium');
  if (denied) return denied;
  const id =
    req.nextUrl.searchParams.get('id')?.trim() ||
    req.nextUrl.searchParams.get('voiceId')?.trim() ||
    '';
  if (!id) {
    return NextResponse.json({ error: 'Thiếu id clone (lsc_…)' }, { status: 400 });
  }
  const ok = deleteLaStudioUserClone(id);
  if (!ok) {
    return NextResponse.json(
      { error: `Không tìm thấy clone «${id}»` },
      { status: 404 },
    );
  }
  return NextResponse.json({
    ok: true,
    deleted: id,
    userClones: userClonesAsVoiceOptions(listLaStudioUserClones()),
  });
}
