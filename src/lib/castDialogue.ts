/**
 * Dialogue parse for Role Casting Studio — NFC names, stable content-hash IDs.
 * Supports:
 * - "Tên: thoại" / "Tên nói: thoại"
 * - Prose: Tên ... "thoại" / "thoại" Tên ...
 * - Multiple quotes + speakers in one paragraph
 */
import { cleanSegmentText } from './characterVoice';
import {
  makeSegmentId,
  normalizeSegText,
  type CastSegment,
  type CastSegmentSource,
  type ProjectVoiceCast,
  type VoiceRole,
  NARRATOR_ROLE_ID,
  characterRoleId,
  hash12,
  sceneKey,
  findRoleByCharacter,
} from './voiceCast';

export interface ParsedCastLine {
  speaker: string | null;
  text: string;
  source: CastSegmentSource;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const SPEECH_VERBS =
  'nói|hỏi|đáp|thét|bảo|thì\\s*thầm|gằn|cười|thở\\s*dài|gầm|khàn|lạnh\\s*lùng|cau\\s*mày|khoanh\\s*tay|lẩm\\s*bẩm|gào|thì thầm';

/**
 * Parse scene text into cast lines (speaker + text + source).
 */
export function parseCastDialogue(params: {
  sceneText: string;
  characterNames: string[];
}): ParsedCastLine[] {
  const { sceneText, characterNames } = params;
  if (!sceneText?.trim()) return [];

  const names = [...characterNames]
    .map((n) => n.trim().normalize('NFC'))
    .filter(Boolean)
    .sort((a, b) => b.length - a.length);

  const lines = sceneText
    .normalize('NFC')
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

  const raw: ParsedCastLine[] = [];

  for (const line of lines) {
    if (/^\[?CẢNH\s+\d+/i.test(line)) continue;

    // 1) Classic "Name: body"
    let matchedPrefix = false;
    for (const name of names) {
      const re = new RegExp(
        `^${escapeRegExp(name)}(?:\\s*(?:${SPEECH_VERBS}))?\\s*[:：]\\s*(.+)$`,
        'iu',
      );
      const m = line.match(re);
      if (m?.[1]?.trim()) {
        raw.push({
          speaker: name,
          text: cleanSegmentText(m[1]) || m[1].trim(),
          source: 'auto_name',
        });
        matchedPrefix = true;
        break;
      }
    }
    if (matchedPrefix) continue;

    // 2) Prose with one or more quotes — attribute each quote to nearest name
    const pieces = splitProseWithQuotes(line, names);
    if (pieces.length > 0) {
      raw.push(...pieces);
      continue;
    }

    // 3) Fallback: whole line narrator
    raw.push({ speaker: null, text: line, source: 'narrator' });
  }

  // Merge adjacent same speaker
  const merged: ParsedCastLine[] = [];
  for (const seg of raw) {
    const text = (seg.text || '').trim();
    if (!text) continue;
    const last = merged[merged.length - 1];
    if (last && last.speaker === seg.speaker) {
      last.text = `${last.text}\n${text}`;
    } else {
      merged.push({ ...seg, text });
    }
  }
  return merged;
}

/**
 * Split a prose line into narrator + dialogue attributed to characters.
 */
function splitProseWithQuotes(line: string, names: string[]): ParsedCastLine[] {
  const quoteRe = /[“"«]([^”"»]+)[”"»]/gu;
  const matches = [...line.matchAll(quoteRe)];
  if (matches.length === 0) {
    // No quotes — try "Name action" alone? keep as narrator
    return [];
  }

  const out: ParsedCastLine[] = [];
  let cursor = 0;

  for (const m of matches) {
    const full = m[0];
    const inner = m[1] || '';
    const start = m.index ?? 0;
    const end = start + full.length;

    // Narration before this quote
    const before = line.slice(cursor, start).trim();
    if (before) {
      // If "before" is only a name + short action, attach to next quote
      const nameOnly = matchTrailingSpeaker(before, names);
      if (!nameOnly) {
        out.push({ speaker: null, text: before, source: 'narrator' });
      }
    }

    const preContext = line.slice(Math.max(0, start - 48), start);
    const postContext = line.slice(end, Math.min(line.length, end + 48));
    let speaker =
      matchTrailingSpeaker(preContext, names) ||
      matchLeadingSpeaker(postContext, names) ||
      matchTrailingSpeaker(before, names);

    // "quote," Name said
    if (!speaker) {
      const afterSaid = tryQuoteAttribution(`${full} ${postContext}`.trim(), names);
      if (afterSaid) speaker = afterSaid.speaker;
    }

    const quoteText = cleanSegmentText(inner) || inner.trim();
    if (quoteText) {
      out.push({
        speaker,
        text: quoteText,
        source: speaker ? 'auto_name' : 'ambiguous',
      });
    }

    cursor = end;
  }

  const tail = line.slice(cursor).trim();
  if (tail) {
    // Strip pure attribution tails like "Khánh Ân khoanh tay."
    const onlyName = matchLeadingSpeaker(tail, names);
    if (onlyName && tail.length < onlyName.length + 40) {
      // leave as short narrator action or skip
      out.push({ speaker: null, text: tail, source: 'narrator' });
    } else {
      out.push({ speaker: null, text: tail, source: 'narrator' });
    }
  }

  // If every quote still null speaker and no names matched — not useful split
  const anySpeaker = out.some((o) => o.speaker);
  if (!anySpeaker && matches.length > 0) {
    // Still return quotes as ambiguous + narration — multi-seg for later manual cast
    return out;
  }
  return out;
}

function matchTrailingSpeaker(context: string, names: string[]): string | null {
  const t = context.trim();
  if (!t) return null;
  for (const name of names) {
    // Name at end of context (possibly with short action after)
    const re = new RegExp(
      `${escapeRegExp(name)}(?:\\s*(?:${SPEECH_VERBS}|cau\\s*mày|khoanh\\s*tay|lẩm\\s*bẩm)[^“"«]{0,24})?\\s*$`,
      'iu',
    );
    if (re.test(t)) return name;
    // Name appears near end
    const idx = t.lastIndexOf(name);
    if (idx >= 0 && t.length - idx < name.length + 28) return name;
  }
  return null;
}

function matchLeadingSpeaker(context: string, names: string[]): string | null {
  const t = context.trim();
  if (!t) return null;
  for (const name of names) {
    const re = new RegExp(
      `^\\s*${escapeRegExp(name)}(?:\\s|,|\\.|$)`,
      'iu',
    );
    if (re.test(t)) return name;
  }
  return null;
}

/** "…," Hàn Dực nói. / Hàn Dực nói: "…" */
function tryQuoteAttribution(
  text: string,
  names: string[],
): { speaker: string; text: string } | null {
  const t = text.trim();
  for (const name of names) {
    const reAfter = new RegExp(
      `^([“"«].+?[”"»])\\s*[,，]?\\s*${escapeRegExp(name)}\\s*(?:${SPEECH_VERBS})(?:\\s*[,.…]|$)`,
      'iu',
    );
    const m1 = t.match(reAfter);
    if (m1?.[1]) {
      return { speaker: name, text: m1[1] };
    }
    const reBefore = new RegExp(
      `^${escapeRegExp(name)}\\s*(?:${SPEECH_VERBS})?\\s*[:：]?\\s*([“"«].+[”"»])\\s*$`,
      'iu',
    );
    const m2 = t.match(reBefore);
    if (m2?.[1]) {
      return { speaker: name, text: m2[1] };
    }
  }
  return null;
}

export function roleIdForSpeaker(
  speaker: string | null,
  roles: VoiceRole[],
): string {
  if (!speaker) return NARRATOR_ROLE_ID;
  const found = findRoleByCharacter(roles, speaker);
  if (found) return found.id;
  return characterRoleId(speaker);
}

/**
 * Build CastSegment[] with stable ids + apply overrides + rebind on re-parse.
 */
export function buildSceneCastSegments(params: {
  sceneText: string;
  chapter: number;
  sceneIndex: number;
  characterNames: string[];
  cast: ProjectVoiceCast;
}): { segments: CastSegment[]; textHash: string; prunedOverrideIds: string[] } {
  const { sceneText, chapter, sceneIndex, characterNames, cast } = params;
  const lines = parseCastDialogue({ sceneText, characterNames });
  const textHash = hash12(sceneText.normalize('NFC'));
  const sk = sceneKey(chapter, sceneIndex);
  const prevHash = cast.sceneTextHashes?.[sk];
  const hashChanged = prevHash != null && prevHash !== textHash;

  const segments: CastSegment[] = lines.map((line, order) => {
    const speakerRoleId = roleIdForSpeaker(line.speaker, cast.roles);
    const id = makeSegmentId({
      chapter,
      sceneIndex,
      text: line.text,
      speakerGuess: line.speaker,
    });
    return {
      id,
      chapter,
      sceneIndex,
      order,
      speakerRoleId,
      text: line.text,
      source: line.source,
    };
  });

  const overrides = { ...(cast.segmentOverrides || {}) };
  const usedOverrideIds = new Set<string>();
  const prunedOverrideIds: string[] = [];

  for (const seg of segments) {
    let ov = overrides[seg.id];
    if (!ov) {
      const altId = makeSegmentId({
        chapter,
        sceneIndex,
        text: seg.text,
        speakerGuess: null,
      });
      if (overrides[altId] && !usedOverrideIds.has(altId)) {
        ov = overrides[altId];
      }
    }
    if (ov) {
      usedOverrideIds.add(seg.id);
      if (ov.speakerRoleId) seg.speakerRoleId = ov.speakerRoleId;
      if (ov.source) seg.source = ov.source;
      if (ov.locked != null) seg.locked = ov.locked;
      if (ov.confidence != null) seg.confidence = ov.confidence;
      if (cast.allowTextOverride && ov.text?.trim()) {
        seg.text = ov.text;
      }
    }
  }

  if (hashChanged) {
    for (const [oid, o] of Object.entries(overrides)) {
      if (usedOverrideIds.has(oid)) continue;
      if (!o.locked) {
        prunedOverrideIds.push(oid);
      }
    }
  }

  return { segments, textHash, prunedOverrideIds };
}
