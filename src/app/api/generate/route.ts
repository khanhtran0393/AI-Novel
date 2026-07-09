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
  extractHookFromScript,
  scoreNarrativePsychScript,
  injectHumanJokeAsides,
  countHumanJokeAsides,
} from '@/lib/youtubeSafe';

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

async function callOpenAI(prompt: string, apiKeyOrKeys: string | string[]) {
  let keys = Array.isArray(apiKeyOrKeys) ? apiKeyOrKeys.filter(Boolean) : [apiKeyOrKeys].filter(Boolean);
  if (keys.length === 0) {
    throw new Error('Không có OpenAI API Key nào hợp lệ để sử dụng.');
  }

  const models = ['gpt-4o', 'gpt-4o-mini'];
  let lastError: any = null;

  for (const apiKey of keys) {
    for (const model of models) {
      try {
        console.log(`[OpenAI API] Thử gọi mô hình: ${model} ...`);
        const response = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`
          },
          body: JSON.stringify({
            model: model,
            messages: [{ role: 'user', content: prompt }],
            temperature: 0.85,
            max_tokens: 4096
          })
        });

        if (response.ok) {
          const data = await response.json();
          const text = data.choices?.[0]?.message?.content;
          if (text) return text;
        } else {
          const errorData = await response.json().catch(() => ({}));
          throw new Error(errorData.error?.message || 'Lỗi không xác định từ OpenAI API');
        }
      } catch (e: any) {
        lastError = e;
        console.warn(`[OpenAI API] Thất bại với model ${model}: ${e.message}`);
      }
    }
  }
  throw lastError || new Error('Tất cả API Key hoặc Model của OpenAI đều thất bại.');
}

async function callGroq(prompt: string, apiKeyOrKeys: string | string[]) {
  let keys = Array.isArray(apiKeyOrKeys) ? apiKeyOrKeys.filter(Boolean) : [apiKeyOrKeys].filter(Boolean);
  if (keys.length === 0) {
    throw new Error('Không có Groq API Key nào hợp lệ để sử dụng.');
  }

  const models = ['llama-3.3-70b-versatile', 'llama3-70b-8192', 'llama3-8b-8192'];
  let lastError: any = null;

  for (const apiKey of keys) {
    for (const model of models) {
      try {
        console.log(`[Groq API] Thử gọi mô hình: ${model} ...`);
        const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`
          },
          body: JSON.stringify({
            model: model,
            messages: [{ role: 'user', content: prompt }],
            temperature: 0.85,
            max_tokens: 4096
          })
        });

        if (response.ok) {
          const data = await response.json();
          const text = data.choices?.[0]?.message?.content;
          if (text) return text;
        } else {
          const errorData = await response.json().catch(() => ({}));
          throw new Error(errorData.error?.message || 'Lỗi không xác định từ Groq API');
        }
      } catch (e: any) {
        lastError = e;
        console.warn(`[Groq API] Thất bại với model ${model}: ${e.message}`);
      }
    }
  }
  throw lastError || new Error('Tất cả API Key hoặc Model của Groq đều thất bại.');
}

async function callGrok(prompt: string, apiKeyOrKeys: string | string[]) {
  let keys = Array.isArray(apiKeyOrKeys) ? apiKeyOrKeys.filter(Boolean) : [apiKeyOrKeys].filter(Boolean);
  if (keys.length === 0) {
    throw new Error('Không có Grok API Key nào hợp lệ để sử dụng.');
  }

  const models = ['grok-2-1212', 'grok-beta', 'grok-2'];
  let lastError: any = null;

  for (const apiKey of keys) {
    for (const model of models) {
      try {
        console.log(`[xAI Grok API] Thử gọi mô hình: ${model} ...`);
        const response = await fetch('https://api.x.ai/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`
          },
          body: JSON.stringify({
            model: model,
            messages: [{ role: 'user', content: prompt }],
            temperature: 0.85
          })
        });

        if (response.ok) {
          const data = await response.json();
          const text = data.choices?.[0]?.message?.content;
          if (text) return text;
        } else {
          const errorData = await response.json().catch(() => ({}));
          throw new Error(errorData.error?.message || 'Lỗi không xác định từ xAI Grok API');
        }
      } catch (e: any) {
        lastError = e;
        console.warn(`[xAI Grok API] Thất bại với model ${model}: ${e.message}`);
      }
    }
  }
  throw lastError || new Error('Tất cả API Key hoặc Model của Grok đều thất bại.');
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

async function callActiveModel(prompt: string, apiKeyOrKeys: string | string[], model: string = 'gemini') {
  if (model === 'gpt4o') {
    return await callOpenAI(prompt, apiKeyOrKeys);
  } else if (model === 'llama') {
    const firstKey = Array.isArray(apiKeyOrKeys) ? apiKeyOrKeys[0] : apiKeyOrKeys;
    return firstKey && String(firstKey).startsWith('gsk_')
      ? await callGroq(prompt, apiKeyOrKeys)
      : await callGrok(prompt, apiKeyOrKeys);
  } else {
    return await callGemini(prompt, apiKeyOrKeys);
  }
}

type VisionInput = { name?: string; mimeType: string; data: string };

async function callOpenAIVision(prompt: string, images: VisionInput[], apiKeyOrKeys: string | string[]) {
  const keys = Array.isArray(apiKeyOrKeys) ? apiKeyOrKeys.filter(Boolean) : [apiKeyOrKeys].filter(Boolean);
  if (keys.length === 0) throw new Error('Khong co OpenAI API Key de phan tich anh.');

  let lastError: unknown = null;
  for (const apiKey of keys) {
    try {
      const content = [
        { type: 'text', text: prompt },
        ...images.map((image) => ({
          type: 'image_url',
          image_url: { url: `data:${image.mimeType};base64,${image.data}` },
        })),
      ];
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: 'gpt-4o',
          messages: [{ role: 'user', content }],
          temperature: 0.35,
          max_tokens: 2600,
        }),
      });
      if (response.ok) {
        const data = await response.json();
        const text = data.choices?.[0]?.message?.content;
        if (text) return text;
      } else {
        const err = await response.json().catch(() => ({}));
        lastError = new Error(err.error?.message || `OpenAI vision error ${response.status}`);
      }
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError || new Error('OpenAI vision failed.');
}

async function callGeminiVision(prompt: string, images: VisionInput[], apiKeyOrKeys: string | string[]) {
  const keys = Array.isArray(apiKeyOrKeys) ? apiKeyOrKeys.filter(Boolean) : [apiKeyOrKeys].filter(Boolean);
  if (keys.length === 0) throw new Error('Khong co Google API Key de phan tich anh.');

  const models = ['gemini-2.5-flash', 'gemini-2.5-pro'];
  let lastError: unknown = null;
  for (const apiKey of keys) {
    for (const visionModel of models) {
      try {
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${visionModel}:generateContent?key=${apiKey}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{
              parts: [
                { text: prompt },
                ...images.map((image) => ({
                  inlineData: { mimeType: image.mimeType, data: image.data },
                })),
              ],
            }],
            generationConfig: { temperature: 0.35, maxOutputTokens: 2600 },
          }),
        });
        if (response.ok) {
          const data = await response.json();
          const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
          if (text) return text;
        } else {
          const err = await response.json().catch(() => ({}));
          lastError = new Error(err.error?.message || `Gemini vision error ${response.status}`);
        }
      } catch (err) {
        lastError = err;
      }
    }
  }
  throw lastError || new Error('Gemini vision failed.');
}

async function callGrokVision(prompt: string, images: VisionInput[], apiKeyOrKeys: string | string[]) {
  const keys = Array.isArray(apiKeyOrKeys) ? apiKeyOrKeys.filter(Boolean) : [apiKeyOrKeys].filter(Boolean);
  if (keys.length === 0) throw new Error('Khong co Grok API Key de phan tich anh.');

  let lastError: unknown = null;
  for (const apiKey of keys) {
    try {
      const content = [
        { type: 'text', text: prompt },
        ...images.map((image) => ({
          type: 'image_url',
          image_url: { url: `data:${image.mimeType};base64,${image.data}` },
        })),
      ];
      const response = await fetch('https://api.x.ai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: 'grok-2-vision-1212',
          messages: [{ role: 'user', content }],
          temperature: 0.35,
          max_tokens: 2600,
        }),
      });
      if (response.ok) {
        const data = await response.json();
        const text = data.choices?.[0]?.message?.content;
        if (text) return text;
      } else {
        const err = await response.json().catch(() => ({}));
        lastError = new Error(err.error?.message || `Grok vision error ${response.status}`);
      }
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError || new Error('Grok vision failed.');
}

async function callActiveVision(prompt: string, images: VisionInput[], apiKeyOrKeys: string | string[], model: string = 'gemini') {
  if (model === 'gpt4o') return callOpenAIVision(prompt, images, apiKeyOrKeys);
  if (model === 'llama') return callGrokVision(prompt, images, apiKeyOrKeys);
  return callGeminiVision(prompt, images, apiKeyOrKeys);
}

// Luồng kiểm tra chéo (Cross-check thread) tự động phát hiện lỗi định dạng JSON và thử lại
async function generateJsonWithRetry(prompt: string, keysToUse: string[], maxRetries = 2, model: string = 'gemini') {
  let lastError = null;
  for (let i = 0; i <= maxRetries; i++) {
    try {
      const aiResponse = await callActiveModel(prompt, keysToUse, model);
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
    const { requestType, apiKey: clientApiKey, apiKeys: clientApiKeys, model, payload } = body;

    // Thiết lập danh sách API Key hợp lệ
    let keysToUse: string[] = [];
    if (Array.isArray(clientApiKeys) && clientApiKeys.length > 0) {
      keysToUse = clientApiKeys.filter(Boolean);
    } else if (clientApiKey) {
      keysToUse = [clientApiKey];
    } else if (process.env.GEMINI_API_KEY) {
      keysToUse = [process.env.GEMINI_API_KEY];
    }

    if (keysToUse.length === 0 && model !== 'aistudio') {
      return NextResponse.json(
        { error: 'Thiếu API Key. Vui lòng nhập ít nhất một API Key ở góc trên bên phải hoặc cấu hình biến môi trường server.' },
        { status: 400 }
      );
    }

    if (requestType === 'ANALYZE_VISUAL_DNA') {
      const images = Array.isArray(payload?.images) ? payload.images : [];
      if (images.length < 4 || images.length > 6) {
        return NextResponse.json({ error: 'Can 4-6 anh tham chieu de phan tich DNA thi giac.' }, { status: 400 });
      }

      const visionPrompt = `
You are a strict senior art director extracting a reusable visual DNA from 4-6 reference images.

Return only one dense English visual style prompt, no markdown, no bullet list, no labels.
Write 150-230 words as one practical prompt fragment that can be prepended to image and video prompts.

Preserve every visible style signal from the references. Cover all of these if present:
- visual genre, medium, and rendering language
- character design grammar, face/body treatment, wardrobe, material details, and pose energy
- color palette, contrast, saturation, skin tone handling, and accent colors
- lighting direction, softness, shadow behavior, reflections, glow, weather or atmosphere
- camera distance, lens feeling, framing, angle, depth layering, and composition habits
- environment/background treatment, props, architecture, texture language, surface wear, and scale
- mood, emotion, pacing, cinematic rhythm, and the kind of realism or stylization used
- avoid-list phrased naturally: what the generated image should not drift into

Do not mention the uploaded images directly. Do not include generic quality tags such as 8k, highly detailed, photorealistic, Unreal Engine, masterpiece.
Do not summarize into a short tag cluster. The output must be complete enough for a downstream image prompt to inherit the full visual identity without seeing the references.
`;

      const aiResponse = await callActiveVision(visionPrompt, images, keysToUse, model);
      const visualDnaPrompt = aiResponse.replace(/```[\s\S]*?```/g, '').trim();
      return NextResponse.json({ visualDnaPrompt, usedApiKey: globalLastWorkingKey });
    }

    // --- NODE 0: GENERATE_IDEA ---
    if (requestType === 'GENERATE_IDEAS' || requestType === 'GENERATE_IDEA') {
      const { chu_de, phong_cach } = payload || {};
      const prompt = `Bạn là Trợ lý Biên kịch sáng tạo chuyên nghiệp bậc nhất.
Với Khối Chủ đề: "${chu_de || 'Sinh tồn mạt thế'}" và Khối Phong cách: "${phong_cach || 'Kịch tính, Tăm tối'}".
Hãy sáng tạo ra một ý tưởng cốt truyện/bối cảnh (khoảng 4-6 câu) thật độc đáo, chi tiết, có chiều sâu, mô tả nghịch cảnh mà nhân vật chính đang phải đối mặt. Hãy để trí tưởng tượng bay bổng, không bị gò bó vào bất kỳ lối mòn nào. Không trả về Markdown, chỉ trả về văn bản thuần túy.`;
      const aiResponse = await callActiveModel(prompt, keysToUse, model);
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

      console.log(`[Prompt Generator] Đã sinh thành công ${formattedPrompts.length} prompt tương ứng với ${rawSentences.length} câu trên tổng thời lượng ${totalDuration}s.`);

      return NextResponse.json({ prompts: formattedPrompts, usedApiKey: globalLastWorkingKey });
    }

    // --- NODE 1: GENERATE_OUTLINE ---
    if (requestType === 'GENERATE_OUTLINE') {
      const { chu_de, phong_cach, mo_ta, so_chuong, ngon_ngu } = payload;

      const prompt = `Bạn là một Trợ lý Biên kịch Sản xuất tiểu thuyết mạt thế, sinh tồn, huyền huyễn xuất sắc bậc nhất.
Dựa trên các tham số cấu hình sau:
- Chủ đề: ${chu_de}
- Phong cách: ${phong_cach}
- Ý tưởng cốt truyện gốc: ${mo_ta || 'Ngẫu nhiên bối cảnh hoang phế độc đáo'}
- Số lượng chương cần phân bổ: ${so_chuong} chương (BẮT BUỘC: chỉ được phép lên dàn ý đúng chính xác ${so_chuong} chương, không thừa không thiếu)
- Ngôn ngữ đầu ra: ${ngon_ngu || 'Tiếng Việt'}

Nhiệm vụ của bạn là:
1. Đề xuất một tên tác phẩm bằng ${ngon_ngu || 'Tiếng Việt'} kịch tính, đậm chất mạt thế, sinh tồn.
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

      const result = await generateJsonWithRetry(prompt, keysToUse, 2, model);
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
${truncateOutline(dan_y_tong_the || 'Không có')}

--- TRÍ NHỚ CUỐN CHIẾU & NGẮN HẠN ---
Cuốn chiếu: ${tom_tat_cuon_chieu || 'Chưa có'}
Ngắn hạn: ${(tri_nho_ngan_han && tri_nho_ngan_han.length > 0) ? tri_nho_ngan_han.join('\n') : 'Chưa có'}

Dựa trên các dữ liệu trên, hãy suy luận logic và đưa ra Gợi Ý Dàn Ý Chương chi tiết cho chương tiếp theo (Chương ${chuong_so}). Đảm bảo tình tiết phát triển tự nhiên, hấp dẫn, cực kỳ sáng tạo và KHÔNG BỊ LẶP LẠI cốt truyện cũ (ví dụ: không lặp lại việc mài dao rỉ sét nếu đã làm ở chương trước).
Chỉ trả về văn bản dàn ý (khoảng 100-200 từ), không bọc markdown hay json.`;
      const aiResponse = await callActiveModel(prompt, keysToUse, model);
      return NextResponse.json({ dan_y: aiResponse.trim(), usedApiKey: globalLastWorkingKey });
    }

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
        usedApiKey: globalLastWorkingKey,
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
        usedApiKey: globalLastWorkingKey,
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
        usedApiKey: globalLastWorkingKey,
      });
    }

    // --- NODE: PLAN_ARC (Kiến Trúc Sư) ---
    if (requestType === 'PLAN_ARC') {
      const { ten_tac_pham, lorebook, danh_sach_chuong_da_viet, cung_hien_tai, so_chuong_moi_cung } = payload;
      const prompt = `Bạn là Kiến trúc sư của tiểu thuyết "${ten_tac_pham}".
Hãy lập Dàn Ý cho Arc (Cung/Tập) ${cung_hien_tai + 1} gồm ${so_chuong_moi_cung} chương tiếp theo.

1. LÕI BẤT BIẾN:
${lorebook}

2. TÓM TẮT CÁC CHƯƠNG ĐÃ VIẾT TRƯỚC ĐÓ:
${danh_sach_chuong_da_viet}

Dựa vào diễn biến hiện tại, hãy lập dàn ý chi tiết sự kiện cho ${so_chuong_moi_cung} chương kế tiếp.

TRẢ VỀ JSON:
{
  "danh_sach_chuong": [
    {
      "so_chuong": number,
      "tieu_de": "Tên chương",
      "dan_y": "Tóm tắt sự kiện xảy ra trong chương này (càng chi tiết càng tốt)"
    }
  ]
}`;
      const result = await generateJsonWithRetry(prompt, keysToUse, 2, model);
      return NextResponse.json({ ...result, usedApiKey: globalLastWorkingKey });
    }

    // --- NODE: EXPAND_SCENE ---
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
      return NextResponse.json({ expanded_content: aiResponse, usedApiKey: globalLastWorkingKey });
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
      return NextResponse.json({ rewritten_content: rewritten, usedApiKey: globalLastWorkingKey });
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
      const result = await generateJsonWithRetry(prompt, keysToUse, 2, model);
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
        lorebook,
        world_state,
        da_dien_ra_entities,
      } = payload;

      const prompt = `Bạn là Trợ lý Biên kịch kiêm Bộ Nén Ký Ức logic mạt thế xuất sắc.
Hãy đọc kỹ nội dung kịch bản Chương ${chuong_hien_tai.so_chuong} vừa viết dưới đây và thực hiện cập nhật toàn bộ trạng thái Trí nhớ vĩ mô của hệ thống.

--- NỘI DUNG CHƯƠNG VỪA VIẾT ---
${noi_dung_kich_ban}

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
        usedApiKey: globalLastWorkingKey,
      });
    }

    // --- NODE: GENERATE_CHARACTER_PROMPT (Hồ sơ đầy đủ + identity lock + 4 góc + biểu cảm) ---
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
      return NextResponse.json({ ...result, usedApiKey: globalLastWorkingKey });
    }
    // --- NODE: COMPRESS_CONTEXT ---
    if (requestType === 'COMPRESS_CONTEXT') {
      const { tom_tat_cuon_chieu, tri_nho_ngan_han } = payload;
      const prompt = `Bạn là bộ tổng hợp hồ sơ trí nhớ cho một cuốn tiểu thuyết.
Nhiệm vụ của bạn là nén "Tóm Tắt Cuốn Chiếu" (các chương trước đó) và "Trí Nhớ Ngắn Hạn" (những sự kiện vừa xảy ra) thành một khối dung lượng siêu nhỏ nhưng mang đậm ý nghĩa logic.

--- TÓM TẮT CUỐN CHIẾU HIỆN TẠI ---
${tom_tat_cuon_chieu}

--- TRÍ NHỚ NGẮN HẠN ---
${tri_nho_ngan_han?.join('\n') || ''}

YÊU CẦU BẮT BUỘC:
1. Tổng hợp lại thành một đoạn văn duy nhất, ngắn gọn, súc tích (dưới 300 từ).
2. Giữ lại được tuyến tình cảm, mâu thuẫn chính, và sự kiện mấu chốt để cung cấp cho người viết chương tiếp theo.
3. Chỉ trả về một chuỗi văn bản thuần túy, không bọc trong định dạng JSON. Không có lời chào hay giải thích.`;

      const aiResponse = await callActiveModel(prompt, keysToUse, model);
      return NextResponse.json({ compressedMemory: aiResponse.trim(), usedApiKey: globalLastWorkingKey });
    }

    // --- NODE: IMPORT_FOUNDATION (Thuật toán Kế thừa Di sản) ---
    if (requestType === 'IMPORT_FOUNDATION') {
      const { text_content } = payload;
      const prompt = `Bạn là chuyên gia phân tích tính liên tục của tiểu thuyết. Nhiệm vụ: đọc đoạn văn bản gốc mà người dùng cung cấp (có thể gồm nhiều chương), rồi phân tích ngược để xây dựng lại toàn bộ cài đặt nền tảng cần thiết cho việc tiếp tục viết các chương sau.

Chế độ làm việc: Không sáng tác thêm, tái tạo foundation dựa hoàn toàn vào nội dung gốc, thà chi tiết còn hơn bỏ sót, không bịa đặt quy tắc không có.

VĂN BẢN GỐC:
${text_content}

Yêu cầu định dạng đầu ra (Trọng yếu: Bạn PHẢI trả về ĐÚNG VÀ CHỈ MỘT định dạng JSON nguyên chất theo cấu trúc sau, không bọc markdown \`\`\`json, không văn bản thừa):

{
  "mo_ta": "Mô tả ngắn gọn thể loại, tông điệu, xung đột cốt lõi và mục tiêu của nhân vật chính.",
  "nhan_vat": [
    {
      "name": "Tên nhân vật chính",
      "gioi_tinh": "Nam/Nữ",
      "tuoi": "khoảng tuổi",
      "dang_nguoi": "dáng người",
      "vai_tro": "chính/phụ/phản diện",
      "quan_ao": "trang phục signature",
      "so_thich": "sở thích/phong cách",
      "thoi_quen": "thói quen hành vi",
      "dong_co": "động cơ cốt lõi",
      "giong_thoai": "quirk thoại",
      "ngoai_hinh": "face lock: tóc/mắt/da/xương mặt",
      "dac_diem_nhan_dang": "sẹo/nốt ruồi/xăm/khuyết tật nhìn thấy được",
      "khuet_tat": "khuyết tật nếu có",
      "prompt": "English master identity lock portrait, neutral, front view"
    }
  ],
  "lorebook": {
    "magic_technology": "Quy tắc phép thuật/công nghệ được ám chỉ",
    "geography": "Địa lý, bối cảnh",
    "society": "Cơ cấu xã hội, tổ chức"
  },
  "dan_y_tong_the": [
    {
      "ten_cung": "Tiêu đề cung truyện/arc phân tích ngược",
      "muc_tieu": "Chủ đề cốt lõi",
      "so_chuong_du_kien": 5,
      "mo_ta": "Tóm tắt sự kiện trong cung này"
    }
  ]
}`;
      const aiResponse = await callActiveModel(prompt, keysToUse, model);
      const parsed = cleanAndParseJson(aiResponse);
      return NextResponse.json({ foundation: parsed, usedApiKey: globalLastWorkingKey });
    }

    // --- NODE: GENERATE_CHARACTER_PROMPT_ONLY (Tạo lại master identity lock an toàn) ---
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
