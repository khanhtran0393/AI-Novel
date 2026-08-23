import { NextRequest, NextResponse } from 'next/server';
import { resolveYoutubeMetaIp } from '@/lib/commercial/ip/psychCloudBridge';
import { extractEntitlementToken } from '@/lib/entitlement';
import { DEFAULT_GEMINI_TEXT_MODEL } from '@/lib/geminiModels';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const GEMINI_MODELS = [
  DEFAULT_GEMINI_TEXT_MODEL,
] as const;

/** Max Gemini attempts (cùng API — hết round thì hard-fail) */
const MAX_AI_ROUNDS = 3;

function collectKeys(body: Record<string, unknown>): string[] {
  const keys: string[] = [];
  if (typeof body.apiKey === 'string' && body.apiKey.trim()) keys.push(body.apiKey.trim());
  if (typeof body.gemini_api_key === 'string' && body.gemini_api_key.trim()) {
    keys.push(body.gemini_api_key.trim());
  }
  if (Array.isArray(body.apiKeys)) {
    for (const k of body.apiKeys) {
      if (typeof k === 'string' && k.trim()) keys.push(k.trim());
    }
  }
  return [...new Set(keys)];
}

function extractText(data: unknown): string {
  const d = data as {
    candidates?: Array<{
      content?: { parts?: Array<{ text?: string }> };
      finishReason?: string;
    }>;
    promptFeedback?: { blockReason?: string };
  };

  const parts = d?.candidates?.[0]?.content?.parts;
  const joined =
    parts
      ?.map((p) => p.text || '')
      .join('')
      .trim() || '';

  if (joined) return joined;

  // Sometimes model returns empty parts with finishReason (safety / MAX_TOKENS)
  const reason = d?.candidates?.[0]?.finishReason || d?.promptFeedback?.blockReason || '';
  if (reason) {
    throw new Error(`Gemini empty content (${reason})`);
  }
  return '';
}

/**
 * Repair common LLM JSON mess so parse succeeds more often.
 */
function repairJsonText(input: string): string {
  let s = (input || '').trim();

  // Strip BOM / zero-width
  s = s.replace(/^\uFEFF/, '').replace(/[\u200B-\u200D\uFEFF]/g, '');

  // Strip markdown fences (anywhere, not only start)
  s = s
    .replace(/^```(?:json|JSON)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .replace(/```(?:json|JSON)?\s*/gi, '')
    .replace(/```/g, '')
    .trim();

  // Smart quotes → ASCII
  s = s
    .replace(/[\u201C\u201D\u201E\u201F\u2033\u2036]/g, '"')
    .replace(/[\u2018\u2019\u201A\u201B\u2032\u2035]/g, "'");

  // Extract first {...} block if there is prose around it
  const start = s.indexOf('{');
  const end = s.lastIndexOf('}');
  if (start >= 0 && end > start) {
    s = s.slice(start, end + 1);
  }

  // Trailing commas before } or ]
  s = s.replace(/,\s*([}\]])/g, '$1');

  // JS-style single-quoted keys/strings → double quotes (conservative)
  // "key": 'value' → "key": "value"
  s = s.replace(/:\s*'([^'\\]*(?:\\.[^'\\]*)*)'/g, (_m, inner: string) => {
    const escaped = inner.replace(/\\'/g, "'").replace(/"/g, '\\"');
    return `: "${escaped}"`;
  });
  // 'key': → "key":
  s = s.replace(/'([A-Za-z0-9_]+)'\s*:/g, '"$1":');

  // Unquoted keys: { title: "..." } → { "title": "..." }
  s = s.replace(/([{,]\s*)([A-Za-z_][A-Za-z0-9_]*)\s*:/g, '$1"$2":');

  return s.trim();
}

/**
 * Last-resort: pull string fields from messy text with regex.
 * Accepts both "title" and title: patterns.
 */
function extractFieldsHeuristic(raw: string): Record<string, unknown> | null {
  const text = raw || '';
  const pick = (keys: string[]): string => {
    for (const key of keys) {
      // "key": "value" or "key": "multi\nline"
      const reDq = new RegExp(
        `["']?${key}["']?\\s*:\\s*"((?:\\\\.|[^"\\\\])*)"`,
        'i',
      );
      const m1 = text.match(reDq);
      if (m1?.[1]) {
        return m1[1]
          .replace(/\\n/g, '\n')
          .replace(/\\"/g, '"')
          .replace(/\\\\/g, '\\')
          .trim();
      }
      // 'key': 'value'
      const reSq = new RegExp(
        `["']?${key}["']?\\s*:\\s*'((?:\\\\.|[^'\\\\])*)'`,
        'i',
      );
      const m2 = text.match(reSq);
      if (m2?.[1]) return m2[1].replace(/\\'/g, "'").trim();
    }
    return '';
  };

  const title = pick(['title', 'seo_title', 'seoTitle']);
  const description = pick(['description', 'seo_description', 'seoDescription']);
  const thumbnailLine = pick([
    'thumbnailLine',
    'thumbnail_line',
    'thumb_line',
    'thumb',
  ]);
  const tags = pick(['tags', 'hashtags', 'seoTags']);
  const hook = pick(['hook']);
  const thumbnailPrompt = pick([
    'thumbnailPrompt',
    'thumbnail_prompt',
    'thumb_prompt',
  ]);

  if (!title && !description && !thumbnailLine) return null;

  return {
    title,
    description,
    tags,
    thumbnailLine,
    hook,
    thumbnailPrompt,
  };
}

function parseJsonLoose(raw: string): Record<string, unknown> {
  const text = (raw || '').trim();
  if (!text) {
    throw new Error('AI không trả JSON hợp lệ cho YouTube SEO (empty)');
  }

  // 1) Direct parse
  try {
    const v = JSON.parse(text) as unknown;
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      return v as Record<string, unknown>;
    }
  } catch {
    /* continue */
  }

  // 2) Repair then parse
  const repaired = repairJsonText(text);
  try {
    const v = JSON.parse(repaired) as unknown;
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      return v as Record<string, unknown>;
    }
  } catch {
    /* continue */
  }

  // 3) Try fixing bare newlines inside string values (common Gemini bug)
  try {
    const withEscapedNewlines = repaired.replace(
      /"([^"\\]*(?:\\.[^"\\]*)*)"/g,
      (full) => full.replace(/\r?\n/g, '\\n'),
    );
    const v = JSON.parse(withEscapedNewlines) as unknown;
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      return v as Record<string, unknown>;
    }
  } catch {
    /* continue */
  }

  // 4) Heuristic field scrape
  const heur = extractFieldsHeuristic(text);
  if (heur) return heur;

  throw new Error('AI không trả JSON hợp lệ cho YouTube SEO');
}

function normalizePack(
  payload: Record<string, unknown>,
  fallbackTitle: string,
): {
  title: string;
  seoTitle: string;
  description: string;
  seoDescription: string;
  tags: string;
  hashtags: string;
  thumbnailLine: string;
  thumbnail_line: string;
  thumbnailPrompt: string;
  hook: string;
} {
  const title = String(
    payload.title || payload.seo_title || payload.seoTitle || '',
  )
    .normalize('NFC')
    .trim()
    .slice(0, 100);

  const description = String(
    payload.description || payload.seo_description || payload.seoDescription || '',
  )
    .normalize('NFC')
    .replace(/——\s*HOOK\s*\(?30s?\)?\s*——/gi, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, 4500);

  const tagsRaw = payload.tags ?? payload.hashtags ?? payload.seoTags ?? '';
  const tags = Array.isArray(tagsRaw)
    ? tagsRaw.map(String).join(' ')
    : String(tagsRaw || '').trim();

  const thumbnailLine = String(
    payload.thumbnailLine ||
      payload.thumbnail_line ||
      payload.thumb_line ||
      payload.thumb ||
      '',
  )
    .normalize('NFC')
    .trim()
    .slice(0, 30);

  const thumbnailPrompt = String(
    payload.thumbnailPrompt || payload.thumbnail_prompt || payload.thumb_prompt || '',
  )
    .normalize('NFC')
    .trim();

  const hook = String(payload.hook || '')
    .normalize('NFC')
    .trim()
    .slice(0, 900);

  const finalTitle = title || fallbackTitle.slice(0, 100);

  return {
    title: finalTitle,
    seoTitle: finalTitle,
    description,
    seoDescription: description,
    tags,
    hashtags: tags,
    thumbnailLine,
    thumbnail_line: thumbnailLine,
    thumbnailPrompt,
    hook,
  };
}

function buildSeoPrompt(params: {
  text: string;
  novelTitle: string;
  randomSeed: number | string;
  usedTitles: string[];
  usedThumbLines: string[];
  chapter?: number;
  strictJson?: boolean;
}): string {
  const avoidTitles = params.usedTitles
    .filter(Boolean)
    .slice(-12)
    .map((t, i) => `${i + 1}. ${t}`)
    .join('\n');
  const avoidThumbs = params.usedThumbLines
    .filter(Boolean)
    .slice(-12)
    .map((t, i) => `${i + 1}. ${t}`)
    .join('\n');

  const strictNote = params.strictJson
    ? `
QUAN TRỌNG (LẦN PARSE TRƯỚC BỊ LỖI):
- CHỈ trả về 1 object JSON. Không markdown, không \`\`\`, không lời dẫn.
- Mọi value string dùng double quotes ". Escape \\n và \\" bên trong string.
- Không trailing comma. Không comment.
`
    : '';

  return `Bạn là chuyên gia YouTube SEO + CTR tâm lý cho kênh truyện audio / kể chuyện Việt Nam.

NHIỆM VỤ: Sinh gói metadata YouTube HOÀN TOÀN MỚI từ kịch bản. Mỗi lần gen phải KHÁC hẳn lần trước.
${strictNote}
NOVEL: ${params.novelTitle || '(không tên)'}
CHAPTER: ${params.chapter ?? '?'}
RANDOM_SEED (bắt buộc dùng để đa dạng hoá — đừng lặp): ${params.randomSeed}
TIMESTAMP_NOISE: ${Date.now()}

KỊCH BẢN (rút gọn):
"""
${params.text.slice(0, 12000)}
"""

CẤM LẶP (đã dùng trên kênh — tuyệt đối không copy/paraphrase gần):
Titles đã dùng:
${avoidTitles || '(chưa có)'}

Thumb lines đã dùng:
${avoidThumbs || '(chưa có)'}

YÊU CẦU CHẤT LƯỢNG:
1) seoTitle (title): tiếng Việt, ≤100 ký tự, CTR mạnh (tò mò / đe dọa / open-loop / FOMO / nghịch lý). KHÔNG thoại, KHÔNG trích dẫn hội thoại, KHÔNG meta plot ("cảnh này căng").
2) thumbnailLine: tiếng Việt ≤30 ký tự, gợi tò mò, có thể kết thúc … hoặc ?, 1 ý duy nhất.
3) seoDescription: 2–4 đoạn ngắn + CTA nhẹ + gợi ý hashtag trong thân mô tả nếu hợp lý; ≤4500 ký tự; dẫn bằng hook cảm xúc, không spoil twist chính. Trong JSON, xuống dòng viết thành \\n (không xuống dòng thô).
4) tags: chuỗi hashtag/từ khóa cách nhau bằng khoảng trắng hoặc #, 8–18 tag.
5) hook: 30–45 giây đọc (≈80–120 từ), mở open-loop, không tóm tắt hết.
6) thumbnailPrompt: 1 câu tiếng Anh cho AI vẽ thumbnail (cinematic, face emotion, high contrast text space).

ĐA DẠNG BẮT BUỘC:
- Dùng RANDOM_SEED để chọn góc (threat / curiosity / loss / time / paradox / identity / forbidden / number) KHÁC với các title đã cấm.
- Title phải khác ≥60% so với mọi title đã dùng (không cùng 8–12 ký tự đầu).
- thumbnailLine phải khác mọi thumb đã dùng.

Trả về JSON THUẦN (không markdown, không giải thích):
{
  "title": "...",
  "thumbnailLine": "...",
  "description": "...",
  "tags": "#a #b ...",
  "hook": "...",
  "thumbnailPrompt": "..."
}`;
}

async function callGeminiJson(
  prompt: string,
  keys: string[],
  temperature: number,
): Promise<{ text: string; provider: string }> {
  let lastErr: Error | null = null;

  for (const key of keys) {
    for (const model of GEMINI_MODELS) {
      try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
        const res = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-goog-api-key': key,
          },
          body: JSON.stringify({
            contents: [{ role: 'user', parts: [{ text: prompt }] }],
            generationConfig: {
              temperature,
              topP: 0.95,
              maxOutputTokens: 4096,
              responseMimeType: 'application/json',
            },
            safetySettings: [
              { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
              { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
              { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
              { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' },
            ],
          }),
          signal: AbortSignal.timeout(90_000),
        });

        if (!res.ok) {
          const t = await res.text().catch(() => '');
          const msg = `Gemini ${model} ${res.status}: ${t.slice(0, 220)}`;
          lastErr = new Error(msg);
          // quota → next key
          if (res.status === 429 || /quota|limit/i.test(t)) break;
          continue;
        }

        const data = await res.json();
        let text = '';
        try {
          text = extractText(data);
        } catch (e) {
          lastErr = e instanceof Error ? e : new Error(String(e));
          continue;
        }
        if (!text.trim()) {
          lastErr = new Error(`Gemini ${model}: empty response`);
          continue;
        }
        return { text, provider: `gemini:${model}` };
      } catch (e) {
        lastErr = e instanceof Error ? e : new Error(String(e));
      }
    }
  }

  throw lastErr || new Error('Tất cả Gemini key/model đều thất bại');
}

/** Psych IP path (cloud when packaged+token) — optional offline helper for future use. */
async function packFromPsychIp(params: {
  req: Request;
  body: unknown;
  text: string;
  novelTitle: string;
  usedTitles: string[];
  usedThumbLines: string[];
  chapter?: number;
  randomSeed: string;
  visualDna: string;
}): Promise<
  ReturnType<typeof normalizePack> & {
    scores?: unknown;
    rounds?: number;
    source?: string;
  }
> {
  const token = extractEntitlementToken(params.req, params.body);
  const { pack: qa, source } = await resolveYoutubeMetaIp(
    {
      script: params.text,
      novelTitle: params.novelTitle,
      usedTitles: params.usedTitles,
      usedThumbLines: params.usedThumbLines,
      chapter: params.chapter,
      maxRounds: 5,
      visualDna: params.visualDna,
    },
    { entitlementToken: token, allowLocalFreeFallback: !token },
  );

  const seedN = Math.abs(
    Array.from(params.randomSeed).reduce((a, c) => a + c.charCodeAt(0), 0),
  );
  const titleShift = seedN % 3;
  let title = qa.seoTitle;
  if (titleShift === 1 && title.length > 12) {
    title = title.replace(/^(.{8,20}?)[|·\-–—]\s*/, '').trim() || title;
  }

  return {
    ...normalizePack(
      {
        title: title.slice(0, 100),
        description: qa.seoDescription,
        tags: qa.seoTags,
        thumbnailLine: qa.thumbnailLine,
        hook: qa.hook,
        thumbnailPrompt: qa.thumbnailPrompt,
      },
      params.novelTitle || 'Truyện audio',
    ),
    scores: qa.scores,
    rounds: qa.rounds,
    source,
  };
}

function buildFormatted(pack: {
  title: string;
  thumbnailLine: string;
  description: string;
  tags: string;
}): string {
  return [
    `TITLE: ${pack.title}`,
    `THUMB: ${pack.thumbnailLine}`,
    '',
    pack.description,
    '',
    pack.tags,
  ]
    .filter(Boolean)
    .join('\n');
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as Record<string, unknown>;
    // Free product surface (YouTube SEO workspace) — not toolbox_labs gated.
    const text = typeof body.text === 'string' ? body.text : '';
    if (!text.trim()) {
      return NextResponse.json({ success: false, error: 'Missing "text"' }, { status: 400 });
    }

    const keys = collectKeys(body);
    const novelTitle = String(body.novelTitle ?? body.novel_title ?? '').trim();
    const randomSeed = String(
      body.randomSeed ??
        body.random_seed ??
        `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
    );
    const usedTitles = Array.isArray(body.usedTitles)
      ? body.usedTitles.map(String)
      : Array.isArray(body.used_titles)
        ? (body.used_titles as unknown[]).map(String)
        : [];
    const usedThumbLines = Array.isArray(body.usedThumbLines)
      ? body.usedThumbLines.map(String)
      : Array.isArray(body.used_thumb_lines)
        ? (body.used_thumb_lines as unknown[]).map(String)
        : [];
    const chapter =
      typeof body.chapter === 'number'
        ? body.chapter
        : typeof body.chapter === 'string'
          ? Number(body.chapter) || undefined
          : undefined;

    const visualDna = String(
      body.visualDna || body.visualDnaPrompt || body.mediaStylePreset || '',
    ).trim();
    const preferPsych =
      body.engine === 'psych' ||
      body.preferPsychIp === true ||
      body.source === 'psych';

    // Psych IP path (cloud when packaged+token; free local server formulas)
    if (preferPsych || keys.length === 0) {
      if (!visualDna) {
        return NextResponse.json(
          {
            success: false,
            error:
              keys.length === 0
                ? 'YouTube SEO: thiếu Gemini API Key (hoặc Visual DNA để dùng psych IP).'
                : 'Psych SEO cần visualDna (Visual DNA / Media Style).',
          },
          { status: 400 },
        );
      }
      try {
        const pack = await packFromPsychIp({
          req,
          body,
          text,
          novelTitle,
          usedTitles,
          usedThumbLines,
          chapter,
          randomSeed,
          visualDna,
        });
        return NextResponse.json({
          success: true,
          provider: `psych-ip:${pack.source || 'local'}`,
          source: pack.source || 'psych',
          randomSeed,
          data: pack,
          result: pack,
          formatted: buildFormatted(pack),
          scores: pack.scores,
          rounds: pack.rounds,
        });
      } catch (e) {
        if (preferPsych || keys.length === 0) {
          return NextResponse.json(
            {
              success: false,
              error: e instanceof Error ? e.message : String(e),
            },
            { status: 502 },
          );
        }
        // Fall through to Gemini if psych optional failed
      }
    }

    // IRON B10: SEO meta Gemini — không nhồi soft-success khi key có nhưng AI fail
    if (keys.length === 0) {
      return NextResponse.json(
        {
          success: false,
          error:
            'YouTube SEO: thiếu Gemini API Key. Thêm key hoặc Visual DNA (psych IP).',
        },
        { status: 400 },
      );
    }

    // High temperature + seed → mỗi lần gen khác nhau
    const temperatureRaw = Number(body.temperature);
    const temperature =
      Number.isFinite(temperatureRaw) && temperatureRaw > 0
        ? Math.min(1.2, Math.max(0.7, temperatureRaw))
        : 1.0;

    let lastAiErr: Error | null = null;
    let lastRaw = '';

    for (let round = 0; round < MAX_AI_ROUNDS; round++) {
      const prompt = buildSeoPrompt({
        text,
        novelTitle,
        randomSeed: `${randomSeed}-r${round}`,
        usedTitles,
        usedThumbLines,
        chapter,
        strictJson: round > 0,
      });

      // Slightly lower temp on retries for cleaner JSON
      const temp = round === 0 ? temperature : Math.max(0.7, temperature - 0.15 * round);

      try {
        const { text: raw, provider } = await callGeminiJson(prompt, keys, temp);
        lastRaw = raw;
        const parsed = parseJsonLoose(raw);
        const pack = normalizePack(parsed, novelTitle || 'Truyện audio');

        if (!pack.title || !pack.description) {
          lastAiErr = new Error(
            'Gemini trả SEO thiếu title/description — không nhồi local. Sửa prompt/key hoặc gen lại.',
          );
          continue;
        }

        return NextResponse.json({
          success: true,
          provider,
          source: 'gemini',
          parseRound: round + 1,
          randomSeed,
          data: pack,
          result: pack,
          formatted: buildFormatted(pack),
        });
      } catch (e) {
        lastAiErr = e instanceof Error ? e : new Error(String(e));
        // JSON parse fail or empty → next round with stricter prompt (cùng Gemini API)
        continue;
      }
    }

    // IRON B10: hết round Gemini → hard-fail (không local-qa-fallback)
    return NextResponse.json(
      {
        success: false,
        error:
          lastAiErr?.message ||
          'YouTube SEO: Gemini fail sau mọi round — không fallback local. Kiểm tra API key / JSON output.',
        raw: lastRaw.slice(0, 400),
      },
      { status: 502 },
    );
  } catch (error: unknown) {
    const err = error as Error;
    return NextResponse.json(
      { success: false, error: err.message || String(error) },
      { status: 500 },
    );
  }
}
