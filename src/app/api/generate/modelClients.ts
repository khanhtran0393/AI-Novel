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
export function cleanAndParseJson(text: string) {
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

export function getLastWorkingApiKey(): string {
  return globalLastWorkingKey;
}

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

export async function callActiveModel(prompt: string, apiKeyOrKeys: string | string[], model: string = 'gemini') {
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

export type VisionInput = { name?: string; mimeType: string; data: string };

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

export async function callActiveVision(prompt: string, images: VisionInput[], apiKeyOrKeys: string | string[], model: string = 'gemini') {
  if (model === 'gpt4o') return callOpenAIVision(prompt, images, apiKeyOrKeys);
  if (model === 'llama') return callGrokVision(prompt, images, apiKeyOrKeys);
  return callGeminiVision(prompt, images, apiKeyOrKeys);
}

// Luồng kiểm tra chéo (Cross-check thread) tự động phát hiện lỗi định dạng JSON và thử lại
export async function generateJsonWithRetry(prompt: string, keysToUse: string[], maxRetries = 2, model: string = 'gemini') {
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
