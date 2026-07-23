import { NextResponse } from 'next/server';
import {
  lorebookForPrompt,
  requireGenreLabelFromSetup,
  setupGenreFromPayload,
  writeEngineRoleLine,
} from '@/lib/storyWriting';
import {
  buildScriptModePacingBlock,
  buildShortManhuaSceneBlock,
  getScriptModePacing,
  isShortManhuaMode,
  normalizeScriptMode,
} from '@/lib/scriptMode';
import {
  buildStyleEngineWriteBlock,
  resolveStyleEngineFromSetupPayload,
} from '@/lib/styleEngineProfiles';
import {
  buildMatrixWriteBlock,
  composeMatrixFromPayload,
} from '@/lib/matrixEngine';
import {
  injectHumanJokeAsides,
  countHumanJokeAsides,
} from '@/lib/youtubeSafe';
import {
  callActiveModel,
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
      scriptMode,
    } = payload;

    let genreLabel: string;
    try {
      genreLabel = requireGenreLabelFromSetup(setupGenreFromPayload(payload));
    } catch (e) {
      return NextResponse.json(
        { error: e instanceof Error ? e.message : String(e) },
        { status: 400 },
      );
    }
  
    const isHook = !!is_hook;
    const lore = lorebookForPrompt(lorebook);
    const mode = normalizeScriptMode(scriptMode);
    const pacing = getScriptModePacing(mode);
    const shortBlock = isShortManhuaMode(mode)
      ? buildShortManhuaSceneBlock('expand')
      : '';
    const hookLenHint =
      mode === 'short_manhua'
        ? 'ước đọc ~15–30 giây, khoảng 40–90 từ (~170 WPM short)'
        : mode === 'sang_van'
          ? 'ước đọc ~20–35 giây, khoảng 60–110 từ (~155 WPM recap)'
          : 'ước đọc ~25–40 giây, khoảng 70–120 từ (~130 WPM chuyên sâu) — không ép trailer Shorts';
  
    const prompt = isHook
      ? `${writeEngineRoleLine(genreLabel, 'hook_writer')}
  Tác phẩm "${ten_tac_pham}", Chương ${chuong_hien_tai?.so_chuong || '?'}: "${chuong_hien_tai?.tieu_de || '?'}".
  Setup thể loại: ${genreLabel}.
  scriptMode: ${mode} · coldOpen=${pacing.coldOpen}.
  ${buildScriptModePacingBlock(mode)}
  ${buildMatrixWriteBlock(composeMatrixFromPayload({ ...(payload || {}), genre: genreLabel, lorebook }), {
    isContinue: false,
    maxMoTaChars: 400,
  })}
  ${buildStyleEngineWriteBlock(resolveStyleEngineFromSetupPayload(payload || {}), {
    scriptMode: mode,
  })}
  
  --- LOREBOOK ---
  ${lore}
  
  --- HOOK / MỞ ĐẦU HIỆN TẠI (CẦN MỞ RỘNG) ---
  ${current_scene_content}
  
  --- CẢNH 1 SAU HOOK (để nối nhịp, không chép) ---
  ${next_scene_content || 'Chưa có.'}
  ${shortBlock}
  NHIỆM VỤ — MỞ RỘNG HOOK:
  1. Mở rộng bản hook thêm khoảng 40–80% độ dài so với gốc, vẫn giữ nhịp cold-open (${hookLenHint}).
  2. GIỮ cốt xung đột / pattern interrupt / open loop; không spoiler hết chương; không biến hook thành cả cảnh dài.
  3. Bổ sung: chi tiết giác quan chọn lọc, nhịp thở, 1–2 câu thoại đời, áp lực thời gian/cạn kiệt phù hợp thể loại Setup.
  4. Câu đầu vẫn phải căng (đe dọa / câu hỏi / xung đột) — CẤM mở thơ phong cảnh.
  5. Cuối hook: open loop nối mượt sang cảnh 1.
  6. Nếu trong hook gốc đã có câu đùa ngoặc đơn “người nói với người”: GIỮ phải VUI (có punchline) + bâng quơ, KHÔNG đổi thành bình luận cốt truyện hay nhắc nhở nhạt. Nếu chưa có: có thể chèn 1 joke vui không dính chủ đề/nhân vật/twist, ví dụ (Đề nghị mọi người đi vệ sinh nhớ chùi đít) — CẤM SFX (Cười)/(thở dài).
  7. Chỉ trả về NỘI DUNG HOOK thuần — không tag [CẢNH], không markdown, không giải thích.`
      : `${writeEngineRoleLine(genreLabel, 'scene_writer')}
  Bạn đang viết tác phẩm "${ten_tac_pham}", thuộc Chương ${chuong_hien_tai?.so_chuong || '?'}: "${chuong_hien_tai?.tieu_de || '?'}".
  Setup thể loại: ${genreLabel}.
  scriptMode: ${mode}.
  ${buildMatrixWriteBlock(composeMatrixFromPayload({ ...(payload || {}), genre: genreLabel, lorebook }), {
    isContinue: true,
    maxMoTaChars: 300,
  })}
  
  1. LÕI BẤT BIẾN (LOREBOOK):
  ${lore}
  
  --- CẢNH TRƯỚC ĐÓ ---
  ${previous_scene_content || 'Không có cảnh trước đó.'}
  
  --- CẢNH HIỆN TẠI (CẦN MỞ RỘNG) ---
  ${current_scene_content}
  
  --- CẢNH TIẾP THEO ---
  ${next_scene_content || 'Không có cảnh tiếp theo.'}
  ${shortBlock}
  NHIỆM VỤ:
  Mở rộng "CẢNH HIỆN TẠI" thêm khoảng 50–100% độ dài so với bản gốc — văn mượt, có nhịp thở, chống thô cứng.
  Bổ sung chọn lọc: 1–2 chi tiết không gian/đạo cụ đắt (theo Setup), biểu cảm/cử chỉ, ${
    isShortManhuaMode(mode)
      ? 'thoại đời + action nhìn được (ưu tiên short/manhua; nội tâm tối đa 1–2 câu)'
      : '1–3 câu nội tâm lệch tính cách, thoại đời có subtext'
  }.
  Xen câu ngắn và câu vừa/dài; CẤM checklist hành động, CẤM stack 5 giác quan, CẤM giải thích cảm xúc bằng lời kể rỗng.
  NỐI MƯỢT với cảnh trước và cảnh sau (nếu có) — không lệch pha tình tiết.
  Chỉ trả về nội dung thuần của cảnh hiện tại đã mở rộng. CẤM tag [CẢNH X...], CẤM markdown, CẤM kèm cảnh kề.`;
  
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
      scriptMode,
    } = payload;

    let genreLabel: string;
    try {
      genreLabel = requireGenreLabelFromSetup(setupGenreFromPayload(payload));
    } catch (e) {
      return NextResponse.json(
        { error: e instanceof Error ? e.message : String(e) },
        { status: 400 },
      );
    }
  
    const humanizeOn = humanize_script !== false;
    const isHook = !!is_hook;
    const lore = lorebookForPrompt(lorebook);
    const mode = normalizeScriptMode(scriptMode);
    const pacingRw = getScriptModePacing(mode);
    const shortBlock = isShortManhuaMode(mode)
      ? buildShortManhuaSceneBlock('rewrite')
      : '';
    const hookLenRw =
      mode === 'short_manhua'
        ? '~15–30 giây (40–90 từ, short ~170 WPM)'
        : mode === 'sang_van'
          ? '~20–35 giây (60–110 từ, recap ~155 WPM)'
          : '~25–40 giây (70–120 từ, chuyên sâu ~130 WPM — không trailer Shorts)';
  
    const prompt = isHook
      ? `${writeEngineRoleLine(genreLabel, 'hook_editor')}
  Tác phẩm "${ten_tac_pham}", Chương ${chuong_hien_tai?.so_chuong || '?'}: "${chuong_hien_tai?.tieu_de || '?'}".
  Setup thể loại: ${genreLabel}.
  scriptMode: ${mode} · coldOpen=${pacingRw.coldOpen}.
  ${buildScriptModePacingBlock(mode)}
  ${buildStyleEngineWriteBlock(resolveStyleEngineFromSetupPayload(payload || {}), {
    scriptMode: mode,
  })}
  
  --- LOREBOOK ---
  ${lore}
  
  --- HOOK / MỞ ĐẦU HIỆN TẠI (CẦN VIẾT LẠI) ---
  ${current_scene_content}
  
  --- CẢNH 1 SAU HOOK (để nối nhịp, không chép) ---
  ${next_scene_content || 'Chưa có.'}
  ${shortBlock}
  NHIỆM VỤ — VIẾT LẠI HOOK (${hookLenRw}):
  1. GIỮ cốt xung đột / pattern interrupt / open loop của bản gốc; không spoiler hết chương.
  2. Độ dài theo Phong Cách Kịch Bản: ${hookLenRw}; không phình dài thành cả cảnh.
  3. Câu đầu 1–3: xung đột / đe dọa / câu hỏi — CẤM mở thơ phong cảnh.
  4. Cuối hook: open loop (cắt dở, tiếng động, câu hỏi) nối sang cảnh 1.
  5. Thoại đời, nhịp audio-friendly theo mode (${pacingRw.wpm} WPM gợi ý).
  ${humanizeOn ? '6. TÍNH NGƯỜI: chèn đúng 1 câu đùa "người nói với người" trong ngoặc đơn giữa nhịp thoại. Giọng hội bạn đời (bẩn nhẹ/absurde/đề nghị vớ vẩn), VUI, bâng quơ — KHÔNG dính cốt truyện. Ví dụ: "...mệt." (Đề nghị mọi người đi vệ sinh nhớ chùi đít) "Mệt hả?..." — CẤM mùi AI (lương/crush/gym/Google); CẤM nhắc nhạt; CẤM meta plot; CẤM SFX (Cười)/(thở dài).' : ''}
  7. Chỉ trả về NỘI DUNG HOOK thuần — không tag [CẢNH], không markdown, không giải thích.`
      : `${writeEngineRoleLine(genreLabel, 'scene_editor')}
  Bạn đang chỉnh sửa tác phẩm "${ten_tac_pham}", Chương ${chuong_hien_tai?.so_chuong || '?'}: "${chuong_hien_tai?.tieu_de || '?'}".
  Setup thể loại: ${genreLabel}.
  scriptMode: ${mode}.
  
  1. LÕI BẤT BIẾN (LOREBOOK):
  ${lore}
  
  --- CẢNH TRƯỚC ĐÓ ---
  ${previous_scene_content || 'Không có cảnh trước đó.'}
  
  --- CẢNH HIỆN TẠI (CẦN VIẾT LẠI NHẸ) ---
  ${current_scene_content}
  
  --- CẢNH TIẾP THEO ---
  ${next_scene_content || 'Không có cảnh tiếp theo.'}
  ${shortBlock}
  NHIỆM VỤ — VIẾT LẠI NHẸ (LIGHT REWRITE), KHÔNG PHẢI MỞ RỘNG HAY VIẾT LẠI MẠNH:
  
  1. GIỮ NGUYÊN cốt truyện, sự kiện, hành động nhân vật, thông tin quan trọng và thứ tự diễn biến của CẢNH HIỆN TẠI. Không thêm tình tiết mới lớn, không xóa mốc quan trọng.
  2. Trau chuốt câu chữ: mượt hơn, ${
    isShortManhuaMode(mode)
      ? 'thoại dứt + action nhìn được (short/manhua), subtext nhẹ'
      : 'subtext, nhịp câu xen ngắn–vừa–dài, thoại đời'
  } — chống thô cứng/checklist. Chi tiết giác quan chọn lọc (1–2 đắt). KHÔNG đổi độ dài quá ~15% so với bản gốc.
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
