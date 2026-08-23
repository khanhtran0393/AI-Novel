/**
 * MiroFish-inspired what-if / swarm simulation bridge for AI Novel.
 *
 * Full MiroFish (Zep graph + OASIS multi-agent) needs Docker + ZEP_API_KEY.
 * This bridge provides:
 *  1) Native in-process multi-persona what-if using the app's Gemini keys
 *  2) Optional health probe to MiroFish backend (:5001) if user runs it separately
 */
import fs from 'fs';
import path from 'path';
import { ensureWorkDirs, getIntegrationPaths } from './paths';
import { DEFAULT_GEMINI_TEXT_MODEL } from '@/lib/geminiModels';

export const MIROFISH_DEFAULT_URL = process.env.AINOVEL_MIROFISH_URL || 'http://127.0.0.1:5001';

export interface MiroPersona {
  name: string;
  role: string;
  goal: string;
  flaw: string;
}

export interface WhatIfInput {
  title: string;
  lorebook?: string;
  chapterSummary?: string;
  characters?: Array<{ name: string; gender?: string; notes?: string }>;
  hypothesis: string;
  rounds?: number;
  apiKey?: string;
  apiKeys?: string[];
}

export interface WhatIfRound {
  round: number;
  speaker: string;
  action: string;
  innerThought: string;
  worldDelta: string;
}

export interface WhatIfResult {
  success: boolean;
  mode: 'native-swarm' | 'mirofish-proxy';
  hypothesis: string;
  personas: MiroPersona[];
  rounds: WhatIfRound[];
  predictionReport: string;
  plotHooks: string[];
  savedPath?: string;
  error?: string;
  external?: { url: string; reachable: boolean; detail?: string };
}

function pickKey(input: WhatIfInput): string | null {
  const keys = [
    ...(input.apiKey ? [input.apiKey] : []),
    ...(input.apiKeys || []),
  ]
    .map((k) => k.trim())
    .filter(Boolean);
  return keys[0] || null;
}

function buildPersonas(input: WhatIfInput): MiroPersona[] {
  const fromChars = (input.characters || []).slice(0, 6).map((c) => ({
    name: c.name,
    role: c.notes?.slice(0, 80) || 'character in the novel world',
    goal: `Survive and advance personal agenda under hypothesis: ${input.hypothesis.slice(0, 60)}`,
    flaw: 'apocalypse scar / trust deficit',
  }));

  if (fromChars.length >= 2) return fromChars;

  // IRON B10: không nhồi persona giả Protagonist/Antagonist
  throw new Error(
    `Mirofish: cần ≥2 nhân vật trong danh sách (hiện ${fromChars.length}). ` +
      `Không seed persona fallback. Thêm nhân vật trong Sidebar rồi chạy lại.`,
  );
}

async function callGeminiJson(apiKey: string, prompt: string): Promise<string> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${DEFAULT_GEMINI_TEXT_MODEL}:generateContent`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': apiKey,
    },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.85,
        maxOutputTokens: 4096,
        responseMimeType: 'application/json',
      },
    }),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Gemini ${res.status}: ${t.slice(0, 400)}`);
  }
  const data = (await res.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('') || '';
  if (!text) throw new Error('Empty Gemini response');
  return text;
}

function parseWhatIfJson(raw: string): {
  rounds: WhatIfRound[];
  predictionReport: string;
  plotHooks: string[];
} {
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(raw);
  } catch {
    const m = raw.match(/\{[\s\S]*\}/);
    if (!m) throw new Error('Could not parse what-if JSON');
    parsed = JSON.parse(m[0]);
  }

  const roundsRaw = Array.isArray(parsed.rounds) ? parsed.rounds : [];
  const rounds: WhatIfRound[] = roundsRaw.map((r: Record<string, unknown>, i: number) => ({
    round: Number(r.round) || i + 1,
    speaker: String(r.speaker || r.name || 'Unknown'),
    action: String(r.action || ''),
    innerThought: String(r.innerThought || r.thought || ''),
    worldDelta: String(r.worldDelta || r.delta || ''),
  }));

  const hooks = Array.isArray(parsed.plotHooks)
    ? (parsed.plotHooks as unknown[]).map(String)
    : Array.isArray(parsed.hooks)
      ? (parsed.hooks as unknown[]).map(String)
      : [];

  return {
    rounds,
    predictionReport: String(parsed.predictionReport || parsed.report || ''),
    plotHooks: hooks,
  };
}

export async function probeMirofishBackend(
  baseUrl = MIROFISH_DEFAULT_URL,
): Promise<{ reachable: boolean; detail: string }> {
  try {
    const res = await fetch(baseUrl, { method: 'GET', signal: AbortSignal.timeout(2500) });
    return { reachable: true, detail: `HTTP ${res.status}` };
  } catch (err) {
    return { reachable: false, detail: (err as Error).message };
  }
}

/**
 * Native swarm what-if: multi-persona simulation for plot branching.
 * Inspired by MiroFish vision (seed + agents + prediction report) without Zep dependency.
 */
export async function runNativeWhatIf(input: WhatIfInput): Promise<WhatIfResult> {
  const personas = buildPersonas(input);
  const external = await probeMirofishBackend();
  const key = pickKey(input);

  if (!key) {
    return {
      success: false,
      mode: 'native-swarm',
      hypothesis: input.hypothesis,
      personas,
      rounds: [],
      predictionReport: '',
      plotHooks: [],
      error: 'Missing Gemini API key for native swarm what-if',
      external: { url: MIROFISH_DEFAULT_URL, ...external },
    };
  }

  const rounds = Math.min(Math.max(input.rounds || 4, 2), 8);
  const personaBlock = personas
    .map((p) => `- ${p.name} | role: ${p.role} | goal: ${p.goal} | flaw: ${p.flaw}`)
    .join('\n');

  const prompt = `You are MiroFish-style swarm intelligence for a Vietnamese dark novel sandbox.
Simulate free interaction of personas under a hypothesis. Output STRICT JSON only.

Title: ${input.title}
Lorebook:
${(input.lorebook || '').slice(0, 3000)}

Chapter summary:
${(input.chapterSummary || '').slice(0, 2500)}

Personas:
${personaBlock}

Hypothesis (inject as God variable): ${input.hypothesis}

Simulate ${rounds} interaction rounds. Each round: one persona acts, others react implicitly via worldDelta.
Then write a prediction report (Vietnamese) and 3-6 concrete plot hooks the author can write next.

JSON schema:
{
  "rounds": [
    { "round": 1, "speaker": "", "action": "", "innerThought": "", "worldDelta": "" }
  ],
  "predictionReport": "long vietnamese report",
  "plotHooks": ["hook1", "hook2"]
}`;

  try {
    const raw = await callGeminiJson(key, prompt);
    const parsed = parseWhatIfJson(raw);

    const paths = getIntegrationPaths();
    ensureWorkDirs(paths);
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const savedPath = path.join(paths.mirofishWork, `whatif_${stamp}.json`);
    const payload = {
      title: input.title,
      hypothesis: input.hypothesis,
      personas,
      ...parsed,
      mode: 'native-swarm',
      at: new Date().toISOString(),
      mirofishBackend: external,
    };
    fs.writeFileSync(savedPath, JSON.stringify(payload, null, 2), 'utf8');

    return {
      success: true,
      mode: 'native-swarm',
      hypothesis: input.hypothesis,
      personas,
      rounds: parsed.rounds,
      predictionReport: parsed.predictionReport,
      plotHooks: parsed.plotHooks,
      savedPath,
      external: { url: MIROFISH_DEFAULT_URL, ...external },
    };
  } catch (err) {
    return {
      success: false,
      mode: 'native-swarm',
      hypothesis: input.hypothesis,
      personas,
      rounds: [],
      predictionReport: '',
      plotHooks: [],
      error: (err as Error).message,
      external: { url: MIROFISH_DEFAULT_URL, ...external },
    };
  }
}

export function mirofishRepoReady(): boolean {
  const p = getIntegrationPaths();
  return fs.existsSync(path.join(p.mirofish, 'backend', 'run.py'));
}

export function mirofishStatus() {
  const paths = getIntegrationPaths();
  return {
    ready: mirofishRepoReady(),
    path: paths.mirofish,
    backend: paths.mirofishBackend,
    defaultUrl: MIROFISH_DEFAULT_URL,
    note: 'Native swarm runs in-process. Full MiroFish needs Docker + ZEP_API_KEY on :5001.',
  };
}
