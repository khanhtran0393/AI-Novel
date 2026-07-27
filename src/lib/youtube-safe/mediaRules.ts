import { SHOT_SCALE_CYCLE } from './config';
import { stripImageCacheBust } from '@/lib/mediaReference';

export function buildShotDiversityBlock(): string {
  return `
SHOT DIVERSITY / SHOT GRAPH (YouTube anti-slideshow):
- Cycle camera scale across consecutive items: wide → medium → close-up → insert detail → OTS/dutch.
- Never repeat the same framing/pose/background layout on adjacent ids.
- Prefer tactile materials, practical light; avoid generic 8k/masterpiece spam tags.
- Each image_prompt must imply DISTINCT composition (subject size in frame, lens feel, depth layers).`;
}

/** Pre-TTS: insert breath-friendly line breaks after sentence ends */
export function injectBreathPauses(text: string): string {
  if (!text) return '';
  return text
    .normalize('NFC')
    .replace(/\r\n/g, '\n')
    .replace(/([.!?…。！？])(["'”’])?\s+/g, '$1$2\n\n')
    .replace(/([,;，；])\s+/g, '$1 ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function emotionPitchOffset(emotion?: string): number {
  const e = (emotion || '').toLowerCase();
  if (!e) return 0;
  if (/sợ|kinh|hoảng|fear|panic|terror|anxiety/.test(e)) return 0.6;
  if (/giận|tức|rage|anger|fury/.test(e)) return 0.35;
  if (/buồn|đau|sad|grief|melancholy/.test(e)) return -0.55;
  if (/thì thầm|whisper|quiet|cold/.test(e)) return -0.75;
  if (/vui|hype|excited|joy/.test(e)) return 0.4;
  if (/căng|tense|suspense/.test(e)) return 0.2;
  return 0;
}

export function applyShotScaleToPrompt(imagePrompt: string, index: number): string {
  const scale = SHOT_SCALE_CYCLE[index % SHOT_SCALE_CYCLE.length];
  const base = (imagePrompt || '').trim();
  if (!base) return scale;
  if (new RegExp(scale.split(',')[0], 'i').test(base)) return base;
  return `${scale}, ${base}`;
}

export function enforceShotGraphOnPrompts<
  T extends { image_prompt?: string; imagePrompt?: string },
>(items: T[]): T[] {
  return items.map((item, i) => {
    const key = item.image_prompt != null ? 'image_prompt' : 'imagePrompt';
    const raw = (item as { image_prompt?: string; imagePrompt?: string }).image_prompt
      ?? (item as { imagePrompt?: string }).imagePrompt
      ?? '';
    const next = applyShotScaleToPrompt(String(raw), i);
    return { ...item, [key]: next } as T;
  });
}

export function checkImagePathReuse(
  imagePath: string,
  existing: Record<string, string>,
  currentKey: string,
): { reused: boolean; otherKey?: string } {
  const norm = stripImageCacheBust(imagePath)
    .replace(/\\/g, '/')
    .toLowerCase();
  if (!norm) return { reused: false };
  for (const [k, v] of Object.entries(existing || {})) {
    if (k === currentKey) continue;
    const ov = stripImageCacheBust(v).replace(/\\/g, '/').toLowerCase();
    if (ov && ov === norm) return { reused: true, otherKey: k };
  }
  return { reused: false };
}
