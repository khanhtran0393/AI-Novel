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
 * Owner: generate/foundation.ts
 * Only handles requestTypes assigned in contracts/apiMap GENERATE_REQUEST_OWNERS → foundation
 */
export async function handleFoundation(
  ctx: GenerateHandlerContext,
  requestType: string,
): Promise<NextResponse | null> {
  const { payload, keysToUse, model } = ctx;

  if (requestType === 'COMPRESS_CONTEXT') {
    const { tom_tat_cuon_chieu, tri_nho_ngan_han } = payload;
    const prompt = `Bạn là bộ tổng hợp hồ sơ trí nhớ cho một cuốn tiểu thuyết.
  Nhiệm vụ của bạn là nén "Tóm Tắt Cuốn Chiếu" (các chương trước đó) và "Trí Nhớ Ngắn Hạn" (những sự kiện vừa xảy ra) thành một khối dung lượng siêu nhỏ nhưng mang đậm ý nghĩa logic.
  
  --- TÓM TẮT CUỐN CHIẾU HIỆN TẠI ---
  ${tom_tat_cuon_chieu}
  
  --- TRÍ NHỚ NGẮN HẠN ---
  ${tri_nho_ngan_han?.join('\n') || ''}
  
  YÊU CẦU BẮT BUỘC:
  1. Tổng hợp lại thành một đoạn văn duy nhất, ngắn gọn, súc tích (dưới 300 từ).
  2. Giữ lại được tuyến tình cảm, mâu thuẫn chính, và sự kiện mấu chốt để cung cấp cho người viết chương tiếp theo.
  3. Chỉ trả về một chuỗi văn bản thuần túy, không bọc trong định dạng JSON. Không có lời chào hay giải thích.`;
  
    const aiResponse = await callActiveModel(prompt, keysToUse, model);
    return NextResponse.json({ compressedMemory: aiResponse.trim(), usedApiKey: getLastWorkingApiKey() });
  }
  
  // --- NODE: SUMMARIZE_SCRIPT_OUTLINE (Tóm gọn dàn ý từ kịch bản dán) ---
  if (requestType === 'SUMMARIZE_SCRIPT_OUTLINE') {
    const text =
      (typeof payload?.text_content === 'string' && payload.text_content) ||
      (typeof payload?.text === 'string' && payload.text) ||
      (typeof payload?.content === 'string' && payload.content) ||
      '';
    const excerpt = text.trim().slice(0, 50000);
    if (excerpt.length < 80) {
      return NextResponse.json(
        { error: 'Cần dán kịch bản/truyện đủ dài (≥80 ký tự) để tóm gọn dàn ý.' },
        { status: 400 },
      );
    }
    const prompt = `Bạn là biên kịch / kiến trúc sư dàn ý. Nhiệm vụ: đọc kịch bản hoặc truyện hoàn chỉnh người dùng dán, rồi TÓM GỌN thành dàn ý + cốt truyện lõi để viết lại / kế thừa tiếp.

VĂN BẢN NGUỒN:
---
${excerpt}
---

Trả về ĐÚNG một JSON thuần (không markdown fence):
{
  "mo_ta": "Cốt truyện lõi 8–14 câu: bối cảnh, nhân vật trung tâm (archetype), xung đột, stakes, tone, 3–5 beat bắt buộc. Không copy nguyên văn dài.",
  "dan_y_tom_gon": "Dàn ý tóm gọn theo cung/chương (markdown ngắn, gạch đầu dòng). Giữ xương sống sự kiện, bỏ chi tiết thừa.",
  "tieu_de_goi_y": "Tên tác phẩm gợi ý (có thể mới nếu viết lại)"
}

CẤM bịa quy tắc không có trong nguồn. CẤM copy nguyên đoạn thoại dài.`;
    const aiResponse = await callActiveModel(prompt, keysToUse, model);
    const parsed = cleanAndParseJson(aiResponse) as Record<string, unknown>;
    const mo_ta =
      (typeof parsed?.mo_ta === 'string' && parsed.mo_ta.trim()) ||
      aiResponse.trim();
    const dan_y_tom_gon =
      (typeof parsed?.dan_y_tom_gon === 'string' && parsed.dan_y_tom_gon.trim()) ||
      '';
    const tieu_de_goi_y =
      (typeof parsed?.tieu_de_goi_y === 'string' && parsed.tieu_de_goi_y.trim()) ||
      '';
    // Ghép mo_ta hiển thị: cốt truyện + dàn ý tóm (nếu có)
    const combined = [mo_ta, dan_y_tom_gon ? `\n\n--- DÀN Ý TÓM GỌN ---\n${dan_y_tom_gon}` : '']
      .filter(Boolean)
      .join('');
    return NextResponse.json({
      mo_ta: combined || mo_ta,
      dan_y_tom_gon,
      tieu_de_goi_y,
      usedApiKey: getLastWorkingApiKey(),
    });
  }

  // --- NODE: IMPORT_FOUNDATION (Thuật toán Kế thừa Di sản) ---
  
  if (requestType === 'IMPORT_FOUNDATION') {
    const { text_content } = payload;
    const prompt = `Bạn là chuyên gia phân tích tính liên tục của tiểu thuyết. Nhiệm vụ: đọc đoạn văn bản gốc mà người dùng cung cấp (có thể gồm nhiều chương), rồi phân tích ngược để xây dựng lại toàn bộ cài đặt nền tảng cần thiết cho việc tiếp tục viết các chương sau.
  
  Chế độ làm việc: Không sáng tác thêm, tái tạo foundation dựa hoàn toàn vào nội dung gốc, thà chi tiết còn hơn bỏ sót, không bịa đặt quy tắc không có.
  
  VĂN BẢN GỐC:
  ${text_content}
  
  Yêu cầu định dạng đầu ra (Trọng yếu: Bạn PHẢI trả về ĐÚNG VÀ CHỈ MỘT định dạng JSON nguyên chất theo cấu trúc sau, không bọc markdown \`\`\`json, không văn bản thừa):
  
  {
    "mo_ta": "Mô tả ngắn gọn thể loại, tông điệu, xung đột cốt lõi và mục tiêu của nhân vật chính.",
    "nhan_vat": [
  {
    "name": "Tên nhân vật chính",
    "gioi_tinh": "Nam/Nữ",
    "tuoi": "khoảng tuổi",
    "dang_nguoi": "dáng người",
    "vai_tro": "chính/phụ/phản diện",
    "quan_ao": "trang phục signature",
    "so_thich": "sở thích/phong cách",
    "thoi_quen": "thói quen hành vi",
    "dong_co": "động cơ cốt lõi",
    "giong_thoai": "quirk thoại",
    "ngoai_hinh": "face lock: tóc/mắt/da/xương mặt",
    "dac_diem_nhan_dang": "sẹo/nốt ruồi/xăm/khuyết tật nhìn thấy được",
    "khuet_tat": "khuyết tật nếu có",
    "prompt": "English master identity lock portrait, neutral, front view"
  }
    ],
    "lorebook": {
  "magic_technology": "Quy tắc phép thuật/công nghệ được ám chỉ",
  "geography": "Địa lý, bối cảnh",
  "society": "Cơ cấu xã hội, tổ chức"
    },
    "dan_y_tong_the": [
  {
    "ten_cung": "Tiêu đề cung truyện/arc phân tích ngược",
    "muc_tieu": "Chủ đề cốt lõi",
    "so_chuong_du_kien": 5,
    "mo_ta": "Tóm tắt sự kiện trong cung này"
  }
    ]
  }`;
    const aiResponse = await callActiveModel(prompt, keysToUse, model);
    const parsed = cleanAndParseJson(aiResponse);
    // Apply still formula only when client provided style/genre (no silent genre hardcode)
    const importStyle = String(
      payload.styleHint || payload.style || payload.visualDnaPrompt || '',
    ).trim();
    const importGenre = String(
      payload.genre ||
        [payload.chu_de, payload.phong_cach].filter(Boolean).join(' / ') ||
        '',
    ).trim();
    if (parsed && Array.isArray(parsed.nhan_vat) && (importStyle || importGenre)) {
      try {
        parsed.nhan_vat = parsed.nhan_vat.map(
          (c: {
            name?: string;
            prompt?: string;
            angle_prompts?: Record<string, string>;
            expression_prompts?: Record<string, string>;
          }) => {
            if (!c || typeof c !== 'object') return c;
            const sheet = applyCharacterSheetFormulas({
              name: c.name || 'character',
              prompt: c.prompt || '',
              angle_prompts: c.angle_prompts,
              expression_prompts: c.expression_prompts,
              styleHint: importStyle || importGenre,
              genre: importGenre || importStyle,
              angleFraming: CHAR_ANGLE_CAMERA as unknown as Record<string, string>,
              emotionFace: CHAR_EMOTION_FACE as unknown as Record<string, string>,
            });
            return {
              ...c,
              prompt: sheet.prompt,
              angle_prompts: Object.keys(sheet.angle_prompts).length
                ? sheet.angle_prompts
                : c.angle_prompts,
              expression_prompts: Object.keys(sheet.expression_prompts).length
                ? sheet.expression_prompts
                : c.expression_prompts,
            };
          },
        );
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return NextResponse.json(
          {
            error: `IMPORT_FOUNDATION character formula loi: ${msg}`,
            usedApiKey: getLastWorkingApiKey(),
          },
          { status: 502 },
        );
      }
    }
    return NextResponse.json({ foundation: parsed, usedApiKey: getLastWorkingApiKey() });
  }
  
  // --- NODE: GENERATE_CHARACTER_PROMPT_ONLY (Tạo lại master identity lock an toàn) ---

  return null;
}
