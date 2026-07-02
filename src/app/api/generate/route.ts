import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

// Hàm tự động sửa chữa/hoàn thành các khối JSON bị lỗi hoặc bị cắt cụt (truncation) do giới hạn token của AI
function repairJson(jsonStr: string): string {
  let result = '';
  let inString = false;
  let escape = false;
  const stack: ('{' | '[')[] = [];

  for (let i = 0; i < jsonStr.length; i++) {
    const char = jsonStr[i];

    if (inString) {
      if (escape) {
        result += char;
        escape = false;
      } else if (char === '\\') {
        result += char;
        escape = true;
      } else if (char === '"') {
        result += char;
        inString = false;
      } else if (char === '\n') {
        result += '\\n';
      } else if (char === '\r') {
        result += '\\r';
      } else if (char === '\t') {
        result += '\\t';
      } else {
        result += char;
      }
    } else {
      if (char === '"') {
        inString = true;
        result += char;
      } else if (char === '{') {
        stack.push('{');
        result += char;
      } else if (char === '}') {
        if (stack[stack.length - 1] === '{') {
          stack.pop();
        }
        result += char;
      } else if (char === '[') {
        stack.push('[');
        result += char;
      } else if (char === ']') {
        if (stack[stack.length - 1] === '[') {
          stack.pop();
        }
        result += char;
      } else {
        result += char;
      }
    }
  }

  if (inString) {
    result += '"';
  }

  while (stack.length > 0) {
    const last = stack.pop();
    if (last === '{') {
      result += '}';
    } else if (last === '[') {
      result += ']';
    }
  }

  return result;
}

// Hàm xử lý làm sạch văn bản và phân tích JSON cực kỳ mạnh mẽ để tránh lỗi định dạng
function cleanAndParseJson(text: string) {
  // 1. Thử parse trực tiếp trước
  try {
    return JSON.parse(text);
  } catch {}

  // 2. Loại bỏ các thẻ code block markdown nếu có
  let cleaned = text.trim();
  cleaned = cleaned.replace(/^```[a-zA-Z]*[\s\n]*/, ''); // strip leading ```json with any spaces or newlines
  cleaned = cleaned.replace(/```$/, '').trim(); // strip trailing ```

  try {
    return JSON.parse(cleaned);
  } catch {}

  // 3. Sử dụng thuật toán sửa chữa cấu trúc ngoặc và ký tự điều khiển cực kỳ mạnh mẽ
  try {
    const structuralCleaned = cleanJsonStructurally(cleaned);
    return JSON.parse(structuralCleaned);
  } catch {}

  // 4. Sử dụng bộ sửa chữa JSON nâng cao gốc để vá các lỗi cấu trúc (cắt cụt hoặc raw control characters)
  const repaired = repairJson(cleaned);
  try {
    return JSON.parse(repaired);
  } catch {}

  // 5. Tìm kiếm và trích xuất khối JSON đối tượng { ... } lớn nhất bằng Regex
  const startCurly = cleaned.indexOf('{');
  const endCurly = cleaned.lastIndexOf('}');
  if (startCurly !== -1 && endCurly !== -1 && endCurly > startCurly) {
    try {
      const jsonCandidate = cleaned.substring(startCurly, endCurly + 1);
      return JSON.parse(jsonCandidate);
    } catch {}
    
    // Thử sửa chữa jsonCandidate trích xuất được
    try {
      const repairedCandidate = repairJson(cleaned.substring(startCurly, endCurly + 1));
      return JSON.parse(repairedCandidate);
    } catch {}
    
    // Thử sửa chữa cấu trúc của jsonCandidate
    try {
      const structuralCandidate = cleanJsonStructurally(cleaned.substring(startCurly, endCurly + 1));
      return JSON.parse(structuralCandidate);
    } catch {}
  }

  // 6. Tìm kiếm và trích xuất khối JSON mảng [ ... ] lớn nhất bằng Regex
  const startSquare = cleaned.indexOf('[');
  const endSquare = cleaned.lastIndexOf(']');
  if (startSquare !== -1 && endSquare !== -1 && endSquare > startSquare) {
    try {
      const jsonCandidate = cleaned.substring(startSquare, endSquare + 1);
      return JSON.parse(jsonCandidate);
    } catch {}
    
    // Thử sửa chữa jsonCandidate mảng trích xuất được
    try {
      const repairedCandidate = repairJson(cleaned.substring(startSquare, endSquare + 1));
      return JSON.parse(repairedCandidate);
    } catch {}

    // Thử sửa chữa cấu trúc của mảng Candidate
    try {
      const structuralCandidate = cleanJsonStructurally(cleaned.substring(startSquare, endSquare + 1));
      return JSON.parse(structuralCandidate);
    } catch {}
  }

  // Nếu tất cả các nỗ lực đều thất bại, đưa ra phản hồi lỗi chứa toàn bộ nội dung để chẩn đoán
  throw new Error('AI phản hồi sai định dạng JSON. Phản hồi thực tế: ' + (text.length > 500 ? text.substring(0, 500) + '...' : text));
}

// Thuật toán làm sạch và sửa chữa cấu trúc JSON động (tránh trôi dấu ngoặc kép và ký tự xuống dòng)
function cleanJsonStructurally(jsonStr: string): string {
  let result = '';
  let inString = false;
  let escape = false;

  for (let i = 0; i < jsonStr.length; i++) {
    const char = jsonStr[i];

    if (inString) {
      if (escape) {
        result += char;
        escape = false;
      } else if (char === '\\') {
        result += char;
        escape = true;
      } else if (char === '"') {
        // Kiểm tra xem dấu ngoặc kép này có thực sự là dấu đóng chuỗi JSON hay không
        // Dấu đóng chuỗi JSON chuẩn luôn được theo sau bởi: :, ,, }, ] và các khoảng trắng
        let nextChar = '';
        let lookAheadIdx = i + 1;
        while (lookAheadIdx < jsonStr.length) {
          const next = jsonStr[lookAheadIdx];
          if (next !== ' ' && next !== '\n' && next !== '\r' && next !== '\t') {
            nextChar = next;
            break;
          }
          lookAheadIdx++;
        }

        const isClosing = nextChar === ':' || nextChar === ',' || nextChar === '}' || nextChar === ']';

        if (isClosing) {
          result += char;
          inString = false;
        } else {
          // Đây là dấu ngoặc kép nằm bên trong chuỗi giá trị chưa được escape! Tiến hành sửa chữa!
          result += '\\"';
        }
      } else if (char === '\n') {
        result += '\\n';
      } else if (char === '\r') {
        result += '\\r';
      } else if (char === '\t') {
        result += '\\t';
      } else {
        result += char;
      }
    } else {
      if (char === '"') {
        inString = true;
        result += char;
      } else {
        result += char;
      }
    }
  }

  return result;
}

let globalLastWorkingKey = '';
let globalLastWorkingModel = '';

// Hàm gọi API Gemini hỗ trợ tự động xoay vòng nhiều API Key và nhiều dòng mô hình khi hết quota hoặc lỗi model
async function callGemini(prompt: string, apiKeyOrKeys: string | string[]) {
  let keys = Array.isArray(apiKeyOrKeys) ? apiKeyOrKeys.filter(Boolean) : [apiKeyOrKeys].filter(Boolean);
  
  if (keys.length === 0) {
    throw new Error('Không có API Key nào hợp lệ để sử dụng.');
  }

  // Đưa key đang hoạt động tốt lên đầu danh sách để tiết kiệm thời gian
  if (globalLastWorkingKey && keys.includes(globalLastWorkingKey)) {
    keys = [globalLastWorkingKey, ...keys.filter(k => k !== globalLastWorkingKey)];
  }

  // Danh sách các mô hình chạy ổn định sắp xếp theo thứ tự ưu tiên
  // LƯU Ý: Các model gemini-1.5-* (flash, pro, flash-8b) đã bị Google ngừng hỗ trợ hoàn toàn (deprecated)
  // và luôn trả về 404 "not found". KHÔNG được thêm lại vào danh sách này. Xem error.md Mục 19.
  let models = [
    'gemini-2.5-flash',
    'gemini-2.5-flash-lite',
    'gemini-2.5-pro'
  ];
  
  // Đưa model đang hoạt động tốt lên đầu danh sách
  if (globalLastWorkingModel && models.includes(globalLastWorkingModel)) {
    models = [globalLastWorkingModel, ...models.filter(m => m !== globalLastWorkingModel)];
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let lastError: any = null;
  const exhaustedKeys = new Set<string>();

  // Ưu tiên xoay vòng qua từng Key trước (vòng lặp ngoài)
  for (let i = 0; i < keys.length; i++) {
    const apiKey = keys[i];
    if (exhaustedKeys.has(apiKey)) continue;

    console.log(`[Gemini API] Bắt đầu thử các dòng mô hình với API Key index ${i + 1}/${keys.length} (...${apiKey.slice(-4)})...`);

    // Với mỗi API Key, thử lần lượt các Model theo độ ưu tiên (vòng lặp trong)
    for (const model of models) {
      const url = `https://generativelanguage.googleapis.com/v1/models/${model}:generateContent?key=${apiKey}`;
      
      try {
        console.log(`[Gemini API] Thử gọi mô hình: ${model} (v1) với API Key index ${i + 1}/${keys.length}...`);
        const response = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: { temperature: 0.85, maxOutputTokens: 8192 },
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

        // Nếu lỗi liên quan đến model không tìm thấy hoặc không hỗ trợ ở v1, thử fallback v1beta cho model này
        if (!response.ok && (msg.includes('not found') || msg.includes('not supported') || status === 404)) {
          console.warn(`[Gemini API] Mô hình ${model} không khả dụng ở v1. Đang thử lại với v1beta cho khóa index ${i + 1}...`);
          const urlBeta = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
          const responseBeta = await fetch(urlBeta, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: [{ parts: [{ text: prompt }] }],
              generationConfig: { temperature: 0.85, maxOutputTokens: 8192 },
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
              globalLastWorkingKey = apiKey;
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
          const data = errorData; // Đã parse ở trên
          const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
          if (!text) {
            throw new Error(`[Key ${i + 1}/${keys.length}]: AI không trả về kết quả hợp lệ.`);
          }
          globalLastWorkingKey = apiKey;
          globalLastWorkingModel = model;
          return text;
        }

        // Xử lý lỗi trả về từ API
        if (status === 429 || msg.includes('Quota') || msg.includes('quota') || msg.includes('limit')) {
          console.warn(`[Gemini API] Key index ${i + 1} (...${apiKey.slice(-4)}) bị cạn kiệt hoặc quá hạn ngạch (Status: ${status}). Đánh dấu cạn kiệt và chuyển sang Key tiếp theo.`);
          exhaustedKeys.add(apiKey);
          lastError = new Error(`[Key ${i + 1}/${keys.length}] (${model}): ${msg} (Status: 429)`);
          break; // Bứt khỏi vòng lặp models để chuyển sang API Key tiếp theo ngay lập tức!
        } else {
          // Lỗi khác (vd: lỗi tham số, lỗi server 500), tiếp tục thử model khác của key này
          console.warn(`[Gemini API] Lỗi model ${model} với Key index ${i + 1} (...${apiKey.slice(-4)}): ${msg} (Status: ${status})`);
          lastError = new Error(`[Key ${i + 1}/${keys.length}] (${model}): ${msg} (Status: ${status})`);
        }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } catch (err: any) {
        const errMsg = err.message || '';
        console.error(`[Gemini API] Ngoại lệ với ${model} và API Key index ${i + 1}:`, errMsg);
        lastError = err;

        if (errMsg.includes('429') || errMsg.includes('Quota') || errMsg.includes('quota') || errMsg.includes('limit')) {
          exhaustedKeys.add(apiKey);
          break; // Bứt khỏi vòng lặp models để sang key mới
        }
      }
    } // end for models
  } // end for keys

  throw lastError || new Error('Tất cả các API Key và dòng mô hình đều thất bại hoặc quá hạn ngạch.');
}

// Luồng kiểm tra chéo (Cross-check thread) tự động phát hiện lỗi định dạng JSON và thử lại
async function generateJsonWithRetry(prompt: string, keysToUse: string[], maxRetries = 2) {
  let lastError = null;
  for (let i = 0; i <= maxRetries; i++) {
    try {
      const aiResponse = await callGemini(prompt, keysToUse);
      const result = cleanAndParseJson(aiResponse);
      return result;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (e: any) {
      lastError = e;
      console.warn(`[Lỗi chéo - Lần ${i+1}] Bắt lỗi định dạng JSON: ${e.message}. Đang yêu cầu AI thử lại...`);
    }
  }
  throw lastError;
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { requestType, apiKey: clientApiKey, apiKeys: clientApiKeys, payload } = body;

    // Thiết lập danh sách API Key hợp lệ
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

    // --- NODE 0: GENERATE_IDEA ---
    if (requestType === 'GENERATE_IDEAS' || requestType === 'GENERATE_IDEA') {
      const { chu_de, phong_cach } = payload || {};
      const prompt = `Bạn là Trợ lý Biên kịch sáng tạo chuyên nghiệp bậc nhất.
Với Khối Chủ đề: "${chu_de || 'Sinh tồn mạt thế'}" và Khối Phong cách: "${phong_cach || 'Kịch tính, Tăm tối'}".
Hãy sáng tạo ra một ý tưởng cốt truyện/bối cảnh (khoảng 4-6 câu) thật độc đáo, chi tiết, có chiều sâu, mô tả nghịch cảnh mà nhân vật chính đang phải đối mặt. Hãy để trí tưởng tượng bay bổng, không bị gò bó vào bất kỳ lối mòn nào. Không trả về Markdown, chỉ trả về văn bản thuần túy.`;
      const aiResponse = await callGemini(prompt, keysToUse);
      return NextResponse.json({ idea: aiResponse.trim(), mo_ta: aiResponse.trim(), usedApiKey: globalLastWorkingKey });
    }

    // --- NODE: GENERATE_IMAGE_PROMPT (Phân tách theo từng câu + cảm xúc) ---
    if (requestType === 'GENERATE_IMAGE_PROMPT') {
      const { sceneText, style, voiceDuration, characterReferences } = payload;
      const totalDuration = voiceDuration || 30;

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
          characterInstructions += `- Nhân vật: "${name}" -> Giới tính: ${c.gioi_tinh || '?'}, Quần áo: ${c.quan_ao || '?'}, Sở thích: ${c.so_thich || '?'}, Thói quen: ${c.thoi_quen || '?'}. Prompt tham chiếu ngoại hình: "${c.prompt || ''}"\n`;
        }
        characterInstructions += `\nYÊU CẦU QUAN TRỌNG (Character Consistency): Với mỗi câu trong kịch bản, nếu xuất hiện tên của bất kỳ nhân vật nào trong danh sách tham chiếu trên, bạn BẮT BUỘC phải tích hợp các mô tả chi tiết đặc điểm ngoại hình, trang phục, giới tính, và thuộc tính của nhân vật đó từ phần tham chiếu vào trong Prompt vẽ ảnh tiếng Anh tương ứng. Điều này đảm bảo tính nhất quán hình ảnh của nhân vật xuyên suốt các phân cảnh.`;
      }

      const prompt = `Bạn là một Chuyên Gia Phân Tích Kịch Bản & Thiết Kế Prompt Vẽ Ảnh AI (Stable Diffusion/Midjourney) chuyên nghiệp.
      
NHIỆM VỤ: Tôi có chính xác ${rawSentences.length} câu lẻ dưới đây trích xuất từ kịch bản phân cảnh. Bạn BẮT BUỘC phải tạo ra đúng ${rawSentences.length} đối tượng JSON tương ứng với ${rawSentences.length} câu này theo đúng thứ tự (id từ 1 đến ${rawSentences.length}). Tuyệt đối KHÔNG ĐƯỢC gộp câu, KHÔNG ĐƯỢC bỏ sót bất kỳ câu nào từ đầu đến cuối danh sách!

--- DANH SÁCH CÁC CÂU CẦN PHÂN TÍCH (BẮT BUỘC TẠO ĐỦ PROMPT CHO TỪNG CÂU) ---
${sentenceListText}

--- PHONG CÁCH NGHỆ THUẬT (VISUAL DNA STYLE) ---
${style || 'Cinematic Dark Post-Apocalyptic Fantasy'}
${characterInstructions}

YÊU CẦU BẮT BUỘC VỀ SỰ LIÊN KẾT (CROSS-REFERENCE):
1. Tính nhất quán phong cách (Visual DNA): Toàn bộ Prompt sinh ra phải áp dụng triệt để Phong Cách Nghệ Thuật (Visual DNA) được cấu hình ở trên để tạo ra Art Direction đồng nhất cho toàn bộ video.
2. Tính nhất quán nhân vật: Nếu câu trong kịch bản có nhắc đến tên nhân vật đã được cung cấp ở mục THAM CHIẾU NHÂN VẬT, bạn BẮT BUỘC phải kết hợp đầy đủ các đặc tả ngoại hình, trang phục, giới tính của họ vào Prompt để AI vẽ nhân vật giống nhau ở mọi cảnh.
3. Kịch bản & Cảm xúc: Tái hiện lại bối cảnh và hành động mô tả trong câu gốc bằng tiếng Anh. Phân tích cảm xúc chính (emotion) của câu.
4. Chất lượng đầu ra: Tiếng Anh 100%. Bổ sung các thẻ chất lượng cao (Unreal Engine 5, 8k resolution, highly detailed, cinematic lighting, depth of field).

TRẢ VỀ JSON THUẦN TÚY, KHÔNG CÓ MARKDOWN, theo cấu trúc mảng JSON sau:
[
  { "id": 1, "emotion": "...", "prompt": "[Style DNA] style, [Character details] performing [action] in [Setting], cinematic lighting, 8k..." },
  { "id": 2, "emotion": "...", "prompt": "..." }
]`;

      const aiResponse = await callGemini(prompt, keysToUse);
      
      // Phân tích JSON trả về
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let parsedPrompts: any[] = [];
      try {
        parsedPrompts = cleanAndParseJson(aiResponse);
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      } catch (err) {
        console.warn('[Gemini Prompt Parser] Thất bại khi parse JSON, tiến hành dùng chế độ thô dự phòng.');
        parsedPrompts = [];
      }

      if (!Array.isArray(parsedPrompts)) {
        parsedPrompts = [];
      }

      // Tái lập danh sách prompt đầy đủ hoàn hảo khớp 100% với danh sách câu ban đầu
      const formattedPrompts = rawSentences.map((sentence: string, idx: number) => {
        // Tính toán timestamp chia đều hoàn hảo theo tổng thời lượng (ví dụ: 242s)
        const segDur = Math.max(1, Math.round(totalDuration / rawSentences.length));
        const timestamp = `${idx * segDur}s`;
        
        // Tìm prompt mà AI trả về dựa trên id (1-indexed) hoặc vị trí index tương ứng
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const aiItem = parsedPrompts.find((item: any) => Number(item?.id) === idx + 1) || parsedPrompts[idx];
        
        // Fallback prompt an toàn nếu AI bỏ sót
        const fallbackPrompt = `Cinematic wide shot showing: ${sentence}. ${style || 'Cinematic Dark Cyberpunk Sci-Fi Fantasy'}, highly detailed, Unreal Engine 5, 8k, photorealistic.`;
        
        return {
          timestamp,
          emotion: aiItem?.emotion || 'cinematic',
          sentence: sentence,
          prompt: aiItem?.prompt || fallbackPrompt
        };
      });

      console.log(`[Prompt Generator] Đã sinh thành công ${formattedPrompts.length} prompt tương ứng với ${rawSentences.length} câu trên tổng thời lượng ${totalDuration}s.`);

      return NextResponse.json({ prompts: formattedPrompts, usedApiKey: globalLastWorkingKey });
    }

    // --- NODE 1: GENERATE_OUTLINE ---
    if (requestType === 'GENERATE_OUTLINE') {
      const { chu_de, phong_cach, mo_ta, so_chuong } = payload;

      const prompt = `Bạn là một Trợ lý Biên kịch Sản xuất tiểu thuyết mạt thế, sinh tồn, huyền huyễn xuất sắc bậc nhất.
Dựa trên các tham số cấu hình sau:
- Chủ đề: ${chu_de}
- Phong cách: ${phong_cach}
- Ý tưởng cốt truyện gốc: ${mo_ta || 'Ngẫu nhiên bối cảnh hoang phế độc đáo'}
- Số lượng chương cần phân bổ: ${so_chuong} chương (BẮT BUỘC: chỉ được phép lên dàn ý đúng chính xác ${so_chuong} chương, không thừa không thiếu)

Nhiệm vụ của bạn là:
1. Đề xuất một tên tác phẩm tiếng Việt kịch tính, đậm chất mạt thế, sinh tồn.
2. Thiết lập Dàn ý Tổng thể (World-building & Plot Outline) thật chi tiết dưới dạng Markdown.
3. Bóc tách ra khoảng 2-4 tên nhân vật chính yếu (bắt buộc phải là tên Hán Việt độc đáo mới mẻ, ví dụ: Tiêu Hàn, Thạch Dã, Diệp Dao... tuyệt đối không sử dụng Lâm Khuyết hay các tên quá phổ biến).
4. Phác thảo dàn ý chi tiết cho từng chương (từ Chương 1 đến Chương ${so_chuong}) để người dùng chốt chặn trước khi viết. (BẮT BUỘC: danh sách "danh_sach_chuong" bên dưới phải có đúng chính xác ${so_chuong} phần tử chương, không được phép tự tiện thêm bớt bất kỳ chương nào ngoài số lượng này).
5. Xây dựng Bản Đồ Lưu Trữ Lõi Bất Biến (Lorebook) bao gồm các quy luật sinh tồn, hệ sinh thái, bối cảnh lịch sử, hoặc nguyên tắc cốt lõi của thế giới này. Trình bày dưới dạng Markdown.

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

Hãy viết cực kỳ hấp dẫn, logic, áp đặt các quy luật sinh tồn khắc nghiệt. Trả về đúng cấu trúc JSON nêu trên.`;

      const result = await generateJsonWithRetry(prompt, keysToUse);
      return NextResponse.json({ ...result, usedApiKey: globalLastWorkingKey });
    } 
    

    // --- NODE 2: GENERATE_CHAPTER_OUTLINE ---
    if (requestType === 'GENERATE_CHAPTER_OUTLINE') {
      const { ten_tac_pham, dan_y_tong_the, lorebook, tri_nho_ngan_han, tom_tat_cuon_chieu, chuong_so } = payload;
      const prompt = `Bạn là Trợ lý Biên kịch Sản xuất kịch bản tiểu thuyết chuyên nghiệp.
Tác phẩm: "${ten_tac_pham}"
Chương hiện tại cần lên dàn ý: Chương ${chuong_so}

--- LOREBOOK ---
${lorebook || 'Không có'}

--- DÀN Ý TỔNG THỂ ---
${dan_y_tong_the || 'Không có'}

--- TRÍ NHỚ CUỐN CHIẾU & NGẮN HẠN ---
Cuốn chiếu: ${tom_tat_cuon_chieu || 'Chưa có'}
Ngắn hạn: ${(tri_nho_ngan_han && tri_nho_ngan_han.length > 0) ? tri_nho_ngan_han.join('\n') : 'Chưa có'}

Dựa trên các dữ liệu trên, hãy suy luận logic và đưa ra Gợi Ý Dàn Ý Chương chi tiết cho chương tiếp theo (Chương ${chuong_so}). Đảm bảo tình tiết phát triển tự nhiên, hấp dẫn, cực kỳ sáng tạo và KHÔNG BỊ LẶP LẠI cốt truyện cũ (ví dụ: không lặp lại việc mài dao rỉ sét nếu đã làm ở chương trước).
Chỉ trả về văn bản dàn ý (khoảng 100-200 từ), không bọc markdown hay json.`;
      const aiResponse = await callGemini(prompt, keysToUse);
      return NextResponse.json({ dan_y: aiResponse.trim(), usedApiKey: globalLastWorkingKey });
    }

    if (requestType === 'WRITE_CHAPTER') {
      const { 
        ten_tac_pham, 
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        dan_y_tong_the, 
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        nhan_vat, 
        chuong_hien_tai, 
        tom_tat_cuon_chieu, 
        tri_nho_ngan_han, 
        lorebook,
        so_tu_chuong,
        noi_dung_hien_tai
      } = payload;

      const wordGoal = so_tu_chuong ? Number(so_tu_chuong) : 4250;
      const wordMin = Math.round(wordGoal * 0.92);
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const wordMax = Math.round(wordGoal * 1.08);

      const prompt = `Bạn là Trợ lý Biên kịch Sản xuất kịch bản tiểu thuyết mạt thế chuyên nghiệp bậc nhất.
Hãy viết kịch bản chi tiết văn học đa giác quan cho Chương ${chuong_hien_tai.so_chuong}: "${chuong_hien_tai.tieu_de}" thuộc tác phẩm "${ten_tac_pham}".

--- BỐI CẢNH VÀ TRÍ NHỚ VĨ MÔ (ROLLING CONTEXT SYSTEM) ---
1. LÕI BẤT BIẾN (LOREBOOK):
${lorebook || 'Luật thế giới mạt thế cực lạnh.'}

2. TÓM TẮT CUỐN CHIẾU CÁC CHƯƠNG TRƯỚC (DƯỚI 500 TỪ):
${tom_tat_cuon_chieu || 'Chưa viết chương trước nào.'}

3. TRÍ NHỚ NGẮN HẠN (3 CHƯƠNG GẦN NHẤT):
${(tri_nho_ngan_han && tri_nho_ngan_han.length > 0) ? tri_nho_ngan_han.join('\n') : 'Chưa có trí nhớ ngắn hạn.'}

DÀN Ý SỰ KIỆN CHƯƠNG HIỆN TẠI:
${chuong_hien_tai.dan_y}

YÊU CẦU KỸ THUẬT KHI TẠO TÁC KỊCH BẢN CHI TIẾT:
1. TUYỆT ĐỐI CẤM in lại, nhại lại hoặc chép lại Lõi Bất Biến (Lorebook), Trí nhớ, Dàn ý hay bất kỳ thông tin nào từ BỐI CẢNH VÀ TRÍ NHỚ VĨ MÔ vào trong kịch bản. Chữ duy nhất bạn xuất ra phải là NỘI DUNG KỊCH BẢN THUẦN TÚY.
2. Viết dưới dạng văn học/kịch bản sạch sẽ nhất có thể. CẤM dùng các ghi chú đạo diễn (No Notes) hay hiệu ứng âm thanh/hình ảnh (No FX) như [âm thanh gió rít], (Cười)... 
3. TUYỆT ĐỐI TUÂN THỦ: Tên mỗi cảnh phải được bọc trong DẤU NGOẶC VUÔNG trên một dòng riêng. Ví dụ:
[CẢNH 1: NỘI CẢNH. CĂN HỘ TỒI TÀN - ĐÊM]
Tuyệt đối KHÔNG dùng ký tự ** hay các định dạng Markdown khác bên trong dấu ngoặc vuông này.
4. Viết cực kỳ sống động đa giác quan. MIÊU TẢ CỰC KỲ CHẬM RÃI VÀ CHI TIẾT từng hành động, từng diễn biến tâm lý. Đừng tóm tắt, hãy kể chuyện theo thời gian thực (real-time pacing).
5. Đạt chuẩn Cổng Từ (Word-Gate) - MỤC TIÊU SINH TỬ: Bạn BẮT BUỘC phải viết kịch bản vô cùng dài, siêu chi tiết. Hãy kéo dài hội thoại, độc thoại và tả cảnh để độ dài văn bản đạt lý tưởng khoảng ${wordGoal} từ (TUYỆT ĐỐI KHÔNG ĐƯỢC PHÉP VIẾT NGẮN DƯỚI ${wordMin} TỪ).
6. ⚠️ MỆNH LỆNH TUYỆT ĐỐI VỀ PHÂN CẢNH: Bạn BẮT BUỘC PHẢI chia toàn bộ nội dung kịch bản thành TỐI THIỂU 3 đến 5 phân cảnh riêng biệt. Mỗi phân cảnh PHẢI bắt đầu bằng một dòng tag duy nhất trên một dòng riêng biệt theo cú pháp: [CẢNH X: NỘI CẢNH/NGOẠI CẢNH. ĐỊA ĐIỂM CỤ THỂ - THỜI GIAN]. Phân bổ ĐỀU số từ mục tiêu (${wordGoal} từ) cho tất cả các cảnh. TUYỆT ĐỐI CẤM viết toàn bộ chương thành chỉ 1 hoặc 2 cảnh duy nhất. Nếu vi phạm, kịch bản sẽ bị từ chối hoàn toàn.
${noi_dung_hien_tai ? '\n--- PHẦN NỘI DUNG ĐANG VIẾT DANG DỞ ---\n' + noi_dung_hien_tai + '\n\nBẠN ĐANG Ở CHẾ ĐỘ VIẾT TIẾP. HÃY ĐỌC PHẦN DANG DỞ TRÊN VÀ BẮT ĐẦU VIẾT NỐI TIẾP VÀO ĐÓ.' : '\nĐừng thêm tiêu đề chương, hãy bắt đầu viết trực tiếp nội dung chương truyện với Cảnh 1 ngay.'}`;

      const aiResponse = await callGemini(prompt, keysToUse);
      return NextResponse.json({ noi_dung: aiResponse, usedApiKey: globalLastWorkingKey });
    }

    // --- NODE: EXPAND_SCENE ---
    if (requestType === 'EXPAND_SCENE') {
      const {
        ten_tac_pham,
        chuong_hien_tai,
        lorebook,
        previous_scene_content,
        current_scene_content,
        next_scene_content
      } = payload;

      const prompt = `Bạn là Trợ lý Biên kịch Sản xuất kịch bản tiểu thuyết mạt thế chuyên nghiệp bậc nhất.
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

      const aiResponse = await callGemini(prompt, keysToUse);
      return NextResponse.json({ expanded_content: aiResponse, usedApiKey: globalLastWorkingKey });
    }

    // --- NODE: EXTRACT_CHARACTERS ---
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
      const result = await generateJsonWithRetry(prompt, keysToUse);
      return NextResponse.json({ ...result, usedApiKey: globalLastWorkingKey });
    }

    // --- NODE 4: COMMIT_MEMORY ---
    if (requestType === 'COMMIT_MEMORY') {
      const { 
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        ten_tac_pham, 
        chuong_hien_tai, 
        noi_dung_kich_ban, 
        tom_tat_cuon_chieu, 
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        tri_nho_ngan_han, 
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        lorebook 
      } = payload;

      const prompt = `Bạn là Trợ lý Biên kịch kiêm Bộ Nén Ký Ức logic mạt thế xuất sắc.
Hãy đọc kỹ nội dung kịch bản Chương ${chuong_hien_tai.so_chuong} vừa viết dưới đây và thực hiện cập nhật toàn bộ trạng thái Trí nhớ vĩ mô của hệ thống.

--- NỘI DUNG CHƯƠNG VỪA VIẾT ---
${noi_dung_kich_ban}

--- TRẠNG THÁI BỘ NHỚ VĨ MÔ TRƯỚC ĐÓ ---
- Tóm tắt cuốn chiếu cũ: ${tom_tat_cuon_chieu}

Nhiệm Vụ Của Bạn:
1. **Nén cốt truyện (Tóm tắt cuốn chiếu)**: Tổng hợp nội dung chương mới này vào tóm tắt cuốn chiếu cốt truyện cũ. Đảm bảo bản tóm tắt tổng thể mới sau khi tích lũy vẫn dưới 500 từ, liền mạch và súc tích.
2. **Trí nhớ ngắn hạn**: Trả về một câu tóm tắt cực ngắn (dưới 30 từ) mô tả cột mốc cảm xúc hoặc sự kiện cốt lõi của chương vừa rồi.

YÊU CẦU ĐỊNH DẠNG:
- Trả về định dạng JSON duy nhất và TUYỆT ĐỐI không bao bọc bởi tag markdown \`\`\`json hay text thừa. Khối JSON phải khớp chính xác cấu trúc sau:
{
  "tom_tat_cuon_chieu": "Bản tóm tắt cuốn chiếu mới sau khi nén chương này (dưới 500 từ)",
  "tri_nho_ngan_han_moi": "Tóm tắt cực ngắn 1 câu của chương vừa rồi (dưới 30 từ)",
  "lorebook_cap_nhat": "Nếu có luật lệ mạt thế mới được khám phá ra trong chương thì thêm vào Lorebook, ngược lại trả về nguyên văn Lorebook cũ."
}`;
      const result = await generateJsonWithRetry(prompt, keysToUse);
      return NextResponse.json({ ...result, usedApiKey: globalLastWorkingKey });
    }

    // --- NODE: GENERATE_CHARACTER_PROMPT (Sinh toàn bộ hồ sơ & prompt nhân vật) ---
    if (requestType === 'GENERATE_CHARACTER_PROMPT') {
      const { name, gioi_tinh, quan_ao, so_thich, thoi_quen, dan_y_tong_the, lorebook } = payload;
      const prompt = `Bạn là một Chuyên Gia Biên Kịch kiêm Phác Họa Concept Art Nhân Vật AI.
Dựa trên thông tin nhân vật: "${name}" và bối cảnh tác phẩm dưới đây:
--- DÀN Ý TỔNG THỂ ---
${dan_y_tong_the || 'Trống'}

--- LOREBOOK ---
${lorebook || 'Trống'}

Nhiệm vụ của bạn là:
1. Hãy tìm kiếm/suy luận ra đặc điểm phù hợp cho nhân vật "${name}".
2. Sáng tạo chi tiết và trả về các thông tin: Giới tính, Trang phục (outfit phù hợp mạt thế), Sở thích, Thói quen đặc biệt, và một Prompt tiếng Anh chi tiết để vẽ ảnh chân dung nhân vật này (concept art, Unreal Engine 5, 8k resolution).
3. Sử dụng thông tin người dùng đã nhập nếu có để phát triển thêm:
   - Giới tính đã nhập: ${gioi_tinh || 'chưa nhập'}
   - Trang phục đã nhập: ${quan_ao || 'chưa nhập'}
   - Sở thích đã nhập: ${so_thich || 'chưa nhập'}
   - Thói quen đã nhập: ${thoi_quen || 'chưa nhập'}

Hãy trả về định dạng JSON duy nhất và TUYỆT ĐỐI không bao bọc bởi tag markdown \`\`\`json hay text thừa. Khối JSON phải khớp chính xác cấu trúc sau:
{
  "gioi_tinh": "Mô tả ngắn gọn giới tính (ví dụ: Nam, khoảng 25 tuổi)",
  "quan_ao": "Mô tả chi tiết trang phục của nhân vật phù hợp bối cảnh",
  "so_thich": "Mô tả ngắn gọn sở thích/phong cách",
  "thoi_quen": "Mô tả thói quen hoặc đặc điểm đặc biệt",
  "prompt": "Detailed English concept art prompt of the character for Stable Diffusion/Midjourney..."
}`;

      const result = await generateJsonWithRetry(prompt, keysToUse);
      return NextResponse.json({ ...result, usedApiKey: globalLastWorkingKey });
    }

    // --- NODE: GENERATE_CHARACTER_PROMPT_ONLY (Chỉ sinh/tạo lại prompt ngoại hình khi bị vi phạm chính sách) ---
    if (requestType === 'GENERATE_CHARACTER_PROMPT_ONLY') {
      const { name, gioi_tinh, quan_ao, so_thich, thoi_quen } = payload;
      const prompt = `Bạn là một Chuyên Gia Thiết Kế Concept Art và Prompt Nhân Vật AI (Stable Diffusion/Midjourney).
Hãy tạo một Prompt tiếng Anh chi tiết, an toàn, không chứa từ nhạy cảm hay bạo lực (tránh lỗi vi phạm chính sách safety filter) để phác họa ngoại hình của nhân vật sau đây:
- Tên nhân vật: ${name}
- Giới tính: ${gioi_tinh || 'không rõ'}
- Trang phục/Quần áo: ${quan_ao || 'không rõ'}
- Sở thích/Phong cách: ${so_thich || 'không rõ'}
- Thói quen/Đặc điểm đặc biệt: ${thoi_quen || 'không rõ'}

YÊU CẦU BẮT BUỘC:
1. Viết prompt hoàn toàn bằng tiếng Anh chi tiết.
2. Tập trung vào diện mạo, biểu cảm khuôn mặt, vóc dáng, trang phục, và ánh sáng.
3. Đặt trong bối cảnh mạt thế cyberpunk Neo-Veridia (neon lights, dark atmosphere, gritty, highly detailed, Unreal Engine 5 render, character concept art).
4. Đảm bảo từ ngữ hoàn toàn an toàn, lành mạnh để vượt qua mọi bộ lọc chính sách.
5. Chỉ trả về chuỗi prompt tiếng Anh duy nhất, không giải thích gì thêm, không bọc markdown.`;

      const aiResponse = await callGemini(prompt, keysToUse);
      return NextResponse.json({ prompt: aiResponse.trim(), usedApiKey: globalLastWorkingKey });
    }

    // --- NODE: REGENERATE_PROMPT (Viết lại prompt bị lỗi/vi phạm chính sách) ---
    if (requestType === 'REGENERATE_PROMPT') {
      const { sentence, currentPrompt, style, characterReferences } = payload;
      
      let characterInstructions = '';
      if (characterReferences && Object.keys(characterReferences).length > 0) {
        characterInstructions = `\n--- THAM CHIẾU NHÂN VẬT QUAN TRỌNG (CHARACTER VISUAL REFERENCES) ---\n`;
        for (const [name, info] of Object.entries(characterReferences)) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const c = info as any;
          characterInstructions += `- Nhân vật: "${name}" -> Ngoại hình: ${c.prompt || ''}\n`;
        }
      }

      const prompt = `Bạn là một Chuyên Gia Thiết Kế Prompt Vẽ Ảnh AI (Stable Diffusion/Midjourney) chuyên nghiệp.
      
Nhiệm vụ của bạn là VIẾT LẠI (Sửa chữa/Tối ưu) một Prompt vẽ ảnh bị lỗi hoặc vi phạm chính sách nội dung (safety blocked).

--- CÂU GỐC TRONG KỊCH BẢN ---
"${sentence}"

--- PROMPT CŨ BỊ LỖI ---
"${currentPrompt}"

--- PHONG CÁCH NGHỆ THUẬT (VISUAL DNA STYLE) ---
${style || 'Cinematic Dark Cyberpunk Sci-Fi Fantasy'}
${characterInstructions}

YÊU CẦU BẮT BUỘC VỀ SỰ LIÊN KẾT:
1. Hãy viết lại Prompt này bằng tiếng Anh thật an toàn, tránh vi phạm chính sách nội dung (safety block) nhưng vẫn bám sát nội dung Câu Gốc.
2. Tính nhất quán phong cách (Visual DNA): Prompt mới BẮT BUỘC phải kế thừa triệt để Phong Cách Nghệ Thuật (Visual DNA) được cung cấp ở trên.
3. Tính nhất quán nhân vật: Nếu câu gốc có nhắc đến tên nhân vật đã được cung cấp ở mục THAM CHIẾU NHÂN VẬT, bạn BẮT BUỘC phải kết hợp đầy đủ đặc tả ngoại hình của họ vào Prompt.
4. Chất lượng đầu ra: Sử dụng các thẻ chất lượng (Unreal Engine 5, 8k, dramatic lighting, epic cinematic view).
5. Chỉ trả về chuỗi văn bản Prompt tiếng Anh mới duy nhất, không giải thích gì thêm, không bọc markdown.`;

      const aiResponse = await callGemini(prompt, keysToUse);
      return NextResponse.json({ prompt: aiResponse.trim(), usedApiKey: globalLastWorkingKey });
    }

    return NextResponse.json({ error: 'Loại yêu cầu không hợp lệ.' }, { status: 400 });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    console.error('Lỗi API Generate:', err);
    return NextResponse.json(
      { error: err.message || 'Có lỗi xảy ra trong quá trình sinh dữ liệu từ AI.' },
      { status: 500 }
    );
  }
}
