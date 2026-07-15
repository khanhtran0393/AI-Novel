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
 * Owner: generate/character.ts
 * Only handles requestTypes assigned in contracts/apiMap GENERATE_REQUEST_OWNERS → character
 */
export async function handleCharacter(
  ctx: GenerateHandlerContext,
  requestType: string,
): Promise<NextResponse | null> {
  const { payload, keysToUse, model } = ctx;

  if (requestType === 'EXTRACT_CHARACTERS') {
    const { dan_y_chuong, lorebook } = payload;
    const prompt = `Bạn là Trợ lý Biên kịch chuyên nghiệp chuyên bóc tách hồ sơ nhân vật mạt thế, sinh tồn.
  Dựa trên Dàn ý chi tiết của chương và bối cảnh Lorebook dưới đây:
  --- DÀN Ý CHI TIẾT CHƯƠNG ---
  ${dan_y_chuong}
  
  --- LOREBOOK SỔ TAY THẾ GIỚI ---
  ${lorebook || 'Không có'}
  
  Nhiệm vụ của bạn:
  1. Bóc tách ra tất cả danh sách các nhân vật xuất hiện hoặc hoạt động/được nhắc tới nhiều trong chương này.
  2. Trả về tên của họ dưới dạng một mảng các chuỗi ký tự (ví dụ: ["Tiêu Hàn", "Diệp Dao", "Lạc Sương"]).
  3. Hãy giữ lại tối đa 4-5 nhân vật thực sự nổi bật nhất.
  
  YÊU CẦU ĐỊNH DẠNG:
  - Trả về định dạng JSON duy nhất và TUYỆT ĐỐI không bao bọc bởi tag markdown \`\`\`json hay text thừa. Khối JSON phải khớp chính xác cấu trúc sau:
  {
    "nhan_vat": ["Tên Nhân Vật 1", "Tên Nhân Vật 2"]
  }
  `;
    const result = await generateJsonWithRetry(prompt, keysToUse, 2, model);
    return NextResponse.json({ ...result, usedApiKey: getLastWorkingApiKey() });
  }
  
  // --- NODE 4: COMMIT_MEMORY ---
  
  if (requestType === 'GENERATE_CHARACTER_PROMPT') {
    const {
      name,
      gioi_tinh,
      tuoi,
      dang_nguoi,
      vai_tro,
      quan_ao,
      so_thich,
      thoi_quen,
      dong_co,
      giong_thoai,
      ngoai_hinh,
      dac_diem_nhan_dang,
      khuet_tat,
      dan_y_tong_the,
      lorebook,
    } = payload;
    const prompt = `Bạn là Chuyên Gia Biên Kịch + Character Designer (turnaround sheet + expression sheet) cho AI image models.
  Nhân vật: "${name}"
  --- DÀN Ý TỔNG THỂ ---
  ${dan_y_tong_the || 'Trống'}
  
  --- LOREBOOK ---
  ${lorebook || 'Trống'}
  
  THÔNG TIN USER ĐÃ NHẬP (giữ và phát triển, không xóa nếu đã có):
  - Giới tính: ${gioi_tinh || 'chưa nhập'}
  - Tuổi: ${tuoi || 'chưa nhập'}
  - Dáng người: ${dang_nguoi || 'chưa nhập'}
  - Vai trò: ${vai_tro || 'chưa nhập'}
  - Trang phục: ${quan_ao || 'chưa nhập'}
  - Sở thích: ${so_thich || 'chưa nhập'}
  - Thói quen: ${thoi_quen || 'chưa nhập'}
  - Động cơ: ${dong_co || 'chưa nhập'}
  - Giọng thoại/quirk: ${giong_thoai || 'chưa nhập'}
  - Ngoại hình (face lock): ${ngoai_hinh || 'chưa nhập'}
  - Đặc điểm nhận dạng: ${dac_diem_nhan_dang || 'chưa nhập'}
  - Khuyết tật: ${khuet_tat || 'chưa nhập'}
  
  NHIỆM VỤ:
  1. Xây hồ sơ đầy đủ, phù hợp bối cảnh (ưu tiên mạt thế / grounded nếu lore gợi ý).
  2. TÁCH RÕ: gioi_tinh chỉ giới tính; tuoi riêng; dang_nguoi riêng; dong_co không nhét vào thoi_quen.
  3. dac_diem_nhan_dang BẮT BUỘC cụ thể, nhìn thấy được (sẹo, nốt ruồi, xăm, mắt lệch, khuyết ngón, vật đeo signature...). Phải giữ y hệt mọi góc/mọi biểu cảm.
  4. ngoai_hinh = face lock: tóc, mắt, da, xương mặt, tuổi vẻ ngoài — ổn định.
  5. prompt = master English identity lock (portrait base, front-facing, neutral expression).
  6. angle_prompts: 4 prompt EN cho front / three_quarter / side / back — CÙNG identity + marks, CHỈ đổi góc máy.
  7. expression_prompts: 8 prompt EN close-up face cho neutral/happy/sad/angry/fear/surprised/determined/pain — CÙNG face lock + marks, CHỈ đổi cơ mặt/biểu cảm.
  8. giong_thoai = quirk thoại ngắn (VD: "cộc, câu ngắn", "mỉa nửa cười").
  
  Trả về JSON THUẦN (không markdown) đúng schema:
  {
    "gioi_tinh": "Nam/Nữ/...",
    "tuoi": "khoảng 28",
    "dang_nguoi": "cao gầy / vạm vỡ...",
    "vai_tro": "nhân vật chính / phản diện / phụ...",
    "quan_ao": "trang phục signature chi tiết",
    "so_thich": "sở thích/phong cách",
    "thoi_quen": "thói quen hành vi",
    "dong_co": "động cơ cốt lõi",
    "giong_thoai": "quirk thoại ngắn",
    "ngoai_hinh": "face lock chi tiết (tóc, mắt, da, xương mặt)",
    "dac_diem_nhan_dang": "marks nhận dạng cố định, cụ thể",
    "khuet_tat": "khuyết tật/thương tật nếu có, hoặc rỗng",
    "prompt": "English master identity lock portrait, neutral expression, front view...",
    "angle_prompts": {
  "front": "English full turnaround front...",
  "three_quarter": "English turnaround 3/4...",
  "side": "English strict profile...",
  "back": "English rear view..."
    },
    "expression_prompts": {
  "neutral": "English face close-up neutral...",
  "happy": "English face close-up happy...",
  "sad": "English face close-up sad...",
  "angry": "English face close-up angry...",
  "fear": "English face close-up fear...",
  "surprised": "English face close-up surprised...",
  "determined": "English face close-up determined...",
  "pain": "English face close-up pain..."
    }
  }`;
  
    const result = await generateJsonWithRetry(prompt, keysToUse, 2, model);
  
    // Director formula on master + turnaround + expression sheet (silent)
    try {
      const sheet = applyCharacterSheetFormulas({
        name: String(name || 'character'),
        prompt: typeof result.prompt === 'string' ? result.prompt : '',
        angle_prompts:
          result.angle_prompts && typeof result.angle_prompts === 'object'
            ? (result.angle_prompts as Record<string, string>)
            : undefined,
        expression_prompts:
          result.expression_prompts && typeof result.expression_prompts === 'object'
            ? (result.expression_prompts as Record<string, string>)
            : undefined,
        styleHint: 'dark survival realism, matte debris world, grounded costume, identity lock',
        genre: 'dark survival / mạt thế',
        angleFraming: CHAR_ANGLE_CAMERA as unknown as Record<string, string>,
        emotionFace: CHAR_EMOTION_FACE as unknown as Record<string, string>,
      });
      result.prompt = sheet.prompt;
      result.angle_prompts = sheet.angle_prompts;
      result.expression_prompts = sheet.expression_prompts;
      console.log(
        `[Character Prompt] director formula applied for "${name}" · angles=${Object.keys(sheet.angle_prompts).length} · expressions=${Object.keys(sheet.expression_prompts).length}`,
      );
    } catch (e) {
      console.warn('[Character Prompt] director formula skip:', e);
    }
  
    return NextResponse.json({ ...result, usedApiKey: getLastWorkingApiKey() });
  }
  // --- NODE: COMPRESS_CONTEXT ---
  
  if (requestType === 'GENERATE_CHARACTER_PROMPT_ONLY') {
    const {
      name,
      gioi_tinh,
      tuoi,
      dang_nguoi,
      quan_ao,
      so_thich,
      thoi_quen,
      ngoai_hinh,
      dac_diem_nhan_dang,
      khuet_tat,
    } = payload;
    const prompt = `Bạn là Chuyên Gia Character Design Prompt (Stable Diffusion/Flux/Midjourney).
  Tạo ONE master English identity-lock portrait prompt, an toàn (tránh safety filter), cho:
  - Name: ${name}
  - Gender: ${gioi_tinh || 'unknown'}
  - Age look: ${tuoi || 'unknown'}
  - Body: ${dang_nguoi || 'unknown'}
  - Outfit: ${quan_ao || 'unknown'}
  - Style/hobby hint: ${so_thich || 'unknown'}
  - Habit: ${thoi_quen || 'unknown'}
  - Face lock: ${ngoai_hinh || 'unknown'}
  - Distinctive marks (MUST include): ${dac_diem_nhan_dang || 'none specified'}
  - Permanent trait: ${khuet_tat || 'none'}
  
  YÊU CẦU:
  1. English only, detailed, policy-safe wording (no gore/sexual/explicit violence).
  2. Front portrait, neutral expression, natural cinematic lighting.
  3. Lock face + distinctive marks + outfit so the same character can be redrawn consistently.
  4. Grounded post-apocalyptic / cinematic production design if context fits.
  5. Return ONLY the English prompt string, no markdown, no explanation.`;
  
    const aiResponse = await callActiveModel(prompt, keysToUse, model);
    let finalPrompt = aiResponse.trim();
    try {
      const sheet = applyCharacterSheetFormulas({
        name: String(name || 'character'),
        prompt: finalPrompt,
        styleHint: 'dark survival realism, matte debris world, identity lock',
        genre: 'dark survival / mạt thế',
      });
      finalPrompt = sheet.prompt;
    } catch (e) {
      console.warn('[CHARACTER_PROMPT_ONLY] formula skip:', e);
    }
    return NextResponse.json({ prompt: finalPrompt, usedApiKey: getLastWorkingApiKey() });
  }
  
  // --- NODE: REGENERATE_PROMPT (Viết lại prompt bị lỗi/vi phạm chính sách) ---

  return null;
}
