import { currentModelClientConfig } from './modelClientContext';
import {
  callConfiguredProvider,
  type ProviderVisionInput,
} from './providerClients';

export { runWithModelClientConfig } from './modelClientContext';

/**
 * Closes truncated JSON strings/containers without inventing business data.
 */
function repairJson(json: string): string {
  let result = '';
  let inString = false;
  let escaped = false;
  const stack: Array<'{' | '['> = [];

  for (const char of json) {
    if (inString) {
      if (escaped) {
        result += char;
        escaped = false;
      } else if (char === '\\') {
        result += char;
        escaped = true;
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
      continue;
    }

    if (char === '"') {
      inString = true;
    } else if (char === '{' || char === '[') {
      stack.push(char);
    } else if (
      (char === '}' && stack.at(-1) === '{') ||
      (char === ']' && stack.at(-1) === '[')
    ) {
      stack.pop();
    }
    result += char;
  }

  if (inString) result += '"';
  while (stack.length) {
    result += stack.pop() === '{' ? '}' : ']';
  }
  return result;
}

/**
 * Escapes raw control characters and unescaped quotes inside JSON strings.
 */
function cleanJsonStructurally(json: string): string {
  let result = '';
  let inString = false;
  let escaped = false;

  for (let index = 0; index < json.length; index += 1) {
    const char = json[index];
    if (!inString) {
      if (char === '"') inString = true;
      result += char;
      continue;
    }

    if (escaped) {
      result += char;
      escaped = false;
    } else if (char === '\\') {
      result += char;
      escaped = true;
    } else if (char === '"') {
      let nextNonSpace = '';
      for (let lookAhead = index + 1; lookAhead < json.length; lookAhead += 1) {
        const next = json[lookAhead];
        if (!/\s/u.test(next)) {
          nextNonSpace = next;
          break;
        }
      }
      if (
        nextNonSpace === ':' ||
        nextNonSpace === ',' ||
        nextNonSpace === '}' ||
        nextNonSpace === ']' ||
        nextNonSpace === ''
      ) {
        result += char;
        inString = false;
      } else {
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
  }
  return result;
}

function tryParse(candidate: string): unknown | undefined {
  if (!candidate) return undefined;
  for (const attempt of [
    candidate,
    cleanJsonStructurally(candidate),
    repairJson(candidate),
  ]) {
    try {
      return JSON.parse(attempt);
    } catch {
      // Continue with the next non-semantic structural repair.
    }
  }
  return undefined;
}

// Compatibility boundary: handlers validate provider JSON into their own
// domain shapes immediately after parsing.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function cleanAndParseJson<T = any>(text: string): T {
  const direct = tryParse(text);
  if (direct !== undefined) return direct as T;

  const cleaned = text
    .trim()
    .replace(/^```[a-zA-Z]*[\s\n]*/u, '')
    .replace(/```$/u, '')
    .trim();
  const withoutFence = tryParse(cleaned);
  if (withoutFence !== undefined) return withoutFence as T;

  const blocks = [
    {
      start: cleaned.indexOf('['),
      end: cleaned.lastIndexOf(']'),
    },
    {
      start: cleaned.indexOf('{'),
      end: cleaned.lastIndexOf('}'),
    },
  ]
    .filter((block) => block.start >= 0 && block.end > block.start)
    .sort((left, right) => left.start - right.start);

  for (const block of blocks) {
    const parsed = tryParse(cleaned.slice(block.start, block.end + 1));
    if (parsed !== undefined) return parsed as T;
  }

  const preview =
    text.length > 500 ? `${text.slice(0, 500)}...` : text;
  throw new Error(
    `AI phản hồi sai định dạng JSON. Phản hồi thực tế: ${preview}`,
  );
}

/**
 * Kept for response compatibility. Raw provider keys must never leave the
 * server, so callers receive an empty marker instead of the key value.
 */
export function getLastWorkingApiKey(): string {
  return '';
}

export async function callActiveModel(
  prompt: string,
  apiKeyOrKeys: string | string[],
  model = 'gemini',
): Promise<string> {
  return callConfiguredProvider(
    prompt,
    [],
    apiKeyOrKeys,
    currentModelClientConfig(model),
  );
}

export type VisionInput = ProviderVisionInput;

export async function callActiveVision(
  prompt: string,
  images: VisionInput[],
  apiKeyOrKeys: string | string[],
  model = 'gemini',
): Promise<string> {
  return callConfiguredProvider(
    prompt,
    images,
    apiKeyOrKeys,
    currentModelClientConfig(model),
  );
}

export async function generateJsonWithRetry<
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  T = any,
>(
  prompt: string,
  keysToUse: string[],
  maxRetries = 2,
  model = 'gemini',
): Promise<T> {
  let lastParseError: unknown = null;
  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    const response = await callActiveModel(prompt, keysToUse, model);
    try {
      return cleanAndParseJson<T>(response);
    } catch (error) {
      lastParseError = error;
      const note = error instanceof Error ? error.message : String(error);
      console.warn(
        `[JSON Parse Retry ${attempt + 1}/${maxRetries + 1}] ${note}`,
      );
    }
  }
  throw lastParseError;
}
