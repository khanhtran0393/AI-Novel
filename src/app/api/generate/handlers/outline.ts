import { NextResponse } from 'next/server';
import {
  lorebookForPrompt,
  requireGenreLabelFromSetup,
  setupGenreFromPayload,
  truncateOutline,
  writeEngineRoleLine,
} from '@/lib/storyWriting';
import {
  callActiveModel,
  generateJsonWithRetry,
  getLastWorkingApiKey,
} from '../modelClients';
import type { GenerateHandlerContext } from './types';

/**
 * Owner: generate/outline.ts
 * Only handles requestTypes assigned in contracts/apiMap GENERATE_REQUEST_OWNERS → outline
 */
export async function handleOutline(
  ctx: GenerateHandlerContext,
  requestType: string,
): Promise<NextResponse | null> {
  const { payload, keysToUse, model } = ctx;

  if (requestType === 'GENERATE_OUTLINE') {
    const {
      chu_de,
      phong_cach,
      mo_ta,
      so_chuong: soChuongRaw,
      ngon_ngu,
      youtube_rewrite,
      similarity_target,
      youtube_title,
      youtube_captions_excerpt,
      rewrite_source_kind,
    } = payload || {};

    const soChuongN = Number(soChuongRaw);
    const so_chuong =
      Number.isFinite(soChuongN) && soChuongN >= 1
        ? Math.min(500, Math.round(soChuongN))
        : 10;

    const isRewrite = !!youtube_rewrite;
    const sourceKind =
      String(rewrite_source_kind || '').toLowerCase() === 'script'
        ? 'script'
        : 'youtube';
    const isScriptRewrite = isRewrite && sourceKind === 'script';
    const simTarget = Math.max(
      10,
      Math.min(
        100,
        Math.round(
          typeof similarity_target === 'number'
            ? similarity_target
            : typeof similarity_target === 'string' &&
                Number.isFinite(Number(similarity_target))
              ? Number(similarity_target)
              : 80,
        ),
      ),
    );

    const captionsExcerpt =
      typeof youtube_captions_excerpt === 'string'
        ? youtube_captions_excerpt.trim().slice(0, 4500)
        : '';

    const sourceLabel = isScriptRewrite
      ? youtube_title || 'Kịch bản dán'
      : youtube_title || 'YouTube';

    // Classic mode: require Setup. Rewrite mode may use rewrite defaults if user left blank.
    let genreLabel: string;
    try {
      if (isRewrite) {
        const fromSetup = requireGenreLabelFromSetup({
          chu_de: chu_de || (isScriptRewrite ? 'Viết lại kịch bản có sẵn' : 'Viết lại từ YouTube'),
          phong_cach: phong_cach || `Trùng ý tưởng mẫu ~${simTarget}%`,
        });
        genreLabel = fromSetup;
      } else {
        genreLabel = requireGenreLabelFromSetup(setupGenreFromPayload(payload));
      }
    } catch (e) {
      return NextResponse.json(
        { error: e instanceof Error ? e.message : String(e) },
        { status: 400 },
      );
    }

    const moTa = String(mo_ta || '').trim();
    if (!moTa && !isRewrite) {
      return NextResponse.json(
        {
          error:
            'Thieu mo_ta (y tuong cot truyen). Sinh y tuong hoac nhap cot truyen truoc khi tao dan y. App khong tu bi a bối cảnh.',
        },
        { status: 400 },
      );
    }

    const rewriteBlock = isRewrite
      ? `
  CHẾ ĐỘ VIẾT LẠI TỪ NGUỒN MẪU (bắt buộc tuân thủ):
  - Nguồn: ${isScriptRewrite ? 'kịch bản/truyện dán' : 'video YouTube'} "${sourceLabel}" — cốt truyện mẫu nằm trong "Ý tưởng cốt truyện gốc".
  - Độ trùng lặp MỤC TIÊU với ý tưởng mẫu: ~${simTarget}% (cấu trúc xung đột, nhịp, tiền đề, stakes).
  - ${simTarget >= 75 ? 'Bám sát khung truyện mẫu (cùng kiểu xung đột / escalate), chỉ thay da thịt.' : simTarget >= 50 ? 'Giữ xương sống ý tưởng mẫu, được phép xoay twist phụ.' : 'Chỉ lấy cảm hứng lỏng; khác biệt rõ so với mẫu.'}
  - CẤM copy nguyên văn phụ đề / thoại / mô tả nguồn. Tên nhân vật, địa danh, chi tiết cụ thể PHẢI mới (trừ khi kế thừa có chủ đích).
  - Ưu tiên cốt truyện mẫu hơn label chủ đề/phong cách UI.
  ${
    captionsExcerpt
      ? `- ĐỐI CHIẾU NGUỒN MẪU (chỉ canh ~${simTarget}% ý tưởng/nhịp — CẤM chép nguyên câu):
---
${captionsExcerpt}
---`
      : ''
  }
  `
      : '';

    const prompt = `${writeEngineRoleLine(genreLabel, 'writer')}
  Dựa trên các tham số cấu hình sau:
  - Chủ đề + Phong cách (Setup): ${genreLabel}
  - Chủ đề (raw): ${String(chu_de || '').trim() || '(nằm trong Setup gộp)'}
  - Phong cách (raw): ${String(phong_cach || '').trim() || '(nằm trong Setup gộp)'}
  - Ý tưởng cốt truyện gốc: ${moTa || '(chế độ viết lại — lấy từ nguồn mẫu)'}
  - Số lượng chương cần phân bổ: ${so_chuong} chương (BẮT BUỘC: chỉ được phép lên dàn ý đúng chính xác ${so_chuong} chương, không thừa không thiếu)
  - Ngôn ngữ đầu ra: ${ngon_ngu || 'Tiếng Việt'}
  ${rewriteBlock}
  Nhiệm vụ của bạn là:
  1. Đề xuất một tên tác phẩm bằng ${ngon_ngu || 'Tiếng Việt'} kịch tính, độc đáo${isRewrite ? ' (KHÔNG copy tiêu đề nguồn)' : `, bám thể loại Setup: ${genreLabel} — KHÔNG ép mạt thế/sinh tồn nếu Setup khác`}.
  2. Thiết lập Dàn ý Tổng thể (World-building & Plot Outline) thật chi tiết dưới dạng Markdown, khớp Setup thể loại.
  3. Bóc tách ra khoảng 2-4 tên nhân vật chính yếu (bắt buộc tên Hán Việt độc đáo mới mẻ, ví dụ: Tiêu Hàn, Thạch Dã, Diệp Dao... tuyệt đối không dùng Lâm Khuyết hay tên mòn). Mỗi nhân vật PHẢI có khuyết điểm (điểm yếu tính cách / thói xấu / nỗi sợ / hạn chế — KHÔNG bắt buộc "khuyết tật mạt thế").
  4. Phác thảo dàn ý chi tiết cho từng chương (từ Chương 1 đến Chương ${so_chuong}) để người dùng chốt chặn trước khi viết. (BẮT BUỘC: danh sách "danh_sach_chuong" bên dưới phải có đúng chính xác ${so_chuong} phần tử chương, không được phép tự tiện thêm bớt bất kỳ chương nào ngoài số lượng này).
  5. Xây dựng Bản Đồ Lưu Trữ Lõi Bất Biến (Lorebook) bao gồm các quy luật, hệ sinh thái, bối cảnh, hoặc nguyên tắc cốt lõi của thế giới này theo Setup — không ép mạt thế. Trình bày dưới dạng Markdown.
  
  Hạn chế/Yêu cầu:
  - Trả về định dạng JSON duy nhất và TUYỆT ĐỐI không bao bọc bởi tag markdown \`\`\`json hay text thừa. Khối JSON phải khớp chính xác cấu trúc sau:
  {
    "tieu_de": "Tên truyện đề xuất",
    "dan_y_tong_the": "# DÀN Ý TỔNG THỂ\\n\\n## 1. Bối cảnh thế giới...\\n\\n## 2. Diễn biến cốt truyện chính...",
    "lorebook": "# LOREBOOK\\n\\n## 1. Quy luật thế giới...",
    "nhan_vat": ["Nhân vật chính 1", "Nhân vật chính 2"],
    "danh_sach_chuong": [
  {
    "so_chuong": 1,
    "tieu_de": "Tiêu đề Chương 1",
    "dan_y": "Tóm tắt sự kiện, bối cảnh xảy ra trong Chương 1..."
  },
  ...
    ]
  }
  
  Hãy viết cực kỳ hấp dẫn, logic. Trả về đúng cấu trúc JSON nêu trên.`;
  
    const result = await generateJsonWithRetry(prompt, keysToUse, 2, model);
    return NextResponse.json({ ...result, usedApiKey: getLastWorkingApiKey() });
  } 
  
  
  // --- NODE 2: GENERATE_CHAPTER_OUTLINE ---
  
  if (requestType === 'GENERATE_CHAPTER_OUTLINE') {
    const { ten_tac_pham, dan_y_tong_the, lorebook, tri_nho_ngan_han, tom_tat_cuon_chieu, chuong_so } = payload;
    let genreLabel: string;
    try {
      genreLabel = requireGenreLabelFromSetup(setupGenreFromPayload(payload));
    } catch (e) {
      return NextResponse.json(
        { error: e instanceof Error ? e.message : String(e) },
        { status: 400 },
      );
    }
    const prompt = `${writeEngineRoleLine(genreLabel, 'writer')}
  Tác phẩm: "${ten_tac_pham}"
  Chương hiện tại cần lên dàn ý: Chương ${chuong_so}
  Setup thể loại (BẮT BUỘC bám): ${genreLabel}.
  Nhân vật trong dàn ý phải có khuyết điểm (điểm yếu tính cách / thói xấu / nỗi sợ / hạn chế — KHÔNG bắt buộc "khuyết tật mạt thế").
  
  --- LOREBOOK ---
  ${lorebookForPrompt(lorebook)}
  
  --- DÀN Ý TỔNG THỂ ---
  ${truncateOutline(dan_y_tong_the || 'Không có')}
  
  --- TRÍ NHỚ CUỐN CHIẾU & NGẮN HẠN ---
  Cuốn chiếu: ${tom_tat_cuon_chieu || 'Chưa có'}
  Ngắn hạn: ${(tri_nho_ngan_han && tri_nho_ngan_han.length > 0) ? tri_nho_ngan_han.join('\n') : 'Chưa có'}
  
  Dựa trên các dữ liệu trên, hãy suy luận logic và đưa ra Gợi Ý Dàn Ý Chương chi tiết cho chương tiếp theo (Chương ${chuong_so}). Đảm bảo tình tiết phát triển tự nhiên, hấp dẫn, cực kỳ sáng tạo và KHÔNG BỊ LẶP LẠI cốt truyện cũ.
  Chỉ trả về văn bản dàn ý (khoảng 100-200 từ), không bọc markdown hay json.`;
    const aiResponse = await callActiveModel(prompt, keysToUse, model);
    const danY = String(aiResponse || '').trim();
    if (!danY) {
      return NextResponse.json(
        { error: 'AI tra dan_y rong. Khong dung fill cuc bo.' },
        { status: 502 },
      );
    }
    return NextResponse.json({ dan_y: danY, usedApiKey: getLastWorkingApiKey() });
  }
  
  if (requestType === 'PLAN_ARC') {
    const { ten_tac_pham, lorebook, danh_sach_chuong_da_viet, cung_hien_tai, so_chuong_moi_cung } = payload;
    let genreLabel: string;
    try {
      genreLabel = requireGenreLabelFromSetup(setupGenreFromPayload(payload));
    } catch (e) {
      return NextResponse.json(
        { error: e instanceof Error ? e.message : String(e) },
        { status: 400 },
      );
    }
    const prompt = `${writeEngineRoleLine(genreLabel, 'writer')}
  Bạn là Kiến trúc sư của tiểu thuyết "${ten_tac_pham}" — thể loại Setup: ${genreLabel}.
  Hãy lập Dàn Ý cho Arc (Cung/Tập) ${cung_hien_tai + 1} gồm ${so_chuong_moi_cung} chương tiếp theo.
  Bám Setup; nhân vật giữ khuyết điểm (điểm yếu) nhất quán — không ép khuyết tật mạt thế.
  
  1. LÕI BẤT BIẾN:
  ${lorebookForPrompt(lorebook)}
  
  2. TÓM TẮT CÁC CHƯƠNG ĐÃ VIẾT TRƯỚC ĐÓ:
  ${danh_sach_chuong_da_viet}
  
  Dựa vào diễn biến hiện tại, hãy lập dàn ý chi tiết sự kiện cho ${so_chuong_moi_cung} chương kế tiếp.
  
  TRẢ VỀ JSON:
  {
    "danh_sach_chuong": [
  {
    "so_chuong": number,
    "tieu_de": "Tên chương",
    "dan_y": "Tóm tắt sự kiện xảy ra trong chương này (càng chi tiết càng tốt)"
  }
    ]
  }`;
    const result = await generateJsonWithRetry(prompt, keysToUse, 2, model);
    return NextResponse.json({ ...result, usedApiKey: getLastWorkingApiKey() });
  }
  
  // --- NODE: EXPAND_SCENE ---

  return null;
}
