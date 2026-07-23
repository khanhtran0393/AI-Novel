/**
 * Compose V_topic ⊗ V_style + classify pair group + layer flags.
 */

import { nfcLabel } from './catalog';
import { resolveTopicVector } from './topicVectors';
import { resolveStyleVector } from './styleVectors';
import type { MatrixComposition, MatrixLayerFlags } from './types';

/** Topic×style pairs often seen as "textbook" natural fits */
const NATURAL_HINTS: Array<[RegExp, RegExp]> = [
  [/tu tiên|tiên hiệp|huyền huyễn|đông phương/i, /linh khí|võ hiệp|kỳ ảo|thần thoại|hệ thống/i],
  [/đô thị|siêu anh hùng/i, /trùng sinh|báo thù|phản công|thương chiến|hệ thống|y học|ngôn tình/i],
  [/dystopia|hắc ám|military/i, /sinh tồn|du hành|quân sự|game|vô hạn/i],
  [/cổ đại/i, /cung đấu|võ hiệp|chính trị|ngôn tình/i],
  [/huyền nghi|noir|thriller|gothic|tâm lý/i, /kinh dị|trinh thám|tình báo/i],
  [/cyberpunk|steampunk|hard sci|viễn tưởng|không gian/i, /cơ giáp|tình báo|game|thương chiến|dị năng/i],
  [/lit\s*rpg|isekai/i, /game|xuyên không|hệ thống|kỳ ảo/i],
  [/romantasy|slice of life/i, /ngôn tình|học đường|ẩm thực/i],
];

/** High emotional contrast pairs */
const CONTRAST_HINTS: Array<[RegExp, RegExp]> = [
  [/hài hước/i, /hắc ám|gothic|kinh dị|thriller|noir/i],
  [/ẩm thực|slice of life/i, /gothic|hắc ám|dystopia|thriller/i],
  [/học đường/i, /hắc ám|kinh dị|noir/i],
  [/nông trường/i, /cyberpunk|dystopia|hắc ám/i],
  [/ngôn tình/i, /military|dystopia|hắc ám/i],
];

function classifyPair(
  topicName: string,
  styleName: string,
  topicCatalog: boolean,
  styleCatalog: boolean,
): MatrixLayerFlags['pairGroup'] {
  const t = topicName;
  const s = styleName;
  if (/đồng nhân/i.test(t) || /đồng nhân/i.test(s)) return 'freeform';
  for (const [sr, tr] of CONTRAST_HINTS) {
    if (
      (tr.test(t) && sr.test(s)) ||
      (sr.test(t) && tr.test(s)) ||
      (tr.test(t) && tr.test(s)) ||
      (sr.test(s) && tr.test(t))
    ) {
      // refine: topic vs style
      if ((tr.test(t) && sr.test(s)) || (sr.test(t) && tr.test(s))) return 'contrast';
    }
  }
  // dedicated contrast checks
  if (/hài hước/i.test(t) && /hắc ám|gothic|kinh dị|thriller|noir/i.test(s)) return 'contrast';
  if (/ẩm thực/i.test(t) && /gothic|hắc ám|dystopia/i.test(s)) return 'contrast';
  if (/học đường/i.test(t) && /hắc ám|kinh dị|noir/i.test(s)) return 'contrast';
  if (/nông trường/i.test(t) && /cyberpunk|dystopia/i.test(s)) return 'contrast';
  if (/thương chiến/i.test(t) && /đông phương|tu tiên|kỳ ảo/i.test(s)) return 'contrast';

  for (const [sr, tr] of NATURAL_HINTS) {
    if (tr.test(t) && sr.test(s)) return 'natural';
  }
  if (topicCatalog && styleCatalog) return 'mutant';
  return 'freeform';
}

export type ComposeMatrixInput = {
  chu_de?: string | null;
  phong_cach?: string | null;
  genre?: string | null;
  mo_ta?: string | null;
  lorebook?: string | null;
};

function splitGenre(genre: string): { chu: string; phong: string } {
  const g = nfcLabel(genre);
  const parts = g.split(/\s*\/\s*/);
  if (parts.length >= 2) {
    return { chu: parts[0], phong: parts.slice(1).join(' / ') };
  }
  return { chu: g, phong: g };
}

/**
 * Compose matrix for any Setup pair. Never throws on unknown labels.
 * Empty chu+phong still returns soft vectors (callers must requireGenre separately).
 */
export function composeMatrix(input: ComposeMatrixInput): MatrixComposition {
  let chu = nfcLabel(input.chu_de || '');
  let phong = nfcLabel(input.phong_cach || '');
  if ((!chu || !phong) && input.genre) {
    const sp = splitGenre(String(input.genre));
    if (!chu) chu = sp.chu;
    if (!phong) phong = sp.phong;
  }

  const topic = resolveTopicVector(chu);
  const style = resolveStyleVector(phong);
  const mo_ta = nfcLabel(input.mo_ta || '');
  const lorebook = nfcLabel(input.lorebook || '');

  const genreLabel = [topic.name, style.name].filter(Boolean).join(' / ') || nfcLabel(input.genre || '');

  const layers: MatrixLayerFlags = {
    hasUserOverride: mo_ta.length > 0,
    hasLoreOverride: lorebook.length > 0,
    topicFromCatalog: topic.fromCatalog,
    styleFromCatalog: style.fromCatalog,
    pairGroup: classifyPair(topic.name, style.name, topic.fromCatalog, style.fromCatalog),
  };

  const payloadSummary =
    `${topic.conflict.slice(0, 80)} ⊗ ${style.world.slice(0, 60)} [${layers.pairGroup}]`.normalize(
      'NFC',
    );

  return {
    genreLabel,
    topic,
    style,
    layers,
    payloadSummary,
    mo_ta,
    lorebook,
  };
}

export function composeMatrixFromPayload(payload: Record<string, unknown> | null | undefined): MatrixComposition {
  const p = payload || {};
  return composeMatrix({
    chu_de: p.chu_de != null ? String(p.chu_de) : undefined,
    phong_cach: p.phong_cach != null ? String(p.phong_cach) : undefined,
    genre: p.genre != null ? String(p.genre) : undefined,
    mo_ta: p.mo_ta != null ? String(p.mo_ta) : undefined,
    lorebook: p.lorebook != null ? String(p.lorebook) : undefined,
  });
}
