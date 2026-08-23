import { NextResponse } from 'next/server';
import { requireFeature } from '@/lib/commercial/apiGate';
import { callConfiguredProvider } from '../generate/providerClients';
import { DEFAULT_GEMINI_TEXT_MODEL } from '@/lib/geminiModels';

export const runtime = 'nodejs';

let globalLastWorkingKey = '';
let globalLastWorkingModel = '';

async function callGemini(prompt: string, apiKeyOrKeys: string | string[]) {
  let keys = Array.isArray(apiKeyOrKeys) ? apiKeyOrKeys.filter(Boolean) : [apiKeyOrKeys].filter(Boolean);
  
  if (keys.length === 0) {
    throw new Error('Không có API Key nào hợp lệ để sử dụng.');
  }

  if (globalLastWorkingKey && keys.includes(globalLastWorkingKey)) {
    keys = [globalLastWorkingKey, ...keys.filter(k => k !== globalLastWorkingKey)];
  }

  let models = [DEFAULT_GEMINI_TEXT_MODEL];
  
  if (globalLastWorkingModel && models.includes(globalLastWorkingModel)) {
    models = [globalLastWorkingModel, ...models.filter(m => m !== globalLastWorkingModel)];
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let lastError: any = null;
  const exhaustedKeys = new Set<string>();

  for (let i = 0; i < keys.length; i++) {
    const apiKey = keys[i];
    if (exhaustedKeys.has(apiKey)) continue;

    console.log(`[Translate SRT] Bắt đầu thử các mô hình với API Key index ${i + 1}/${keys.length} (...${apiKey.slice(-4)})...`);

    for (const model of models) {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
      
      try {
        const response = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-goog-api-key': apiKey,
          },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: { temperature: 0.6, maxOutputTokens: 8192 },
            safetySettings: [
              { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
              { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
              { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
              { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" }
            ]
          }),
        });

        let status = response.status;
        let errorData = await response.json().catch(() => ({}));
        let msg = errorData.error?.message || '';

        if (!response.ok && (msg.includes('not found') || msg.includes('not supported') || status === 404)) {
          const urlBeta = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
          const responseBeta = await fetch(urlBeta, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-goog-api-key': apiKey,
            },
            body: JSON.stringify({
              contents: [{ parts: [{ text: prompt }] }],
              generationConfig: { temperature: 0.6, maxOutputTokens: 8192 },
              safetySettings: [
                { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
                { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
                { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
                { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" }
              ]
            }),
          });

          if (responseBeta.ok) {
            const dataBeta = await responseBeta.json();
            const textBeta = dataBeta.candidates?.[0]?.content?.parts?.[0]?.text;
            if (textBeta) {
              globalLastWorkingKey = '';
              globalLastWorkingModel = model;
              return textBeta;
            }
          } else {
            errorData = await responseBeta.json().catch(() => ({}));
            msg = errorData.error?.message || 'Lỗi không xác định từ Gemini API (v1beta)';
            status = responseBeta.status;
          }
        }

        if (response.ok) {
          const data = errorData; 
          const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
          if (!text) {
            throw new Error(`[Key ${i + 1}/${keys.length}]: AI không trả về kết quả hợp lệ.`);
          }
          globalLastWorkingKey = '';
          globalLastWorkingModel = model;
          return text;
        }

        if (status === 429 || msg.includes('Quota') || msg.includes('quota') || msg.includes('limit')) {
          exhaustedKeys.add(apiKey);
          lastError = new Error(`[Key ${i + 1}/${keys.length}] (${model}): ${msg} (Status: 429)`);
          break; 
        } else {
          lastError = new Error(`[Key ${i + 1}/${keys.length}] (${model}): ${msg} (Status: ${status})`);
        }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } catch (err: any) {
        const errMsg = err.message || '';
        lastError = err;
        if (errMsg.includes('429') || errMsg.includes('Quota') || errMsg.includes('quota') || errMsg.includes('limit')) {
          exhaustedKeys.add(apiKey);
          break; 
        }
      }
    } 
  } 

  throw lastError || new Error('Tất cả các API Key và dòng mô hình đều thất bại hoặc quá hạn ngạch.');
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const denied = await requireFeature(req, 'tts_premium', body);
    if (denied) return denied;
    const { apiKey: clientApiKey, apiKeys: clientApiKeys, srtText, ruleId = 'modern' } = body;

    let keysToUse: string[] = [];
    if (Array.isArray(clientApiKeys) && clientApiKeys.length > 0) {
      keysToUse = clientApiKeys.filter(Boolean);
    } else if (clientApiKey) {
      keysToUse = [clientApiKey];
    } else if (process.env.GEMINI_API_KEY) {
      keysToUse = [process.env.GEMINI_API_KEY];
    }

    if (keysToUse.length === 0) {
      return NextResponse.json(
        { error: 'Thiếu API Key. Vui lòng nhập ít nhất một API Key ở góc trên bên phải hoặc cấu hình biến môi trường server.' },
        { status: 400 }
      );
    }

    if (!srtText || srtText.trim() === '') {
      return NextResponse.json({ error: 'Nội dung SRT trống.' }, { status: 400 });
    }

    const ruleMap: Record<string, string> = {
      'xianxia': 'Mô tả: Sử dụng từ ngữ Hán Việt cổ kính, trang trọng, khí thế hào hùng. Giữ nguyên các thuật ngữ tu tiên, pháp bảo.',
      'romance': 'Mô tả: Lãng mạn, nhẹ nhàng, sử dụng xưng hô huynh - muội, chàng - thiếp, vương gia, nương nương.',
      'wuxia': 'Mô tả: Võ thuật, ân oán giang hồ. Xưng hô tại hạ, các hạ, huynh đài, tiền bối.',
      'palace': 'Mô tả: Tranh quyền đoạt vị, nội chiến gia tộc. Giọng điệu cung đình trang trọng, cung kính.',
      'rich': 'Mô tả: Giới siêu giàu, tổng tài bá đạo, ngôn từ hiện đại pha chút kiêu ngạo, thương trường.',
      'school': 'Mô tả: Tươi trẻ, hồn nhiên, thuật ngữ học đường, xưng hô cậu - tớ, mày - tao thân thiết.',
      'comedy': 'Mô tả: Vui tươi, hài hước, ngôn từ hiện đại thoải mái, có thể dùng từ lóng mạng mẻ.',
      'horror': 'Mô tả: Kịch tính, logic, lạnh lùng, thuật ngữ phá án/tâm lý/kinh dị. Giọng điệu hồi hộp, nghiêm túc.',
      'action': 'Mô tả: Gọn gàng, mạnh mẽ, dứt khoát. Nhịp độ nhanh, tập trung vào hành động.',
      'scifi': 'Mô tả: Sinh tồn, tương lai, công nghệ khoa học viễn tưởng. Thuật ngữ máy móc, không gian, AI.',
      'history': 'Mô tả: Hào hùng, bi tráng, thời kỳ dân quốc/chiến tranh. Ngôn từ thời chiến lược, tư lệnh, quan chức.',
      'modern': 'Mô tả: Tone chân thực, thực tế, đời sống thường ngày kết hợp thuật ngữ công sở và gia đình. Ngôn từ gần gũi.',
      'strict': 'Mô tả: Dịch 1-1 sát nghĩa gốc, bám sát cấu trúc ngữ pháp nguyên bản, không phóng tác, cực kỳ chuẩn xác, phù hợp Light Novel.',
      'auto': 'Mô tả: AI tự động quét toàn bộ văn bản để phán đoán bối cảnh, từ đó linh hoạt điều chỉnh văn phong và đại từ nhân xưng cho phù hợp nhất.'
    };

    const ruleDesc = ruleMap[ruleId] || ruleMap['modern'];

    const prompt = `Bạn là một tiểu thuyết gia xuất chúng, một bậc thầy ngôn ngữ và là một chuyên gia dịch thuật chuyên nghiệp.
Nhiệm vụ của bạn là dịch file phụ đề (SRT) dưới đây sang Tiếng Việt sao cho văn phong mềm mại, tự nhiên, đậm chất văn học nghệ thuật.
Quy tắc đặc biệt: ${ruleDesc}

YÊU CẦU BẮT BUỘC:
1. Bạn BẮT BUỘC phải giữ nguyên CẤU TRÚC SRT gốc. Mỗi khối phụ đề luôn có 3 dòng:
   - Dòng 1: ID số thứ tự (1, 2, 3...)
   - Dòng 2: Thời gian (00:00:00,000 --> 00:00:00,000)
   - Dòng 3: Văn bản gốc đã được dịch sang tiếng Việt.
   - Dòng 4: Một dòng trống (blank line).
2. TUYỆT ĐỐI KHÔNG gộp câu, KHÔNG gộp ID, KHÔNG nuốt chữ hay làm mất bất kỳ một khối thời gian nào. Tổng số khối SRT đầu ra phải KHỚP 100% với số khối SRT đầu vào.
3. Chỉ trả về văn bản SRT thuần túy, KHÔNG bọc trong markdown (không dùng \`\`\`srt). KHÔNG giải thích gì thêm, KHÔNG thêm lời chào.

--- FILE SRT GỐC ---
${srtText}`;

    const aiResponse = await callConfiguredProvider(
      prompt,
      [],
      keysToUse,
      {
        provider: 'gemini',
        model: DEFAULT_GEMINI_TEXT_MODEL,
      },
    );

    // Lọc bỏ markdown nếu AI lỡ bọc
    let finalSrt = aiResponse.trim();
    if (finalSrt.startsWith('\`\`\`srt')) {
      finalSrt = finalSrt.replace(/^\`\`\`srt[\r\n]*/, '');
      finalSrt = finalSrt.replace(/[\r\n]*\`\`\`$/, '');
    } else if (finalSrt.startsWith('\`\`\`')) {
      finalSrt = finalSrt.replace(/^\`\`\`[\r\n]*/, '');
      finalSrt = finalSrt.replace(/[\r\n]*\`\`\`$/, '');
    }

    return NextResponse.json({
      translatedSrt: finalSrt.trim(),
    });

  } catch (error: unknown) {
    const err = error as Error;
    return NextResponse.json({ error: err.message || 'Có lỗi xảy ra khi dịch SRT.' }, { status: 500 });
  }
}
