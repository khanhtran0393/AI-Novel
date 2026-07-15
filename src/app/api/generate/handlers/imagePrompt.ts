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
 * Owner: generate/imagePrompt.ts
 * Only handles requestTypes assigned in contracts/apiMap GENERATE_REQUEST_OWNERS → imagePrompt
 */
export async function handleImagePrompt(
  ctx: GenerateHandlerContext,
  requestType: string,
): Promise<NextResponse | null> {
  const { payload, keysToUse, model } = ctx;

  if (requestType === 'GENERATE_IMAGE_PROMPT') {
    const { sceneText, style, voiceDuration, characterReferences, wpm, secondsPerBeat } =
      payload;
    const wpmNum = Number(wpm) > 0 ? Number(wpm) : 140;
    const beatSec = Number(secondsPerBeat) > 0 ? Number(secondsPerBeat) : 6;
    const voiceDur = Number(voiceDuration);
    // Prefer real TTS duration; else estimate from word count + WPM (aligned with client Studio)
    const wordCount = String(sceneText || '')
      .normalize('NFC')
      .replace(/\[[^\]]*\]/g, '')
      .trim()
      .split(/\s+/)
      .filter(Boolean).length;
    const estimatedFromWpm = Math.max(
      beatSec,
      Math.ceil((wordCount / wpmNum) * 60) || beatSec,
    );
    const totalDuration = voiceDur > 0 ? voiceDur : estimatedFromWpm;
  
    // 1. Phân tách kịch bản thành các câu đơn độc lập trên backend
    // Hỗ trợ chia tách sâu hơn khi phân cảnh dài để tạo đủ phân cảnh nghệ thuật phong phú
    const rawSegments = sceneText
      .split(/[.!?。;:]+|\n+/)
      .map((s: string) => s.trim())
      .filter((s: string) => s.length > 5);
  
    const rawSentences: string[] = [];
    for (const segment of rawSegments) {
      if (segment.length > 100 && (segment.includes(',') || segment.includes('，') || segment.includes(' - '))) {
        const parts = segment.split(/[,，]|\s+-\s+/);
        let currentPart = '';
        for (const part of parts) {
          const p = part.trim();
          if (!p) continue;
          if (currentPart === '') {
            currentPart = p;
          } else {
            if (currentPart.length < 40) {
              currentPart += ', ' + p;
            } else {
              rawSentences.push(currentPart);
              currentPart = p;
            }
          }
        }
        if (currentPart) {
          rawSentences.push(currentPart);
        }
      } else {
        rawSentences.push(segment);
      }
    }
  
    if (rawSentences.length === 0) {
      rawSentences.push(sceneText.trim());
    }
  
    let sentenceListText = '';
    rawSentences.forEach((sentence: string, idx: number) => {
      sentenceListText += `${idx + 1}. "${sentence}"\n`;
    });
  
    let characterInstructions = '';
    if (characterReferences && Object.keys(characterReferences).length > 0) {
      characterInstructions = `\n--- THAM CHIẾU NHÂN VẬT QUAN TRỌNG (CHARACTER VISUAL REFERENCES) ---\n`;
      for (const [name, info] of Object.entries(characterReferences)) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const c = info as any;
        const identityLock = [
          c.prompt,
          c.ngoai_hinh ? `Face lock: ${c.ngoai_hinh}` : '',
          c.dac_diem_nhan_dang ? `Distinctive marks (MUST keep): ${c.dac_diem_nhan_dang}` : '',
          c.khuet_tat ? `Permanent trait: ${c.khuet_tat}` : '',
        ].filter(Boolean).join('. ');
        characterInstructions += `- Nhân vật: "${name}" | Vai: ${c.vai_tro || '?'} | Giới: ${c.gioi_tinh || '?'} | Tuổi: ${c.tuoi || '?'} | Dáng: ${c.dang_nguoi || '?'} | Trang phục: ${c.quan_ao || '?'} | Face lock: ${c.ngoai_hinh || '?'} | Đặc điểm nhận dạng (BẮT BUỘC giữ nguyên mọi khung hình): ${c.dac_diem_nhan_dang || c.khuet_tat || '?'} | Khóa visual: "${identityLock}"\n`;
      }
      characterInstructions += `\nYÊU CẦU QUAN TRỌNG (Character Consistency):
  1. Nếu câu kịch bản có tên nhân vật trong danh sách trên → BẮT BUỘC nhúng face lock + đặc điểm nhận dạng + trang phục signature vào image_prompt/video_prompt (tiếng Anh).
  2. Đặc điểm nhận dạng (sẹo, nốt ruồi, xăm, khuyết tật, vật dụng đặc trưng) PHẢI xuất hiện giống hệt mọi shot — không được đổi/mất/thêm bừa.
  3. Biểu cảm khuôn mặt phải khớp emotion của câu (vui/buồn/giận/sợ...) nhưng cấu trúc mặt + marks vẫn cố định.
  4. Góc máy (front/3-4/side/back) có thể đổi, nhưng identity lock không được đổi.`;
    }
  
    const prompt = `
  Bạn là một Chuyên Gia Phân Tích Kịch Bản & Thiết Kế Prompt Vẽ Ảnh/Video AI (Stable Diffusion/Flux/Midjourney/Luma/Runway) chuyên nghiệp.
    
  NHIỆM VỤ: Tôi có chính xác ${rawSentences.length} câu lẻ dưới đây trích xuất từ kịch bản phân cảnh. BẠN BẮT BUỘC phải tạo ra đúng ${rawSentences.length} đối tượng JSON tương ứng với đúng ${rawSentences.length} câu này theo đúng thứ tự (id từ 1 đến ${rawSentences.length}). Tuyệt đối KHÔNG ĐƯỢC gộp câu, KHÔNG ĐƯỢC bỏ sót bất kỳ câu nào từ đầu đến cuối danh sách!
  
  --- DANH SÁCH CÁC CÂU CẦN PHÂN TÍCH (BẮT BUỘC TẠO ĐỦ PROMPT CHO TỪNG CÂU) ---
  ${sentenceListText}
  
  --- PHONG CÁCH NGHỆ THUẬT (VISUAL DNA STYLE) ---
  ${style || 'Cinematic Dark Post-Apocalyptic Fantasy'}
  ${characterInstructions}
  
  YÊU CẦU BẮT BUỘC VỀ BẢN DỊCH & NGÔN NGỮ (BẮT BUỘC TUÂN THỦ):
  1. "script_prompt" (Kịch bản sinh prompt): BẮT BUỘC phải giữ nguyên CÂU GỐC TIẾNG VIỆT 100% từ danh sách trên, TUYỆT ĐỐI KHÔNG DỊCH câu gốc này sang Tiếng Anh hay ngôn ngữ khác!
  2. "image_prompt" (Prompt vẽ ảnh): BẮT BUỘC viết bằng TIẾNG ANH 100% (English). Hãy dịch nghĩa câu gốc sang Tiếng Anh, kết hợp phong cách nghệ thuật và đặc điểm nhân vật, sau đó mô tả chi tiết điện ảnh (góc máy, ánh sáng, chất liệu, bố cục) hoàn toàn bằng Tiếng Anh. TUYỆT ĐỐI KHÔNG chứa bất kỳ từ Tiếng Việt nào.
  3. "video_prompt" (Prompt sinh video): BẮT BUỘC viết bằng TIẾNG ANH 100% (English). Mô tả camera di chuyển và các chuyển động vật lý tự nhiên của chủ thể/môi trường hoàn toàn bằng Tiếng Anh. TUYỆT ĐỐI KHÔNG chứa bất kỳ từ Tiếng Việt nào.
  4. Tính nhất quán nhân vật: Nếu câu trong kịch bản có nhắc đến tên nhân vật đã được cung cấp ở mục THAM CHIẾU NHÂN VẬT, bạn BẮT BUỘC phải kết hợp các đặc tả ngoại hình, trang phục, giới tính của họ (đã được dịch sang Tiếng Anh) vào "image_prompt" và "video_prompt".
  ${buildShotDiversityBlock()}
  
  TRẢ VỀ JSON THUẦN TÚY, KHÔNG CÓ MARKDOWN, theo cấu trúc mảng JSON mẫu sau:
  [
    {
  "id": 1,
  "emotion": "...",
  "script_prompt": "Câu gốc Tiếng Việt thứ 1 giữ nguyên 100%",
  "image_prompt": "cinematic still-image prompt in 100% English description of the first sentence, combining style and character details",
  "video_prompt": "[Camera movement description] in 100% English, [static prompt contents] in 100% English, with [motion cues]"
    },
    {
  "id": 2,
  "emotion": "...",
  "script_prompt": "Câu gốc Tiếng Việt thứ 2 giữ nguyên 100%",
  "image_prompt": "...",
  "video_prompt": "..."
    }
  ]
  `;
  
  
    const aiResponse = await callActiveModel(prompt, keysToUse, model);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let parsedPrompts: any[] = [];
    try {
      parsedPrompts = cleanAndParseJson(aiResponse);
    } catch (err) {
      throw new Error(`Prompt generator returned invalid JSON: ${(err as Error).message}`);
    }
  
    if (!Array.isArray(parsedPrompts)) {
      throw new Error('Prompt generator did not return a JSON array.');
    }
  
    // Tái lập danh sách prompt đầy đủ hoàn hảo khớp 100% với danh sách câu ban đầu
    const N = rawSentences.length;
    const durations = new Array(N);
    let remainingDuration = totalDuration;
    for (let i = 0; i < N; i++) {
      const remainingSegments = N - i;
      let dur = Math.round(remainingDuration / remainingSegments);
      if (dur < 1) dur = 1;
      durations[i] = dur;
      remainingDuration -= dur;
    }
  
    let cumulativeSum = 0;
    const formattedPrompts = rawSentences.map((sentence: string, idx: number) => {
      const segDur = durations[idx];
      const startSec = cumulativeSum;
      cumulativeSum += segDur;
      const timestamp = `${String(segDur).padStart(2, '0')}-${startSec === 0 ? '0' : String(startSec).padStart(2, '0')}`;
      
      // Tìm prompt mà AI trả về dựa trên id (1-indexed) hoặc vị trí index tương ứng
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const aiItem = parsedPrompts.find((item: any) => Number(item?.id) === idx + 1) || parsedPrompts[idx];
      
      // Trích xuất dữ liệu thông minh hỗ trợ sai lệch Key từ AI
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const getVal = (obj: any, keys: string[]): string => {
        if (!obj) return '';
        for (const k of keys) {
          if (obj[k] && typeof obj[k] === 'string' && obj[k].trim()) {
            return obj[k].trim();
          }
        }
        return '';
      };
  
      const aiImgPrompt = getVal(aiItem, ['image_prompt', 'imagePrompt', 'prompt_image', 'image-prompt', 'prompt', 'image']);
      const aiVidPrompt = getVal(aiItem, ['video_prompt', 'videoPrompt', 'prompt_video', 'video-prompt', 'video']);
      const aiEmotion = getVal(aiItem, ['emotion', 'feeling', 'mood']) || 'cinematic';
      if (!aiImgPrompt || !aiVidPrompt) {
        throw new Error(`Prompt item ${idx + 1} is missing required image_prompt or video_prompt.`);
      }
  
      return {
        timestamp,
        emotion: aiEmotion,
        sentence: sentence,
        script_prompt: sentence, // Ép cứng luôn là câu gốc Tiếng Việt để tránh AI dịch bậy kịch bản gốc của người dùng
        prompt: aiImgPrompt,
        image_prompt: aiImgPrompt,
        video_prompt: aiVidPrompt
      };
    });
  
    // Shot graph: force wide→medium→close→insert→OTS cycle (anti-slideshow)
    const shotFixed = enforceShotGraphOnPrompts(formattedPrompts);
    for (let i = 0; i < shotFixed.length; i++) {
      const img = shotFixed[i].image_prompt || shotFixed[i].prompt;
      formattedPrompts[i].image_prompt = img;
      formattedPrompts[i].prompt = img;
    }
  
    // Director formula layer — image (still) + video (I2V), anti-slop, no extra UI
    const charHints: string[] = [];
    try {
      const refs = payload.characterReferences || payload.nhan_vat_prompts || {};
      if (refs && typeof refs === 'object') {
        for (const k of Object.keys(refs)) if (k) charHints.push(k);
      }
    } catch {
      /* ignore */
    }
    const styleHint =
      (typeof payload.style === 'string' && payload.style) ||
      'dark survival realism, matte debris world';
    const perShotSec = Math.max(
      Math.min(beatSec, 3),
      Math.round(totalDuration / Math.max(1, formattedPrompts.length)),
    );
    for (let i = 0; i < formattedPrompts.length; i++) {
      const imgBase =
        formattedPrompts[i].image_prompt ||
        formattedPrompts[i].prompt ||
        '';
      const vidBase =
        formattedPrompts[i].video_prompt ||
        imgBase;
      if (!imgBase.trim() && !vidBase.trim()) continue;
      try {
        const directed = applyDirectorFormulasToPromptPair({
          imagePrompt: imgBase,
          videoPrompt: vidBase,
          characterHints: charHints,
          styleHint,
          genre: 'dark survival / mạt thế',
          durationSec: perShotSec,
        });
        formattedPrompts[i].image_prompt = directed.image_prompt;
        formattedPrompts[i].prompt = directed.image_prompt;
        formattedPrompts[i].video_prompt = directed.video_prompt;
      } catch (e) {
        console.warn('[Prompt Generator] director formula skip item', i, e);
      }
    }
  
    console.log(
      `[Prompt Generator] ${formattedPrompts.length} prompts · ${rawSentences.length} sentences · ${totalDuration}s · director formula on image+video`,
    );
  
    return NextResponse.json({ prompts: formattedPrompts, usedApiKey: getLastWorkingApiKey() });
  }
  
  // --- NODE 1: GENERATE_OUTLINE ---
  
  if (requestType === 'REGENERATE_PROMPT') {
    const { sentence, currentPrompt, style, characterReferences } = payload;
    
    let characterInstructions = '';
    if (characterReferences && Object.keys(characterReferences).length > 0) {
      characterInstructions = `\n--- THAM CHIẾU NHÂN VẬT QUAN TRỌNG (CHARACTER VISUAL REFERENCES) ---\n`;
      for (const [name, info] of Object.entries(characterReferences)) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const c = info as any;
        const identityLock = [
          c.prompt,
          c.ngoai_hinh ? `Face lock: ${c.ngoai_hinh}` : '',
          c.dac_diem_nhan_dang ? `Distinctive marks (MUST keep): ${c.dac_diem_nhan_dang}` : '',
          c.khuet_tat ? `Permanent trait: ${c.khuet_tat}` : '',
        ].filter(Boolean).join('. ');
        characterInstructions += `- Nhân vật: "${name}" | Face lock: ${c.ngoai_hinh || '?'} | Nhận dạng: ${c.dac_diem_nhan_dang || c.khuet_tat || '?'} | Khóa visual: "${identityLock}"\n`;
      }
      characterInstructions += `\nGiữ nguyên face lock + đặc điểm nhận dạng trong prompt viết lại. Biểu cảm có thể khớp câu gốc nhưng marks không được đổi.\n`;
    }
  
    const prompt = `
  Bạn là một Chuyên Gia Thiết Kế Prompt Vẽ Ảnh AI (Stable Diffusion/Flux/Midjourney) chuyên nghiệp.
    
  Nhiệm vụ của bạn là VIẾT LẠI (Sửa chữa/Tối ưu) một Prompt vẽ ảnh bị lỗi hoặc vi phạm chính sách nội dung (safety blocked).
  
  --- CÂU GỐC TRONG KỊCH BẢN ---
  "${sentence}"
  
  --- PROMPT CŨ BỊ LỒI ---
  "${currentPrompt}"
  
  --- PHONG CÁCH NGHỆ THUẪc (VISUAL DNA STYLE) ---
  ${style || 'Cinematic Dark Cyberpunk Sci-Fi Fantasy'}
  ${characterInstructions}
  
  YÊU CẦU BẮT BUỘC VỀ SỰ LIÊN KẾT:
  1. Hãy viết lại Prompt này bằng tiếng Anh thật an toàn, tránh vi phạm chính sách nội dung (safety block) nhưng vẫn bám sát nội dung Câu Gốc.
  2. Tính nhất quán phong cách (Visual DNA): Prompt mới BẮT BUỘC phải kế thừa triệt để Phong Cách Nghệ Thuật (Visual DNA) được cung cấp ở trên.
  3. Tính nhất quán nhân vật: Nếu câu gốc có nhắc đến tên nhân vật đã được cung cấp ở mục THAM CHIẾU NHÂN VẪc, bạn BẮT BUỘC phải kế t hợp đủ các đặc tả ngoại hình của họ vào Prompt.
  4. Chất lượng đầu ra: Sử dụng các mô tả điện ảnh hiện đại (cinematic lighting, camera zoom, raw photo rendering style, volumetric light) thay vì sử dụng các từ khóa rác cũ như "8k, Unreal Engine 5, highly detailed".
  5. Chỉ trả về chuỗi văn bản Prompt tiếng Anh mới duy nhất, không giải thích gì thêm, không bọc markdown.
  `;
  
  
    const aiResponse = await callActiveModel(prompt, keysToUse, model);
    // Still-image director formula on rewritten prompt (anti-slop + framing)
    let finalPrompt = aiResponse.trim();
    try {
      const regenChars: string[] = [];
      if (characterReferences && typeof characterReferences === 'object') {
        for (const k of Object.keys(characterReferences)) if (k) regenChars.push(k);
      }
      const still = compileStillImagePrompt({
        sceneText: finalPrompt,
        characterHints: regenChars,
        styleHint:
          (typeof style === 'string' && style) ||
          'dark survival realism, matte debris world',
        genre: 'dark survival / mạt thế',
      });
      finalPrompt = still.prompt;
    } catch (e) {
      console.warn('[REGENERATE_PROMPT] still formula skip:', e);
    }
    return NextResponse.json({ prompt: finalPrompt, usedApiKey: getLastWorkingApiKey() });
  }

  return null;
}
