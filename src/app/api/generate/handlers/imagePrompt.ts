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
  compileStillImagePrompt,
  requireGenreFromSetup,
} from '@/lib/integrations/seedance';
import {
  resolveApplyDirectorFormulasToPromptPair,
  resolveApplySequenceToVideoPrompts,
} from '@/lib/commercial/ip/seedanceCloudBridge';
import { extractEntitlementToken } from '@/lib/entitlement';
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
 * Cap shot count from **user timeline config** (not a fixed 16).
 * Seedance multishot / event-density: ~one beat per shot; budget ≈ duration / beat length.
 *
 * Sources (priority):
 * 1. payload.maxPromptShots — explicit override
 * 2. ceil(totalDurationSec / secondsPerBeat) — Media Config WPM/beat + TTS duration
 * 3. Safety ceiling 80 only to protect model JSON size (not a creative default)
 */
function resolveMaxPromptShots(opts: {
  totalDurationSec: number;
  secondsPerBeat: number;
  explicitMax?: number;
}): number {
  const beatRaw = Number(opts.secondsPerBeat);
  if (!Number.isFinite(beatRaw) || beatRaw <= 0) {
    throw new Error(
      'Thieu secondsPerBeat hop le khi cap shot. App khong tu gan 6s.',
    );
  }
  const beat = Math.max(1, beatRaw);
  const durRaw = Number(opts.totalDurationSec);
  if (!Number.isFinite(durRaw) || durRaw <= 0) {
    throw new Error(
      'Thieu totalDurationSec hop le khi cap shot. App khong tu gan duration.',
    );
  }
  const dur = Math.max(beat, durRaw);
  // How many beats fit the scene timeline (user-configured beat length)
  let maxShots = Math.max(1, Math.round(dur / beat));
  const explicit = Number(opts.explicitMax);
  if (Number.isFinite(explicit) && explicit > 0) {
    maxShots = Math.min(maxShots, Math.round(explicit));
  }
  // Absolute safety only (token / JSON size) — not a product default of 16
  return Math.min(80, Math.max(1, maxShots));
}

/**
 * AI sometimes wraps the array: { prompts: [...] } / { data: [...] }
 * or returns a single object / numeric-key map — normalize to array.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function normalizePromptArray(raw: any): any[] {
  if (Array.isArray(raw)) return raw.filter((x) => x != null);
  if (raw && typeof raw === 'object') {
    for (const k of [
      'prompts',
      'items',
      'data',
      'results',
      'shots',
      'list',
      'output',
      'scenes',
      'beats',
    ]) {
      if (Array.isArray(raw[k])) return raw[k].filter((x: unknown) => x != null);
    }
    // Single prompt object with image/video fields
    if (
      raw.image_prompt ||
      raw.imagePrompt ||
      raw.video_prompt ||
      raw.videoPrompt ||
      raw.prompt ||
      raw.script_prompt
    ) {
      return [raw];
    }
    // Map-like: { "1": {...}, "2": {...} } or { "0": {...} }
    const vals = Object.values(raw);
    if (
      vals.length > 0 &&
      vals.every((v) => v && typeof v === 'object' && !Array.isArray(v))
    ) {
      const looksLikePrompts = vals.some(
        (v) =>
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (v as any).image_prompt ||
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (v as any).imagePrompt ||
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (v as any).prompt ||
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (v as any).video_prompt ||
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (v as any).script_prompt ||
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (v as any).sentence,
      );
      if (looksLikePrompts) return vals as any[];
    }
  }
  return [];
}

/** Merge overflow sentences so N ≤ maxN (preserve order, join with space). */
function capSentences(sentences: string[], maxN: number): string[] {
  if (sentences.length <= maxN) return sentences;
  const out: string[] = [];
  const bucketSize = Math.ceil(sentences.length / maxN);
  for (let i = 0; i < sentences.length; i += bucketSize) {
    out.push(
      sentences
        .slice(i, i + bucketSize)
        .join(' ')
        .trim(),
    );
  }
  // If still over (edge), hard-merge tail
  while (out.length > maxN) {
    const last = out.pop() || '';
    out[out.length - 1] = `${out[out.length - 1]} ${last}`.trim();
  }
  return out;
}

/**
 * Owner: generate/imagePrompt.ts
 * Only handles requestTypes assigned in contracts/apiMap GENERATE_REQUEST_OWNERS → imagePrompt
 * B10: no local heuristic fill, no mat-the genre default — hard-fail with clear error.
 */
export async function handleImagePrompt(
  ctx: GenerateHandlerContext,
  requestType: string,
): Promise<NextResponse | null> {
  const { payload, keysToUse, model, req, rawBody } = ctx;
  const entitlementToken = req
    ? extractEntitlementToken(req, rawBody ?? { payload })
    : null;

  if (requestType === 'GENERATE_IMAGE_PROMPT') {
    const { sceneText, style, voiceDuration, characterReferences, wpm, secondsPerBeat } =
      payload;

    const styleHint = String(style || '').trim();
    if (!styleHint) {
      return NextResponse.json(
        {
          error:
            'Thieu Visual DNA / Media Style. Mo Media Config dat style truoc khi Gen Prompt. App khong tu gan style.',
        },
        { status: 400 },
      );
    }

    let genreLabel: string;
    try {
      genreLabel = requireGenreFromSetup({
        genre: typeof payload.genre === 'string' ? payload.genre : undefined,
        chu_de: typeof payload.chu_de === 'string' ? payload.chu_de : undefined,
        phong_cach:
          typeof payload.phong_cach === 'string' ? payload.phong_cach : undefined,
      });
    } catch (e) {
      return NextResponse.json(
        { error: e instanceof Error ? e.message : String(e) },
        { status: 400 },
      );
    }

    const wpmNum = Number(wpm);
    if (!Number.isFinite(wpmNum) || wpmNum <= 0) {
      return NextResponse.json(
        {
          error:
            'Thieu WPM hop le (Media Config). App khong tu gan WPM.',
        },
        { status: 400 },
      );
    }
    const beatSec = Number(secondsPerBeat);
    if (!Number.isFinite(beatSec) || beatSec <= 0) {
      return NextResponse.json(
        {
          error:
            'Thieu secondsPerBeat hop le (Media Config). App khong tu gan beat.',
        },
        { status: 400 },
      );
    }
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
      rawSentences.push(String(sceneText || '').trim() || 'Cảnh trống');
    }

    // Cap shot count from user config: secondsPerBeat + scene duration (TTS or WPM estimate)
    const explicitMax = Number(
      (payload as { maxPromptShots?: number }).maxPromptShots,
    );
    const maxPromptShots = resolveMaxPromptShots({
      totalDurationSec: totalDuration,
      secondsPerBeat: beatSec,
      explicitMax: Number.isFinite(explicitMax) && explicitMax > 0 ? explicitMax : undefined,
    });
    const beforeCap = rawSentences.length;
    const capped = capSentences(rawSentences, maxPromptShots);
    rawSentences.length = 0;
    rawSentences.push(...capped);
    if (beforeCap !== rawSentences.length) {
      console.info(
        `[Prompt Generator] cap shots ${beforeCap} → ${rawSentences.length} ` +
          `(user beat=${beatSec}s · duration=${totalDuration}s · max=${maxPromptShots})`,
      );
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
  2. Đặc điểm nhận dạng (sẹo, nốt ruồi, xăm, vật dụng đặc trưng) PHẢI xuất hiện giống hệt mọi shot — không được đổi/mất/thêm bừa.
  3. Biểu cảm khuôn mặt phải khớp emotion của câu (vui/buồn/giận/sợ...) nhưng cấu trúc mặt + marks vẫn cố định.
  4. Góc máy (front/3-4/side/back) có thể đổi, nhưng identity lock không được đổi.`;
    }
  
    const prompt = `
  Bạn là một Chuyên Gia Phân Tích Kịch Bản & Thiết Kế Prompt Vẽ Ảnh/Video AI (Stable Diffusion/Flux/Midjourney/Luma/Runway) chuyên nghiệp.
    
  NHIỆM VỤ: Tôi có chính xác ${rawSentences.length} câu lẻ dưới đây trích xuất từ kịch bản phân cảnh. BẠN BẮT BUỘC phải tạo ra đúng ${rawSentences.length} đối tượng JSON tương ứng với đúng ${rawSentences.length} câu này theo đúng thứ tự (id từ 1 đến ${rawSentences.length}). Tuyệt đối KHÔNG ĐƯỢC gộp câu, KHÔNG ĐƯỢC bỏ sót bất kỳ câu nào từ đầu đến cuối danh sách!
  
  --- DANH SÁCH CÁC CÂU CẦN PHÂN TÍCH (BẮT BUỘC TẠO ĐỦ PROMPT CHO TỪNG CÂU) ---
  ${sentenceListText}
  
  --- PHONG CÁCH NGHỆ THUẬT (VISUAL DNA STYLE) ---
  ${styleHint}
  --- THỂ LOẠI / SETUP (CHỦ ĐỀ + PHONG CÁCH TRUYỆN) ---
  ${genreLabel}
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
  
  
    // Resolve character hints early (AI repair path only — no local fill)
    const charHintsEarly: string[] = [];
    try {
      const refs = characterReferences || payload.nhan_vat_prompts || {};
      if (refs && typeof refs === 'object') {
        for (const k of Object.keys(refs)) if (k) charHintsEarly.push(k);
      }
    } catch {
      /* ignore */
    }
    // Prefer retry-capable JSON path — B10: no local heuristic fill on failure
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let parsedPrompts: any[] = [];
    let aiParseError: string | null = null;
    try {
      const rawJson = await generateJsonWithRetry(prompt, keysToUse, 2, model);
      parsedPrompts = normalizePromptArray(rawJson);
    } catch (err) {
      aiParseError = err instanceof Error ? err.message : String(err);
      try {
        const aiResponse = await callActiveModel(prompt, keysToUse, model);
        parsedPrompts = normalizePromptArray(cleanAndParseJson(aiResponse));
        aiParseError = null;
      } catch (err2) {
        aiParseError =
          (err2 instanceof Error ? err2.message : String(err2)) || aiParseError;
        return NextResponse.json(
          {
            error: `Sinh prompt AI that bai (JSON). Khong dung fill cuc bo. Chi tiet: ${aiParseError}`,
          },
          { status: 502 },
        );
      }
    }

    if (!parsedPrompts.length) {
      return NextResponse.json(
        {
          error:
            'AI tra ve mang prompt rong. Khong dung fill cuc bo — kiem tra API key / model master.',
        },
        { status: 502 },
      );
    }

    // Tái lập danh sách prompt khớp 100% với danh sách câu
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

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const coercePromptText = (val: any): string => {
      if (val == null) return '';
      if (typeof val === 'string') return val.trim();
      if (typeof val === 'number' || typeof val === 'boolean') return String(val).trim();
      if (Array.isArray(val)) {
        return val.map(coercePromptText).filter(Boolean).join(', ').trim();
      }
      if (typeof val === 'object') {
        for (const k of [
          'text',
          'prompt',
          'value',
          'content',
          'en',
          'english',
          'description',
          'image_prompt',
          'video_prompt',
        ]) {
          const s = coercePromptText(val[k]);
          if (s) return s;
        }
      }
      return '';
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const getVal = (obj: any, keys: string[]): string => {
      if (!obj || typeof obj !== 'object') return '';
      for (const k of keys) {
        const s = coercePromptText(obj[k]);
        if (s) return s;
      }
      return '';
    };

    // Claim each AI item at most once — avoid id=1 being reused for idx 0 and 1
    const claimed = new Set<number>();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pickAiItem = (idx: number): any => {
      // 1) exact 1-based id
      for (let i = 0; i < parsedPrompts.length; i++) {
        if (claimed.has(i)) continue;
        if (Number(parsedPrompts[i]?.id) === idx + 1) {
          claimed.add(i);
          return parsedPrompts[i];
        }
      }
      // 2) positional index
      if (idx < parsedPrompts.length && !claimed.has(idx)) {
        claimed.add(idx);
        return parsedPrompts[idx];
      }
      // 3) first unclaimed
      for (let i = 0; i < parsedPrompts.length; i++) {
        if (!claimed.has(i)) {
          claimed.add(i);
          return parsedPrompts[i];
        }
      }
      return null;
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const extractPair = (aiItem: any) => {
      if (!aiItem) {
        return { image: '', video: '', emotion: 'cinematic' };
      }
      const image = getVal(aiItem, [
        'image_prompt',
        'imagePrompt',
        'prompt_image',
        'image-prompt',
        'still_prompt',
        'stillPrompt',
        'prompt',
        'image',
      ]);
      let video = getVal(aiItem, [
        'video_prompt',
        'videoPrompt',
        'prompt_video',
        'video-prompt',
        'motion_prompt',
        'motionPrompt',
        'video',
        'animation',
      ]);
      // B10: do not invent video from image — incomplete pairs go to repair / hard-fail
      return {
        image,
        video,
        emotion: getVal(aiItem, ['emotion', 'feeling', 'mood']) || 'cinematic',
      };
    };

    type DraftItem = {
      idx: number;
      sentence: string;
      image: string;
      video: string;
      emotion: string;
      source: 'ai' | 'repair';
    };
    const drafts: DraftItem[] = rawSentences.map((sentence: string, idx: number) => {
      const pair = extractPair(pickAiItem(idx));
      return {
        idx,
        sentence,
        image: pair.image,
        video: pair.video,
        emotion: pair.emotion,
        source: 'ai' as const,
      };
    });

    // Surgical AI repair for incomplete slots only (still AI — no local heuristic)
    let missing = drafts.filter((d) => !d.image.trim() || !d.video.trim());
    if (missing.length > 0 && missing.length <= N) {
      console.warn(
        `[Prompt Generator] ${missing.length}/${N} incomplete — AI repair`,
        missing.map((m) => m.idx + 1),
      );
      const repairList = missing
        .map(
          (m) =>
            `${m.idx + 1}. script (VI): "${m.sentence.slice(0, 200)}"\n` +
            `   have_image: ${m.image ? 'yes' : 'NO'}\n` +
            `   have_video: ${m.video ? 'yes' : 'NO'}`,
        )
        .join('\n');
      const repairPrompt = `You are a cinematic prompt engineer.
Return ONLY a pure JSON array (no markdown). One object per item below.
Each object MUST have non-empty English "image_prompt" AND "video_prompt".

[
  { "id": 1, "emotion": "tense", "image_prompt": "...", "video_prompt": "..." }
]

Style DNA: ${styleHint}
Genre / Setup: ${genreLabel}
${characterInstructions}

ITEMS:
${repairList}
`;
      try {
        const repairedRaw = await generateJsonWithRetry(
          repairPrompt,
          keysToUse,
          1,
          model,
        );
        const repaired = normalizePromptArray(repairedRaw);
        for (const m of missing) {
          const hit =
            repaired.find((item: any) => Number(item?.id) === m.idx + 1) ||
            repaired[missing.indexOf(m)] ||
            null;
          if (!hit) continue;
          const pair = extractPair(hit);
          if (pair.image) {
            drafts[m.idx].image = pair.image;
            drafts[m.idx].source = 'repair';
          }
          if (pair.video) {
            drafts[m.idx].video = pair.video;
            drafts[m.idx].source = 'repair';
          }
          if (pair.emotion) drafts[m.idx].emotion = pair.emotion;
        }
      } catch (repairErr) {
        const msg =
          repairErr instanceof Error ? repairErr.message : String(repairErr);
        return NextResponse.json(
          {
            error: `AI repair prompt that bai (slot thieu image/video). Chi tiet: ${msg}`,
            missingIds: missing.map((m) => m.idx + 1),
          },
          { status: 502 },
        );
      }
    }

    missing = drafts.filter((d) => !d.image.trim() || !d.video.trim());
    if (missing.length > 0) {
      return NextResponse.json(
        {
          error: `Con ${missing.length}/${N} shot thieu image_prompt hoac video_prompt sau AI repair. Khong dung fill cuc bo — kiem tra API / thu gen lai.`,
          missingIds: missing.map((m) => m.idx + 1),
          missingSentences: missing.map((m) => m.sentence.slice(0, 80)),
        },
        { status: 502 },
      );
    }

    // Timestamp unified: start-end (matches TTS resync) e.g. "0-8.5s"
    let cumulativeSum = 0;
    const formattedPrompts = drafts.map((d) => {
      const segDur = durations[d.idx];
      const startSec = cumulativeSum;
      cumulativeSum += segDur;
      const endSec = cumulativeSum;
      const timestamp = `${startSec}-${endSec}s`;
      return {
        timestamp,
        emotion: d.emotion || 'cinematic',
        sentence: d.sentence,
        script_prompt: d.sentence,
        prompt: d.image,
        image_prompt: d.image,
        video_prompt: d.video,
        _source: d.source,
      };
    });
  
    // Shot graph: force wide→medium→close→insert→OTS cycle (anti-slideshow) — server only
    const shotFixed = enforceShotGraphOnPrompts(formattedPrompts);
    for (let i = 0; i < shotFixed.length; i++) {
      const img = shotFixed[i].image_prompt || shotFixed[i].prompt;
      formattedPrompts[i].image_prompt = img;
      formattedPrompts[i].prompt = img;
    }
  
    // Director formula layer — style from Visual DNA, genre from Setup (no mat-the default)
    const charHints = charHintsEarly;
    const perShotSec = Math.max(
      Math.min(beatSec, 3),
      Math.round(totalDuration / Math.max(1, formattedPrompts.length)),
    );
    for (let i = 0; i < formattedPrompts.length; i++) {
      const imgBase =
        formattedPrompts[i].image_prompt ||
        formattedPrompts[i].prompt ||
        '';
      const vidBase = formattedPrompts[i].video_prompt || '';
      if (!imgBase.trim() || !vidBase.trim()) {
        return NextResponse.json(
          {
            error: `Shot #${i + 1} thieu image/video truoc director formula. Khong fill cuc bo.`,
          },
          { status: 502 },
        );
      }
      try {
        const directed = await resolveApplyDirectorFormulasToPromptPair(
          {
            imagePrompt: imgBase,
            videoPrompt: vidBase,
            characterHints: charHints,
            styleHint,
            genre: genreLabel,
            durationSec: Math.max(perShotSec, beatSec),
            secondsPerBeat: beatSec,
          },
          { entitlementToken },
        );
        if (!directed.image_prompt?.trim() || !directed.video_prompt?.trim()) {
          return NextResponse.json(
            {
              error: `Director formula tra rong o shot #${i + 1}. Kiem tra style/genre setup.`,
            },
            { status: 502 },
          );
        }
        formattedPrompts[i].image_prompt = directed.image_prompt;
        formattedPrompts[i].prompt = directed.image_prompt;
        formattedPrompts[i].video_prompt = directed.video_prompt;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return NextResponse.json(
          {
            error: `Director formula loi o shot #${i + 1}: ${msg}`,
          },
          { status: 502 },
        );
      }
    }

    // Seedance sequence — hard-fail if continuity bake fails (B10 no silent skip)
    // Packaged Pro: cloud IP authority (Vercel); free offline sequence denied.
    let sequenceMeta: {
      projectId?: string;
      sequenceApplied?: boolean;
      clipIds?: string[];
      source?: string;
    } = {};
    try {
      const chapterNum = Number(
        payload.chapterNum ?? payload.chuong_dang_chon ?? 0,
      );
      const sceneIndex = Number(payload.sceneIndex ?? payload.scene_index ?? 0);
      const applied = await resolveApplySequenceToVideoPrompts(
        {
        chapterNum: Number.isFinite(chapterNum) && chapterNum > 0 ? chapterNum : 1,
        sceneIndex: Number.isFinite(sceneIndex) ? sceneIndex : 0,
        prompts: formattedPrompts,
        characterHints: charHints,
        styleHint,
        genre: genreLabel,
        secondsPerBeat: beatSec,
        durationSecPerShot: Math.max(perShotSec, beatSec),
        title:
          typeof payload.ten_tac_pham === 'string'
            ? payload.ten_tac_pham
            : typeof payload.title === 'string'
              ? payload.title
              : undefined,
        lorebook:
          typeof payload.lorebook === 'string' ? payload.lorebook : undefined,
        sceneText: String(sceneText || ''),
        projectSlug:
          typeof payload.ten_tac_pham === 'string'
            ? payload.ten_tac_pham
            : undefined,
        },
        { entitlementToken },
      );
      for (let i = 0; i < formattedPrompts.length; i++) {
        const next = applied.prompts[i];
        if (!next) continue;
        if (next.video_prompt) formattedPrompts[i].video_prompt = next.video_prompt;
        if (next.image_prompt) {
          formattedPrompts[i].image_prompt = next.image_prompt;
          formattedPrompts[i].prompt = next.image_prompt;
        }
      }
      sequenceMeta = {
        projectId: applied.projectId,
        sequenceApplied: applied.sequenceApplied,
        clipIds: applied.clipIds,
        source: applied.source,
      };
      console.log(
        `[Prompt Generator] Seedance sequence applied · project=${applied.projectId} · clips=${applied.clipIds.length} · source=${applied.source || 'local'}`,
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return NextResponse.json(
        {
          error: `Seedance sequence that bai (khong bo qua im lang): ${msg}`,
        },
        { status: 502 },
      );
    }

    const repairCount = drafts.filter((d) => d.source === 'repair').length;
    void aiParseError;
    console.log(
      `[Prompt Generator] ${formattedPrompts.length} prompts · ${rawSentences.length} sentences · ${totalDuration}s · repair=${repairCount} · genre=${genreLabel.slice(0, 40)}`,
    );

    // Strip internal debug field before client
    const clientPrompts = formattedPrompts.map(
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      ({ _source, ...rest }) => rest,
    );

    return NextResponse.json({
      prompts: clientPrompts,
      usedApiKey: getLastWorkingApiKey(),
      meta: {
        sentenceCount: rawSentences.length,
        localFill: 0,
        repairFill: repairCount,
        genre: genreLabel,
        style: styleHint,
        seedance: sequenceMeta,
      },
    });
  }
  
  // --- NODE 1: GENERATE_OUTLINE ---
  
  if (requestType === 'REGENERATE_PROMPT') {
    const { sentence, currentPrompt, style, characterReferences } = payload;

    const styleHint = String(style || '').trim();
    if (!styleHint) {
      return NextResponse.json(
        {
          error:
            'Thieu Visual DNA / Media Style khi viet lai prompt. App khong tu gan style.',
        },
        { status: 400 },
      );
    }

    let genreLabel: string;
    try {
      genreLabel = requireGenreFromSetup({
        genre: typeof payload.genre === 'string' ? payload.genre : undefined,
        chu_de: typeof payload.chu_de === 'string' ? payload.chu_de : undefined,
        phong_cach:
          typeof payload.phong_cach === 'string' ? payload.phong_cach : undefined,
      });
    } catch (e) {
      return NextResponse.json(
        { error: e instanceof Error ? e.message : String(e) },
        { status: 400 },
      );
    }
    
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
  
  --- PHONG CÁCH NGHỆ THUẬT (VISUAL DNA STYLE) ---
  ${styleHint}
  --- THỂ LOẠI / SETUP ---
  ${genreLabel}
  ${characterInstructions}
  
  YÊU CẦU BẮT BUỘC VỀ SỰ LIÊN KẾT:
  1. Hãy viết lại Prompt này bằng tiếng Anh thật an toàn, tránh vi phạm chính sách nội dung (safety block) nhưng vẫn bám sát nội dung Câu Gốc.
  2. Tính nhất quán phong cách (Visual DNA): Prompt mới BẮT BUỘC phải kế thừa triệt để Phong Cách Nghệ Thuật (Visual DNA) được cung cấp ở trên.
  3. Tính nhất quán nhân vật: Nếu câu gốc có nhắc đến tên nhân vật đã được cung cấp ở mục THAM CHIẾU NHÂN VẬT, bạn BẮT BUỘC phải kết hợp đủ các đặc tả ngoại hình của họ vào Prompt.
  4. Chất lượng đầu ra: Sử dụng các mô tả điện ảnh hiện đại (cinematic lighting, camera zoom, raw photo rendering style, volumetric light) thay vì sử dụng các từ khóa rác cũ như "8k, Unreal Engine 5, highly detailed".
  5. Chỉ trả về chuỗi văn bản Prompt tiếng Anh mới duy nhất, không giải thích gì thêm, không bọc markdown.
  `;
  
  
    const aiResponse = await callActiveModel(prompt, keysToUse, model);
    let finalPrompt = String(aiResponse || '').trim();
    if (!finalPrompt) {
      return NextResponse.json(
        { error: 'AI tra prompt rong khi viet lai. Khong dung fill cuc bo.' },
        { status: 502 },
      );
    }
    // Still-image director formula — hard-fail if formula fails (B10)
    try {
      const regenChars: string[] = [];
      if (characterReferences && typeof characterReferences === 'object') {
        for (const k of Object.keys(characterReferences)) if (k) regenChars.push(k);
      }
      const still = compileStillImagePrompt({
        sceneText: finalPrompt,
        characterHints: regenChars,
        styleHint,
        genre: genreLabel,
      });
      finalPrompt = still.prompt;
      if (!finalPrompt?.trim()) {
        return NextResponse.json(
          { error: 'Director still formula tra rong sau REGENERATE_PROMPT.' },
          { status: 502 },
        );
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return NextResponse.json(
        { error: `REGENERATE_PROMPT director formula loi: ${msg}` },
        { status: 502 },
      );
    }
    return NextResponse.json({ prompt: finalPrompt, usedApiKey: getLastWorkingApiKey() });
  }

  return null;
}
