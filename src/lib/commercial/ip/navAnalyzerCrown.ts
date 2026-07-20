/**
 * NAV analyzer crown IP — TS port of python_core script/storyboard planner prompts.
 * Cloud authority + local free/dev path share this module (like seedance.ts).
 */
import { callGoogleStudioText } from '@/lib/ttsBatchSrt/googleStudioClient';
import { AppError } from '@/lib/errors';

export const VEO_CLIP_SECONDS = 8;
export const MAX_SCRIPT_SCENES = 40;

export const STYLE_PRESETS: Record<string, string> = {
  '3D CGI Realistic':
    '3D CGI realistic style, hyper-detailed character models with lifelike proportions and anatomically correct features. Physically-based rendering (PBR) with accurate material response, realistic skin textures, detailed fabric simulation.',
  'Cinematic Live Action':
    'Cinematic live-action style, 35mm film grain, natural lighting, shallow depth of field, color-graded teal and orange, professional film production quality.',
  'Historical Documentary':
    'Historical documentary reenactment style, period-accurate costumes and architecture, warm golden hour lighting, steady tripod shots, educational tone.',
  'Anime 2D':
    'Anime 2D style, cel-shaded, Studio Ghibli inspired, vivid saturated colors, hand-drawn backgrounds, expressive character designs.',
  'Studio Ghibli':
    'Studio Ghibli hand-painted aesthetic, soft watercolor backgrounds, warm golden lighting, painterly brush textures, whimsical magical atmosphere.',
  'Pixar 3D Cartoon':
    'Pixar 3D animation style, expressive cartoon characters, smooth subsurface-scattering skin, soft volumetric studio lighting, vibrant saturated color palette.',
  'Cyberpunk Neon':
    'Cyberpunk neon aesthetic, vibrant magenta and cyan color palette, dramatic night-city lighting with glowing signage and rain reflections.',
};

export const DEFAULT_STYLE_PRESET = '3D CGI Realistic';

export const VEO3_SHOT_TYPES = [
  'extreme wide shot',
  'wide establishing shot',
  'wide shot',
  'medium wide shot',
  'medium shot',
  'medium close-up',
  'close-up',
  'extreme close-up',
  'over-the-shoulder shot',
  'POV shot',
  "bird's-eye view",
  "worm's-eye view",
  'dutch angle shot',
  'low angle shot',
  'high angle shot',
  'aerial shot',
  'profile shot',
  'two-shot',
  'group shot',
] as const;

export const VEO3_CAMERA_MOVES = [
  'static tripod shot',
  'slow dolly-in',
  'slow dolly-out',
  'smooth tracking shot left-to-right',
  'smooth tracking shot right-to-left',
  'crane shot rising',
  'crane shot descending',
  'handheld shaky cam',
  'FPV drone dive',
  'orbit shot circling subject',
  'pull-back reveal',
  'whip pan',
  'tilt up slowly',
  'tilt down slowly',
  'zoom in gradually',
  'zoom out gradually',
] as const;

export const STORYBOARD_STYLES: Array<[string, string]> = [
  ['Cinematic realistic', 'cinematic realism, natural lighting, photoreal, shallow depth of field'],
  ['Animation 2D', '2D animation style, vibrant colors, smooth motion, hand-drawn feel'],
  ['Animation 3D Pixar', '3D Pixar-style animation, soft lighting, expressive characters'],
  ['Anime', 'anime style, sharp lines, dramatic camera angles, vibrant colors'],
  ['Studio Ghibli', 'Studio Ghibli style, soft watercolor backgrounds, dreamy atmosphere'],
  ['Documentary', 'documentary footage, handheld camera, natural ambient lighting'],
  ['Cyberpunk Neon', 'cyberpunk neon aesthetic, dark moody lighting, vibrant magenta/cyan'],
];

function normalizeWhitelist(raw: string, list: readonly string[], fallback: string): string {
  const s = String(raw || '').trim().toLowerCase();
  if (!s) return fallback;
  for (const item of list) {
    if (item.toLowerCase() === s) return item;
  }
  for (const item of list) {
    if (s.includes(item.toLowerCase()) || item.toLowerCase().includes(s)) return item;
  }
  return fallback;
}

export function buildScriptPlannerPrompt(input: {
  scriptText: string;
  numScenes: number | null;
  stylePresetDesc: string;
  userGlobalContext?: string;
  voiceGender?: string;
  characterAliases?: string[];
  autoDetectScenes?: boolean;
  narrationLang?: string;
}): string {
  const aliases = (input.characterAliases || []).filter(Boolean);
  const aliasesClause = aliases.length
    ? `\n\nCHARACTER ALIASES: ${aliases.map((a) => '@' + a.replace(/^@/, '')).join(', ')}\nUse alias tokens ONLY when that character is on screen in that shot.`
    : '';
  const voice =
    input.voiceGender === 'male' || input.voiceGender === 'female'
      ? `\n\nVoiceover gender: ${input.voiceGender}.`
      : '';
  const ctx = (input.userGlobalContext || '').trim()
    ? `\n\nReuse this global context verbatim in output:\n"${(input.userGlobalContext || '').trim()}"`
    : '';
  const narrationLang = input.narrationLang || 'Vietnamese';
  const auto = Boolean(input.autoDetectScenes);
  const sceneRule = auto
    ? '1. Choose 3-20 scenes based on natural beat structure.'
    : `1. Output EXACTLY ${input.numScenes} scenes.`;
  const opening = auto
    ? `You are a video director planning a Veo 3.1 video. Each shot is ~${VEO_CLIP_SECONDS}s.`
    : `You are a video director planning a ${input.numScenes}-shot Veo 3.1 sequence. Each shot is ~${VEO_CLIP_SECONDS}s.`;

  return (
    `${opening}\n\nUSER SCRIPT:\n"""${input.scriptText.trim()}"""\n\n` +
    `VISUAL STYLE:\n${input.stylePresetDesc}\n${ctx}${voice}${aliasesClause}\n\n` +
    `Rules:\n${sceneRule}\n` +
    `2. shot_type from: ${VEO3_SHOT_TYPES.join(', ')}\n` +
    `3. camera_move from: ${VEO3_CAMERA_MOVES.join(', ')}\n` +
    '4. subject_desc in English, 30-50 words.\n' +
    `5. vi_caption in ${narrationLang}, max 25 words.\n` +
    '6. characters_in_scene lists aliases visible in that shot.\n' +
    '7. global_context is a short reusable prefix for all scenes.\n' +
    'Output ONLY JSON with keys: global_context (string), scenes (array of objects with shot_type, camera_move, subject_desc, vi_caption, characters_in_scene).'
  );
}

export function buildStoryboardPlannerPrompt(
  idea: string,
  numScenes: number,
  styleDesc: string,
): string {
  return (
    `You are a video storyboard director. Break the idea into EXACTLY ${numScenes} scenes ` +
    `for Veo 3.1 (~${VEO_CLIP_SECONDS}s each).\n\nIDEA:\n${idea}\n\n` +
    `STYLE:\n${styleDesc}\n\n` +
    'Return JSON: {"scenes": [{"prompt": "...", "vi_summary": "..."}, ...]}'
  );
}

function stripJsonFence(text: string): string {
  let s = String(text || '').trim();
  if (s.startsWith('```')) s = s.split('\n').slice(1).join('\n');
  if (s.includes('```')) s = s.split('```')[0];
  s = s.trim();
  if (!s.startsWith('{')) {
    const start = s.indexOf('{');
    const end = s.lastIndexOf('}');
    if (start >= 0 && end > start) s = s.slice(start, end + 1);
  }
  return s.trim();
}

function assemblePrompt(parts: {
  sceneNum: number;
  shotType: string;
  cameraMove: string;
  subjectDesc: string;
  styleLock: string;
  globalContext: string;
  visibleAliases: string[];
  narration: string;
  narrationLang: string;
  voiceGender: string;
}): string {
  const aliasLine =
    parts.visibleAliases.length > 0
      ? `Characters: ${parts.visibleAliases.join(', ')}. `
      : '';
  const voice =
    parts.voiceGender === 'male' || parts.voiceGender === 'female'
      ? `Voice: ${parts.voiceGender}. `
      : '';
  const narr = parts.narration
    ? `Narration (${parts.narrationLang}): ${parts.narration}. `
    : '';
  return (
    `[Scene ${parts.sceneNum}] ${parts.shotType}, ${parts.cameraMove}. ` +
    `${parts.globalContext ? parts.globalContext + ' ' : ''}` +
    `${parts.subjectDesc}. Style: ${parts.styleLock}. ${aliasLine}${voice}${narr}`
  ).trim();
}

export type Script2PromptInput = {
  text: string;
  model: string;
  apiKeys: string[];
  numScenes?: number;
  stylePreset?: string;
  globalContext?: string;
  characterAliases?: string[];
  voiceGender?: string;
  narrationLang?: string;
  autoDetectScenes?: boolean;
};

export type StoryboardInput = {
  idea: string;
  model: string;
  apiKeys: string[];
  numScenes?: number;
  style?: string;
};

/** Local authority — runs crown planner via Gemini (dev / cloud host). */
export async function runScript2PromptLocal(input: Script2PromptInput): Promise<{
  success: true;
  result: Record<string, unknown>;
  source: 'nav-analyzer-local';
}> {
  const text = String(input.text || '').trim();
  if (!text) throw new AppError('Missing "text"', { code: 'VALIDATION', status: 400 });
  const model = String(input.model || '').trim();
  if (!model) {
    throw new AppError('Gemini model is required; AI Novel does not choose a fallback model', {
      code: 'VALIDATION',
      status: 400,
    });
  }
  const keys = (input.apiKeys || []).filter(Boolean);
  if (!keys.length) throw new AppError('Gemini API key required', { code: 'AUTH', status: 400 });

  const styleLock = String(input.stylePreset || DEFAULT_STYLE_PRESET).trim() || DEFAULT_STYLE_PRESET;
  const styleDesc = STYLE_PRESETS[styleLock] || STYLE_PRESETS[DEFAULT_STYLE_PRESET];
  const n = Math.max(1, Math.min(Number(input.numScenes) || 8, MAX_SCRIPT_SCENES));
  const auto = Boolean(input.autoDetectScenes);
  const aliases = (input.characterAliases || []).map((a) => String(a).replace(/^@/, '').trim()).filter(Boolean);
  const narrationLang = input.narrationLang || 'Vietnamese';
  const voiceGender = String(input.voiceGender || '');

  const prompt = buildScriptPlannerPrompt({
    scriptText: text,
    numScenes: auto ? null : n,
    stylePresetDesc: styleDesc,
    userGlobalContext: input.globalContext || '',
    voiceGender,
    characterAliases: aliases,
    autoDetectScenes: auto,
    narrationLang,
  });

  const raw = await callGoogleStudioText({
    prompt,
    apiKeys: keys,
    temperature: 0.4,
    maxOutputTokens: 8192,
    models: [model],
  });
  let data: { global_context?: string; scenes?: unknown[] };
  try {
    data = JSON.parse(stripJsonFence(raw)) as typeof data;
  } catch {
    throw new AppError('Script2Prompt: Gemini JSON parse fail', { code: 'PROVIDER', status: 502 });
  }
  const globalCtx = String(data.global_context || input.globalContext || '').trim();
  const rawScenes = Array.isArray(data.scenes) ? data.scenes : [];
  const scenes: Record<string, unknown>[] = [];
  for (let i = 0; i < rawScenes.length; i++) {
    const rawS = rawScenes[i];
    if (!rawS || typeof rawS !== 'object') continue;
    const r = rawS as Record<string, unknown>;
    const shot = normalizeWhitelist(String(r.shot_type || ''), VEO3_SHOT_TYPES, 'medium shot');
    const cam = normalizeWhitelist(String(r.camera_move || ''), VEO3_CAMERA_MOVES, 'static tripod shot');
    const subject = String(r.subject_desc || '')
      .replace(/^SCENE[_\s]?\d+[.:\s]+/i, '')
      .trim();
    const vi = String(r.vi_caption || '').trim();
    const allowed = new Set(aliases);
    const chars: string[] = [];
    for (const c of (r.characters_in_scene as unknown[]) || []) {
      if (typeof c !== 'string') continue;
      const clean = c.replace(/^@/, '').trim();
      if (allowed.has(clean)) chars.push('@' + clean);
    }
    const idx = scenes.length + 1;
    scenes.push({
      scene_num: idx,
      shot_type: shot,
      camera_move: cam,
      subject_desc: subject,
      narration: vi,
      prompt: assemblePrompt({
        sceneNum: idx,
        shotType: shot,
        cameraMove: cam,
        subjectDesc: subject,
        styleLock,
        globalContext: globalCtx,
        visibleAliases: chars,
        narration: vi,
        narrationLang,
        voiceGender,
      }),
      characters_in_scene: chars,
      transcripts: vi,
      frame: '',
      confidence: 1,
      start: (idx - 1) * VEO_CLIP_SECONDS,
      end: idx * VEO_CLIP_SECONDS,
      duration: VEO_CLIP_SECONDS,
    });
    if (!auto && scenes.length >= n) break;
  }
  if (!scenes.length) {
    throw new AppError('Script2Prompt: no scenes from model', { code: 'PROVIDER', status: 502 });
  }
  return {
    success: true,
    result: {
      scenes,
      warnings: [],
      raw_scenes: rawScenes,
      transcripts: Object.fromEntries(scenes.map((s) => [String(s.scene_num), s.narration])),
      generated_global_context: globalCtx,
      title: 'User script',
      duration: scenes.length * VEO_CLIP_SECONDS,
    },
    source: 'nav-analyzer-local',
  };
}

export async function runStoryboardLocal(input: StoryboardInput): Promise<{
  success: true;
  scenes: Array<{ prompt: string; vi_summary: string }>;
  source: 'nav-analyzer-local';
}> {
  const idea = String(input.idea || '').trim();
  if (!idea) throw new AppError('Missing "idea"', { code: 'VALIDATION', status: 400 });
  const model = String(input.model || '').trim();
  if (!model) {
    throw new AppError('Gemini model is required; AI Novel does not choose a fallback model', {
      code: 'VALIDATION',
      status: 400,
    });
  }
  const keys = (input.apiKeys || []).filter(Boolean);
  if (!keys.length) throw new AppError('Gemini API key required', { code: 'AUTH', status: 400 });

  const num = Math.max(2, Math.min(Number(input.numScenes) || 6, 20));
  const styleLabel = String(input.style || STORYBOARD_STYLES[0][0]);
  const styleDesc =
    STORYBOARD_STYLES.find(([l]) => l === styleLabel)?.[1] || STORYBOARD_STYLES[0][1];
  const prompt = buildStoryboardPlannerPrompt(idea, num, styleDesc);
  const raw = await callGoogleStudioText({
    prompt,
    apiKeys: keys,
    temperature: 0.5,
    maxOutputTokens: 8192,
    models: [model],
  });
  let data: { scenes?: unknown[] };
  try {
    data = JSON.parse(stripJsonFence(raw)) as typeof data;
  } catch {
    throw new AppError('Storyboard: Gemini JSON parse fail', {
      code: 'PROVIDER',
      status: 502,
    });
  }
  const clean: Array<{ prompt: string; vi_summary: string }> = [];
  for (const s of data.scenes || []) {
    if (!s || typeof s !== 'object') continue;
    const o = s as Record<string, unknown>;
    const p = String(o.prompt || '').trim();
    const summary = String(o.vi_summary || '').trim();
    if (p) clean.push({ prompt: p, vi_summary: summary || '(không có mô tả)' });
    if (clean.length >= num) break;
  }
  if (!clean.length) {
    throw new AppError('Storyboard: no scenes', { code: 'PROVIDER', status: 502 });
  }
  return { success: true, scenes: clean, source: 'nav-analyzer-local' };
}
