/**
 * Module StyleStat: Phân tích và thống kê văn phong toàn tác phẩm.
 * Mô phỏng lại lõi stylestat.go của AI Novel CLI.
 */

export interface PatternStat {
  name: string;
  total: number;
  per_chapter: string; // formatted to 2 decimals
}

export interface PhraseStat {
  text: string;
  count: number;
}

export interface StyleStats {
  chapters: number;
  patterns: PatternStat[];
  top_phrases: PhraseStat[];
}

const PATTERNS = [
  { name: 'Khuôn câu "Không phải là... mà là..."', re: /không phải( là)?[^.!?\n]{1,30}mà( là)?/gi },
  { name: 'Lượng từ thời gian sáo rỗng (nháy mắt/nửa nén hương)', re: /(nháy mắt|nửa nén hương|trong chớp mắt|chỉ trong một cái chớp mắt|chỉ một thoáng)/gi },
  { name: 'So sánh rập khuôn (như thể/tựa như)', re: /(như thể|tựa như|giống hệt như|tựa hồ|dường như)/gi },
  { name: 'Nhịp im lặng giả tạo', re: /(rơi vào trầm mặc|không nói gì|không ai lên tiếng|bỗng nhiên im bặt)/gi },
  { name: 'Biểu cảm thừa thãi', re: /(không khỏi|bất giác|khẽ chau mày|khẽ nhíu mày|hít một ngụm khí lạnh)/gi }
];

// Hàm trích xuất cụm n-gram (để tìm cụm từ lặp lại nhiều nhất)
function getTopPhrases(text: string, topK: number = 5): PhraseStat[] {
  // Chuẩn hóa và làm sạch
  const cleanText = text.toLowerCase().replace(/[.,!?;:()[\]"'\n]/g, ' ');
  const words = cleanText.split(/\s+/).filter(w => w.length > 0);
  
  const phraseCounts: Record<string, number> = {};
  
  // Trích xuất cụm 3-5 từ
  for (let n = 3; n <= 5; n++) {
    for (let i = 0; i <= words.length - n; i++) {
      const phrase = words.slice(i, i + n).join(' ');
      phraseCounts[phrase] = (phraseCounts[phrase] || 0) + 1;
    }
  }

  // Lọc các cụm xuất hiện >= 3 lần và lấy top
  const phrases = Object.entries(phraseCounts)
    .filter(([_, count]) => count >= 3)
    .map(([text, count]) => ({ text, count }))
    .sort((a, b) => b.count - a.count);

  // Lọc bỏ cụm con (ví dụ "anh đi về" sẽ bị loại nếu "anh đi về nhà" có cùng số lần)
  const result: PhraseStat[] = [];
  for (const p of phrases) {
    const isSubset = result.some(rp => rp.text.includes(p.text) && rp.count >= p.count - 1);
    if (!isSubset) {
      result.push(p);
      if (result.length >= topK) break;
    }
  }

  return result;
}

export function computeStyleStats(chapters: { so_chuong: number, noi_dung: string }[]): StyleStats | null {
  const validChapters = chapters.filter(c => c.noi_dung && c.noi_dung.trim().length > 0);
  if (validChapters.length === 0) return null;

  const totalChapters = validChapters.length;
  const fullText = validChapters.map(c => c.noi_dung).join('\n\n');

  // Tính số lượng Pattern
  const patterns: PatternStat[] = PATTERNS.map(p => {
    const matches = fullText.match(p.re);
    const total = matches ? matches.length : 0;
    return {
      name: p.name,
      total,
      per_chapter: (total / totalChapters).toFixed(2)
    };
  });

  // Tìm cụm từ lặp (ưu tiên 20 chương gần nhất để tránh "từ cửa miệng hiện tại")
  const recentChapters = validChapters.slice(-20);
  const recentText = recentChapters.map(c => c.noi_dung).join('\n\n');
  const top_phrases = getTopPhrases(recentText, 10);

  return {
    chapters: totalChapters,
    patterns,
    top_phrases
  };
}
