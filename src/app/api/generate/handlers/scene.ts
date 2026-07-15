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
 * Owner: generate/scene.ts
 * Only handles requestTypes assigned in contracts/apiMap GENERATE_REQUEST_OWNERS → scene
 */
export async function handleScene(
  ctx: GenerateHandlerContext,
  requestType: string,
): Promise<NextResponse | null> {
  const { payload, keysToUse, model } = ctx;

  if (requestType === 'EXPAND_SCENE') {
    const {
      ten_tac_pham,
      chuong_hien_tai,
      lorebook,
      previous_scene_content,
      current_scene_content,
      next_scene_content,
      is_hook,
    } = payload;
  
    const isHook = !!is_hook;
  
    const prompt = isHook
      ? `Bạn là Biên kịch cold-open YouTube (~30–45 giây đọc) cho tiểu thuyết mạt thế.
  Tác phẩm "${ten_tac_pham}", Chương ${chuong_hien_tai?.so_chuong || '?'}: "${chuong_hien_tai?.tieu_de || '?'}".
  
  --- LOREBOOK ---
  ${lorebook || 'Luật thế giới mạt thế cực lạnh.'}
  
  --- HOOK / MỞ ĐẦU HIỆN TẠI (CẦN MỞ RỘNG) ---
  ${current_scene_content}
  
  --- CẢNH 1 SAU HOOK (để nối nhịp, không chép) ---
  ${next_scene_content || 'Chưa có.'}
  
  NHIỆM VỤ — MỞ RỘNG HOOK:
  1. Mở rộng bản hook thêm khoảng 40–80% độ dài so với gốc, vẫn giữ nhịp cold-open (ước đọc ~30–45 giây, khoảng 80–130 từ tiếng Việt).
  2. GIỮ cốt xung đột / pattern interrupt / open loop; không spoiler hết chương; không biến hook thành cả cảnh dài.
  3. Bổ sung: chi tiết giác quan chọn lọc, nhịp thở, 1–2 câu thoại đời, áp lực thời gian/cạn kiệt.
  4. Câu đầu vẫn phải căng (đe dọa / câu hỏi) — CẤM mở thơ phong cảnh.
  5. Cuối hook: open loop nối mượt sang cảnh 1.
  6. Nếu trong hook gốc đã có câu đùa ngoặc đơn “người nói với người”: GIỮ phải VUI (có punchline) + bâng quơ, KHÔNG đổi thành bình luận cốt truyện hay nhắc nhở nhạt. Nếu chưa có: có thể chèn 1 joke vui không dính chủ đề/nhân vật/twist, ví dụ (Đề nghị mọi người đi vệ sinh nhớ chùi đít) — CẤM SFX (Cười)/(thở dài).
  7. Chỉ trả về NỘI DUNG HOOK thuần — không tag [CẢNH], không markdown, không giải thích.`
      : `Bạn là Trợ lý Biên kịch Sản xuất kịch bản tiểu thuyết mạt thế chuyên nghiệp bậc nhất.
  Bạn đang viết tác phẩm "${ten_tac_pham}", thuộc Chương ${chuong_hien_tai?.so_chuong || '?'}: "${chuong_hien_tai?.tieu_de || '?'}".
  
  1. LÕI BẤT BIẾN (LOREBOOK):
  ${lorebook || 'Luật thế giới mạt thế cực lạnh.'}
  
  --- CẢNH TRƯỚC ĐÓ ---
  ${previous_scene_content || 'Không có cảnh trước đó.'}
  
  --- CẢNH HIỆN TẠI (CẦN MỞ RỘNG) ---
  ${current_scene_content}
  
  --- CẢNH TIẾP THEO ---
  ${next_scene_content || 'Không có cảnh tiếp theo.'}
  
  NHIỆM VỤ:
  Bạn hãy mở rộng và viết sâu hơn nội dung của "CẢNH HIỆN TẠI" thêm khoảng 50-100% độ dài so với bản gốc. 
  Hãy bổ sung chi tiết: miêu tả biểu cảm nhân vật, suy nghĩ nội tâm, không gian xung quanh, bối cảnh thời tiết và cách các vật dụng sinh tồn được sử dụng.
  Đặc biệt quan trọng: NỘI DUNG MỞ RỘNG PHẢI KẾT NỐI MƯỢT MÀ, HỢP LÝ VỚI CẢNH TRƯỚC VÀ CẢNH TIẾP THEO (nếu có). Tránh thay đổi mạch truyện hay tạo ra tình tiết vô lý lệch pha với cảnh kế tiếp.
  Chỉ trả về nội dung thuần túy của cảnh hiện tại đã được mở rộng. TUYỆT ĐỐI KHÔNG trả về Tên Cảnh (như [CẢNH X...]) hay bất kỳ định dạng nào khác. Không kèm cảnh trước hay cảnh sau vào kết quả.`;
  
    const aiResponse = await callActiveModel(prompt, keysToUse, model);
    return NextResponse.json({ expanded_content: aiResponse, usedApiKey: getLastWorkingApiKey() });
  }
  
  // --- NODE: REWRITE_SCENE (viết lại nhẹ, giữ cốt lõi + nối mạch cảnh kề / Hook) ---
  
  if (requestType === 'REWRITE_SCENE') {
    const {
      ten_tac_pham,
      chuong_hien_tai,
      lorebook,
      previous_scene_content,
      current_scene_content,
      next_scene_content,
      is_hook,
      humanize_script,
    } = payload;
  
    const humanizeOn = humanize_script !== false;
    const isHook = !!is_hook;
  
    const prompt = isHook
      ? `Bạn là Biên tập viên cold-open YouTube (~30 giây đọc) cho tiểu thuyết mạt thế.
  Tác phẩm "${ten_tac_pham}", Chương ${chuong_hien_tai?.so_chuong || '?'}: "${chuong_hien_tai?.tieu_de || '?'}".
  
  --- LOREBOOK ---
  ${lorebook || 'Luật thế giới mạt thế cực lạnh.'}
  
  --- HOOK / MỞ ĐẦU HIỆN TẠI (CẦN VIẾT LẠI) ---
  ${current_scene_content}
  
  --- CẢNH 1 SAU HOOK (để nối nhịp, không chép) ---
  ${next_scene_content || 'Chưa có.'}
  
  NHIỆM VỤ — VIẾT LẠI HOOK ~30s:
  1. GIỮ cốt xung đột / pattern interrupt / open loop của bản gốc; không spoiler hết chương.
  2. Độ dài: khoảng thời gian đọc ~25–35 giây (ước 70–110 từ tiếng Việt), không phình dài thành cả cảnh.
  3. Câu đầu 1–3: xung đột / đe dọa / câu hỏi — CẤM mở thơ phong cảnh.
  4. Cuối hook: open loop (cắt dở, tiếng động, câu hỏi) nối sang cảnh 1.
  5. Thoại đời, nhịp audio-friendly (câu ngắn vừa miệng đọc).
  ${humanizeOn ? '6. TÍNH NGƯỜI: chèn đúng 1 câu đùa "người nói với người" trong ngoặc đơn giữa nhịp thoại. Giọng hội bạn đời (bẩn nhẹ/absurde/đề nghị vớ vẩn), VUI, bâng quơ — KHÔNG dính cốt truyện. Ví dụ: "...mệt." (Đề nghị mọi người đi vệ sinh nhớ chùi đít) "Mệt hả?..." — CẤM mùi AI (lương/crush/gym/Google); CẤM nhắc nhạt; CẤM meta plot; CẤM SFX (Cười)/(thở dài).' : ''}
  7. Chỉ trả về NỘI DUNG HOOK thuần — không tag [CẢNH], không markdown, không giải thích.`
      : `Bạn là Biên tập viên kịch bản tiểu thuyết mạt thế chuyên nghiệp.
  Bạn đang chỉnh sửa tác phẩm "${ten_tac_pham}", Chương ${chuong_hien_tai?.so_chuong || '?'}: "${chuong_hien_tai?.tieu_de || '?'}".
  
  1. LÕI BẤT BIẾN (LOREBOOK):
  ${lorebook || 'Luật thế giới mạt thế cực lạnh.'}
  
  --- CẢNH TRƯỚC ĐÓ ---
  ${previous_scene_content || 'Không có cảnh trước đó.'}
  
  --- CẢNH HIỆN TẠI (CẦN VIẾT LẠI NHẸ) ---
  ${current_scene_content}
  
  --- CẢNH TIẾP THEO ---
  ${next_scene_content || 'Không có cảnh tiếp theo.'}
  
  NHIỆM VỤ — VIẾT LẠI NHẸ (LIGHT REWRITE), KHÔNG PHẢI MỞ RỘNG HAY VIẾT LẠI MẠNH:
  
  1. GIỮ NGUYÊN cốt truyện, sự kiện, hành động nhân vật, thông tin quan trọng và thứ tự diễn biến của CẢNH HIỆN TẠI. Không thêm tình tiết mới lớn, không xóa mốc quan trọng.
  2. Chỉ trau chuốt câu chữ: mượt hơn, tự nhiên hơn, đa giác quan vừa phải — KHÔNG kéo dài quá ~15% số từ so với bản gốc, cũng không rút ngắn quá ~15%.
  3. ĐIỀU HÒA & NỐI TIẾP:
     - Câu mở cảnh phải liền mạch với CẢNH TRƯỚC (không nhảy cóc, không lặp lại nguyên khối cuối cảnh trước).
     - Câu kết cảnh phải mở nhịp hợp lý sang CẢNH TIẾP THEO (không mâu thuẫn, không spoil lệch, không cắt đột ngột).
     - Giọng văn, không khí, thời gian/không gian phải đồng bộ với hai cảnh kề (nếu có).
  4. Giữ tên nhân vật, thuật ngữ lore, và chi tiết nhận diện đã có trong cảnh gốc.
  5. Chỉ trả về NỘI DUNG THUẦN của cảnh hiện tại đã viết lại. TUYỆT ĐỐI KHÔNG trả tên cảnh (như [CẢNH X...]), không kèm cảnh trước/sau, không markdown giải thích.`;
  
    const aiResponse = await callActiveModel(prompt, keysToUse, model);
    let rewritten = (aiResponse || '').normalize('NFC').trim();
    if (isHook && humanizeOn) {
      rewritten = injectHumanJokeAsides(rewritten, { minCount: 1, enabled: true });
    }
    return NextResponse.json({ rewritten_content: rewritten, usedApiKey: getLastWorkingApiKey() });
  }
  
  // --- NODE: EXTRACT_CHARACTERS ---

  return null;
}
