import { NextResponse } from 'next/server';
import {
  loadVinaProfiles,
  mergeSettings,
  applyProfileToSettings,
  engineStatus,
  probeVinaEngine,
  deleteVinaProfile,
  deleteAllUserVinaProfiles,
} from '@/lib/vinaVoice';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function mapProfileList() {
  const profiles = loadVinaProfiles();
  const base = mergeSettings({});
  return profiles.map((p) => {
    const s = applyProfileToSettings(base, p);
    const isUser =
      p._source === 'user_upload' ||
      p._source === 'user_scan' ||
      /^USER/i.test(p.name);
    return {
      name: p.name,
      filename: p.filename,
      text: p.text,
      speaker_seed: p.speaker_seed,
      style_seed: p.style_seed,
      pitch_shift: p.pitch_shift,
      hasSample: !!s.reference_audio,
      samplePath: s.reference_audio || null,
      isUser,
      source: p._source || (isUser ? 'user' : 'catalog'),
    };
  });
}

export async function GET() {
  const list = mapProfileList();
  const status = engineStatus();
  const engine = await probeVinaEngine(status.defaultEngineUrl);
  return NextResponse.json({
    ok: true,
    count: list.length,
    userCount: list.filter((p) => p.isUser).length,
    profiles: list,
    status: { ...status, engine },
  });
}

/**
 * DELETE /api/vina-voice/profiles
 * Body: { name: string } | { allUser: true }
 * Xóa giọng USER clone khỏi profiles_user.json + file mẫu trên disk.
 */
export async function DELETE(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as {
      name?: string;
      allUser?: boolean;
    };

    if (body.allUser) {
      const result = deleteAllUserVinaProfiles();
      const list = mapProfileList();
      return NextResponse.json({
        ok: result.ok || result.deleted.length > 0,
        deleted: result.deleted,
        errors: result.errors,
        count: list.length,
        userCount: list.filter((p) => p.isUser).length,
        profiles: list,
      });
    }

    const name = String(body.name || '').trim();
    if (!name) {
      return NextResponse.json(
        { ok: false, error: 'Thiếu name (tên profile cần xóa).' },
        { status: 400 },
      );
    }

    const result = deleteVinaProfile(name);
    if (!result.ok) {
      return NextResponse.json(
        { ok: false, error: result.error, profileName: name },
        { status: result.error?.includes('catalog') ? 403 : 404 },
      );
    }

    const list = mapProfileList();
    return NextResponse.json({
      ok: true,
      profileName: result.profileName,
      deletedFiles: result.deletedFiles,
      count: list.length,
      userCount: list.filter((p) => p.isUser).length,
      profiles: list,
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
