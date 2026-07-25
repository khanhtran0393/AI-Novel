/**
 * Rules checker — port hành vi checker CLI (forbidden / fatigue / word band).
 */
import { type NovelRules, BUILTIN_RULES, mergeUserRules } from './defaultRules';
import { wordCount } from '../domain';

export type RuleSeverity = 'error' | 'warning' | 'info';

export interface RuleFinding {
  severity: RuleSeverity;
  rule: string;
  message: string;
  evidence?: string;
}

export function checkChapterAgainstRules(
  content: string,
  rules: NovelRules = BUILTIN_RULES,
): RuleFinding[] {
  const findings: RuleFinding[] = [];
  const text = content || '';
  const lower = text.toLowerCase();
  const words = wordCount(text);

  if (words > 0 && words < rules.chapterWordsMin * 0.8) {
    findings.push({
      severity: 'error',
      rule: 'chapter_words',
      message: `Số từ ${words} < 80% ngưỡng tối thiểu ${rules.chapterWordsMin}`,
    });
  } else if (words > 0 && words < rules.chapterWordsMin) {
    findings.push({
      severity: 'warning',
      rule: 'chapter_words',
      message: `Số từ ${words} dưới band ${rules.chapterWordsMin}-${rules.chapterWordsMax}`,
    });
  } else if (words > rules.chapterWordsMax * 1.2) {
    findings.push({
      severity: 'error',
      rule: 'chapter_words',
      message: `Số từ ${words} vượt >20% tối đa ${rules.chapterWordsMax}`,
    });
  } else if (words > rules.chapterWordsMax) {
    findings.push({
      severity: 'warning',
      rule: 'chapter_words',
      message: `Số từ ${words} trên band tối đa ${rules.chapterWordsMax}`,
    });
  }

  for (const phrase of rules.forbiddenPhrases) {
    const p = phrase.toLowerCase();
    if (!p) continue;
    if (lower.includes(p)) {
      findings.push({
        severity: 'error',
        rule: 'forbidden_phrases',
        message: `Cấm cụm: "${phrase}"`,
        evidence: phrase,
      });
    }
  }

  for (const f of rules.fatigueWords) {
    const re = new RegExp(escapeReg(f.word), 'gi');
    const matches = text.match(re);
    const count = matches ? matches.length : 0;
    if (count > f.maxPerChapter) {
      findings.push({
        severity: 'warning',
        rule: 'fatigue_words',
        message: `"${f.word}" xuất hiện ${count} lần (ngưỡng ${f.maxPerChapter})`,
        evidence: f.word,
      });
    }
  }

  return findings;
}

export function resolveRulesForProject(
  userRules?: {
    forbidden_words?: string;
    fatigue_words?: string;
  },
  /** Setup so_tu_chuong — aligns chapterWordsMin/Max with word-gate (no dual band) */
  wordGoal?: number,
): NovelRules {
  const merged = mergeUserRules(BUILTIN_RULES, userRules);
  if (typeof wordGoal === 'number' && Number.isFinite(wordGoal) && wordGoal > 0) {
    const goal = Math.round(wordGoal);
    return {
      ...merged,
      chapterWordsMin: Math.round(goal * 0.92),
      // Ceiling = selected goal + 20% (same as wordBand WORD_CEILING_RATIO)
      chapterWordsMax: Math.round(goal * 1.2),
      source: `${merged.source}+setupGoal:${goal}`,
    };
  }
  return merged;
}

function escapeReg(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
