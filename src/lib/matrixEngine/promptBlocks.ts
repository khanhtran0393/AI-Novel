/**
 * Prompt inject blocks — Fluid 3-Layer Matrix (L3 override → L1 context → L2 subvert).
 * Keep under ~1.8k chars for write; shorter for continue / scene.
 */

import type { MatrixComposition } from './types';
import { composeMatrix, composeMatrixFromPayload, type ComposeMatrixInput } from './compose';

function clip(s: string, max: number): string {
  const t = (s || '').normalize('NFC').trim();
  if (t.length <= max) return t;
  return t.slice(0, max - 1) + '…';
}

function pairGroupNote(g: MatrixComposition['layers']['pairGroup']): string {
  switch (g) {
    case 'natural':
      return 'Tổ hợp TƯƠNG THÍCH TỰ NHIÊN: đào sâu jargon + quy luật bối cảnh kinh điển fan niche.';
    case 'mutant':
      return 'Tổ hợp ĐỘT BIẾN / PHÁ CÁCH: Phong cách = vỏ môi trường; Chủ đề = nhiệm vụ cốt lõi. Giữ cả hai trục — không nuốt trôi một trục.';
    case 'contrast':
      return 'Tổ hợp TƯƠNG PHẢN: không khí Style vs hành động Topic — black comedy / cảm xúc đối lập có chủ đích, không hòa loãng thành “trung tính”.';
    default:
      return 'Tổ hợp TỰ DO / FREEFORM: ưu tiên mo_ta & lore; thẻ Setup chỉ tô giọng & visual.';
  }
}

export function buildMatrixWriteBlock(
  input: ComposeMatrixInput | MatrixComposition,
  opts?: { isContinue?: boolean; maxMoTaChars?: number },
): string {
  const m: MatrixComposition =
    'topic' in input && 'style' in input && 'layers' in input
      ? (input as MatrixComposition)
      : composeMatrix(input as ComposeMatrixInput);

  if (!m.topic.name && !m.style.name) return '';

  if (opts?.isContinue) {
    return `
--- MATRIX ENGINE (CONTINUE · ${m.genreLabel}) ---
Giữ trục Topic「${m.topic.name}」⊗ Style「${m.style.name}」(${m.layers.pairGroup}).
Conflict: ${clip(m.topic.conflict, 120)}
World/jargon: ${clip(m.style.world, 80)} · ${clip(m.style.jargon, 80)}
${m.layers.hasUserOverride ? 'Vẫn tôn trọng Ý ĐỒ USER (mo_ta) đã khóa — không đổi premise.' : ''}
CẤM lệch sang thể loại ngoài Setup.
`.normalize('NFC');
  }

  const moMax = opts?.maxMoTaChars ?? 900;
  const l3 =
    m.layers.hasUserOverride || m.layers.hasLoreOverride
      ? `
### TẦNG 3 — USER INTENT OVERRIDE (QUYỀN TỐI CAO)
${
  m.layers.hasUserOverride
    ? `- MÔ TẢ CỐT TRUYỆN (mo_ta) — BẮT BUỘC bám, được phép GHI ĐÈ trope/matrix nếu mâu thuẫn:\n${clip(m.mo_ta, moMax)}`
    : '- Chưa có mo_ta chi tiết — dựng từ dàn ý chương + Setup; không bịa premise trái Setup.'
}
${
  m.layers.hasLoreOverride
    ? '- Lorebook (nếu khác trope phổ biến): tôn trọng lore user, không overwrite bằng niche template.'
    : '- Lorebook trống/ít: không bịa luật thế giới mặc định ngoài Setup.'
}
`
      : `
### TẦNG 3 — USER INTENT
Chưa có mo_ta dài — bám dàn ý chương + Setup. CẤM bịa premise / world law ngoài Setup.
`;

  const subverts = [...m.topic.subvertHints].slice(0, 3);
  if (m.layers.pairGroup === 'mutant' || m.layers.pairGroup === 'contrast') {
    subverts.push(
      'Giữ va chạm hai trục: fan thấy lạ nhưng logic nội tại (môi trường Style phục vụ conflict Topic).',
    );
  }

  return `
--- DYNAMIC MATRIX · ${m.genreLabel} · group=${m.layers.pairGroup} ---
${pairGroupNote(m.layers.pairGroup)}
${l3}
### TẦNG 1 — CONTEXT (chất liệu, không gông cốt)
- Topic conflict: ${m.topic.conflict}
- Motive: ${m.topic.motive}
- Reward loop: ${m.topic.reward}
- Style world: ${m.style.world}
- Jargon (dệt tự nhiên, không nhồi checklist): ${m.style.jargon}
- Visual grade gợi ý: ${m.style.colorGrade} · shot ~${m.style.shotSecMin}–${m.style.shotSecMax}s · WPM bias ~${m.style.wpmBias}
- TTS tone: ${m.style.ttsTone.narrator} | ${m.style.ttsTone.rolesHint}

### TẦNG 2 — TROPE SUBVERSION (chống rập khuôn)
${subverts.map((s, i) => `${i + 1}) ${s}`).join('\n')}
`.normalize('NFC');
}

export function buildMatrixOutlineBlock(
  input: ComposeMatrixInput | MatrixComposition,
): string {
  const m: MatrixComposition =
    'topic' in input && 'style' in input && 'layers' in input
      ? (input as MatrixComposition)
      : composeMatrix(input as ComposeMatrixInput);
  if (!m.topic.name && !m.style.name) return '';
  return `
--- MATRIX OUTLINE · ${m.genreLabel} (${m.layers.pairGroup}) ---
${pairGroupNote(m.layers.pairGroup)}
Conflict engine: ${m.topic.conflict}
Reward beats: ${m.topic.reward}
World frame: ${m.style.world}
${m.layers.hasUserOverride ? `USER mo_ta (override): ${clip(m.mo_ta, 500)}` : 'USER mo_ta: (dùng payload mo_ta bắt buộc nếu handler yêu cầu)'}
Mỗi chương: 1 micro-conflict Topic + 1 texture Style (jargon/visual), cuối open loop.
`.normalize('NFC');
}

export function buildMatrixShotBlock(
  input: ComposeMatrixInput | MatrixComposition,
): string {
  const m: MatrixComposition =
    'topic' in input && 'style' in input && 'layers' in input
      ? (input as MatrixComposition)
      : composeMatrix(input as ComposeMatrixInput);
  if (!m.style.name && !m.topic.name) return '';
  return `
--- MATRIX SHOT / VISUAL · ${m.genreLabel} ---
DNA: ${clip(m.style.visualDnaEn, 220)}
Grade: ${m.style.colorGrade}
Band gợi ý: ${m.style.shotSecMin}–${m.style.shotSecMax}s/shot (intersect scriptMode/style engine khi có).
Topic visual stakes: ${clip(m.topic.conflict, 100)}
CẤM lệch palette/world ngoài Style Setup trừ mo_ta yêu cầu rõ.
`.normalize('NFC');
}

export function buildMatrixTtsHintBlock(
  input: ComposeMatrixInput | MatrixComposition,
): string {
  const m: MatrixComposition =
    'topic' in input && 'style' in input && 'layers' in input
      ? (input as MatrixComposition)
      : composeMatrix(input as ComposeMatrixInput);
  if (!m.style.name) return '';
  return `
--- MATRIX TTS / CAST HINT (gợi ý — không ép platform/voice id) ---
Narrator: ${m.style.ttsTone.narrator}
Roles: ${m.style.ttsTone.rolesHint}
WPM bias niche ~${m.style.wpmBias} (scriptMode vẫn master format).
Gợi ý phân vai: Thuyết minh | Nhân vật chính (topic drive) | Phản diện/trở lực | (nếu Hệ thống/LitRPG) giọng panel riêng.
CẤM nhét sceneEmotion vào multi-voice gate; CẤM đổi TTS platform khi fail.
`.normalize('NFC');
}

/** Motifs for SEO / high-CTR when StyleEngine is null */
export function matrixScoreMotifs(input: ComposeMatrixInput | MatrixComposition): string[] {
  const m: MatrixComposition =
    'topic' in input && 'style' in input && 'layers' in input
      ? (input as MatrixComposition)
      : composeMatrix(input as ComposeMatrixInput);
  const styleBits = m.style.name
    .toLowerCase()
    .split(/[\s/]+/)
    .filter((w) => w.length >= 3)
    .slice(0, 4);
  return Array.from(new Set([...m.topic.scoreMotifs, ...styleBits]));
}

export function matrixThumbOverlaySuggestions(
  input: ComposeMatrixInput | MatrixComposition,
): string[] {
  const m: MatrixComposition =
    'topic' in input && 'style' in input && 'layers' in input
      ? (input as MatrixComposition)
      : composeMatrix(input as ComposeMatrixInput);
  const out: string[] = [];
  const motifs = m.topic.scoreMotifs;
  if (motifs[0]) out.push(`${motifs[0].toUpperCase()}!`.slice(0, 18));
  if (motifs[1]) out.push(clip(motifs[1].toUpperCase(), 16));
  if (m.layers.pairGroup === 'contrast') out.push('ĐỪNG TIN!');
  if (m.layers.pairGroup === 'mutant') out.push('CHƯA TỪNG THẤY');
  return out.filter(Boolean).slice(0, 4);
}

export { composeMatrix, composeMatrixFromPayload };
