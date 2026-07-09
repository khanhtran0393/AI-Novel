/**
 * Text normalization pipeline — mirrors Vina custom_rules (simple + light smart).
 */
import type { VinaTextRule } from './types';

const DIGIT_VI = ['không', 'một', 'hai', 'ba', 'bốn', 'năm', 'sáu', 'bảy', 'tám', 'chín'];

function readDigitsVi(n: string): string {
  return n
    .split('')
    .map((c) => (/[0-9]/.test(c) ? DIGIT_VI[Number(c)] : c))
    .join(' ');
}

/** Built-in rules always applied (safe subset of Vina "Good" profile) */
const BUILTIN_SIMPLE: VinaTextRule[] = [
  { active: true, type: 'simple', pattern: '"', replacement: '', case: false },
  { active: true, type: 'simple', pattern: '“', replacement: '', case: false },
  { active: true, type: 'simple', pattern: '”', replacement: '', case: false },
  { active: true, type: 'simple', pattern: 'FOMO', replacement: 'Phô mô', case: true },
  { active: true, type: 'simple', pattern: '/m2', replacement: ' một mét vuông', case: true },
  { active: true, type: 'simple', pattern: 'HĐQT', replacement: 'hội đồng quản trị', case: true },
  { active: true, type: 'simple', pattern: 'cư trú:', replacement: 'cư trú ở', case: false },
  { active: true, type: 'simple', pattern: '%', replacement: ' phần trăm', case: false },
];

function applySimpleRule(text: string, rule: VinaTextRule): string {
  if (!rule.pattern) return text;
  const flags = rule.case ? 'g' : 'gi';
  try {
    const re = new RegExp(escapeRegExp(rule.pattern), flags);
    return text.replace(re, rule.replacement ?? '');
  } catch {
    return text.split(rule.pattern).join(rule.replacement ?? '');
  }
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Light smart rules that cover high-value Vina patterns without full DSL interpreter.
 */
function applyLightSmartPasses(text: string): string {
  let t = text;
  // 12:30 with time context → giờ phút (simplified)
  t = t.replace(
    /\b(\d{1,2}):(\d{2})\b/g,
    (_, h: string, m: string) => `${Number(h)} giờ ${Number(m)} phút`,
  );
  // 3,5 → 3 phẩy 5
  t = t.replace(/(\d+),(\d+)/g, '$1 phẩy $2');
  // 1-5 with number context already → "đến"
  t = t.replace(/(\d+)\s*-\s*(\d+)/g, '$1 đến $2');
  // SN 1990
  t = t.replace(/\bSN\s*(\d{4})\b/gi, 'sinh năm $1');
  // tháng 3/2020
  t = t.replace(/tháng\s*(\d{1,2})\s*\/\s*(\d{4})/gi, 'tháng $1 năm $2');
  // strip list marker dash at line start to pause-friendly form
  t = t.replace(/^[\-\*\•]\s+/gm, '');
  return t;
}

export function applyVinaTextRules(
  raw: string,
  customRules: VinaTextRule[] = [],
): string {
  let text = (raw || '').normalize('NFC').trim();
  if (!text) return '';

  const before = [...BUILTIN_SIMPLE, ...customRules.filter((r) => r.active !== false && !r.run_after)];
  const after = customRules.filter((r) => r.active !== false && r.run_after);

  for (const rule of before) {
    if (rule.type === 'simple' || !rule.type) {
      text = applySimpleRule(text, rule);
    }
  }

  text = applyLightSmartPasses(text);

  for (const rule of after) {
    if (rule.type === 'simple' || !rule.type) {
      text = applySimpleRule(text, rule);
    }
  }

  // collapse whitespace
  text = text.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  return text;
}

export function estimateSpeakableLength(text: string): number {
  return (text || '').replace(/\s+/g, ' ').trim().length;
}

export { readDigitsVi };
