/**
 * Chunking + pause schedule — mirrors Vina max_chars / markers / pause_*_ms.
 */
import type { VinaChunk, VinaVoiceSettings } from './types';

function lastSentenceBreak(s: string, max: number): number {
  const window = s.slice(0, max);
  const candidates = ['.', '!', '?', '…', '。', ';', '\n'];
  let best = -1;
  for (const c of candidates) {
    const i = window.lastIndexOf(c);
    if (i > best) best = i;
  }
  if (best >= 40) return best + 1;
  const sp = window.lastIndexOf(' ');
  if (sp >= 40) return sp + 1;
  return max;
}

function pauseForEnding(chunk: string, settings: VinaVoiceSettings): number {
  const t = chunk.trimEnd();
  const last = t[t.length - 1] || '';
  if (last === '.' || last === '…' || last === '。') return settings.pause_dot_ms;
  if (last === ',') return settings.pause_comma_ms;
  if (last === '?' || last === '？') return settings.pause_question_ms;
  if (last === ';') return settings.pause_semicolon_ms;
  if (last === '!' || last === '！') return settings.pause_exclamation_ms;
  return Math.round(settings.pause_comma_ms * 0.6);
}

export function chunkVinaText(
  text: string,
  settings: Pick<
    VinaVoiceSettings,
    | 'max_chars_per_chunk'
    | 'chunk_length_buffer'
    | 'list_markers'
    | 'pause_dot_ms'
    | 'pause_comma_ms'
    | 'pause_question_ms'
    | 'pause_semicolon_ms'
    | 'pause_exclamation_ms'
    | 'chunking_strategy'
  >,
): VinaChunk[] {
  const raw = (text || '').normalize('NFC').trim();
  if (!raw) return [];

  const max = Math.max(40, settings.max_chars_per_chunk || 125);
  const markers = (settings.list_markers || '- * •').split(/\s+/).filter(Boolean);

  // Prefer split on list markers / paragraphs first
  let parts: string[] = [];
  const lines = raw.split(/\n+/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let rest = trimmed;
    for (const m of markers) {
      if (rest.startsWith(m + ' ') || rest.startsWith(m)) {
        rest = rest.slice(m.length).trim();
        break;
      }
    }
    parts.push(rest);
  }
  if (parts.length === 0) parts = [raw];

  const chunks: VinaChunk[] = [];
  let idx = 0;

  for (const part of parts) {
    let remaining = part.trim();
    while (remaining.length > 0) {
      if (remaining.length <= max + (settings.chunk_length_buffer || 0)) {
        chunks.push({
          index: idx++,
          text: remaining,
          pauseAfterMs: pauseForEnding(remaining, settings as VinaVoiceSettings),
        });
        break;
      }
      const cut = lastSentenceBreak(remaining, max);
      const piece = remaining.slice(0, cut).trim();
      if (piece) {
        chunks.push({
          index: idx++,
          text: piece,
          pauseAfterMs: pauseForEnding(piece, settings as VinaVoiceSettings),
        });
      }
      remaining = remaining.slice(cut).trim();
    }
  }

  // last chunk: no trailing pause needed (still set small)
  if (chunks.length) {
    chunks[chunks.length - 1].pauseAfterMs = Math.min(
      chunks[chunks.length - 1].pauseAfterMs,
      120,
    );
  }
  return chunks;
}
