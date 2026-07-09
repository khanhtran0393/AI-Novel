import { NextResponse } from 'next/server';
import {
  loadVinaProfiles,
  mergeSettings,
  applyProfileToSettings,
  engineStatus,
  probeVinaEngine,
} from '@/lib/vinaVoice';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const profiles = loadVinaProfiles();
  const base = mergeSettings({});
  const list = profiles.map((p) => {
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
