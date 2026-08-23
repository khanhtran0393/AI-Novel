/**
 * Parse SRT subtitle files → cutsdk CaptionClipSpec[] for CapCut text tracks.
 *
 * Converts standard .srt format into CapCut-compatible caption clips that
 * appear as editable text tracks in the CapCut timeline.
 *
 * cutsdk time format: string like '0s', '3.5s' or number in microseconds.
 * We use string format for readability.
 */

import fs from 'fs';

// ─── cutsdk-compatible types (mirrors cutsdk/types) ───

export interface CaptionClipSpec {
  type: 'caption';
  text: string;
  start: string;   // e.g. '0s', '3.5s'
  duration: string; // e.g. '5s'
  position?: 'top' | 'center' | 'bottom';
  style?: TextStyleSpec;
  fontSize?: number;
  keyword?: string;
  keywordColor?: string;
}

export interface TextStyleSpec {
  font?: string;
  fontSize?: number;
  color?: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  alpha?: number;
  borderColor?: string;
  textEffect?: string;
  letterSpacing?: number;
  lineSpacing?: number;
  shadow?: boolean | {
    color?: string;
    alpha?: number;
    diffuse?: number;
    distance?: number;
    angle?: number;
  };
}

export type SubStylePreset = 'cinema' | 'tiktok' | 'bilingual';

// ─── SRT Parsing ───

interface SrtEntry {
  index: number;
  startSec: number;
  endSec: number;
  text: string;
}

/**
 * Parse SRT timecode "HH:MM:SS,mmm" → seconds (float).
 */
function parseSrtTime(tc: string): number {
  // Format: 00:01:23,456 or 00:01:23.456
  const cleaned = tc.trim().replace(',', '.');
  const parts = cleaned.split(':');
  if (parts.length !== 3) return 0;
  const h = parseFloat(parts[0]) || 0;
  const m = parseFloat(parts[1]) || 0;
  const s = parseFloat(parts[2]) || 0;
  return h * 3600 + m * 60 + s;
}

/**
 * Parse raw SRT text content into structured entries.
 */
export function parseSrt(srtContent: string): SrtEntry[] {
  const entries: SrtEntry[] = [];
  // Normalize line endings
  const normalized = srtContent.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  // Split by double newline (entry separator)
  const blocks = normalized.split(/\n\n+/).filter(b => b.trim());

  for (const block of blocks) {
    const lines = block.split('\n').filter(l => l.trim());
    if (lines.length < 2) continue;

    // First line: index (might be just a number)
    const indexLine = lines[0].trim();
    if (!/^\d+$/.test(indexLine)) continue;
    const index = parseInt(indexLine, 10);

    // Second line: timecodes "00:00:01,000 --> 00:00:04,500"
    const tcLine = lines[1].trim();
    const tcMatch = tcLine.match(
      /(\d{1,2}:\d{2}:\d{2}[,.]\d{3})\s*-->\s*(\d{1,2}:\d{2}:\d{2}[,.]\d{3})/,
    );
    if (!tcMatch) continue;

    const startSec = parseSrtTime(tcMatch[1]);
    const endSec = parseSrtTime(tcMatch[2]);

    // Remaining lines: subtitle text (may be multi-line)
    const textLines = lines.slice(2);
    const text = textLines.join(' ').trim();
    if (!text) continue;

    entries.push({ index, startSec, endSec, text });
  }

  return entries;
}

/**
 * Read SRT file from disk and parse it.
 */
export function parseSrtFile(srtPath: string): SrtEntry[] {
  if (!fs.existsSync(srtPath)) return [];
  const content = fs.readFileSync(srtPath, 'utf8');
  return parseSrt(content);
}

// ─── Style Presets ───

/**
 * Get cutsdk TextStyleSpec for a subtitle style preset.
 */
export function getCapCutSubtitleStyle(preset: SubStylePreset = 'cinema'): TextStyleSpec {
  switch (preset) {
    case 'tiktok':
      return {
        fontSize: 8, // cutsdk fontSize scale (not px)
        bold: true,
        color: '#FFFF00',     // Yellow
        borderColor: '#000000',
        shadow: {
          color: '#000000',
          alpha: 0.8,
          diffuse: 2,
          distance: 2,
          angle: 135,
        },
      };
    case 'bilingual':
      return {
        fontSize: 7,
        bold: true,
        color: '#FFFFFF',
        borderColor: '#333333',
        shadow: {
          color: '#000000',
          alpha: 0.9,
          diffuse: 3,
          distance: 1,
          angle: 180,
        },
      };
    case 'cinema':
    default:
      return {
        fontSize: 6,
        bold: false,
        color: '#FFFFFF',
        borderColor: '#000000',
        shadow: {
          color: '#000000',
          alpha: 0.6,
          diffuse: 1,
          distance: 1,
          angle: 135,
        },
      };
  }
}

// ─── Main Conversion ───

/**
 * Convert SRT entries → cutsdk CaptionClipSpec[] for CapCut draft text track.
 *
 * @param srtEntries - Parsed SRT entries
 * @param preset - Style preset (cinema/tiktok/bilingual)
 * @param position - Text position on screen
 * @returns Array of caption clips ready for cutsdk tracks[{ type: 'text', clips }]
 */
export function srtToCaptionClips(
  srtEntries: SrtEntry[],
  preset: SubStylePreset = 'cinema',
  position: 'top' | 'center' | 'bottom' = 'bottom',
): CaptionClipSpec[] {
  const style = getCapCutSubtitleStyle(preset);

  return srtEntries
    .filter(e => e.endSec > e.startSec && e.text.trim())
    .map(entry => {
      const duration = entry.endSec - entry.startSec;
      return {
        type: 'caption' as const,
        text: entry.text.normalize('NFC'),
        start: `${entry.startSec.toFixed(3)}s`,
        duration: `${duration.toFixed(3)}s`,
        position,
        style,
        fontSize: style.fontSize,
      };
    });
}

/**
 * One-shot: read SRT file → cutsdk CaptionClipSpec[].
 *
 * @param srtPath - Absolute path to .srt file
 * @param preset - Style preset
 * @returns Caption clips for cutsdk text track, or empty array if file not found
 */
export function srtFileToCaptionClips(
  srtPath: string,
  preset: SubStylePreset = 'cinema',
  position: 'top' | 'center' | 'bottom' = 'bottom',
): CaptionClipSpec[] {
  const entries = parseSrtFile(srtPath);
  if (entries.length === 0) return [];
  return srtToCaptionClips(entries, preset, position);
}
