import {
  assertPoolHasCapacity,
  filterAvailableKeys,
  isKeyAvailable,
  keyFingerprint,
  markKeyAttempt,
  markKeyLimited,
  markKeySuccess,
  type KeyLimitKind,
} from '@/lib/apiKeyRotate';

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

  // 5–6. Extract largest JSON block. Prefer the structure that starts first:
  // if `[` comes before `{`, try array first (avoids carving one object out of `[{…},{…}]`
  // which previously produced invalid multi-object fragments or empty normalize).
  const startCurly = cleaned.indexOf('{');
  const endCurly = cleaned.lastIndexOf('}');
  const startSquare = cleaned.indexOf('[');
  const endSquare = cleaned.lastIndexOf(']');

  const tryParseSlice = (start: number, end: number): unknown | undefined => {
    if (start === -1 || end === -1 || end <= start) return undefined;
    const slice = cleaned.substring(start, end + 1);
    for (const candidate of [
      slice,
      (() => {
        try {
          return repairJson(slice);
        } catch {
          return '';
        }
      })(),
      (() => {
        try {
          return cleanJsonStructurally(slice);
        } catch {
          return '';
        }
      })(),
    ]) {
      if (!candidate) continue;
      try {
        return JSON.parse(candidate);
      } catch {
        /* next */
      }
    }
    return undefined;
  };

  const preferArray =
    startSquare !== -1 &&
    (startCurly === -1 || startSquare < startCurly);

  if (preferArray) {
    const arr = tryParseSlice(startSquare, endSquare);
    if (arr !== undefined) return arr;
    const obj = tryParseSlice(startCurly, endCurly);
    if (obj !== undefined) return obj;
  } else {
    const obj = tryParseSlice(startCurly, endCurly);
    if (obj !== undefined) return obj;
    const arr = tryParseSlice(startSquare, endSquare);
    if (arr !== undefined) return arr;
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

function shouldExhaustKey(kind: KeyLimitKind): boolean {
  return kind === 'rpm' || kind === 'rpd' || kind === 'auth';
}

async function callOpenAI(prompt: string, apiKeyOrKeys: string | string[]) {
  // Hard gate: if pool over RPM/RPD → wait message (no force-call)
  assertPoolHasCapacity(apiKeyOrKeys);
  const keys = filterAvailableKeys(apiKeyOrKeys);
  if (keys.length === 0) {
    assertPoolHasCapacity(apiKeyOrKeys);
    throw new Error('Không có OpenAI API Key nào hợp lệ để sử dụng.');
  }

  const models = ['gpt-4o', 'gpt-4o-mini'];
  let lastError: any = null;
  let payloadFatal: Error | null = null;

  for (let i = 0; i < keys.length; i++) {
    const apiKey = keys[i];
    if (!isKeyAvailable(apiKey)) continue;
    for (const model of models) {
      try {
        if (!isKeyAvailable(apiKey)) break;
        console.log(
          `[OpenAI API] RR key ${i + 1}/${keys.length} (${keyFingerprint(apiKey)}) model=${model}`,
        );
        if (!markKeyAttempt(apiKey)) {
          lastError = new Error(
            `Key ${keyFingerprint(apiKey)} đã chạm trần — chuyển key/chờ.`,
          );
          break;
        }
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
          if (text) {
            markKeySuccess(apiKey);
            globalLastWorkingKey = apiKey;
            return text;
          }
        } else {
          const errorData = await response.json().catch(() => ({}));
          const msg = errorData.error?.message || `HTTP ${response.status}`;
          const kind = markKeyLimited(apiKey, msg, response.status);
          lastError = new Error(`[${response.status}] ${msg}`);
          if (kind === 'payload') {
            payloadFatal = lastError;
            // same bad body — stop burning the whole key pool
            throw lastError;
          }
          if (shouldExhaustKey(kind)) break;
        }
      } catch (e: any) {
        lastError = e;
        if (payloadFatal) throw payloadFatal;
        const kind = markKeyLimited(apiKey, e?.message || '', undefined);
        if (shouldExhaustKey(kind)) break;
        console.warn(`[OpenAI API] Thất bại với model ${model}: ${e.message}`);
      }
    }
  }
  throw lastError || new Error('Tất cả API Key hoặc Model của OpenAI đều thất bại.');
}

async function callGroq(prompt: string, apiKeyOrKeys: string | string[]) {
  assertPoolHasCapacity(apiKeyOrKeys);
  const keys = filterAvailableKeys(apiKeyOrKeys);
  if (keys.length === 0) {
    assertPoolHasCapacity(apiKeyOrKeys);
    throw new Error('Không có Groq API Key nào hợp lệ để sử dụng.');
  }

  const models = ['llama-3.3-70b-versatile', 'llama3-70b-8192', 'llama3-8b-8192'];
  let lastError: any = null;
  let payloadFatal: Error | null = null;

  for (let i = 0; i < keys.length; i++) {
    const apiKey = keys[i];
    if (!isKeyAvailable(apiKey)) continue;
    for (const model of models) {
      try {
        if (!isKeyAvailable(apiKey)) break;
        console.log(
          `[Groq API] RR key ${i + 1}/${keys.length} (${keyFingerprint(apiKey)}) model=${model}`,
        );
        if (!markKeyAttempt(apiKey)) {
          lastError = new Error(
            `Key ${keyFingerprint(apiKey)} đã chạm trần — chuyển key/chờ.`,
          );
          break;
        }
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
          if (text) {
            markKeySuccess(apiKey);
            globalLastWorkingKey = apiKey;
            return text;
          }
        } else {
          const errorData = await response.json().catch(() => ({}));
          const msg = errorData.error?.message || `HTTP ${response.status}`;
          const kind = markKeyLimited(apiKey, msg, response.status);
          lastError = new Error(`[${response.status}] ${msg}`);
          if (kind === 'payload') {
            payloadFatal = lastError;
            throw lastError;
          }
          if (shouldExhaustKey(kind)) break;
        }
      } catch (e: any) {
        lastError = e;
        if (payloadFatal) throw payloadFatal;
        const kind = markKeyLimited(apiKey, e?.message || '', undefined);
        if (shouldExhaustKey(kind)) break;
        console.warn(`[Groq API] Thất bại với model ${model}: ${e.message}`);
      }
    }
  }
  throw lastError || new Error('Tất cả API Key hoặc Model của Groq đều thất bại.');
}

async function callGrok(prompt: string, apiKeyOrKeys: string | string[]) {
  assertPoolHasCapacity(apiKeyOrKeys);
  const keys = filterAvailableKeys(apiKeyOrKeys);
  if (keys.length === 0) {
    assertPoolHasCapacity(apiKeyOrKeys);
    throw new Error('Không có Grok API Key nào hợp lệ để sử dụng.');
  }

  const models = ['grok-2-1212', 'grok-beta', 'grok-2'];
  let lastError: any = null;
  let payloadFatal: Error | null = null;

  for (let i = 0; i < keys.length; i++) {
    const apiKey = keys[i];
    if (!isKeyAvailable(apiKey)) continue;
    for (const model of models) {
      try {
        if (!isKeyAvailable(apiKey)) break;
        console.log(
          `[xAI Grok API] RR key ${i + 1}/${keys.length} (${keyFingerprint(apiKey)}) model=${model}`,
        );
        if (!markKeyAttempt(apiKey)) {
          lastError = new Error(
            `Key ${keyFingerprint(apiKey)} đã chạm trần — chuyển key/chờ.`,
          );
          break;
        }
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
          if (text) {
            markKeySuccess(apiKey);
            globalLastWorkingKey = apiKey;
            return text;
          }
        } else {
          const errorData = await response.json().catch(() => ({}));
          const msg = errorData.error?.message || `HTTP ${response.status}`;
          const kind = markKeyLimited(apiKey, msg, response.status);
          lastError = new Error(`[${response.status}] ${msg}`);
          if (kind === 'payload') {
            payloadFatal = lastError;
            throw lastError;
          }
          if (shouldExhaustKey(kind)) break;
        }
      } catch (e: any) {
        lastError = e;
        if (payloadFatal) throw payloadFatal;
        const kind = markKeyLimited(apiKey, e?.message || '', undefined);
        if (shouldExhaustKey(kind)) break;
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

// Gemini: round-robin keys mỗi request + hard gate RPM/RPD (B10: chỉ xoay key, không đổi platform)
async function callGemini(prompt: string, apiKeyOrKeys: string | string[], preferredModel?: string) {
  assertPoolHasCapacity(apiKeyOrKeys);
  const keys = filterAvailableKeys(apiKeyOrKeys);

  if (keys.length === 0) {
    assertPoolHasCapacity(apiKeyOrKeys);
    throw new Error('Không có API Key nào hợp lệ để sử dụng.');
  }

  // Danh sách các mô hình chạy ổn định sắp xếp theo thứ tự ưu tiên
  // LƯU Ý: gemini-1.5-* deprecated — không thêm lại. Xem error.md Mục 19.
  let models = [
    'gemini-2.5-flash',
    'gemini-2.5-flash-lite',
    'gemini-2.0-flash',
    'gemini-2.5-pro',
  ];

  if (preferredModel && models.includes(preferredModel)) {
    models = [preferredModel, ...models.filter((m) => m !== preferredModel)];
  } else if (globalLastWorkingModel && models.includes(globalLastWorkingModel)) {
    models = [globalLastWorkingModel, ...models.filter((m) => m !== globalLastWorkingModel)];
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let lastError: any = null;
  const exhaustedKeys = new Set<string>();
  /** Same bad payload → stop burning every key with identical 400 */
  let payloadFatal: Error | null = null;

  for (let i = 0; i < keys.length; i++) {
    const apiKey = keys[i];
    if (exhaustedKeys.has(apiKey)) continue;
    if (payloadFatal) break;
    if (!isKeyAvailable(apiKey)) continue;

    console.log(
      `[Gemini API] RR key ${i + 1}/${keys.length} (${keyFingerprint(apiKey)})…`,
    );

    for (const model of models) {
      if (!isKeyAvailable(apiKey)) {
        exhaustedKeys.add(apiKey);
        break;
      }
      const url = `https://generativelanguage.googleapis.com/v1/models/${model}:generateContent?key=${apiKey}`;

      try {
        console.log(
          `[Gemini API] model=${model} key=${i + 1}/${keys.length} (${keyFingerprint(apiKey)})`,
        );
        if (!markKeyAttempt(apiKey)) {
          exhaustedKeys.add(apiKey);
          lastError = new Error(
            `Key ${keyFingerprint(apiKey)} chạm trần RPM/RPD — chuyển key hoặc chờ.`,
          );
          break;
        }
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

        const status = response.status;
        const errorData = await response.json().catch(() => ({}));
        const msg = errorData.error?.message || '';

        if (response.ok) {
          const data = errorData;
          // Gemini 2.5 may split thought + answer across parts — join all text parts.
          // Only parts[0] often yields empty / non-JSON and causes "mảng prompt rỗng".
          const candidate = data.candidates?.[0];
          const parts = candidate?.content?.parts;
          let text = '';
          if (Array.isArray(parts)) {
            text = parts
              .map((p: { text?: string }) =>
                typeof p?.text === 'string' ? p.text : '',
              )
              .filter(Boolean)
              .join('\n')
              .trim();
          }
          if (!text && typeof candidate?.content?.parts?.[0]?.text === 'string') {
            text = String(candidate.content.parts[0].text).trim();
          }
          if (!text) {
            const finish = String(candidate?.finishReason || data.promptFeedback?.blockReason || '');
            const reason = finish ? ` finishReason/block=${finish}` : '';
            throw new Error(
              `[Key ${i + 1}/${keys.length}]: AI không trả về text hợp lệ.${reason}`,
            );
          }
          globalLastWorkingKey = apiKey;
          globalLastWorkingModel = model;
          markKeySuccess(apiKey);
          return text;
        }

        const kind = markKeyLimited(apiKey, msg || `Status ${status}`, status);
        lastError = new Error(
          `[Key ${i + 1}/${keys.length}] (${model}): ${msg || 'no message'} (Status: ${status})`,
        );

        if (kind === 'payload') {
          // 400 invalid argument / unsupported — try next model; if all models fail, stop pool
          console.warn(
            `[Gemini API] HTTP 400 payload/model key=${keyFingerprint(apiKey)} model=${model}: ${msg.slice(0, 180)}`,
          );
          // If message is clearly model-not-found, continue models; else after last model mark fatal
          if (
            /not\s*found|is not found|unsupported|does not exist|unknown model/i.test(
              msg,
            )
          ) {
            continue;
          }
          // Same body will fail every key — don't rotate the whole pool
          if (model === models[models.length - 1] || !/model/i.test(msg)) {
            payloadFatal = lastError;
            break;
          }
          continue;
        }

        if (shouldExhaustKey(kind)) {
          console.warn(
            `[Gemini API] Key ${keyFingerprint(apiKey)} ${kind} (${status}) → xoay key tiếp`,
          );
          exhaustedKeys.add(apiKey);
          break;
        }

        console.warn(
          `[Gemini API] Lỗi model ${model} key ${keyFingerprint(apiKey)}: ${msg} (${status})`,
        );

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } catch (err: any) {
        const errMsg = err.message || '';
        console.error(`[Gemini API] Ngoại lệ ${model} key ${keyFingerprint(apiKey)}:`, errMsg);
        lastError = err;

        const kind = markKeyLimited(apiKey, errMsg, undefined);
        if (kind === 'payload') {
          payloadFatal = err;
          break;
        }
        if (shouldExhaustKey(kind)) {
          exhaustedKeys.add(apiKey);
          break;
        }
      }
    } // end for models
  } // end for keys

  if (payloadFatal) {
    throw new Error(
      `[Gemini 400] Request bị từ chối (payload/model), không phải RPM/RPD. ` +
        `Không xoay hết pool key. Chi tiết: ${payloadFatal.message}`,
    );
  }

  // Re-check pool — may now be fully blocked after attempts
  try {
    assertPoolHasCapacity(apiKeyOrKeys);
  } catch (waitErr) {
    throw waitErr;
  }

  throw lastError || new Error('Tất cả các API Key và dòng mô hình đều thất bại hoặc quá hạn ngạch.');
}

export async function callActiveModel(prompt: string, apiKeyOrKeys: string | string[], model: string = 'gemini') {
  if (model === 'gpt4o' || model.startsWith('gpt-')) {
    return await callOpenAI(prompt, apiKeyOrKeys);
  } else if (model === 'llama' || model.startsWith('grok')) {
    const firstKey = Array.isArray(apiKeyOrKeys) ? apiKeyOrKeys[0] : apiKeyOrKeys;
    return firstKey && String(firstKey).startsWith('gsk_')
      ? await callGroq(prompt, apiKeyOrKeys)
      : await callGrok(prompt, apiKeyOrKeys);
  } else {
    return await callGemini(prompt, apiKeyOrKeys, model !== 'gemini' ? model : undefined);
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
  const rawKeys = Array.isArray(apiKeyOrKeys) ? apiKeyOrKeys.filter(Boolean) : [apiKeyOrKeys].filter(Boolean);
  const keys = filterAvailableKeys(rawKeys);
  if (keys.length === 0) throw new Error('Khong co Google API Key hop le de phan tich anh.');

  const models = ['gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-2.0-flash', 'gemini-2.5-pro'];
  let lastError: unknown = null;

  for (const apiKey of keys) {
    if (!isKeyAvailable(apiKey)) continue;
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
          if (text) {
            markKeySuccess(apiKey);
            return text;
          }
        } else {
          const err = await response.json().catch(() => ({}));
          const msg = err.error?.message || `Gemini vision error ${response.status}`;
          if (!msg.includes('limit: 0') || !lastError) {
            lastError = new Error(msg);
          }
          markKeyLimited(apiKey, msg, response.status);
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
