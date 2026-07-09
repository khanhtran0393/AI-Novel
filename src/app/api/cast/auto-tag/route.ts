/**
 * AI auto-tag speakers for ambiguous dialogue segments.
 * Budgeted: max 20 segs, ±400 context, 30s timeout, no scene body logs.
 */
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const maxDuration = 30;

const MAX_SEGS = 20;
const CTX_CHARS = 400;
const CONFIDENCE_MIN = 0.55;
const INPUT_CHARS_SOFT = 12000;

type SegIn = {
  id: string;
  text: string;
  source?: string;
  order?: number;
};

type Assignment = {
  id: string;
  speaker: string | null;
  confidence: number;
};

function stripJsonFence(raw: string): string {
  let s = (raw || '').trim();
  if (s.startsWith('```')) {
    s = s.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
  }
  return s.trim();
}

function extractJsonArray(raw: string): unknown {
  const cleaned = stripJsonFence(raw);
  try {
    return JSON.parse(cleaned);
  } catch {
    const m = cleaned.match(/\[[\s\S]*\]/);
    if (m) {
      try {
        return JSON.parse(m[0]);
      } catch {
        /* fallthrough */
      }
    }
    throw new Error('Model did not return valid JSON array');
  }
}

async function callGemini(
  prompt: string,
  keys: string[],
  model = 'gemini-2.0-flash',
): Promise<{ text: string; provider: string }> {
  let lastErr: Error | null = null;
  for (const key of keys) {
    if (!key?.trim()) continue;
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key.trim()}`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.2,
            maxOutputTokens: 2048,
            responseMimeType: 'application/json',
          },
        }),
        signal: AbortSignal.timeout(28_000),
      });
      if (!res.ok) {
        const t = await res.text().catch(() => '');
        throw new Error(`Gemini ${res.status}: ${t.slice(0, 200)}`);
      }
      const data = await res.json();
      const text =
        data?.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text || '').join('') ||
        '';
      if (!text.trim()) throw new Error('Empty Gemini response');
      return { text, provider: `gemini:${model}` };
    } catch (e) {
      lastErr = e instanceof Error ? e : new Error(String(e));
    }
  }
  throw lastErr || new Error('All Gemini keys failed');
}

async function callOpenAI(
  prompt: string,
  keys: string[],
): Promise<{ text: string; provider: string }> {
  let lastErr: Error | null = null;
  for (const key of keys) {
    if (!key?.trim()) continue;
    try {
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${key.trim()}`,
        },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          temperature: 0.2,
          response_format: { type: 'json_object' },
          messages: [
            {
              role: 'system',
              content:
                'Return JSON only: {"assignments":[{"id":"...","speaker":"Name or null","confidence":0.0}]}',
            },
            { role: 'user', content: prompt },
          ],
        }),
        signal: AbortSignal.timeout(28_000),
      });
      if (!res.ok) {
        const t = await res.text().catch(() => '');
        throw new Error(`OpenAI ${res.status}: ${t.slice(0, 200)}`);
      }
      const data = await res.json();
      const text = data?.choices?.[0]?.message?.content || '';
      if (!text.trim()) throw new Error('Empty OpenAI response');
      return { text, provider: 'openai:gpt-4o-mini' };
    } catch (e) {
      lastErr = e instanceof Error ? e : new Error(String(e));
    }
  }
  throw lastErr || new Error('All OpenAI keys failed');
}

function buildPrompt(params: {
  characterNames: string[];
  segments: Array<{ id: string; text: string; context: string }>;
}): string {
  const names = params.characterNames.map((n) => n.normalize('NFC')).filter(Boolean);
  return `Bạn là biên kịch phân vai thoại tiếng Việt.
Gán speaker cho mỗi đoạn thoại mơ hồ. Chỉ dùng tên trong danh sách hoặc null (người kể).
Danh sách nhân vật: ${JSON.stringify(names)}

Trả về JSON array thuần (không markdown):
[{"id":"seg_xxx","speaker":"Tên NV hoặc null","confidence":0.0-1.0}]

Đoạn cần gán:
${JSON.stringify(params.segments, null, 0)}

Quy tắc:
- confidence thấp nếu không chắc; speaker null nếu là kể chuyện/mô tả.
- Không viết lại text. Chỉ gán speaker.
- Chỉ JSON array.`;
}

function contextAround(sceneText: string, quote: string): string {
  const scene = sceneText.normalize('NFC');
  const q = quote.normalize('NFC').slice(0, 80);
  const idx = scene.indexOf(q);
  if (idx < 0) {
    return scene.slice(0, CTX_CHARS * 2);
  }
  const start = Math.max(0, idx - CTX_CHARS);
  const end = Math.min(scene.length, idx + q.length + CTX_CHARS);
  return scene.slice(start, end);
}

export async function POST(req: Request) {
  const t0 = Date.now();
  try {
    const body = await req.json();
    const characterNames: string[] = Array.isArray(body.characterNames)
      ? body.characterNames
      : [];
    const sceneText = typeof body.sceneText === 'string' ? body.sceneText : '';
    const ambiguousOnly = body.ambiguousOnly !== false;
    let segments: SegIn[] = Array.isArray(body.segments) ? body.segments : [];

    if (!segments.length) {
      return NextResponse.json({ error: 'Thiếu segments.' }, { status: 400 });
    }

    if (ambiguousOnly) {
      segments = segments.filter(
        (s) => s && (s.source === 'ambiguous' || !s.source || s.source === 'narrator'),
      );
    }

    // Prefer truly ambiguous / quoted lines
    segments = segments
      .filter((s) => s?.id && typeof s.text === 'string' && s.text.trim())
      .slice(0, MAX_SEGS);

    if (!segments.length) {
      return NextResponse.json({
        ok: true,
        assignments: [],
        assignedCount: 0,
        message: 'Không còn dòng mơ hồ để gán.',
        latencyMs: Date.now() - t0,
      });
    }

    const packed = segments.map((s) => ({
      id: s.id,
      text: s.text.trim().slice(0, 500),
      context: contextAround(sceneText, s.text.trim()).slice(0, CTX_CHARS * 2 + 100),
    }));

    let inputChars = JSON.stringify(packed).length;
    if (inputChars > INPUT_CHARS_SOFT) {
      for (const p of packed) {
        p.context = p.context.slice(0, 200);
        p.text = p.text.slice(0, 200);
      }
      inputChars = JSON.stringify(packed).length;
    }

    const prompt = buildPrompt({ characterNames, segments: packed });

    const geminiKeys: string[] = [
      ...(Array.isArray(body.apiKeys) ? body.apiKeys : []),
      body.apiKey,
      process.env.GEMINI_API_KEY,
      process.env.GEMINI_KEY_1,
      process.env.GEMINI_KEY_2,
    ].filter((k): k is string => !!k && String(k).trim().length > 0);

    const openaiKeys: string[] = [
      ...(Array.isArray(body.openaiApiKeys) ? body.openaiApiKeys : []),
      body.openaiApiKey,
      process.env.OPENAI_API_KEY,
    ].filter((k): k is string => !!k && String(k).trim().length > 0);

    let rawText = '';
    let provider = '';
    try {
      if (geminiKeys.length) {
        const r = await callGemini(prompt, geminiKeys);
        rawText = r.text;
        provider = r.provider;
      } else if (openaiKeys.length) {
        const r = await callOpenAI(prompt, openaiKeys);
        rawText = r.text;
        provider = r.provider;
      } else {
        return NextResponse.json(
          { error: 'Thiếu API Key Gemini/OpenAI cho auto-tag.' },
          { status: 400 },
        );
      }
    } catch (e) {
      if (openaiKeys.length && !provider.startsWith('openai')) {
        try {
          const r = await callOpenAI(prompt, openaiKeys);
          rawText = r.text;
          provider = r.provider;
        } catch (e2) {
          throw e2;
        }
      } else {
        throw e;
      }
    }

    let parsed = extractJsonArray(rawText);
    // OpenAI may wrap { assignments: [...] }
    if (parsed && !Array.isArray(parsed) && typeof parsed === 'object') {
      const obj = parsed as { assignments?: unknown };
      if (Array.isArray(obj.assignments)) parsed = obj.assignments;
    }
    if (!Array.isArray(parsed)) {
      throw new Error('Assignments is not an array');
    }

    const nameSet = new Set(
      characterNames.map((n) => n.normalize('NFC').trim()).filter(Boolean),
    );

    const assignments: Assignment[] = [];
    for (const row of parsed) {
      if (!row || typeof row !== 'object') continue;
      const id = String((row as { id?: string }).id || '').trim();
      if (!id) continue;
      let speaker = (row as { speaker?: string | null }).speaker;
      if (speaker != null) {
        speaker = String(speaker).normalize('NFC').trim();
        if (!nameSet.has(speaker)) speaker = null;
      } else {
        speaker = null;
      }
      let confidence = Number((row as { confidence?: number }).confidence);
      if (!Number.isFinite(confidence)) confidence = 0.5;
      confidence = Math.max(0, Math.min(1, confidence));
      if (confidence < CONFIDENCE_MIN) {
        // keep but mark low — client may ignore
      }
      assignments.push({ id, speaker, confidence });
    }

    const kept = assignments.filter((a) => a.confidence >= CONFIDENCE_MIN);
    const latencyMs = Date.now() - t0;

    console.info(
      `[cast/auto-tag] provider=${provider} inputChars=${inputChars} segCount=${segments.length} assignedCount=${kept.length} latencyMs=${latencyMs}`,
    );

    return NextResponse.json({
      ok: true,
      assignments: kept,
      allAssignments: assignments,
      assignedCount: kept.length,
      provider,
      inputChars,
      segCount: segments.length,
      latencyMs,
      confidenceMin: CONFIDENCE_MIN,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[cast/auto-tag] error latencyMs=${Date.now() - t0}:`, msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
