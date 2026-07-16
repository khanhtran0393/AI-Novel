/**
 * Flow Agent (P2) — in-app creative collaborator.
 * Plans shot lists / refines prompts from chapter + cast context,
 * can enqueue Flow queue tasks. Uses user's LLM API key (Gemini/OpenAI-compatible).
 */
import { loadFlowOps, applyAgentInstructions } from './opsStore';
import { estimateTaskCredits, FLOW_VIDEO_MODELS, FLOW_IMAGE_MODELS } from './modelCatalog';

export type FlowAgentMessage = {
  role: 'user' | 'assistant' | 'system';
  content: string;
};

export type FlowAgentShotPlan = {
  index: number;
  kind: 'image' | 'video';
  prompt: string;
  durationSec?: number;
  cameraHint?: string;
  ingredientNote?: string;
};

export type FlowAgentPlanResult = {
  reply: string;
  shots: FlowAgentShotPlan[];
  estimatedCredits: number;
};

function extractJsonBlock(text: string): unknown | null {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const raw = fenced ? fenced[1] : text;
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(raw.slice(start, end + 1));
  } catch {
    return null;
  }
}

function parseShots(data: unknown): FlowAgentShotPlan[] {
  if (!data || typeof data !== 'object') return [];
  const o = data as { shots?: unknown[] };
  if (!Array.isArray(o.shots)) return [];
  return o.shots
    .map((s, i) => {
      const x = s as Record<string, unknown>;
      const kind = x.kind === 'video' ? 'video' : 'image';
      const prompt = String(x.prompt || x.image_prompt || x.video_prompt || '').trim();
      if (!prompt) return null;
      return {
        index: Number(x.index) || i,
        kind,
        prompt,
        durationSec:
          x.durationSec != null ? Number(x.durationSec) : kind === 'video' ? 8 : undefined,
        cameraHint: x.cameraHint ? String(x.cameraHint) : undefined,
        ingredientNote: x.ingredientNote ? String(x.ingredientNote) : undefined,
      } satisfies FlowAgentShotPlan;
    })
    .filter(Boolean) as FlowAgentShotPlan[];
}

async function callLlm(opts: {
  apiKey: string;
  model?: string;
  system: string;
  user: string;
}): Promise<string> {
  const key = opts.apiKey.trim();
  if (!key) throw new Error('Thiếu API key cho Flow Agent (Gemini/OpenAI).');

  // Prefer Gemini Google AI Studio shape when key looks like AIza
  if (key.startsWith('AIza')) {
    const model = opts.model || 'gemini-2.0-flash';
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(key)}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [
          {
            role: 'user',
            parts: [{ text: `${opts.system}\n\n---\n\n${opts.user}` }],
          },
        ],
        generationConfig: { temperature: 0.7, maxOutputTokens: 4096 },
      }),
    });
    const data = (await res.json().catch(() => ({}))) as {
      error?: { message?: string };
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };
    if (!res.ok) {
      throw new Error(data.error?.message || `Gemini HTTP ${res.status}`);
    }
    const text =
      data.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('') ||
      '';
    if (!text.trim()) throw new Error('Gemini trả rỗng.');
    return text;
  }

  // OpenAI-compatible
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      model: opts.model || 'gpt-4o-mini',
      temperature: 0.7,
      messages: [
        { role: 'system', content: opts.system },
        { role: 'user', content: opts.user },
      ],
    }),
  });
  const data = (await res.json().catch(() => ({}))) as {
    error?: { message?: string };
    choices?: Array<{ message?: { content?: string } }>;
  };
  if (!res.ok) {
    throw new Error(data.error?.message || `OpenAI HTTP ${res.status}`);
  }
  const text = data.choices?.[0]?.message?.content || '';
  if (!text.trim()) throw new Error('OpenAI trả rỗng.');
  return text;
}

export async function runFlowAgentPlan(opts: {
  apiKey: string;
  userMessage: string;
  chapterText?: string;
  castNames?: string[];
  existingPrompts?: string[];
  history?: FlowAgentMessage[];
  maxShots?: number;
}): Promise<FlowAgentPlanResult> {
  const ops = loadFlowOps();
  const maxShots = Math.max(1, Math.min(24, opts.maxShots || 8));
  const system = `You are the Google Flow Agent collaborator inside AI Novel.
Plan cinematic image/video shots for a novel chapter.
Respect Agent Instructions:
${ops.agentInstructions || '(none)'}

Output MUST include a short Vietnamese reply for the user, then a JSON block:
\`\`\`json
{
  "reply": "…",
  "shots": [
    {
      "index": 0,
      "kind": "image" | "video",
      "prompt": "English visual prompt only",
      "durationSec": 8,
      "cameraHint": "dolly_in eye normal",
      "ingredientNote": "use cast ref if available"
    }
  ]
}
\`\`\`
Rules:
- Max ${maxShots} shots.
- Prompts in English, specific, multi-sensory, NO time-skips.
- Keep cast names consistent: ${(opts.castNames || []).join(', ') || 'from chapter'}.
- Prefer alternating image then video when storyboarding.
- Do not invent API keys or claim generation finished.`;

  const hist =
    (opts.history || [])
      .slice(-8)
      .map((m) => `${m.role}: ${m.content}`)
      .join('\n') || '';

  const user = [
    hist && `Recent chat:\n${hist}`,
    opts.chapterText && `Chapter / scene:\n${opts.chapterText.slice(0, 6000)}`,
    opts.existingPrompts?.length &&
      `Existing prompts:\n${opts.existingPrompts.slice(0, 12).join('\n---\n')}`,
    `User request:\n${opts.userMessage}`,
  ]
    .filter(Boolean)
    .join('\n\n');

  const text = await callLlm({
    apiKey: opts.apiKey,
    system,
    user,
  });

  const parsed = extractJsonBlock(text);
  let shots = parseShots(parsed);
  let reply = '';
  if (parsed && typeof parsed === 'object' && 'reply' in parsed) {
    reply = String((parsed as { reply?: unknown }).reply ?? '');
  }

  if (!shots.length) {
    // Fallback: single refined prompt
    shots = [
      {
        index: 0,
        kind: 'image',
        prompt: applyAgentInstructions(opts.userMessage.slice(0, 800)),
      },
    ];
  }

  // Apply agent instructions to each shot prompt
  shots = shots.map((s) => ({
    ...s,
    prompt: applyAgentInstructions(s.prompt),
  }));

  if (!reply.trim()) {
    reply =
      text.replace(/```[\s\S]*?```/g, '').trim().slice(0, 1200) ||
      `Đã lập ${shots.length} shot.`;
  }

  const estimatedCredits = shots.reduce(
    (sum, s) =>
      sum +
      estimateTaskCredits({
        kind: s.kind,
        modelId:
          s.kind === 'video'
            ? FLOW_VIDEO_MODELS[0]?.id
            : FLOW_IMAGE_MODELS[0]?.id,
        quality: ops.defaultQuality,
      }),
    0,
  );

  return { reply, shots, estimatedCredits };
}
