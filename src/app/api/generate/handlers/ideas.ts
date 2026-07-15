import { NextResponse } from 'next/server';
import {
  buildContinueContext,
  evaluateWordGate,
  formatCharacterBible,
  formatSpentEntities,
  formatWorldState,
  normalizeSceneTags,
  truncateOutline,
  DEFAULT_WORD_GOAL,
  MIN_SCENE_COUNT,
} from '@/lib/storyWriting';
import {
  buildHumanizeScriptBlock,
  buildNarrativePsychBlock,
  buildShotDiversityBlock,
  buildSpeechFingerprintBlock,
  buildAudioReadabilityBlock,
  enforceShotGraphOnPrompts,
  resolveUserRules,
  scoreNarrativePsychScript,
  injectHumanJokeAsides,
  countHumanJokeAsides,
} from '@/lib/youtubeSafe';
import {
  applyCharacterSheetFormulas,
  applyDirectorFormulasToPromptPair,
  compileStillImagePrompt,
} from '@/lib/integrations/seedance';
import {
  CHAR_ANGLE_CAMERA,
  CHAR_EMOTION_FACE,
} from '@/lib/characterProfile';
import {
  callActiveModel,
  callActiveVision,
  cleanAndParseJson,
  generateJsonWithRetry,
  getLastWorkingApiKey,
} from '../modelClients';
import type { GenerateHandlerContext } from './types';

/**
 * Owner: generate/ideas.ts
 * Only handles requestTypes assigned in contracts/apiMap GENERATE_REQUEST_OWNERS → ideas
 */
export async function handleIdeas(
  ctx: GenerateHandlerContext,
  requestType: string,
): Promise<NextResponse | null> {
  const { payload, keysToUse, model } = ctx;

  if (requestType === 'GENERATE_IDEAS' || requestType === 'GENERATE_IDEA') {
    const { chu_de, phong_cach } = payload || {};
    const prompt = `Bạn là Trợ lý Biên kịch sáng tạo chuyên nghiệp bậc nhất.
  Với Khối Chủ đề: "${chu_de || 'Sinh tồn mạt thế'}" và Khối Phong cách: "${phong_cach || 'Kịch tính, Tăm tối'}".
  Hãy sáng tạo ra một ý tưởng cốt truyện/bối cảnh (khoảng 4-6 câu) thật độc đáo, chi tiết, có chiều sâu, mô tả nghịch cảnh mà nhân vật chính đang phải đối mặt. Hãy để trí tưởng tượng bay bổng, không bị gò bó vào bất kỳ lối mòn nào. Không trả về Markdown, chỉ trả về văn bản thuần túy.`;
    const aiResponse = await callActiveModel(prompt, keysToUse, model);
    return NextResponse.json({ idea: aiResponse.trim(), mo_ta: aiResponse.trim(), usedApiKey: getLastWorkingApiKey() });
  }

  if (requestType === 'ANALYZE_YOUTUBE_PLOT') {
    const source =
      (typeof payload?.source_text === 'string' && payload.source_text) ||
      (typeof payload?.transcript === 'string' && payload.transcript) ||
      '';
    const title =
      (typeof payload?.title === 'string' && payload.title) || 'Video YouTube';
    const target =
      typeof payload?.similarity_target === 'number'
        ? Math.max(10, Math.min(100, Math.round(payload.similarity_target)))
        : 80;
    const excerpt = source.trim().slice(0, 12000);
    if (excerpt.length < 40) {
      return NextResponse.json(
        { error: 'Thiếu bản chép lời (phụ đề) để phân tích cốt truyện — không dùng mô tả video.' },
        { status: 400 },
      );
    }
    const prompt = `Bạn là biên kịch chuyên phân tích BẢN CHÉP LỜI / PHỤ ĐỀ video YouTube để viết lại kịch bản MỚI nhưng tương tự.
Tiêu đề video nguồn: "${title}"
Mục tiêu độ bám ý tưởng mẫu khi viết lại sau này: ~${target}% (cấu trúc, xung đột, nhịp — KHÔNG copy lời).

Nguồn = BẢN CHÉP LỜI (captions/transcript) — KHÔNG phải mô tả video:
---
${excerpt}
---

Nhiệm vụ: Bóc cốt truyện lõi thành 1 khối "mo_ta" tiếng Việt (hoặc cùng ngôn ngữ nguồn nếu không phải Việt), khoảng 8–14 câu, gồm:
1) Bối cảnh thế giới / tiền đề
2) Nhân vật trung tâm (archetype, KHÔNG giữ tên thật từ nguồn — gợi ý archetype)
3) Xung đột chính + stakes
4) Nhịp 3 hồi (mở / giữa / cao trào–kết gợi mở)
5) Tone / cảm xúc chủ đạo
6) 3–5 "beat" bắt buộc giữ khi viết lại (ý tưởng, không nguyên văn)

CẤM: copy nguyên câu phụ đề; CẤM tóm tắt kiểu spoiler list dài dòng.
Chỉ trả về văn bản thuần (không markdown fence).`;
    const aiResponse = await callActiveModel(prompt, keysToUse, model);
    const mo_ta = aiResponse.trim();
    return NextResponse.json({
      mo_ta,
      idea: mo_ta,
      usedApiKey: getLastWorkingApiKey(),
    });
  }
  
  // --- NODE: GENERATE_IMAGE_PROMPT (Phân tách theo từng câu + cảm xúc) ---

  return null;
}
