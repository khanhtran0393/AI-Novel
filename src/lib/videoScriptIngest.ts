/**
 * Video Script Ingestion & Rewrite Helper
 * Bóc tách và làm sạch kịch bản/sub thô từ video mẫu (SRT, Transcript, OCR)
 * biến thành tư liệu đầu vào chuẩn cho AI Novel sáng tạo lại 100%.
 */

export type IngestedScriptResult = {
  rawDialogue: string;
  cleanedStoryContext: string;
  estimatedScenesCount: number;
  wordCount: number;
  suggestedGenrePrompt: string;
};

/**
 * Trích xuất và làm sạch file SRT / transcript từ video mẫu
 */
export function cleanRawVideoTranscript(srtOrRawText: string): string {
  if (!srtOrRawText || !srtOrRawText.trim()) return '';

  return srtOrRawText
    // Bỏ dòng số thứ tự SRT (1, 2, 3...)
    .replace(/^\d+\s*$/gm, '')
    // Bỏ timestamp SRT (00:00:01,000 --> 00:00:04,500)
    .replace(/\d{2}:\d{2}:\d{2}[,\.]\d{3}\s*-->\s*\d{2}:\d{2}:\d{2}[,\.]\d{3}/g, '')
    // Bỏ thẻ HTML/VTT nếu có (<font>, <i>, ...)
    .replace(/<[^>]*>/g, '')
    // Xóa dòng trống thừa
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .join(' ');
}

/**
 * Chuyển đổi thoại thô từ Video mẫu thành Cấu trúc đầu vào Setup cho AI Novel Engine
 */
export function ingestVideoToSetupContext(rawVideoScript: string): IngestedScriptResult {
  const cleanedStoryContext = cleanRawVideoTranscript(rawVideoScript);
  const words = cleanedStoryContext.split(/\s+/).filter(Boolean);
  const wordCount = words.length;

  // Ước tính số phân cảnh (mỗi ~120 từ 1 phân cảnh)
  const estimatedScenesCount = Math.max(2, Math.ceil(wordCount / 120));

  const suggestedGenrePrompt = `Kịch bản chuyển thể từ tư liệu Video mẫu (${wordCount} từ thô). Yêu cầu AI Novel viết lại hoàn toàn theo phong cách độc đáo, biến các đoạn thoại thô thành diễn biến truyện giàu cảm xúc, đầy đủ phân cảnh và hành động nhân vật.`;

  return {
    rawDialogue: rawVideoScript,
    cleanedStoryContext,
    estimatedScenesCount,
    wordCount,
    suggestedGenrePrompt,
  };
}
