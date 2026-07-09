/**
 * Default writing rules — port từ ainovel-cli assets/rules/default.md
 */
export interface FatigueWordRule {
  word: string;
  maxPerChapter: number;
}

export interface NovelRules {
  chapterWordsMin: number;
  chapterWordsMax: number;
  forbiddenPhrases: string[];
  fatigueWords: FatigueWordRule[];
  source: string;
}

export const BUILTIN_RULES: NovelRules = {
  chapterWordsMin: 3000,
  chapterWordsMax: 6000,
  forbiddenPhrases: [
    'theo một nghĩa nào đó',
    'đáng chú ý là',
    'không hiểu tại sao',
    'cảm xúc lẫn lộn',
    'có thể nói rằng',
    'nhìn chung',
    'không thể phủ nhận',
  ],
  fatigueWords: [
    { word: 'không khỏi', maxPerChapter: 1 },
    { word: 'bỗng nhiên', maxPerChapter: 1 },
    { word: 'dường như', maxPerChapter: 2 },
    { word: 'ngoài ra', maxPerChapter: 1 },
    { word: 'tuy nhiên', maxPerChapter: 2 },
    { word: 'một chút', maxPerChapter: 2 },
    { word: 'tựa như', maxPerChapter: 1 },
    { word: 'không thể không', maxPerChapter: 1 },
    { word: 'như thể', maxPerChapter: 3 },
    { word: 'im lặng', maxPerChapter: 2 },
    { word: 'không nói gì', maxPerChapter: 2 },
    { word: 'vài nhịp thở', maxPerChapter: 3 },
    { word: 'một nhịp thở', maxPerChapter: 3 },
  ],
  source: 'builtin:ainovel-cli/default.md',
};

export function mergeUserRules(
  base: NovelRules,
  user?: { forbidden_words?: string; fatigue_words?: string },
): NovelRules {
  if (!user) return base;
  const forbidden = [...base.forbiddenPhrases];
  for (const part of (user.forbidden_words || '').split(/[,;\n]/)) {
    const t = part.trim();
    if (t && !forbidden.includes(t)) forbidden.push(t);
  }
  const fatigue = [...base.fatigueWords];
  for (const part of (user.fatigue_words || '').split(/[,;\n]/)) {
    const t = part.trim();
    if (!t) continue;
    if (!fatigue.some((f) => f.word === t)) {
      fatigue.push({ word: t, maxPerChapter: 2 });
    }
  }
  return { ...base, forbiddenPhrases: forbidden, fatigueWords: fatigue, source: `${base.source}+user` };
}
