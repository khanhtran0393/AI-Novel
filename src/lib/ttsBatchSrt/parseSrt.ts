/**
 * Robust SRT parser for TTS Batch SRT.
 * Supports: classic blocks, optional speaker "Name: text", multi-line dialogue.
 */

import type { SrtCue } from './types';

/** Parse "00:00:01,500" or "00:00:01.500" or "00:01:02" → ms */
export function parseSrtTimestamp(raw: string): number {
  const s = String(raw || '').trim().replace(',', '.');
  const m = s.match(/^(?:(\d+):)?(\d{1,2}):(\d{1,2})(?:\.(\d{1,3}))?$/);
  if (!m) {
    throw new Error(`SRT timestamp không hợp lệ: "${raw}"`);
  }
  const hours = m[1] != null ? Number(m[1]) : 0;
  const mins = Number(m[2]);
  const secs = Number(m[3]);
  const frac = m[4] != null ? m[4].padEnd(3, '0').slice(0, 3) : '0';
  const ms = Number(frac);
  if (![hours, mins, secs, ms].every((n) => Number.isFinite(n))) {
    throw new Error(`SRT timestamp không parse được: "${raw}"`);
  }
  return ((hours * 60 + mins) * 60 + secs) * 1000 + ms;
}

export function formatSrtTimestamp(ms: number): string {
  const n = Math.max(0, Math.round(ms));
  const h = Math.floor(n / 3_600_000);
  const m = Math.floor((n % 3_600_000) / 60_000);
  const s = Math.floor((n % 60_000) / 1000);
  const milli = n % 1000;
  const pad = (x: number, w = 2) => String(x).padStart(w, '0');
  return `${pad(h)}:${pad(m)}:${pad(s)},${pad(milli, 3)}`;
}

function splitSpeaker(text: string): { speaker?: string; text: string } {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return { text: '' };
  const first = lines[0];
  // "Hàn Dực: …" or "[Narrator] …"
  const colon = first.match(/^([^:]{1,40}):\s*(.+)$/u);
  if (colon && !/^\d+$/.test(colon[1])) {
    const rest = [colon[2], ...lines.slice(1)].join('\n').trim();
    return { speaker: colon[1].trim(), text: rest || colon[2].trim() };
  }
  const bracket = first.match(/^\[([^\]]{1,40})\]\s*(.*)$/u);
  if (bracket) {
    const rest = [bracket[2], ...lines.slice(1)].join('\n').trim();
    return { speaker: bracket[1].trim(), text: rest || first };
  }
  return { text: lines.join('\n') };
}

/**
 * Parse full SRT document → ordered cues.
 * Hard-fail if zero cues (B10: no fake sample).
 */
export function parseSrt(srtText: string): SrtCue[] {
  const raw = String(srtText || '')
    .replace(/^\uFEFF/, '')
    .replace(/\r\n/g, '\n')
    .trim();
  if (!raw) {
    throw new Error('SRT trống. Dán hoặc chọn file .srt có cue.');
  }

  const blocks = raw.split(/\n\s*\n+/);
  const cues: SrtCue[] = [];

  for (const block of blocks) {
    const lines = block.split('\n').map((l) => l.trimEnd()).filter((l) => l.length > 0);
    if (lines.length < 2) continue;

    let timeLineIdx = 0;
    // Optional numeric index line
    if (/^\d+$/.test(lines[0].trim()) && lines.length >= 3) {
      timeLineIdx = 1;
    }

    const timeLine = lines[timeLineIdx];
    const tm = timeLine.match(
      /(\d{1,2}:\d{1,2}:\d{1,2}[,.]\d{1,3}|\d{1,2}:\d{1,2}[,.]\d{1,3}|\d{1,2}:\d{1,2}:\d{1,2})\s*-->\s*(\d{1,2}:\d{1,2}:\d{1,2}[,.]\d{1,3}|\d{1,2}:\d{1,2}[,.]\d{1,3}|\d{1,2}:\d{1,2}:\d{1,2})/,
    );
    if (!tm) continue;

    const startMs = parseSrtTimestamp(normalizeTs(tm[1]));
    const endMs = parseSrtTimestamp(normalizeTs(tm[2]));
    if (endMs < startMs) {
      throw new Error(
        `Cue #${cues.length + 1}: end < start (${tm[1]} --> ${tm[2]})`,
      );
    }

    const textLines = lines.slice(timeLineIdx + 1);
    if (!textLines.length) continue;
    const body = textLines.join('\n').trim();
    if (!body) continue;

    const { speaker, text } = splitSpeaker(body);
    if (!text.trim()) continue;

    cues.push({
      index: cues.length + 1,
      startMs,
      endMs,
      text: text.trim(),
      speaker,
    });
  }

  if (!cues.length) {
    throw new Error(
      'Không parse được cue SRT nào. Cần block: index + timestamp --> + text.',
    );
  }

  return cues;
}

/** Ensure HH:MM:SS,mmm for parser when only MM:SS,mmm */
function normalizeTs(ts: string): string {
  const t = ts.trim().replace('.', ',');
  const parts = t.split(':');
  if (parts.length === 2) return `00:${t}`;
  return t;
}

export function srtSummary(cues: SrtCue[]): {
  count: number;
  durationSec: number;
  speakers: string[];
} {
  if (!cues.length) return { count: 0, durationSec: 0, speakers: [] };
  const last = cues[cues.length - 1];
  const speakers = [
    ...new Set(cues.map((c) => c.speaker).filter(Boolean) as string[]),
  ];
  return {
    count: cues.length,
    durationSec: Math.round((last.endMs / 1000) * 10) / 10,
    speakers,
  };
}

/** Serialize cues back to SRT text */
export function cuesToSrt(cues: SrtCue[]): string {
  return cues
    .map((c, i) => {
      const body = c.speaker ? `${c.speaker}: ${c.text}` : c.text;
      return `${i + 1}\n${formatSrtTimestamp(c.startMs)} --> ${formatSrtTimestamp(c.endMs)}\n${body}\n`;
    })
    .join('\n');
}

/**
 * Plain .txt → synthetic SRT (equal slots).
 * Splits on blank lines, then sentences / long lines.
 */
export function plainTextToSrt(
  text: string,
  opts?: { secondsPerCue?: number },
): string {
  const sec = Math.max(1.5, Number(opts?.secondsPerCue) || 4);
  const raw = String(text || '')
    .replace(/^\uFEFF/, '')
    .replace(/\r\n/g, '\n')
    .trim();
  if (!raw) {
    throw new Error('File .txt trống.');
  }

  let chunks: string[] = [];
  // Prefer paragraph blocks
  const paras = raw
    .split(/\n\s*\n+/)
    .map((p) => p.replace(/\n+/g, ' ').trim())
    .filter(Boolean);
  if (paras.length >= 2) {
    chunks = paras;
  } else {
    const one = paras[0] || raw.replace(/\n+/g, ' ').trim();
    // Split sentences (., !, ?, 。, ！, ？)
    const parts = one
      .split(/(?<=[.!?。！？…])\s+/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (parts.length >= 2) {
      chunks = parts;
    } else {
      // Hard wrap long line ~120 chars
      const words = one.split(/\s+/);
      let buf = '';
      for (const w of words) {
        if ((buf + ' ' + w).trim().length > 120 && buf) {
          chunks.push(buf.trim());
          buf = w;
        } else {
          buf = (buf + ' ' + w).trim();
        }
      }
      if (buf) chunks.push(buf);
    }
  }

  if (!chunks.length) throw new Error('Không tách được dòng text từ .txt');

  const cues: SrtCue[] = chunks.map((t, i) => {
    const startMs = Math.round(i * sec * 1000);
    const endMs = Math.round((i + 1) * sec * 1000 - 80);
    const { speaker, text: body } = (() => {
      const m = t.match(/^([^:]{1,40}):\s*(.+)$/u);
      if (m && !/^\d+$/.test(m[1])) {
        return { speaker: m[1].trim(), text: m[2].trim() };
      }
      return { text: t };
    })();
    return {
      index: i + 1,
      startMs,
      endMs: Math.max(endMs, startMs + 500),
      text: body,
      speaker,
    };
  });

  return cuesToSrt(cues);
}

export type SubtitleInputKind = 'srt' | 'txt' | 'empty';

/**
 * Accept .srt or plain .txt content → normalized SRT string.
 */
export function normalizeSubtitleInput(
  content: string,
  fileHint?: string,
): { srtText: string; kind: SubtitleInputKind } {
  const raw = String(content || '')
    .replace(/^\uFEFF/, '')
    .trim();
  if (!raw) return { srtText: '', kind: 'empty' };

  const hint = String(fileHint || '').toLowerCase();
  const looksSrt =
    /-->/.test(raw) ||
    hint.endsWith('.srt') ||
    /^\d+\s*\n\d{1,2}:\d{2}/m.test(raw);

  if (looksSrt) {
    // Validate parse
    const cues = parseSrt(raw);
    return { srtText: cuesToSrt(cues), kind: 'srt' };
  }

  // Plain text
  const srtText = plainTextToSrt(raw);
  parseSrt(srtText); // hard-fail if broken
  return { srtText, kind: 'txt' };
}
