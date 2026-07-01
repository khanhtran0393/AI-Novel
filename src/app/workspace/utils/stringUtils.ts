// Hàm phân tích kịch bản thành các Cảnh riêng biệt (tách biệt Tiêu đề Cảnh ra ngoài)
export function parseScenes(text: string): { title: string; content: string }[] {
  if (!text) return [];
  const normalizedText = text.normalize('NFC');
  const regex = /(\[CẢNH\s+\d+\s*:[^\]\n]+\])/gi;
  const parts = normalizedText.split(regex);

  if (parts.length <= 1) {
    return [{ title: 'KỊCH BẢN', content: normalizedText }];
  }

  const scenes: { title: string; content: string }[] = [];
  if (parts[0].trim()) {
    scenes.push({ title: 'MỞ ĐẦU', content: parts[0].trim() });
  }

  for (let i = 1; i < parts.length; i += 2) {
    const title = parts[i].trim();
    const content = parts[i + 1] ? parts[i + 1].trim() : '';
    scenes.push({ title, content });
  }

  return scenes;
}

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

  return cleaned.split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0)
    .join('\n\n')
    .trim();
}

// Hàm đếm số từ chuẩn xác hỗ trợ Unicode tiếng Việt
export function getWordCount(text: string): number {
  if (!text) return 0;
  const cleaned = text.normalize('NFC').replace(/\[[^\]]*\]/g, '').trim();
  if (!cleaned) return 0;
  return cleaned.split(/\s+/).filter(Boolean).length;
}
