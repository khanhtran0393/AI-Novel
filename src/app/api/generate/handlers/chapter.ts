import { NextResponse } from 'next/server';
import {
  buildContinueContext,
  buildProseCraftBlock,
  evaluateWordGate,
  formatCharacterBible,
  formatSpentEntities,
  formatWorldState,
  getWordCount,
  lorebookForPrompt,
  normalizeSceneTags,
  requireGenreLabelFromSetup,
  setupGenreFromPayload,
  truncateOutline,
  writeEngineRoleLine,
  DEFAULT_WORD_GOAL,
  MIN_SCENE_COUNT,
} from '@/lib/storyWriting';
import {
  buildScriptModeColdOpenBlock,
  buildScriptModePacingBlock,
  buildShortManhuaWordGateExtra,
  isShortManhuaMode,
  maxScenesForScriptMode,
  minScenesForScriptMode,
  normalizeScriptMode,
} from '@/lib/scriptMode';
import {
  buildStyleEngineWriteBlock,
  resolveStyleEngineFromSetupPayload,
} from '@/lib/styleEngineProfiles';
import {
  buildMatrixWriteBlock,
  buildMatrixTtsHintBlock,
  buildWaveRhythmBlock,
  buildCliffhangerBlock,
  composeMatrixFromPayload,
} from '@/lib/matrixEngine';
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
      scriptMode,
      mo_ta,
      wpm,
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

    if (
      !chuong_hien_tai ||
      typeof chuong_hien_tai !== 'object' ||
      chuong_hien_tai.so_chuong == null
    ) {
      return NextResponse.json(
        {
          error:
            'Thiếu chuong_hien_tai (so_chuong + tieu_de). Client phải gửi object chương đang viết — không gửi so_chuong lẻ.',
        },
        { status: 400 },
      );
    }
  
    const mode = normalizeScriptMode(scriptMode);
    const minScenes = minScenesForScriptMode(mode);
    const maxScenes = maxScenesForScriptMode(mode);
    // Cổng từ = so_tu client gửi (đã clamp gói) — không ép hằng 4250
    const wordGoalRaw = Number(so_tu_chuong);
    const wordGoal =
      Number.isFinite(wordGoalRaw) && wordGoalRaw > 0
        ? Math.round(wordGoalRaw)
        : DEFAULT_WORD_GOAL;
    const wordMin = Math.round(wordGoal * 0.92);
    const wordMax = Math.round(wordGoal * 1.2);
    const charBible = formatCharacterBible(nhan_vat, nhan_vat_prompts);
    const spentBlock = formatSpentEntities(da_dien_ra_entities);
    const worldBlock = formatWorldState(world_state);
    const outlineBlock = truncateOutline(dan_y_tong_the || '');
    const beat = current_beat_type || 'Beat A (Discovery)';
    const resolvedRules = resolveUserRules(userRules);
    const humanizeOn = humanize_script !== false;
  
    const isContinue = !!(noi_dung_hien_tai && String(noi_dung_hien_tai).trim());
    const existingWords = isContinue
      ? getWordCount(String(noi_dung_hien_tai))
      : 0;
    const remainingBudget = Math.max(0, wordMax - existingWords);
    let continueBlock = '';
    if (isContinue) {
      continueBlock = '\n' + buildContinueContext(String(noi_dung_hien_tai)).promptBody;
      continueBlock += `\n\n--- NGÂN SÁCH TỪ CÒN LẠI (CỨNG) ---
Đã có ~${existingWords} từ. Mục tiêu toàn chương ${wordGoal}, trần ${wordMax}.
Phần MỚI tối đa ~${remainingBudget} từ. Hết budget thì kết thúc gọn (đủ open loop), CẤM viết dài gấp đôi.`;
    } else if (isShortManhuaMode(mode)) {
      continueBlock =
        '\nĐừng thêm tiêu đề chương. Bắt đầu bằng [CẢNH 0: COLD OPEN - HOOK] rồi [CẢNH 1: ...] theo nhịp short/manhua.';
    } else {
      continueBlock =
        '\nĐừng thêm tiêu đề chương, hãy bắt đầu viết trực tiếp nội dung chương truyện với [CẢNH 1: ...] ngay.';
    }
  
    const interventionBlock = intervention_directive
      ? `\n\n--- LỆNH CAN THIỆP TỪ TÁC GIẢ (BẮT BUỘC TUÂN THỦ KHI VIẾT TIẾP) ---\n${intervention_directive}\n`
      : '';
  
    const wordGateExtra = force_word_gate_continue
      ? isShortManhuaMode(mode)
        ? buildShortManhuaWordGateExtra(wordMin, minScenes)
        : `\n⚠️ CHẾ ĐỘ BÙ CỔNG TỪ (NGẮN GỌN — CÓ TRẦN):
Bản trước chưa đủ sàn/cảnh. Mục tiêu toàn chương ${wordGoal} từ (sàn ${wordMin}, TRẦN CỨNG ${wordMax}).
- Đã có ~${existingWords} từ → phần MỚI ≤ ~${remainingBudget} từ.
- Chỉ thêm beat/cảnh còn thiếu; CẤM nhồi sáo, CẤM viết dài vượt trần.
- Hết budget: kết chương gọn, open loop ngắn. Chỉ trả về phần MỚI.`
      : '';
  
    const prompt = `${writeEngineRoleLine(genreLabel, 'writer')}
  Viết chương truyện / kịch bản kể chuyện mượt, có chiều sâu — Chương ${chuong_hien_tai.so_chuong}: "${chuong_hien_tai.tieu_de}" · tác phẩm "${ten_tac_pham}".
  
  --- SETUP THỂ LOẠI (BẮT BUỘC BÁM) ---
  ${genreLabel}
  
  --- BỐI CẢNH VÀ TRÍ NHỚ VĨ MÔ (ROLLING CONTEXT SYSTEM) ---
  1. LÕI BẤT BIẾN (LOREBOOK):
  ${lorebookForPrompt(lorebook)}
  
  2. DÀN Ý TỔNG THỂ (RÚT GỌN — chỉ định hướng arc, KHÔNG chép vào kịch bản):
  ${outlineBlock || 'Chưa có dàn ý tổng thể — dựng xung đột từ dàn ý chương + Setup; không bịa world law mặc định.'}
  
  3. TÓM TẮT CUỐN CHIẾU CÁC CHƯƠNG TRƯỚC (DƯỚI 500 TỪ):
  ${tom_tat_cuon_chieu || 'Chưa viết chương trước nào.'}
  
  4. TRÍ NHỚ NGẮN HẠN (3 CHƯƠNG GẦN NHẤT):
  ${(tri_nho_ngan_han && tri_nho_ngan_han.length > 0) ? tri_nho_ngan_han.join('\n') : 'Chưa có trí nhớ ngắn hạn.'}
  
  5. HỒ SƠ NHÂN VẬT (BIBLE — giữ tính cách/hành vi/ngoại hình/khuyết điểm nhất quán; khuyết điểm = điểm yếu, không ép trope khuyết tật theo thể loại):
  ${charBible}
  
  6. WORLD STATE (trạng thái hiện tại — tôn trọng inventory/clue/location):
  ${worldBlock}
  
  7. ENTITIES ĐÃ DÙNG (tránh lặp motif/địa điểm/vật phẩm):
  ${spentBlock}
  
  8. NHỊP BEAT CHƯƠNG NÀY (định hướng xung đột — dệt vào văn, không dán nhãn beat trong prose):
  ${beat}
  - Beat A (Discovery): khám phá manh mối, bối cảnh, bí ẩn mới.
  - Beat B (Confrontation): đối đầu, va chạm lợi ích, căng thẳng leo thang.
  - Beat C (Crisis): khủng hoảng cốt lõi theo thể loại Setup (không tự đổi thể loại ngoài Setup).
  - Beat D (Insight): bẻ gãy nhận thức, twist logic, hậu quả cảm xúc.
  
  DÀN Ý SỰ KIỆN CHƯƠNG HIỆN TẠI:
  ${chuong_hien_tai.dan_y || '(Trống — tự dựng 3–5 beat sự kiện rõ: mục tiêu NV, trở ngại, bước ngoặt, open loop; bám Setup, không bịa lore mặc định.)'}
  ${interventionBlock}${wordGateExtra}
  ${buildProseCraftBlock(scriptMode)}
  ${buildScriptModePacingBlock(mode)}
  ${buildScriptModeColdOpenBlock(mode, { isContinue })}
  ${buildWaveRhythmBlock({
    scriptMode: mode,
    wpm: wpm != null ? Number(wpm) : undefined,
    so_tu_chuong: wordGoal,
    isContinue,
  })}
  ${buildCliffhangerBlock({ scriptMode: mode, isContinue })}
  ${buildMatrixWriteBlock(
    composeMatrixFromPayload({
      ...(payload || {}),
      mo_ta: mo_ta ?? (payload as { mo_ta?: string })?.mo_ta,
      lorebook,
      chu_de: (payload as { chu_de?: string })?.chu_de,
      phong_cach: (payload as { phong_cach?: string })?.phong_cach,
      genre: genreLabel,
    }),
    { isContinue },
  )}
  ${buildStyleEngineWriteBlock(resolveStyleEngineFromSetupPayload(payload || {}), {
    scriptMode: mode,
    isContinue,
  })}
  ${buildMatrixTtsHintBlock(
    composeMatrixFromPayload({
      ...(payload || {}),
      genre: genreLabel,
      lorebook,
      mo_ta,
    }),
  )}
  
  YÊU CẦU KỸ THUẬT KHI VIẾT:
  - Ngôn ngữ: BẮT BUỘC ${ngon_ngu || 'Tiếng Việt'} — văn phong mượt, có nhịp thở, đọc được cả khi narration.
  1. CẤM in lại / nhại Lorebook, Trí nhớ, Dàn ý hay khối BỐI CẢNH vào kịch bản. Chỉ xuất NỘI DUNG TRUYỆN thuần.
  2. Văn sạch: CẤM note đạo diễn / FX kiểu [âm thanh gió rít], (Cười), (thở dài), (nhạc nền). Ngoại lệ khi bật tính người: 1–2 câu đùa “người nói với người” trong ngoặc đơn ở nhịp thở — xem khối CÂU ĐÙA (không chen cao trào).
  3. Tag cảnh — mỗi cảnh một dòng riêng:
  [CẢNH 1: NỘI CẢNH. ĐỊA ĐIỂM - THỜI GIAN]
  (đoạn văn liền mạch…)
  4. Kể chuyện sống: subtext, nội tâm chọn lọc, NARRATIVE PSYCH dệt vào tình huống (không dán slogan). Real-time: CẤM time-skip / tóm tắt tuần/tháng. Hành động + thoại là xương; 1–2 chi tiết giác quan đắt/cảnh (không stack 5 giác quan).
  5. CỔNG TỪ TOÀN CHƯƠNG (Setup so_tu = ${wordGoal} từ — BẮT BUỘC, không hardcode 4250):
     - Mục tiêu ≈ ${wordGoal} từ cho TOÀN BỘ kịch bản (dao động chấp nhận ${wordMin}–${wordMax}).
     - TRẦN CỨNG ≤${wordMax} từ (+20%). Vượt trần = LỖI. CẤM viết gấp đôi / 200%+.
     - Ước lượng độ dài khi viết; đủ beat + ${minScenes} cảnh trong budget; CẤM nhồi sáo.
  6. Phân cảnh: TỐI THIỂU ${minScenes}, tối đa ~${maxScenes}${
    isShortManhuaMode(mode)
      ? ' cảnh NGẮN (short/manhua — nhiều cut, mỗi cảnh 1 beat hình ảnh).'
      : '.'
  } Mỗi cảnh tag [CẢNH X: NỘI/NGOẠI CẢNH. ĐỊA ĐIỂM CỤ THỂ - THỜI GIAN].
     - Độ dài cảnh theo nhịp truyện (cảnh căng có thể dài hơn) — không chia “đều từ” máy móc.
     - Mỗi cảnh: vào việc sớm + cuối open loop là hệ quả (không lặp cùng một kiểu “và rồi một tiếng động”).
     - Cảnh sau nối hệ quả / đối lập với open loop cảnh trước.
     ${
       isShortManhuaMode(mode)
         ? '- Short/Manhua: narration tối giản; ưu tiên thoại + action nhìn được (sẵn storyboard).'
         : ''
     }
  7. 🚫 TỪ CẤM: ${resolvedRules.forbidden_words}
  8. ⚠️ TỪ SÁO / VĂN AI (hạn chế tối đa): ${resolvedRules.fatigue_words}
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
    let mergedForGate = noi_dung_hien_tai
      ? `${noi_dung_hien_tai}\n\n${normalized}`
      : normalized;
    let gate = evaluateWordGate(mergedForGate, wordGoal, minScenes);
    let fullChapterReplace = false;
    let condensedFrom = 0;

    // ENFORCE: nếu vượt trần (+20%) — rút gọn TOÀN BỘ chương (không chỉ cảnh báo)
    if (gate.wordCount > wordMax) {
      condensedFrom = gate.wordCount;
      const condensePrompt = `${writeEngineRoleLine(genreLabel, 'editor')}
RÚT GỌN CỔNG TỪ BẮT BUỘC — Setup so_tu_chuong = ${wordGoal} từ cho TOÀN BỘ kịch bản.

HIỆN TRẠNG: ~${gate.wordCount} từ (${Math.round((gate.wordCount / wordGoal) * 100)}%) — VƯỢT TRẦN.
MỤC TIÊU SAU RÚT: khoảng ${wordGoal} từ (sàn ≥${wordMin}, TRẦN CỨNG ≤${wordMax}).

QUY TẮC:
1. Trả về TOÀN BỘ chương đã rút gọn (không tóm tắt meta, không markdown giải thích).
2. Giữ ≥${minScenes} tag [CẢNH N: NỘI/NGOẠI…] và cốt truyện / thoại chính.
3. CẮT mô tả thừa, lặp, sáo AI; KHÔNG thêm tình tiết mới.
4. Độ dài cuối BẮT BUỘC ≤${wordMax} từ và gần ${wordGoal} từ.
5. Ngôn ngữ: ${ngon_ngu || 'Tiếng Việt'}.

--- BẢN DÀI CẦN RÚT ---
${mergedForGate.slice(0, 120_000)}
`;
      const condensedRaw = await callActiveModel(condensePrompt, keysToUse, model);
      let condensed = normalizeSceneTags((condensedRaw || '').normalize('NFC'));
      if (!condensed.trim()) {
        // Keep long version but flag — client will retry
        condensed = mergedForGate;
      } else {
        const g2 = evaluateWordGate(condensed, wordGoal, minScenes);
        // If still massively over, one more hard pass
        if (g2.wordCount > wordMax) {
          const hardPrompt = `${writeEngineRoleLine(genreLabel, 'editor')}
LẦN 2 — RÚT GỌN CỨNG: bản còn ${g2.wordCount} từ. Viết lại TOÀN BỘ ≤${wordMax} từ (mục tiêu ${wordGoal}).
Giữ ${minScenes}+ [CẢNH]. Chỉ trả kịch bản thuần.
---
${condensed.slice(0, 80_000)}`;
          const hardRaw = await callActiveModel(hardPrompt, keysToUse, model);
          const hardNorm = normalizeSceneTags((hardRaw || '').normalize('NFC'));
          if (hardNorm.trim()) condensed = hardNorm;
        }
        mergedForGate = condensed;
        normalized = condensed;
        fullChapterReplace = true;
        gate = evaluateWordGate(mergedForGate, wordGoal, minScenes);
      }
    }

    const narrativePsych = scoreNarrativePsychScript(mergedForGate);
  
    return NextResponse.json({
      noi_dung: normalized,
      usedApiKey: getLastWorkingApiKey(),
      wordCount: gate.wordCount,
      sceneCount: gate.sceneCount,
      wordMin: gate.wordMin,
      wordMax: gate.wordMax,
      wordGoal: gate.wordGoal,
      needsContinue: gate.needsContinue,
      overSoftMax: gate.overSoftMax,
      wordsOk: gate.wordsOk,
      scenesOk: gate.scenesOk,
      fullChapterReplace,
      condensedFrom: condensedFrom || undefined,
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
      scriptMode,
      mo_ta,
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
  
    const modeSm = normalizeScriptMode(scriptMode);
    const minScenesRev = minScenesForScriptMode(modeSm);
    const wordGoalRevRaw = Number(so_tu_chuong);
    const wordGoal =
      Number.isFinite(wordGoalRevRaw) && wordGoalRevRaw > 0
        ? Math.round(wordGoalRevRaw)
        : DEFAULT_WORD_GOAL;
    const wordMin = Math.round(wordGoal * 0.92);
    const wordMax = Math.round(wordGoal * 1.2);
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
  
    const prompt = `${writeEngineRoleLine(genreLabel, 'editor')}
  Tác phẩm: "${ten_tac_pham}" — Chương ${chuong_hien_tai?.so_chuong}: "${chuong_hien_tai?.tieu_de}".
  Chế độ: ${modeLabel}.
  Setup thể loại: ${genreLabel}.
  Phong cách kịch bản (scriptMode): ${modeSm}.
  
  --- LOREBOOK ---
  ${lorebookForPrompt(lorebook)}
  
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
  ${buildProseCraftBlock(scriptMode)}
  ${buildMatrixWriteBlock(
    composeMatrixFromPayload({
      ...(payload || {}),
      mo_ta,
      lorebook,
      genre: genreLabel,
    }),
    { isContinue: true },
  )}
  ${buildStyleEngineWriteBlock(resolveStyleEngineFromSetupPayload(payload || {}), {
    scriptMode: modeSm,
    isContinue: true,
  })}
  ${buildHumanizeScriptBlock(humanizeOn)}
  ${buildSpeechFingerprintBlock(nhan_vat, nhan_vat_prompts)}
  ${isAudioRead ? buildAudioReadabilityBlock() : ''}
  
  --- BẢN THẢO HIỆN TẠI ---
  ${noi_dung_kich_ban}
  
  NHIỆM VỤ:
  1. ${String(review?.summary || '').includes('WORD_GATE_CONDENSE')
    ? `CỔNG TỪ RÚT GỌN BẮT BUỘC: viết lại TOÀN BỘ chương còn ≈${wordGoal} từ (sàn ${wordMin}, TRẦN CỨNG ≤${wordMax}). Giữ cốt + ≥${minScenesRev} [CẢNH]. CẮT mô tả thừa. KHÔNG thêm tình tiết. Độ dài cuối PHẢI ≤${wordMax}.`
    : isAudioRead
    ? 'Giữ 100% tình tiết và tag cảnh; tối ưu nhịp đọc audio — cắt sáo, nghỉ thở rõ, NHƯNG giữ xen câu ngắn/vừa/dài để không thô đều như checklist.'
    : isRewrite
    ? isShortManhuaMode(modeSm)
      ? 'Viết lại mạnh theo logic Short/Manhua: thoại + action nhìn được, đủ [CẢNH] ngắn, open loop; khắc phục điểm thấp; CẤM monologue thrift / slogan SEO.'
      : 'Viết lại toàn bộ chương, khắc phục chiều điểm thấp (<70); giữ dàn ý sự kiện cốt lõi; nâng pacing/character/hook + NARRATIVE PSYCH dệt vào văn + subtext + thoại đời. CẤM slogan SEO. Ưu tiên mượt, chống thô cứng.'
    : isShortManhuaMode(modeSm)
    ? 'Giữ cấu trúc; trau chuốt thoại dứt + beat visual; cắt tường thuật thừa; open loop hệ quả cuối cảnh.'
    : 'Giữ cấu trúc và tình tiết chính; trau chuốt câu chữ, nhịp thở, subtext, đối thoại đời; cắt sáo rỗng/văn AI/thô cứng (câu đều đều, tường thuật dàn, giải thích cảm xúc). Open loop cuối cảnh phải là hệ quả, không máy.'}
  2. Ngôn ngữ: ${ngon_ngu || 'Tiếng Việt'}.
  3. Giữ/khôi phục tag [CẢNH X: NỘI CẢNH/NGOẠI CẢNH. ĐỊA ĐIỂM - THỜI GIAN] — tối thiểu ${minScenesRev} cảnh.
  4. Độ dài TOÀN BỘ chương theo Setup: mục tiêu ~${wordGoal} từ (sàn ${wordMin}, TRẦN CỨNG ≤${wordMax}) — không vượt trần.
  5. Chỉ trả về NỘI DUNG TRUYỆN thuần, không markdown giải thích.`;
  
    const aiResponse = await callActiveModel(prompt, keysToUse, model);
    let normalized = normalizeSceneTags((aiResponse || '').normalize('NFC'));
    if (humanizeOn) {
      normalized = injectHumanJokeAsides(normalized, { minCount: 1, enabled: true });
    }
    const gate = evaluateWordGate(normalized, wordGoal, minScenesRev);
    const narrativePsych = scoreNarrativePsychScript(normalized);
    return NextResponse.json({
      noi_dung: normalized,
      usedApiKey: getLastWorkingApiKey(),
      wordCount: gate.wordCount,
      sceneCount: gate.sceneCount,
      wordMin: gate.wordMin,
      wordMax: gate.wordMax,
      wordGoal: gate.wordGoal,
      needsContinue: gate.needsContinue,
      overSoftMax: gate.overSoftMax,
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
      userRules,
      scriptMode
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
  
    const prompt = `${writeEngineRoleLine(genreLabel, 'reviewer')}
  Setup thể loại cần bám khi chấm: ${genreLabel}.
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
  1. Đánh giá 7 chiều: Consistency, Character, Pacing (escalation + nhịp thở), Continuity, Foreshadow (curiosity gap), Hook (pattern interrupt + open loop), Aesthetic (văn phong mượt + tính người + chống văn AI/slogan SEO + chống thô cứng).
  2. Trừ nặng Aesthetic nếu dính nhiều Từ cấm / Từ sáo theo luật tác giả.
  ${
    scriptMode === 'sang_van'
      ? '3. Không trừ điểm Pacing/Aesthetic nếu nhịp truyện cực nhanh, câu ngắn gọn dứt khoát, hoặc buff nhân vật lố nhưng thỏa mãn. Sảng văn ƯU TIÊN tiết tấu nhanh, vả mặt, và dopamine hit. Đừng phạt kiểu "thiếu miêu tả chiều sâu nội tâm rườm rà".'
      : scriptMode === 'short_manhua'
        ? '3. Short/Manhua: ƯU TIÊN thoại + hành động nhìn được, nhiều [CẢNH] ngắn, open loop. KHÔNG trừ Aesthetic vì thiếu monologue nội tâm dài / prose tiểu thuyết. Trừ nặng nếu: tường thuật dài không visual, thiếu tag cảnh, không có beat hành động, time-skip, hoặc note đạo diễn thô [zoom].'
        : '3. Trừ Character/Aesthetic nếu thoại đồng chất, thiếu subtext/im lặng hữu ích, stack 5 giác quan, hoặc văn checklist (câu đều đều ngắn, tường thuật dàn, giải thích cảm xúc rỗng — thô cứng).'
  }
  4. Trừ Hook nếu mở thơ tả cảnh; trừ Pacing nếu chốt êm giữa chương / thiếu open loop / open loop máy lặp kiểu; trừ Continuity nếu cảnh sau không nối hệ quả.
  5. 0–100 mỗi chiều. Bất kỳ chiều <60 hoặc trung bình <70 → verdict "rewrite". 70–80 → "polish". >80 → "accept".
  
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
  
    let genreLabel: string;
    try {
      genreLabel = requireGenreLabelFromSetup(setupGenreFromPayload(payload));
    } catch (e) {
      return NextResponse.json(
        { error: e instanceof Error ? e.message : String(e) },
        { status: 400 },
      );
    }

    const prompt = `${writeEngineRoleLine(genreLabel, 'memory')}
  Hãy đọc kỹ nội dung kịch bản Chương ${chapterNum}${chapterObj.tieu_de ? ` (${chapterObj.tieu_de})` : ''} vừa viết dưới đây và thực hiện cập nhật toàn bộ trạng thái Trí nhớ vĩ mô của hệ thống.
  Setup thể loại (BẮT BUỘC bám): ${genreLabel}.
  
  --- NỘI DUNG CHƯƠNG VỪA VIẾT ---
  ${scriptBody}
  
  --- TRẠNG THÁI BỘ NHỚ VĨ MÔ TRƯỚC ĐÓ ---
  - Tóm tắt cuốn chiếu cũ: ${tom_tat_cuon_chieu}
  - Lorebook cũ: ${lorebookForPrompt(lorebook)}
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

    // LLM may return object/array for text fields — always coerce to string
    // (client used to crash: lorebook_cap_nhat.trim is not a function)
    const coerceText = (v: unknown): string => {
      if (v == null) return '';
      if (typeof v === 'string') return v;
      if (typeof v === 'number' || typeof v === 'boolean') return String(v);
      if (Array.isArray(v)) return v.map(coerceText).filter(Boolean).join('\n');
      if (typeof v === 'object') {
        const o = v as Record<string, unknown>;
        for (const k of ['text', 'content', 'lorebook', 'value', 'body'] as const) {
          if (typeof o[k] === 'string') return o[k] as string;
        }
        try {
          return JSON.stringify(v, null, 2);
        } catch {
          return '';
        }
      }
      return String(v);
    };
  
    return NextResponse.json({
      ...result,
      tom_tat_cuon_chieu: coerceText(result?.tom_tat_cuon_chieu),
      tri_nho_ngan_han_moi: coerceText(result?.tri_nho_ngan_han_moi),
      lorebook_cap_nhat: coerceText(result?.lorebook_cap_nhat),
      world_state_cap_nhat: world,
      spent_entities_cap_nhat: spent,
      usedApiKey: getLastWorkingApiKey(),
    });
  }
  
  // --- NODE: GENERATE_CHARACTER_PROMPT (Hồ sơ đầy đủ + identity lock + 4 góc + biểu cảm) ---

  return null;
}
