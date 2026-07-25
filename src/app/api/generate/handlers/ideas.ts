import { NextResponse } from 'next/server';
import {
  callActiveModel,
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
    const de = String(chu_de || '').trim();
    const pc = String(phong_cach || '').trim();
    if (!de || !pc) {
      return NextResponse.json(
        {
          error:
            'Thiếu Setup Chủ đề và Phong cách. Chọn cả hai trước khi sinh ý tưởng. App không tự gán thể loại mặc định.',
        },
        { status: 400 },
      );
    }
    const prompt = `Bạn là Trợ lý Biên kịch sáng tạo chuyên nghiệp bậc nhất.
  Với Khối Chủ đề: "${de}" và Khối Phong cách: "${pc}".
  Hãy sáng tạo ra một ý tưởng cốt truyện/bối cảnh (khoảng 4-6 câu) thật độc đáo, chi tiết, có chiều sâu, mô tả nghịch cảnh mà nhân vật chính đang phải đối mặt — BẮT BUỘC bám đúng Chủ đề + Phong cách trên, không tự đổi thể loại ngoài Setup.
  Hãy để trí tưởng tượng bay bổng trong khung Setup. Không trả về Markdown, chỉ trả về văn bản thuần túy.`;
    const aiResponse = await callActiveModel(prompt, keysToUse, model);
    const text = String(aiResponse || '').trim();
    if (!text) {
      return NextResponse.json(
        { error: 'AI tra y tuong rong. Khong dung fill cuc bo.' },
        { status: 502 },
      );
    }
    return NextResponse.json({
      idea: text,
      mo_ta: text,
      usedApiKey: getLastWorkingApiKey(),
    });
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
    // captions (default) | metadata (title+description when YouTube blocks captions)
    const sourceKindRaw = String(
      payload?.source_kind || payload?.sourceKind || '',
    ).toLowerCase();
    const isMetadata =
      sourceKindRaw === 'metadata' ||
      source.trim().startsWith('[NGUỒN YOUTUBE — METADATA');
    const excerpt = source.trim().slice(0, 12000);
    if (excerpt.length < 40) {
      return NextResponse.json(
        {
          error: isMetadata
            ? 'Thiếu tiêu đề/mô tả video để gợi ý cốt truyện. Gõ tay ô 3. Cốt truyện rồi Sinh kịch bản.'
            : 'Thiếu bản chép lời (phụ đề) để phân tích cốt truyện — gõ tay ô 3 hoặc thử video khác có CC.',
        },
        { status: 400 },
      );
    }
    const sourceLabel = isMetadata
      ? 'METADATA (tiêu đề + mô tả video — KHÔNG phải phụ đề; độ tin cậy thấp hơn captions)'
      : 'BẢN CHÉP LỜI (captions/transcript)';
    const prompt = `Bạn là biên kịch chuyên phân tích nguồn YouTube để viết lại kịch bản MỚI nhưng tương tự.
Tiêu đề video nguồn: "${title}"
Mục tiêu độ bám ý tưởng mẫu khi viết lại sau này: ~${target}% (cấu trúc, xung đột, nhịp — KHÔNG copy lời).

Nguồn = ${sourceLabel}:
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

${
  isMetadata
    ? 'Nguồn chỉ là metadata — suy luận hợp lý từ tiêu đề/mô tả, CẤM bịa chi tiết như đã xem hết video; ghi rõ giả định nếu cần.'
    : 'CẤM: copy nguyên câu phụ đề; CẤM tóm tắt kiểu spoiler list dài dòng.'
}
Chỉ trả về văn bản thuần (không markdown fence).`;
    const aiResponse = await callActiveModel(prompt, keysToUse, model);
    const mo_ta = String(aiResponse || '').trim();
    if (!mo_ta) {
      return NextResponse.json(
        {
          error:
            'AI tra mo_ta rong khi phan tich YouTube. Khong dung fill cuc bo.',
        },
        { status: 502 },
      );
    }
    return NextResponse.json({
      mo_ta,
      idea: mo_ta,
      sourceKind: isMetadata ? 'metadata' : 'captions',
      usedApiKey: getLastWorkingApiKey(),
    });
  }

  return null;
}
