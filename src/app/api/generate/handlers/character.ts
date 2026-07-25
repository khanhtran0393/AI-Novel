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
  CHAR_POSE_ACTION,
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
    const prompt = `Bạn là Trợ lý Biên kịch chuyên nghiệp chuyên bóc tách hồ sơ nhân vật theo đúng bối cảnh/setup truyện.
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
      chieu_cao,
      vai_tro,
      quan_ao,
      phu_kien,
      so_thich,
      thoi_quen,
      dong_co,
      giong_thoai,
      ngoai_hinh,
      dac_diem_nhan_dang,
      khuet_tat,
      mau_sac,
      dan_y_tong_the,
      lorebook,
    } = payload;
    const prompt = `Bạn là Chuyên Gia Biên Kịch + Character Designer (production character BIBLE sheet) cho AI image models.
  Nhân vật: "${name}"
  --- DÀN Ý TỔNG THỂ ---
  ${dan_y_tong_the || 'Trống'}
  
  --- LOREBOOK ---
  ${lorebook || 'Trống'}
  
  THÔNG TIN USER ĐÃ NHẬP (giữ và phát triển, không xóa nếu đã có):
  - Giới tính: ${gioi_tinh || 'chưa nhập'}
  - Tuổi: ${tuoi || 'chưa nhập'}
  - Dáng người: ${dang_nguoi || 'chưa nhập'}
  - Chiều cao: ${chieu_cao || 'chưa nhập'}
  - Vai trò: ${vai_tro || 'chưa nhập'}
  - Trang phục: ${quan_ao || 'chưa nhập'}
  - Phụ kiện / công cụ gắn liền: ${phu_kien || 'chưa nhập'}
  - Sở thích: ${so_thich || 'chưa nhập'}
  - Thói quen (hành vi / động tác lặp): ${thoi_quen || 'chưa nhập'}
  - Động cơ: ${dong_co || 'chưa nhập'}
  - Giọng thoại/quirk: ${giong_thoai || 'chưa nhập'}
  - Ngoại hình (face lock): ${ngoai_hinh || 'chưa nhập'}
  - Đặc điểm nhận dạng: ${dac_diem_nhan_dang || 'chưa nhập'}
  - Khuyết điểm (điểm yếu / thói xấu / nỗi sợ — không bắt buộc trope khuyết tật cứng): ${khuet_tat || 'chưa nhập'}
  - Bảng màu signature: ${mau_sac || 'chưa nhập'}
  
  MỤC TIÊU CẤU TRÚC BIBLE (bắt buộc đủ — style chỉ theo Setup/Visual DNA client, CẤM copy style mẫu cute 3D beach explorer hay lab mẫu):
  A) INFO CƠ BẢN: gioi_tinh, tuoi, chieu_cao (vd "168 cm"), dang_nguoi, vai_tro, so_thich, thoi_quen, dong_co, phu_kien, mau_sac.
  B) 8 BIỂU CẢM MẶT: expression_prompts đủ 8 key.
  C) 4 GÓC TURNAROUND LƯU TRỮ: angle_prompts front/three_quarter/side/back (sheet ảnh sẽ render thêm 3/4 rear + side đối xứng từ identity).
  D) 7 POSE HÀNH ĐỘNG / THÓI QUEN: pose_prompts map từ thoi_quen + phu_kien của ĐÚNG nhân vật này (không copy pose bãi biển/cún/cây gậy mẫu).
  E) CÔNG CỤ GẮN LIỀN: phu_kien liệt kê 3–6 món signature nhìn thấy được.
  F) CHIỀU CAO: chieu_cao luôn có số + đơn vị (cm hoặc ft+cm).
  
  NHIỆM VỤ:
  1. Xây hồ sơ đầy đủ, phù hợp bối cảnh/setup (lorebook + dàn ý + Setup thể loại — không ép thể loại ngoài Setup).
  2. TÁCH RÕ: gioi_tinh chỉ giới tính; tuoi riêng; dang_nguoi riêng; chieu_cao riêng; dong_co không nhét vào thoi_quen; phu_kien không nhét hết vào quan_ao.
  3. dac_diem_nhan_dang BẮT BUỘC cụ thể, nhìn thấy được (sẹo, nốt ruồi, xăm, mắt lệch, vật đeo signature...). Giữ y hệt mọi góc/mọi biểu cảm/mọi pose.
  4. ngoai_hinh = face lock: tóc, mắt, da, xương mặt, tuổi vẻ ngoài — ổn định.
  5. khuet_tat = khuyết điểm BẮT BUỘC: điểm yếu tính cách, thói xấu, nỗi sợ, hạn chế (có thể gồm thương tật nếu hợp Setup — CẤM mặc định trope khuyết tật cứng).
  6. prompt = master English identity lock (portrait base, front-facing, neutral expression) + outfit + marks + height feel + signature props.
  7. angle_prompts: 4 prompt EN full-body turnaround — CÙNG identity + marks + props, CHỈ đổi góc máy.
  8. expression_prompts: ĐỦ 8 prompt EN close-up face (neutral/happy/sad/angry/fear/surprised/determined/pain) — CÙNG face lock + marks, CHỈ đổi cơ mặt.
  9. pose_prompts: ĐỦ 7 prompt EN full-body — standing / walking / running / crouch / pointing / holding_prop / inspecting — hành động bám thoi_quen + dùng phu_kien signature của nhân vật.
  10. mau_sac: 4–6 swatch (tên + hex gợi ý) khớp trang phục/prop/glow.
  11. giong_thoai = quirk thoại ngắn (VD: "cộc, câu ngắn", "mỉa nửa cười").
  
  Trả về JSON THUẦN (không markdown) đúng schema:
  {
    "gioi_tinh": "Nam/Nữ/...",
    "tuoi": "khoảng 28",
    "dang_nguoi": "cao gầy / vạm vỡ...",
    "chieu_cao": "168 cm",
    "vai_tro": "nhân vật chính / phản diện / phụ...",
    "quan_ao": "trang phục signature chi tiết",
    "phu_kien": "3-6 món công cụ/phụ kiện gắn liền, cụ thể",
    "so_thich": "sở thích/phong cách",
    "thoi_quen": "thói quen hành vi / động tác lặp",
    "dong_co": "động cơ cốt lõi",
    "giong_thoai": "quirk thoại ngắn",
    "ngoai_hinh": "face lock chi tiết (tóc, mắt, da, xương mặt)",
    "dac_diem_nhan_dang": "marks nhận dạng cố định, cụ thể",
    "khuet_tat": "khuyết điểm BẮT BUỘC: điểm yếu tính cách / thói xấu / nỗi sợ / hạn chế",
    "mau_sac": "Lab White #F0F0F0; Tech Grey #2A2E33; ...",
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
    },
    "pose_prompts": {
      "standing": "English full-body standing idle...",
      "walking": "English full-body walking with tool...",
      "running": "English full-body running...",
      "crouch": "English full-body crouch/cast...",
      "pointing": "English full-body pointing/command...",
      "holding_prop": "English full-body holding signature prop...",
      "inspecting": "English full-body inspecting device/accessory..."
    }
  }`;
  
    const result = await generateJsonWithRetry(prompt, keysToUse, 2, model);
  
    // Director formula on master + turnaround + expression + pose sheet — style/genre from client (no silent genre default)
    const styleHint = String(
      payload.styleHint || payload.style || payload.visualDnaPrompt || '',
    ).trim();
    const genreLabel = String(
      payload.genre ||
        [payload.chu_de, payload.phong_cach].filter(Boolean).join(' / ') ||
        '',
    ).trim();
    if (!styleHint && !genreLabel) {
      return NextResponse.json(
        {
          error:
            'Thiếu Visual DNA / Media Style và Setup (chủ đề/phong cách) khi gen prompt nhân vật. App không tự gán thể loại mặc định.',
          ...result,
          usedApiKey: getLastWorkingApiKey(),
        },
        { status: 400 },
      );
    }
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
        pose_prompts:
          result.pose_prompts && typeof result.pose_prompts === 'object'
            ? (result.pose_prompts as Record<string, string>)
            : undefined,
        styleHint: styleHint || genreLabel,
        genre: genreLabel || styleHint,
        angleFraming: CHAR_ANGLE_CAMERA as unknown as Record<string, string>,
        emotionFace: CHAR_EMOTION_FACE as unknown as Record<string, string>,
        poseAction: CHAR_POSE_ACTION as unknown as Record<string, string>,
      });
      result.prompt = sheet.prompt;
      result.angle_prompts = sheet.angle_prompts;
      result.expression_prompts = sheet.expression_prompts;
      result.pose_prompts = sheet.pose_prompts;
      console.log(
        `[Character Prompt] director formula applied for "${name}" · angles=${Object.keys(sheet.angle_prompts).length} · expressions=${Object.keys(sheet.expression_prompts).length} · poses=${Object.keys(sheet.pose_prompts).length}`,
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return NextResponse.json(
        {
          error: `Character director formula loi: ${msg}`,
          usedApiKey: getLastWorkingApiKey(),
        },
        { status: 502 },
      );
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
  - Character flaw/weakness: ${khuet_tat || 'must invent a character flaw matching setup if missing'}
  
  YÊU CẦU:
  1. English only, detailed, policy-safe wording (no gore/sexual/explicit violence).
  2. Front portrait, neutral expression, natural cinematic lighting.
  3. Lock face + distinctive marks + outfit so the same character can be redrawn consistently.
  4. Cinematic production design matching setup — do NOT force a look outside Setup genre/style.
  5. Return ONLY the English prompt string, no markdown, no explanation.`;
  
    const aiResponse = await callActiveModel(prompt, keysToUse, model);
    let finalPrompt = String(aiResponse || '').trim();
    if (!finalPrompt) {
      return NextResponse.json(
        { error: 'AI tra prompt rong (CHARACTER_PROMPT_ONLY).' },
        { status: 502 },
      );
    }
    const styleHint = String(
      payload.styleHint || payload.style || payload.visualDnaPrompt || '',
    ).trim();
    const genreLabel = String(
      payload.genre ||
        [payload.chu_de, payload.phong_cach].filter(Boolean).join(' / ') ||
        '',
    ).trim();
    if (!styleHint && !genreLabel) {
      return NextResponse.json(
        {
          error:
            'Thiếu Visual DNA / Setup khi gen character prompt only. App không tự gán thể loại mặc định.',
        },
        { status: 400 },
      );
    }
    try {
      const sheet = applyCharacterSheetFormulas({
        name: String(name || 'character'),
        prompt: finalPrompt,
        styleHint: styleHint || genreLabel,
        genre: genreLabel || styleHint,
      });
      finalPrompt = sheet.prompt;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return NextResponse.json(
        { error: `CHARACTER_PROMPT_ONLY formula loi: ${msg}` },
        { status: 502 },
      );
    }
    return NextResponse.json({ prompt: finalPrompt, usedApiKey: getLastWorkingApiKey() });
  }
  
  // --- NODE: REGENERATE_PROMPT (Viết lại prompt bị lỗi/vi phạm chính sách) ---

  return null;
}
