/**
 * After chapter TTS force-gen: concat all scene audio → one MP3 + SRT,
 * save under active channel savePathRoot (or savePathTTS / Drive TTS folder).
 */
import { formatSrtTimestamp } from '@/lib/ttsBatchSrt/parseSrt';
import type { ProjectVoiceCast } from '@/lib/voiceCast';
import { normalizeVoiceCast } from '@/lib/voiceCast';
import { isHookSceneIndex } from '@/lib/youtubeSafe';

export type ChapterExportScene = {
  sceneIndex: number;
  title: string;
  text: string;
  audioPath: string;
  durationSec: number;
};

export function resolveChapterTtsOutputDir(input: {
  channelSavePathRoot?: string | null;
  savePathTTS?: string | null;
  googleDrivePath?: string | null;
}): string {
  const channel = String(input.channelSavePathRoot || '').trim();
  if (channel) return channel;
  const tts = String(input.savePathTTS || '').trim();
  if (tts) return tts;
  const base = String(input.googleDrivePath || '').trim();
  if (!base) return '';
  return `${base}${base.includes('/') ? '/' : '\\'}Am Thanh TTS`;
}

function estimateDurationSec(text: string, wpm = 140): number {
  const words = String(text || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
  return Math.max(1.5, (words / Math.max(60, wpm)) * 60);
}

function splitSceneBySpeaker(
  scene: string,
  characterNames: string[],
): Array<{ speaker: string | null; text: string }> {
  const raw = (scene || '').normalize('NFC').trim();
  if (!raw) return [{ speaker: null, text: '' }];
  const parts = raw
    .split(/\n+/)
    .map((l) => l.trim())
    .filter(Boolean);
  const nameAlt = characterNames
    .map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('|');
  const re = nameAlt
    ? new RegExp(`^(${nameAlt})\\s*[:：]\\s*(.+)$`, 'i')
    : null;
  const out: Array<{ speaker: string | null; text: string }> = [];
  for (const line of parts.length ? parts : [raw]) {
    const m = re ? line.match(re) : null;
    if (m) out.push({ speaker: m[1]!.trim(), text: m[2]!.trim() });
    else out.push({ speaker: null, text: line });
  }
  return out.length ? out : [{ speaker: null, text: raw }];
}

/** Build chapter SRT timed from real per-scene audio durations. */
export function buildChapterSrt(input: {
  scenes: ChapterExportScene[];
  cast?: ProjectVoiceCast | null;
  characterNames?: string[];
  wpm?: number;
}): string {
  const names = [
    ...(input.characterNames || []),
    ...(normalizeVoiceCast(input.cast || undefined).roles || [])
      .filter((r) => r.kind === 'character' && r.characterName)
      .map((r) => r.characterName as string),
  ];
  const uniqueNames = [
    ...new Set(
      names.map((n) => n.normalize('NFC').trim()).filter(Boolean),
    ),
  ];

  let tMs = 0;
  const lines: string[] = [];
  let cue = 1;

  for (const sc of input.scenes) {
    const sceneDurSec =
      sc.durationSec > 0
        ? sc.durationSec
        : estimateDurationSec(sc.text, input.wpm ?? 140);
    const sceneDurMs = Math.max(400, Math.round(sceneDurSec * 1000));
    const segs = splitSceneBySpeaker(sc.text, uniqueNames);
    const totalWeight =
      segs.reduce((s, x) => s + Math.max(1, x.text.length), 0) || 1;
    let accMs = 0;
    for (const seg of segs) {
      const weight = Math.max(1, seg.text.length) / totalWeight;
      const durMs = Math.max(400, Math.round(sceneDurMs * weight));
      const start = formatSrtTimestamp(tMs + accMs);
      const end = formatSrtTimestamp(tMs + accMs + durMs);
      accMs += durMs;
      const body = seg.text.replace(/\s+/g, ' ').trim().slice(0, 280);
      const label = isHookSceneIndex(sc.sceneIndex) ? 'Hook' : sc.title;
      const text = seg.speaker
        ? `[${seg.speaker}] ${body}`
        : body || label;
      lines.push(String(cue++), `${start} --> ${end}`, text, '');
    }
    tMs += sceneDurMs;
  }
  return lines.join('\n');
}

export function safeProjectSlug(title: string): string {
  return (
    String(title || 'Truyen')
      .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
      .trim() || 'Truyen'
  );
}

export function chapterFullAudioBasename(
  title: string,
  chapter: number,
): { local: string; drive: string; srtLocal: string; srtDrive: string } {
  const safe = safeProjectSlug(title);
  const ch = Number(chapter);
  return {
    local: `chapter_${ch}_full.mp3`,
    drive: `${safe}_Chuong_${ch}_Full.mp3`,
    srtLocal: `chapter_${ch}_full.srt`,
    srtDrive: `${safe}_Chuong_${ch}_Full.srt`,
  };
}
