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
 * Owner: generate/chapter.ts
 * Only handles requestTypes assigned in contracts/apiMap GENERATE_REQUEST_OWNERS → chapter
 */
export async function handleChapter(
  ctx: GenerateHandlerContext,
  requestType: string,
): Promise<NextResponse | null> {
  const { payload, keysToUse, model } = ctx;

  if (requestType === 'WRITE_CHAPTER') {
    const { 
      ten_tac_pham, 
      dan_y_tong_the, 
      nhan_vat,
      nhan_vat_prompts,
      chuong_hien_tai, 
      tom_tat_cuon_chieu, 
      tri_nho_ngan_han, 
      lorebook,
      so_tu_chuong,
      ngon_ngu,
      noi_dung_hien_tai,
      userRules,
      da_dien_ra_entities,
      world_state,
      current_beat_type,
      intervention_directive,
      force_word_gate_continue,
      humanize_script,
    } = payload;
  
    const wordGoal = so_tu_chuong ? Number(so_tu_chuong) : DEFAULT_WORD_GOAL;
    const wordMin = Math.round(wordGoal * 0.92);
    const charBible = formatCharacterBible(nhan_vat, nhan_vat_prompts);
    const spentBlock = formatSpentEntities(da_dien_ra_entities);
    const worldBlock = formatWorldState(world_state);
    const outlineBlock = truncateOutline(dan_y_tong_the || '');
    const beat = current_beat_type || 'Beat A (Discovery)';
    const resolvedRules = resolveUserRules(userRules);
    const humanizeOn = humanize_script !== false;
  
    let continueBlock = '';
    if (noi_dung_hien_tai && String(noi_dung_hien_tai).trim()) {
      continueBlock = '\n' + buildContinueContext(String(noi_dung_hien_tai)).promptBody;
    } else {
      continueBlock = '\nĐừng thêm tiêu đề chương, hãy bắt đầu viết trực tiếp nội dung chương truyện với [CẢNH 1: ...] ngay.';
    }
  
    const interventionBlock = intervention_directive
      ? `\n\n--- LỆNH CAN THIỆP TỪ TÁC GIẢ (BẮT BUỘC TUÂN THỦ KHI VIẾT TIẾP) ---\n${intervention_directive}\n`
      : '';
  
    const wordGateExtra = force_word_gate_continue
      ? `\n⚠️ CHẾ ĐỘ BÙ CỔNG TỪ: Bản trước CHƯA ĐẠT tối thiểu ${wordMin} từ và/hoặc chưa đủ ${MIN_SCENE_COUNT} phân cảnh. Hãy viết DÀI HƠN, thêm cảnh mới nếu thiếu, miêu tả chi tiết hơn. Chỉ trả về phần MỚI.`
      : '';
  
    const prompt = `Bạn là Trợ lý Biên kịch Sản xuất kịch bản tiểu thuyết mạt thế chuyên nghiệp bậc nhất.
  Hãy viết kịch bản chi tiết văn học đa giác quan cho Chương ${chuong_hien_tai.so_chuong}: "${chuong_hien_tai.tieu_de}" thuộc tác phẩm "${ten_tac_pham}".
  
  --- BỐI CẢNH VÀ TRÍ NHỚ VĨ MÔ (ROLLING CONTEXT SYSTEM) ---
  1. LÕI BẤT BIẾN (LOREBOOK):
  ${lorebook || 'Luật thế giới mạt thế cực lạnh.'}
  
  2. DÀN Ý TỔNG THỂ (RÚT GỌN — chỉ định hướng arc, KHÔNG chép vào kịch bản):
  ${outlineBlock || 'Chưa có dàn ý tổng thể.'}
  
  3. TÓM TẮT CUỐN CHIẾU CÁC CHƯƠNG TRƯỚC (DƯỚI 500 TỪ):
  ${tom_tat_cuon_chieu || 'Chưa viết chương trước nào.'}
  
  4. TRÍ NHỚ NGẮN HẠN (3 CHƯƠNG GẦN NHẤT):
  ${(tri_nho_ngan_han && tri_nho_ngan_han.length > 0) ? tri_nho_ngan_han.join('\n') : 'Chưa có trí nhớ ngắn hạn.'}
  
  5. HỒ SƠ NHÂN VẬT (BIBLE — giữ tính cách/hành vi/ngoại hình nhất quán):
  ${charBible}
  
  6. WORLD STATE (trạng thái hiện tại — tôn trọng inventory/clue/location):
  ${worldBlock}
  
  7. ENTITIES ĐÃ DÙNG (tránh lặp motif/địa điểm/vật phẩm):
  ${spentBlock}
  
  8. NHỊP BEAT CHƯƠNG NÀY (bắt buộc định hướng xung đột):
  ${beat}
  - Beat A (Discovery): khám phá manh mối, bối cảnh, bí ẩn mới.
  - Beat B (Confrontation): đối đầu, va chạm lợi ích, căng thẳng leo thang.
  - Beat C (Survival Crisis): khủng hoảng sinh tồn, áp lực thời gian/cạn kiệt.
  - Beat D (Insight): bẻ gãy nhận thức, twist logic, hậu quả cảm xúc.
  
  DÀN Ý SỰ KIỆN CHƯƠNG HIỆN TẠI:
  ${chuong_hien_tai.dan_y}
  ${interventionBlock}${wordGateExtra}
  
  YÊU CẦU KỸ THUẬT KHI TẠO TÁC KỊCH BẢN CHI TIẾT:
  - Ngôn ngữ viết: BẮT BUỘC PHẢI VIẾT BẰNG ${ngon_ngu || 'Tiếng Việt'}. Dịch toàn bộ văn cảnh và đối thoại sang ngôn ngữ này nhưng phải giữ văn phong mượt mà, đậm chất điện ảnh.
  1. TUYỆT ĐỐI CẤM in lại, nhại lại hoặc chép lại Lõi Bất Biến (Lorebook), Trí nhớ, Dàn ý hay bất kỳ thông tin nào từ BỐI CẢNH VÀ TRÍ NHỚ VĨ MÔ vào trong kịch bản. Chữ duy nhất bạn xuất ra phải là NỘI DUNG KỊCH BẢN THUẦN TÚY.
  2. Viết văn học/kịch bản sạch: CẤM ghi chú đạo diễn / FX kiểu [âm thanh gió rít], (Cười), (thở dài), (nhạc nền). NGOẠI LỆ BẮT BUỘC khi bật tính người: được (và nên) chèn 1–3 câu đùa “người nói với người” trong ngoặc đơn giữa nhịp thoại — xem khối CÂU ĐÙA.
  3. TUYỆT ĐỐI TUÂN THỦ: Tên mỗi cảnh phải được bọc trong DẤU NGOẶC VUÔNG trên một dòng riêng. Ví dụ:
  [CẢNH 1: NỘI CẢNH. ĐỊA ĐIỂM - THỜI GIAN]
  Nội dung phân cảnh...
  4. Viết sống động, có chiều sâu tâm lý kể chuyện (pattern interrupt, open loop, loss qua tình huống — xem khối NARRATIVE PSYCH). Real-time pacing: CẤM time-skip / tóm tắt tuần/tháng. Ưu tiên hành động + thoại; miêu tả giác quan có chọn lọc (không stack liên tục 5 giác quan).
  5. Đạt chuẩn Cổng Từ (Word-Gate): mục tiêu ~${wordGoal} từ (không dưới ${wordMin} từ) bằng xung đột, hội thoại, độc thoại nội tâm — KHÔNG nhồi sáo AI.
  6. ⚠️ MỆNH LỆNH TUYỆT ĐỐI VỀ PHÂN CẢNH: BẮT BUỘC chia thành TỐI THIỂU ${MIN_SCENE_COUNT} đến 5 phân cảnh. Mỗi cảnh một dòng tag: [CẢNH X: NỘI CẢNH/NGOẠI CẢNH. ĐỊA ĐIỂM CỤ THỂ - THỜI GIAN]. Phân bổ đều số từ. CẤM chỉ 1–2 cảnh. Mỗi cảnh: mở căng + cuối open loop.
  7. 🚫 TỪ CẤM: ${resolvedRules.forbidden_words}
  8. ⚠️ TỪ SÁO / VĂN AI: Hạn chế tối đa: ${resolvedRules.fatigue_words}
  ${buildHumanizeScriptBlock(humanizeOn)}
  ${buildSpeechFingerprintBlock(nhan_vat, nhan_vat_prompts)}
  ${continueBlock}`;
  
    const aiResponse = await callActiveModel(prompt, keysToUse, model);
    let normalized = normalizeSceneTags((aiResponse || '').normalize('NFC'));
    // Bảo đảm ≥1 câu đùa người-nói-với-người khi humanize bật (chunk standalone;
    // continue-mode: chỉ inject nếu chunk chưa có và bản merge cũng chưa đủ).
    if (humanizeOn) {
      const mergedPreview = noi_dung_hien_tai
        ? `${noi_dung_hien_tai}\n\n${normalized}`
        : normalized;
      const jokesInMerged = countHumanJokeAsides(mergedPreview);
      if (jokesInMerged < 1) {
        normalized = injectHumanJokeAsides(normalized, { minCount: 1, enabled: true });
      }
    }
    // When continuing, gate is evaluated on the MERGED chapter by the client.
    // Here we report stats for this chunk alone for observability.
    const mergedForGate = noi_dung_hien_tai
      ? `${noi_dung_hien_tai}\n\n${normalized}`
      : normalized;
    const gate = evaluateWordGate(mergedForGate, wordGoal, MIN_SCENE_COUNT);
    const narrativePsych = scoreNarrativePsychScript(mergedForGate);
  
    return NextResponse.json({
      noi_dung: normalized,
      usedApiKey: getLastWorkingApiKey(),
      wordCount: gate.wordCount,
      sceneCount: gate.sceneCount,
      wordMin: gate.wordMin,
      wordGoal: gate.wordGoal,
      needsContinue: gate.needsContinue,
      wordsOk: gate.wordsOk,
      scenesOk: gate.scenesOk,
      narrativePsych,
      humanJokeCount: countHumanJokeAsides(mergedForGate),
    });
  }
  
  // --- NODE: REVISE_CHAPTER (sửa theo nhận xét biên tập) ---
  
  if (requestType === 'REVISE_CHAPTER') {
    const {
      ten_tac_pham,
      chuong_hien_tai,
      noi_dung_kich_ban,
      lorebook,
      userRules,
      review,
      mode, // 'rewrite' | 'polish' | 'audio_readability'
      ngon_ngu,
      so_tu_chuong,
      nhan_vat,
      nhan_vat_prompts,
      humanize_script,
    } = payload;
  
    const wordGoal = so_tu_chuong ? Number(so_tu_chuong) : DEFAULT_WORD_GOAL;
    const wordMin = Math.round(wordGoal * 0.92);
    const dims = Array.isArray(review?.dimensions) ? review.dimensions : [];
    const dimNotes = dims
      .map((d: { dimension?: string; score?: number; comment?: string }) =>
        `- ${d.dimension || '?'}: ${d.score ?? '?'}/100 — ${d.comment || ''}`)
      .join('\n');
    const isRewrite = mode === 'rewrite';
    const isAudioRead = mode === 'audio_readability';
    const charBible = formatCharacterBible(nhan_vat, nhan_vat_prompts);
    const resolvedRules = resolveUserRules(userRules);
    const humanizeOn = humanize_script !== false;
    const modeLabel = isAudioRead
      ? 'AUDIO_READABILITY (tối ưu nhịp đọc TTS/YouTube, cắt câu dài)'
      : isRewrite
        ? 'REWRITE (viết lại mạnh, sửa triệt để các điểm yếu)'
        : 'POLISH (giữ cốt truyện, trau chuốt văn phong/nhịp/thoại đời)';
  
    const prompt = `Bạn là Biên kịch kiêm Editor tiểu thuyết mạt thế (chuẩn YouTube-safe narration).
  Tác phẩm: "${ten_tac_pham}" — Chương ${chuong_hien_tai?.so_chuong}: "${chuong_hien_tai?.tieu_de}".
  Chế độ: ${modeLabel}.
  
  --- LOREBOOK ---
  ${lorebook || 'Không có'}
  
  --- HỒ SƠ NHÂN VẬT ---
  ${charBible}
  
  --- NHẬN XÉT BIÊN TẬP ---
  Verdict: ${review?.verdict || mode}
  Tóm tắt: ${review?.summary || ''}
  Chi tiết:
  ${dimNotes || '(không có)'}
  
  --- LUẬT TỪ ---
  Từ cấm: ${resolvedRules.forbidden_words}
  Từ sáo / văn AI: ${resolvedRules.fatigue_words}
  ${buildHumanizeScriptBlock(humanizeOn)}
  ${buildSpeechFingerprintBlock(nhan_vat, nhan_vat_prompts)}
  ${isAudioRead ? buildAudioReadabilityBlock() : ''}
  
  --- BẢN THẢO HIỆN TẠI ---
  ${noi_dung_kich_ban}
  
  NHIỆM VỤ:
  1. ${isAudioRead
    ? 'Giữ 100% tình tiết và tag cảnh; chỉ tối ưu nhịp đọc audio (câu ngắn hơn, nghỉ thở, cắt sáo).'
    : isRewrite
    ? 'Viết lại toàn bộ chương, khắc phục mọi chiều điểm thấp (<70), giữ dàn ý sự kiện cốt lõi nhưng nâng pacing/character/hook + NARRATIVE PSYCH (pattern interrupt, open loop cuối cảnh, loss qua tình huống, curiosity gap — CẤM slogan SEO trong prose) + tính người (thoại đời, im lặng hữu ích).'
    : 'Giữ cấu trúc và tình tiết chính; trau chuốt câu chữ, nhịp, đối thoại đời, cắt sáo rỗng và văn AI; tăng hook đầu cảnh + open loop cuối cảnh theo NARRATIVE PSYCH.'}
  2. Ngôn ngữ: ${ngon_ngu || 'Tiếng Việt'}.
  3. Giữ/khôi phục tag phân cảnh dạng [CẢNH X: NỘI CẢNH/NGOẠI CẢNH. ĐỊA ĐIỂM - THỜI GIAN] — tối thiểu ${MIN_SCENE_COUNT} cảnh.
  4. Độ dài mục tiêu ~${wordGoal} từ (không dưới ${wordMin} từ) — đủ dài bằng xung đột/thoại, không stack giác quan.
  5. Chỉ trả về NỘI DUNG KỊCH BẢN thuần, không markdown giải thích.`;
  
    const aiResponse = await callActiveModel(prompt, keysToUse, model);
    let normalized = normalizeSceneTags((aiResponse || '').normalize('NFC'));
    if (humanizeOn) {
      normalized = injectHumanJokeAsides(normalized, { minCount: 1, enabled: true });
    }
    const gate = evaluateWordGate(normalized, wordGoal, MIN_SCENE_COUNT);
    const narrativePsych = scoreNarrativePsychScript(normalized);
    return NextResponse.json({
      noi_dung: normalized,
      usedApiKey: getLastWorkingApiKey(),
      wordCount: gate.wordCount,
      sceneCount: gate.sceneCount,
      needsContinue: gate.needsContinue,
      wordsOk: gate.wordsOk,
      scenesOk: gate.scenesOk,
      narrativePsych,
      humanJokeCount: countHumanJokeAsides(normalized),
    });
  }
  
  // --- NODE: EVALUATE_CHAPTER (Trí tuệ Biên Tập Viên) ---
  
  if (requestType === 'EVALUATE_CHAPTER') {
    const { 
      chuong_hien_tai, 
      noi_dung_kich_ban, 
      userRules
    } = payload;
  
    const prompt = `Bạn là một Tổng biên tập khắt khe của tòa soạn tiểu thuyết mạt thế.
  Hãy đọc kỹ nội dung Chương ${chuong_hien_tai.so_chuong} vừa được viết dưới đây và tiến hành CHẤM ĐIỂM 7 CHIỀU.
  
  --- NỘI DUNG CHƯƠNG VỪA VIẾT ---
  ${noi_dung_kich_ban}
  
  --- SỞ THÍCH & LUẬT LỆ TỪ TÁC GIẢ ---
  ${userRules?.forbidden_words ? `- Từ cấm tuyệt đối: ${userRules.forbidden_words}` : ''}
  ${userRules?.fatigue_words ? `- Từ sáo rỗng cần hạn chế: ${userRules.fatigue_words}` : ''}
  
  --- TIÊU CHÍ TÂM LÝ KỂ CHUYỆN (chấm Hook / Pacing / Foreshadow) ---
  ${buildNarrativePsychBlock(true)}
  - Hook: 1–3 câu đầu chương có pattern interrupt? Cuối chương/cảnh có open loop?
  - Pacing: escalation Discovery→Crisis? Có time-skip cấm?
  - Foreshadow: curiosity gap (manh mối dở) chứ không dump bí mật?
  - Trừ nặng Aesthetic nếu prose dính slogan SEO ("Đừng bỏ lỡ", "Like Subscribe", template title).
  
  Nhiệm Vụ:
  1. Đánh giá bản thảo theo 7 chiều: Consistency (Nhất quán), Character (Nhân vật), Pacing (Nhịp điệu + escalation), Continuity (Mạch lạc), Foreshadow (Phục bút + curiosity gap), Hook (Điểm móc + pattern interrupt + open loop), Aesthetic (Thẩm mỹ & Văn phong + tính người / chống văn AI / chống slogan SEO trong prose).
  2. Nếu bản thảo dính nhiều "Từ cấm tuyệt đối" hoặc "Từ sáo rỗng" như yêu cầu của tác giả, hãy trừ nặng điểm Aesthetic.
  3. Trừ điểm Character/Aesthetic nếu thoại đồng chất, thiếu im lặng hữu ích, hoặc miêu tả giác quan stack liên tục (văn AI phẳng — rủi ro kênh narration YouTube).
  4. Trừ điểm Hook nếu mở bằng thơ tả cảnh; trừ Pacing nếu chốt êm giữa chương / thiếu open loop cuối cảnh.
  5. Cho điểm từ 0-100 cho mỗi chiều. Nếu có bất kỳ chiều nào dưới 60 điểm, hoặc tổng điểm trung bình dưới 70, verdict phải là "rewrite" (bắt viết lại). Nếu từ 70-80 là "polish" (chấp nhận nhưng cần trau chuốt). Trên 80 là "accept" (tuyệt vời).
  
  TRẢ VỀ ĐỊNH DẠNG JSON DUY NHẤT (Không bọc bằng markdown \`\`\`json):
  {
    "dimensions": [
  { "dimension": "consistency", "score": 85, "comment": "Nhận xét..." },
  { "dimension": "character", "score": 85, "comment": "Nhận xét..." },
  { "dimension": "pacing", "score": 85, "comment": "Nhận xét..." },
  { "dimension": "continuity", "score": 85, "comment": "Nhận xét..." },
  { "dimension": "foreshadow", "score": 85, "comment": "Nhận xét..." },
  { "dimension": "hook", "score": 85, "comment": "Nhận xét..." },
  { "dimension": "aesthetic", "score": 85, "comment": "Nhận xét..." }
    ],
    "summary": "Tóm tắt đánh giá tổng thể trong 1-2 câu",
    "verdict": "accept" // hoặc "rewrite", "polish"
  }`;
    const result = await generateJsonWithRetry(prompt, keysToUse, 2, model);
    const narrativePsych = scoreNarrativePsychScript(String(noi_dung_kich_ban || ''));
    return NextResponse.json({
      ...result,
      narrativePsych,
      usedApiKey: getLastWorkingApiKey(),
    });
  }
  
  // --- NODE: PLAN_ARC (Kiến Trúc Sư) ---
  
  if (requestType === 'COMMIT_MEMORY') {
    const { 
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      ten_tac_pham, 
      chuong_hien_tai, 
      noi_dung_kich_ban, 
      tom_tat_cuon_chieu, 
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      tri_nho_ngan_han, 
      lorebook,
      world_state,
      da_dien_ra_entities,
    } = payload;

    const chapterObj =
      chuong_hien_tai && typeof chuong_hien_tai === 'object'
        ? (chuong_hien_tai as { so_chuong?: number | string; tieu_de?: string })
        : {};
    const chapterNum =
      Number(chapterObj.so_chuong) ||
      Number((payload as { chapterNum?: number }).chapterNum) ||
      1;
    const scriptBody = String(noi_dung_kich_ban || '').trim();
    if (!scriptBody) {
      return NextResponse.json(
        { error: 'COMMIT_MEMORY: thiếu noi_dung_kich_ban (nội dung chương).' },
        { status: 400 },
      );
    }
  
    const prompt = `Bạn là Trợ lý Biên kịch kiêm Bộ Nén Ký Ức logic mạt thế xuất sắc.
  Hãy đọc kỹ nội dung kịch bản Chương ${chapterNum}${chapterObj.tieu_de ? ` (${chapterObj.tieu_de})` : ''} vừa viết dưới đây và thực hiện cập nhật toàn bộ trạng thái Trí nhớ vĩ mô của hệ thống.
  
  --- NỘI DUNG CHƯƠNG VỪA VIẾT ---
  ${scriptBody}
  
  --- TRẠNG THÁI BỘ NHỚ VĨ MÔ TRƯỚC ĐÓ ---
  - Tóm tắt cuốn chiếu cũ: ${tom_tat_cuon_chieu}
  - Lorebook cũ: ${lorebook || '(trống)'}
  - World state cũ: ${JSON.stringify(world_state || {})}
  - Entities đã dùng cũ: ${JSON.stringify(da_dien_ra_entities || {})}
  
  Nhiệm Vụ Của Bạn:
  1. **Nén cốt truyện (Tóm tắt cuốn chiếu)**: Tổng hợp nội dung chương mới này vào tóm tắt cuốn chiếu cốt truyện cũ. Đảm bảo bản tóm tắt tổng thể mới sau khi tích lũy vẫn dưới 500 từ, liền mạch và súc tích.
  2. **Trí nhớ ngắn hạn**: Trả về một câu tóm tắt cực ngắn (dưới 30 từ) mô tả cột mốc cảm xúc hoặc sự kiện cốt lõi của chương vừa rồi.
  3. **Lorebook**: Nếu có luật lệ/thế giới mới được khám phá thì cập nhật; nếu không thì giữ nguyên lorebook cũ.
  4. **World state**: Cập nhật inventory, discovered_clues, current_location dựa trên diễn biến chương (mất/được đồ, manh mối mới, địa điểm cuối chương).
  5. **Spent entities**: Liệt kê địa điểm / vật phẩm / motif XUẤT HIỆN TRONG CHƯƠNG NÀY (chỉ phần mới hoặc nổi bật) để chống lặp ở chương sau.
  
  YÊU CẦU ĐỊNH DẠNG:
  - Trả về định dạng JSON duy nhất và TUYỆT ĐỐI không bao bọc bởi tag markdown \`\`\`json hay text thừa. Khối JSON phải khớp chính xác cấu trúc sau:
  {
    "tom_tat_cuon_chieu": "Bản tóm tắt cuốn chiếu mới sau khi nén chương này (dưới 500 từ)",
    "tri_nho_ngan_han_moi": "Tóm tắt cực ngắn 1 câu của chương vừa rồi (dưới 30 từ)",
    "lorebook_cap_nhat": "Lorebook đầy đủ sau cập nhật (hoặc giữ nguyên bản cũ nếu không đổi)",
    "world_state_cap_nhat": {
  "inventory": ["vật phẩm nhân vật đang giữ"],
  "discovered_clues": ["manh mối đã biết"],
  "current_location": "địa điểm hiện tại của POV chính"
    },
    "spent_entities_cap_nhat": {
  "dia_diem": ["địa điểm xuất hiện trong chương"],
  "vat_pham": ["vật phẩm then chốt trong chương"],
  "motifs": ["motif/xung đột lặp cần tránh"]
    }
  }`;
    const result = await generateJsonWithRetry(prompt, keysToUse, 2, model);
    // Normalize nested fields so client always gets expected shapes
    const world = result?.world_state_cap_nhat && typeof result.world_state_cap_nhat === 'object'
      ? {
          inventory: Array.isArray(result.world_state_cap_nhat.inventory) ? result.world_state_cap_nhat.inventory.map(String) : [],
          discovered_clues: Array.isArray(result.world_state_cap_nhat.discovered_clues) ? result.world_state_cap_nhat.discovered_clues.map(String) : [],
          current_location: String(result.world_state_cap_nhat.current_location || ''),
        }
      : undefined;
    const spent = result?.spent_entities_cap_nhat && typeof result.spent_entities_cap_nhat === 'object'
      ? {
          dia_diem: Array.isArray(result.spent_entities_cap_nhat.dia_diem) ? result.spent_entities_cap_nhat.dia_diem.map(String) : [],
          vat_pham: Array.isArray(result.spent_entities_cap_nhat.vat_pham) ? result.spent_entities_cap_nhat.vat_pham.map(String) : [],
          motifs: Array.isArray(result.spent_entities_cap_nhat.motifs) ? result.spent_entities_cap_nhat.motifs.map(String) : [],
        }
      : undefined;
  
    return NextResponse.json({
      ...result,
      world_state_cap_nhat: world,
      spent_entities_cap_nhat: spent,
      usedApiKey: getLastWorkingApiKey(),
    });
  }
  
  // --- NODE: GENERATE_CHARACTER_PROMPT (Hồ sơ đầy đủ + identity lock + 4 góc + biểu cảm) ---

  return null;
}
