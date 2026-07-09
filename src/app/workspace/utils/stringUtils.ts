import {
  getWordCount as sharedGetWordCount,
  parseScenes as sharedParseScenes,
  normalizeSceneTags,
  countSceneTags,
  evaluateWordGate,
} from '@/lib/storyWriting';

// Re-export shared story utilities for workspace UI
export function parseScenes(text: string): { title: string; content: string }[] {
  return sharedParseScenes(text);
}

export function getWordCount(text: string): number {
  return sharedGetWordCount(text);
}

export { normalizeSceneTags, countSceneTags, evaluateWordGate };

// Hàm làm sạch kịch bản thô cho bộ đọc giọng nói AI
export function cleanVoiceScript(text: string): string {
  let cleaned = text;
  cleaned = cleaned.replace(/\[?CẢNH\s+\d+:[^\]\n]+\]?/gi, '');
  cleaned = cleaned.replace(/CẢNH\s+\d+:\s*[^\n]+/gi, '');
  cleaned = cleaned.replace(/\([^)]*\)/g, '');
  cleaned = cleaned.replace(/\[[^\]]*\]/g, '');
  cleaned = cleaned.replace(/[\*\_`#]/g, '');
  cleaned = cleaned.replace(/^[a-zA-ZÀ-ỹ\s\d\-]+:/gm, '');
  cleaned = cleaned.replace(/^[a-zA-ZÀ-ỹ\s\d\-]+\([^)]*\):/gm, '');

  return cleaned
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .join('\n\n')
    .trim();
}
