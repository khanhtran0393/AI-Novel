/**
 * P0 — Chapter Quality Gate
 * Word-band = Setup so_tu_chuong only (unified with rules via wordGoal).
 * mediaReady = zero hard errors (no dead rulesHard branch).
 */

import {
  checkChapterAgainstRules,
  resolveRulesForProject,
} from '@/lib/novel-engine/rules/checker';
import {
  DEFAULT_WORD_GOAL,
  MIN_SCENE_COUNT,
  countSceneTags,
  evaluateWordGate,
  getWordCount,
} from '@/lib/storyWriting';
import {
  isShortManhuaMode,
  minScenesForScriptMode,
  normalizeScriptMode,
  shortManhuaQualityHints,
} from '@/lib/scriptMode';
import { wordBandFromSetupGoal } from './wordBand';
import type { ChapterQualityReport, GateFinding } from './types';

export type QualityGateInput = {
  chapter: number;
  content: string;
  characterNames?: string[];
  /** Setup so_tu_chuong — sole word authority */
  wordGoal?: number;
  userRules?: {
    forbidden_words?: string;
    fatigue_words?: string;
  };
  editorVerdict?: 'accept' | 'rewrite' | 'polish' | string;
  /** Phong cách kịch bản — short/manhua dùng min scene + soft hints */
  scriptMode?: string;
};

function consistencyFindings(
  content: string,
  names: string[],
): GateFinding[] {
  const findings: GateFinding[] = [];
  const text = (content || '').normalize('NFC');
  if (!text.trim()) {
    findings.push({
      severity: 'error',
      code: 'empty_content',
      message: 'Nội dung chương trống — không qua Quality Gate.',
    });
    return findings;
  }

  const roster = names.map((n) => n.normalize('NFC').trim()).filter(Boolean);
  if (roster.length === 0) {
    findings.push({
      severity: 'warning',
      code: 'no_roster',
      message: 'Chưa có roster nhân vật — consistency NV bỏ qua.',
    });
    return findings;
  }

  const lower = text.toLowerCase();
  let mentioned = 0;
  for (const name of roster) {
    if (lower.includes(name.toLowerCase())) mentioned += 1;
  }
  if (mentioned === 0 && roster.length > 0) {
    findings.push({
      severity: 'warning',
      code: 'roster_unused',
      message: `Không thấy tên nào trong roster (${roster.length} NV) xuất hiện trong chương.`,
    });
  }

  const speakerHits =
    text.match(/(?:^|\n)\s*([A-ZÀ-Ỵ][\wÀ-ỹ'’\-\s]{1,24})\s*[:：]/g) || [];
  const orphans = new Set<string>();
  for (const raw of speakerHits.slice(0, 40)) {
    const m = raw.match(/([A-ZÀ-Ỵ][\wÀ-ỹ'’\-\s]{1,24})\s*[:：]/);
    if (!m) continue;
    const speaker = m[1].trim();
    if (speaker.length < 2 || speaker.length > 24) continue;
    const inRoster = roster.some(
      (n) =>
        n.toLowerCase() === speaker.toLowerCase() ||
        speaker.toLowerCase().includes(n.toLowerCase()),
    );
    if (!inRoster && !/^(Cảnh|Narrator|Người|Hắn|Nàng|Tôi)$/i.test(speaker)) {
      orphans.add(speaker);
    }
  }
  if (orphans.size >= 3) {
    findings.push({
      severity: 'warning',
      code: 'orphan_speakers',
      message: `≥3 speaker không khớp roster: ${[...orphans].slice(0, 5).join(', ')}`,
      evidence: [...orphans].slice(0, 5).join('|'),
    });
  }

  return findings;
}

/**
 * Run full quality gate. Pure — no I/O.
 * Word authority: Setup so_tu_chuong via evaluateWordGate + aligned rules.
 * Rules chapter_words findings dropped when wordGoal set (avoid double-count).
 */
export function evaluateChapterQuality(input: QualityGateInput): ChapterQualityReport {
  const content = (input.content || '').normalize('NFC');
  const band = wordBandFromSetupGoal(input.wordGoal);
  const wordGoal = band.goal;
  const findings: GateFinding[] = [];
  const mode = normalizeScriptMode(input.scriptMode);
  const minScenes = minScenesForScriptMode(mode);

  // 1) Word + scene gate (Setup) — single hard floor; short/manhua may need more scenes
  const gate = evaluateWordGate(content, wordGoal, minScenes);
  if (!gate.wordsOk) {
    findings.push({
      severity: 'error',
      code: 'word_gate',
      message: `Word-gate: ${gate.wordCount}/${gate.wordMin} từ (mục tiêu Setup ${gate.wordGoal} · band ${band.min}–${band.max}).`,
    });
  } else if (gate.wordCount < wordGoal) {
    findings.push({
      severity: 'info',
      code: 'word_below_goal',
      message: `Đủ floor ${band.min} nhưng dưới mục tiêu ${wordGoal} (hiện ${gate.wordCount}).`,
    });
  }
  if (gate.wordCount > band.max) {
    // Hard over max (+20%): error so media/quality flag overshoot (e.g. 208%)
    const hardOver = Math.round(band.goal * 1.35);
    findings.push({
      severity: gate.wordCount > hardOver ? 'error' : 'warning',
      code: 'word_over_max',
      message: `Cổng từ vượt quy định: ${gate.wordCount}/${band.goal} từ (${Math.round((gate.wordCount / band.goal) * 100)}%) — trần ${band.max} (+20%).`,
    });
  }
  if (!gate.scenesOk) {
    findings.push({
      severity: 'error',
      code: 'scene_gate',
      message: `Thiếu tag cảnh: ${gate.sceneCount}/${minScenes} [CẢNH N: …]${
        isShortManhuaMode(mode) ? ' (Short/Manhua)' : ''
      }.`,
    });
  }
  if (isShortManhuaMode(mode)) {
    for (const h of shortManhuaQualityHints(content)) {
      findings.push({
        severity: h.severity,
        code: h.code,
        message: h.message,
      });
    }
  }

  // 2) Rules (forbidden/fatigue) — word band aligned; skip chapter_words (already gated)
  const rules = resolveRulesForProject(input.userRules, wordGoal);
  const ruleFindings = checkChapterAgainstRules(content, rules).filter(
    (f) => f.rule !== 'chapter_words',
  );
  for (const f of ruleFindings) {
    findings.push({
      severity: f.severity,
      code: `rules_${f.rule}`,
      message: f.message,
      evidence: f.evidence,
    });
  }

  findings.push(...consistencyFindings(content, input.characterNames || []));

  const verdict = String(input.editorVerdict || '').toLowerCase();
  if (verdict === 'rewrite') {
    findings.push({
      severity: 'error',
      code: 'editor_rewrite',
      message: 'Editor verdict=rewrite — chưa media-ready.',
    });
  } else if (verdict === 'polish') {
    findings.push({
      severity: 'warning',
      code: 'editor_polish',
      message: 'Editor verdict=polish — nên polish trước Gen Prompt (media vẫn mở nếu không lỗi khác).',
    });
  }

  const hardErrors = findings.filter((f) => f.severity === 'error').length;
  const warnings = findings.filter((f) => f.severity === 'warning').length;

  // mediaReady = zero hard errors only (no dead rulesHard branch)
  const mediaReady = hardErrors === 0 && content.trim().length > 0;
  const ok = hardErrors === 0;

  return {
    chapter: input.chapter,
    ok,
    mediaReady,
    wordCount: getWordCount(content) || gate.wordCount,
    sceneCount: countSceneTags(content) || gate.sceneCount,
    hardErrors,
    warnings,
    findings,
    checkedAt: new Date().toISOString(),
    editorVerdict: input.editorVerdict || 'ungated',
  };
}

/**
 * Human-readable gate reasons for toast / badge click / preflight.
 * Errors first, then warnings — never empty vague "chặn media" alone.
 */
export function formatQualityGateReasons(
  report: ChapterQualityReport | null | undefined,
  opts?: { maxErrors?: number; maxWarnings?: number; includeMeta?: boolean },
): string {
  if (!report) return 'Chưa có báo cáo Quality Gate — viết/commit chương để quét lại.';
  const maxE = opts?.maxErrors ?? 8;
  const maxW = opts?.maxWarnings ?? 4;
  const lines: string[] = [];
  if (opts?.includeMeta !== false) {
    lines.push(
      `Ch${report.chapter}: ${report.wordCount} từ · ${report.sceneCount} cảnh · ` +
        `${report.hardErrors} lỗi · ${report.warnings} cảnh báo` +
        (report.editorVerdict && report.editorVerdict !== 'ungated'
          ? ` · editor=${report.editorVerdict}`
          : ''),
    );
  }
  const errors = (report.findings || []).filter((f) => f.severity === 'error');
  const warns = (report.findings || []).filter((f) => f.severity === 'warning');
  if (!errors.length && !warns.length) {
    lines.push(
      report.mediaReady
        ? 'Không có finding — media-ready.'
        : 'mediaReady=false nhưng không có finding (re-scan chương).',
    );
    return lines.join('\n');
  }
  for (const f of errors.slice(0, maxE)) {
    lines.push(`❌ [${f.code}] ${f.message}`);
  }
  if (errors.length > maxE) lines.push(`… +${errors.length - maxE} lỗi khác`);
  for (const f of warns.slice(0, maxW)) {
    lines.push(`⚠ [${f.code}] ${f.message}`);
  }
  if (warns.length > maxW) lines.push(`… +${warns.length - maxW} cảnh báo khác`);
  return lines.join('\n');
}

/** One-line summary for toast title / compact badge. */
export function formatQualityGateTitle(
  report: ChapterQualityReport | null | undefined,
): string {
  if (!report) return 'Gate — chưa quét';
  if (report.mediaReady) return `Gate OK · ${report.wordCount}t · ${report.sceneCount}c`;
  return `Gate ${report.hardErrors} lỗi chặn media`;
}

/** Throw with actionable message if not media-ready (B10 hard-fail). */
export function assertChapterMediaReady(
  report: ChapterQualityReport | null | undefined,
  chapter: number,
): void {
  if (!report) {
    throw new Error(
      `Quality Gate: chương ${chapter} chưa được kiểm tra sau khi viết. ` +
        `Viết/commit chương trước, hoặc chạy lại gate. Không bỏ qua để Gen Prompt.`,
    );
  }
  if (report.chapter !== chapter) {
    throw new Error(
      `Quality Gate: báo cáo thuộc ch${report.chapter}, đang gen ch${chapter}.`,
    );
  }
  if (!report.mediaReady) {
    const reasons = formatQualityGateReasons(report, {
      maxErrors: 5,
      maxWarnings: 2,
      includeMeta: false,
    });
    throw new Error(
      `Quality Gate chặn media ch${chapter} (${report.hardErrors} lỗi).\n${reasons || 'Xem findings trên badge Gate (bấm để mở).'}`,
    );
  }
}
