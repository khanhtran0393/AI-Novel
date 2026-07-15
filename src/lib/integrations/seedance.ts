/**
 * Seedance 2.0 directing bridge — compiles AI Novel scene text into
 * production-ready video prompts using the Director Formula
 * (Subject + Action + Scene + Camera + Lighting + Audio + Constraints).
 *
 * Knowledge distilled from D:\repo\seedance-2.0-main (prompt skill + directing engine).
 * Does not call Seedance API itself — enhances prompts for existing generate-video routes.
 */
import fs from 'fs';
import path from 'path';
import { ensureWorkDirs, getIntegrationPaths } from './paths';

export type SeedanceMode = 'T2V' | 'I2V' | 'V2V' | 'R2V' | 'FLF2V' | 'edit' | 'extend';

export type SceneFunction =
  | 'intimate_dialogue'
  | 'confrontation'
  | 'reveal'
  | 'decision'
  | 'arrival'
  | 'pursuit'
  | 'transformation'
  | 'comedy'
  | 'emotional_low'
  | 'product_hero'
  | 'generic';

export interface SeedanceCompileInput {
  sceneText: string;
  characterHints?: string[];
  environmentHint?: string;
  styleHint?: string;
  mode?: SeedanceMode;
  hasStartImage?: boolean;
  hasEndImage?: boolean;
  durationSec?: number;
  language?: 'en' | 'vi' | 'zh' | 'mixed';
  genre?: string;
}

export interface SeedanceCompileResult {
  mode: SeedanceMode;
  function: SceneFunction;
  intention: string;
  prompt: string;
  promptZh?: string;
  camera: string;
  lighting: string;
  audio: string;
  constraints: string;
  antiSlopNotes: string[];
  source: 'seedance-bridge-v1';
}

const SCENE_FUNCTION_STACK: Record<
  SceneFunction,
  { camera: string; lighting: string; performance: string; refuse: string }
> = {
  intimate_dialogue: {
    camera: 'medium close-up to close-up, eye-level, longer lens, minimal motion',
    lighting: 'soft motivated key, low fill, intimate ratio',
    performance: 'micro-behavior: held look, swallowed line, hands betraying calm',
    refuse: 'roaming camera and big coverage that break intimacy',
  },
  confrontation: {
    camera: 'opposed angles, height encodes status, lens isolates each subject',
    lighting: 'split warm/cool keys, high contrast ratio',
    performance: 'stillness as dominance; small loss of composure as the turn',
    refuse: 'symmetrical neutrality that erases the power gap',
  },
  reveal: {
    camera: 'withhold then disclose — frame conceals, then move or light uncovers',
    lighting: 'light change lands with the discovery',
    performance: 'the reaction is the shot; play recognition, not the object',
    refuse: 'showing everything at once with no withholding',
  },
  decision: {
    camera: 'slow push-in isolating the chooser; locked endpoint',
    lighting: 'world quiets; light may shift on the commit',
    performance: 'one decisive physical action with clear before and after',
    refuse: 'dialogue doing the work the body should do',
  },
  arrival: {
    camera: 'wide or medium-wide, motivated move that places subject in space',
    lighting: 'motivated environmental light',
    performance: 'posture and pace that read status at distance',
    refuse: 'pretty empty vista with no subject relationship',
  },
  pursuit: {
    camera: 'tracking or handheld energy, screen-direction discipline',
    lighting: 'contrast light, motion-readable edges',
    performance: 'effort and consequence visible — weight, recovery, near-miss',
    refuse: 'stacked micro-actions that read as chaos',
  },
  transformation: {
    camera: 'locked or controlled so the change is legible',
    lighting: 'light tracks the change',
    performance: 'subject responds to the change rather than narrating it',
    refuse: 'spectacle with no anchor or aftermath',
  },
  comedy: {
    camera: 'locked frame, clean geography, deadpan hold',
    lighting: 'even, readable, no melodrama',
    performance: 'commitment and restraint; hold past comfort',
    refuse: 'busy camera that steps on timing',
  },
  emotional_low: {
    camera: 'distance and stillness, negative space, observe not push',
    lighting: 'cool soft light',
    performance: 'containment — smallest true gesture, withheld release',
    refuse: 'score-driven sentiment and intrusive moving camera',
  },
  product_hero: {
    camera: 'controlled move from context to detail',
    lighting: 'motivated hero light on material',
    performance: 'one honest use action if person present',
    refuse: 'dynamic product camera with drifting identity',
  },
  generic: {
    camera: 'medium shot, eye-level, one motivated move with clear endpoint',
    lighting: 'motivated practical key, natural color',
    performance: 'one legible physical action for the beat',
    refuse: 'stacked adjectives and multi-event chaos',
  },
};

const SLOP_WORDS = [
  'cinematic',
  'epic',
  'beautiful',
  'stunning',
  'breathtaking',
  'masterpiece',
  '8k',
  '4k',
  'ultra detailed',
  'best quality',
  'award-winning',
  'hyperrealistic',
];

function detectSceneFunction(text: string): SceneFunction {
  const t = text.toLowerCase().normalize('NFC');
  if (/đối đầu|đối chất|confrontation|power|áp lực|hăm dọa|threaten/.test(t)) return 'confrontation';
  if (/phát hiện|reveal|bất ngờ|lộ ra|discover|vạch trần/.test(t)) return 'reveal';
  if (/quyết định|lựa chọn|decision|turning|bước ngoặt/.test(t)) return 'decision';
  if (/đuổi|truy|chase|pursuit|chạy trốn|escape|action/.test(t)) return 'pursuit';
  if (/biến đổi|transform|thức tỉnh|mutation|awakening/.test(t)) return 'transformation';
  if (/hài|cười|comedy|joke|mỉa mai/.test(t)) return 'comedy';
  if (/đau|buồn|cô đơn|grief|despair|sụp đổ|emotional/.test(t)) return 'emotional_low';
  if (/đến|arrival|xuất hiện|establishing|thành phố|bước vào/.test(t)) return 'arrival';
  if (/nói|dialogue|thì thầm|hồi đáp|trò chuyện/.test(t)) return 'intimate_dialogue';
  return 'generic';
}

function stripSlop(text: string): { text: string; removed: string[] } {
  let out = text;
  const removed: string[] = [];
  for (const w of SLOP_WORDS) {
    const re = new RegExp(`\\b${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi');
    if (re.test(out)) {
      removed.push(w);
      out = out.replace(re, '');
    }
  }
  out = out.replace(/\s{2,}/g, ' ').replace(/\s+,/g, ',').trim();
  return { text: out, removed };
}

function extractVisibleAction(sceneText: string): string {
  const cleaned = sceneText.normalize('NFC').replace(/\s+/g, ' ').trim();
  if (cleaned.length <= 220) return cleaned;
  // Prefer first sentence-like unit as the visible beat
  const parts = cleaned.split(/(?<=[.!?…。！？])\s+/);
  return (parts[0] || cleaned).slice(0, 220);
}

function buildIntention(fn: SceneFunction, action: string): string {
  const map: Record<SceneFunction, string> = {
    intimate_dialogue: 'make the audience feel the private pressure between speakers',
    confrontation: 'make the audience feel power shift in the space between rivals',
    reveal: 'make the audience discover the truth with the subject',
    decision: 'make the audience feel the cost of the choice as it is committed',
    arrival: 'place the subject in a world that already has rules and danger',
    pursuit: 'make stakes legible in motion — effort, near-miss, consequence',
    transformation: 'prove the change on screen with one cause and visible aftermath',
    comedy: 'hold timing so the absurd action lands clean',
    emotional_low: 'make isolation read in distance, stillness, and withheld release',
    product_hero: 'make the object desirable through controlled, honest detail',
    generic: 'deliver one visible beat with coherent camera, light, and body language',
  };
  return `${map[fn]} — beat: ${action.slice(0, 80)}`;
}

export function compileSeedancePrompt(input: SeedanceCompileInput): SeedanceCompileResult {
  const mode: SeedanceMode =
    input.mode ||
    (input.hasStartImage && input.hasEndImage
      ? 'FLF2V'
      : input.hasStartImage
        ? 'I2V'
        : 'T2V');

  const fn = detectSceneFunction(input.sceneText);
  const stack = SCENE_FUNCTION_STACK[fn];
  const action = extractVisibleAction(input.sceneText);
  const { text: cleanAction, removed } = stripSlop(action);
  const subjects =
    (input.characterHints || []).filter(Boolean).slice(0, 4).join(', ') ||
    'the primary character established in the novel';
  const scene =
    input.environmentHint?.trim() ||
    'environment implied by the chapter lore — no generic empty backdrop';
  const style = input.styleHint?.trim() || input.genre || 'dark survival realism, matte world, grounded debris';
  const duration = input.durationSec && input.durationSec > 0 ? input.durationSec : 5;

  const i2vLead =
    mode === 'I2V' || mode === 'FLF2V'
      ? 'Preserve @Image1 identity, wardrobe, face geometry, and framing exactly. Describe only motion, camera, light change, audio, and constraints. '
      : '';

  const flf =
    mode === 'FLF2V'
      ? ' @Image2 is the final visual target; continuous transition only.'
      : '';

  const promptParts = [
    i2vLead + subjects + '.',
    `Action (${duration}s, one visible beat): ${cleanAction}.`,
    `Scene: ${scene}.`,
    `Camera: ${stack.camera}.`,
    `Lighting/Style: ${stack.lighting}; ${style}.`,
    `Performance: ${stack.performance}.`,
    `Sound: sparse ambient bed; one motivated cue; no wall-to-wall score.`,
    `Constraints: one main subject focus; one camera move; no time-skip montage; refuse ${stack.refuse}; keep character consistency locks; do not invent logos or celebrity likeness.`,
    flf,
  ]
    .filter(Boolean)
    .join(' ')
    .replace(/\s{2,}/g, ' ')
    .trim();

  const intention = buildIntention(fn, cleanAction);

  // Optional compact Chinese variant for models that respond better to 中文 craft terms
  const promptZh = [
    mode === 'I2V' || mode === 'FLF2V' ? '严格保持@Image1人物身份与构图。' : '',
    `主体：${subjects}。动作（${duration}秒，单节拍）：${cleanAction.slice(0, 160)}。`,
    `场景：${scene}。镜头：${stack.camera}。光影：${stack.lighting}；风格：${style}。`,
    '音频：低环境音+一个动机音效。约束：单主体、单运镜、禁止堆叠形容词与时间跳跃。',
  ]
    .filter(Boolean)
    .join('');

  return {
    mode,
    function: fn,
    intention,
    prompt: promptParts,
    promptZh,
    camera: stack.camera,
    lighting: stack.lighting,
    audio: 'sparse ambient + one motivated cue',
    constraints: `refuse: ${stack.refuse}`,
    antiSlopNotes: removed.length
      ? removed.map((w) => `stripped slop word: ${w}`)
      : ['no hollow quality boosters detected'],
    source: 'seedance-bridge-v1',
  };
}

/**
 * Still-image director formula for image_prompt (T2V still).
 * Keeps shot-scale prefixes from shot graph; strips slop; locks subject + light + frame.
 */
export function compileStillImagePrompt(input: {
  sceneText: string;
  characterHints?: string[];
  styleHint?: string;
  genre?: string;
  /** Existing shot-scale prefix e.g. "wide establishing shot, full environment..." */
  shotScalePrefix?: string;
}): SeedanceCompileResult {
  const fn = detectSceneFunction(input.sceneText);
  const stack = SCENE_FUNCTION_STACK[fn];
  const raw = extractVisibleAction(input.sceneText);
  const { text: cleanSubject, removed } = stripSlop(raw);
  const subjects =
    (input.characterHints || []).filter(Boolean).slice(0, 4).join(', ') ||
    'the primary character established in the novel';
  const style =
    input.styleHint?.trim() ||
    input.genre ||
    'dark survival realism, matte debris world, grounded materials';

  // Still framing language (no time-based Action slot — still frame only)
  const body = [
    subjects + '.',
    `Still frame beat: ${cleanSubject}.`,
    `Framing: ${stack.camera}.`,
    `Lighting: ${stack.lighting}; ${style}.`,
    `Pose/gesture: ${stack.performance}.`,
    `Constraints: single clear subject; no collage; no text overlay; no watermark; refuse ${stack.refuse}; keep face and wardrobe identity locks; photoreal or painted consistency with visual DNA; no hollow quality boosters.`,
  ].join(' ');

  const prefix = (input.shotScalePrefix || '').trim();
  const prompt = (prefix ? `${prefix.replace(/,?\s*$/, '')}, ${body}` : body)
    .replace(/\s{2,}/g, ' ')
    .trim();

  return {
    mode: 'T2V',
    function: fn,
    intention: buildIntention(fn, cleanSubject),
    prompt,
    camera: stack.camera,
    lighting: stack.lighting,
    audio: 'n/a still',
    constraints: `refuse: ${stack.refuse}`,
    antiSlopNotes: removed.length
      ? removed.map((w) => `stripped slop word: ${w}`)
      : ['no hollow quality boosters detected'],
    source: 'seedance-bridge-v1',
  };
}

/** Extract leading shot-scale clause if present (from applyShotScaleToPrompt). */
export function extractShotScalePrefix(imagePrompt: string): {
  prefix: string;
  rest: string;
} {
  const s = (imagePrompt || '').trim();
  // Common prefixes from SHOT_SCALE_CYCLE in youtubeSafe
  const known = [
    /^wide establishing shot[^,]*(?:,\s*[^,]+)?(?:,\s*[^,]+)?/i,
    /^medium shot[^,]*(?:,\s*[^,]+)?/i,
    /^close-?up[^,]*(?:,\s*[^,]+)?/i,
    /^insert detail shot[^,]*(?:,\s*[^,]+)?/i,
    /^over-the-shoulder[^,]*(?:,\s*[^,]+)?/i,
  ];
  for (const re of known) {
    const m = s.match(re);
    if (m) {
      const prefix = m[0].trim();
      const rest = s.slice(prefix.length).replace(/^,\s*/, '').trim();
      return { prefix, rest: rest || s };
    }
  }
  return { prefix: '', rest: s };
}

/**
 * Apply full formula pack to a prompt pair after AI + shot graph.
 * - image_prompt → still director + anti-slop (+ keep scale prefix)
 * - video_prompt → I2V director + anti-slop
 */
export function applyDirectorFormulasToPromptPair(input: {
  imagePrompt: string;
  videoPrompt: string;
  characterHints?: string[];
  styleHint?: string;
  genre?: string;
  durationSec?: number;
}): {
  image_prompt: string;
  video_prompt: string;
  imageMeta: SeedanceCompileResult;
  videoMeta: SeedanceCompileResult;
} {
  const { prefix, rest } = extractShotScalePrefix(input.imagePrompt);
  const imageMeta = compileStillImagePrompt({
    sceneText: rest || input.imagePrompt,
    characterHints: input.characterHints,
    styleHint: input.styleHint,
    genre: input.genre,
    shotScalePrefix: prefix,
  });
  const videoMeta = compileSeedancePrompt({
    sceneText: input.videoPrompt || rest || input.imagePrompt,
    characterHints: input.characterHints,
    styleHint: input.styleHint,
    genre: input.genre,
    hasStartImage: true,
    durationSec: input.durationSec,
  });
  return {
    image_prompt: imageMeta.prompt,
    video_prompt: videoMeta.prompt,
    imageMeta,
    videoMeta,
  };
}

const DEFAULT_ANGLE_FRAMING: Record<string, string> = {
  front:
    'front view, facing camera, full-body or waist-up character turnaround, neutral stance, centered',
  three_quarter:
    'three-quarter view, 3/4 angle, character turnaround, same identity as front view',
  side: 'strict side profile view, 90-degree profile, character turnaround, same identity',
  back: 'rear view from behind, back of head and outfit visible, character turnaround, same identity',
};

const DEFAULT_EMOTION_FACE: Record<string, string> = {
  neutral: 'neutral calm expression, relaxed facial muscles, soft gaze',
  happy: 'genuine subtle smile, lifted cheeks, warm eyes',
  sad: 'downcast eyes, slight frown, melancholic expression',
  angry: 'furrowed brows, tense jaw, sharp intense eyes',
  fear: 'widened eyes, raised brows, tight lips, fearful tension',
  surprised: 'raised eyebrows, open eyes, slightly parted lips',
  determined: 'focused narrowed eyes, firm mouth, resolute expression',
  pain: 'winced eyes, clenched jaw, strained brow, restrained pain',
};

/**
 * Apply still director formula to character sheet outputs:
 * master prompt + angle_prompts + expression_prompts.
 * Keeps identity lock text; strips slop; locks framing per angle/emotion.
 */
export function applyCharacterSheetFormulas(input: {
  name: string;
  prompt?: string;
  angle_prompts?: Record<string, string> | null;
  expression_prompts?: Record<string, string> | null;
  styleHint?: string;
  genre?: string;
  angleFraming?: Record<string, string>;
  emotionFace?: Record<string, string>;
}): {
  prompt: string;
  angle_prompts: Record<string, string>;
  expression_prompts: Record<string, string>;
} {
  const name = (input.name || 'character').trim();
  const style =
    input.styleHint ||
    'dark survival realism, matte debris world, grounded costume materials, identity lock';
  const genre = input.genre || 'dark survival / mạt thế';
  const angleFraming = { ...DEFAULT_ANGLE_FRAMING, ...(input.angleFraming || {}) };
  const emotionFace = { ...DEFAULT_EMOTION_FACE, ...(input.emotionFace || {}) };

  const masterRaw = (input.prompt || '').trim() || `${name} portrait identity lock`;
  const master = compileStillImagePrompt({
    sceneText: masterRaw,
    characterHints: [name],
    styleHint: style,
    genre,
    shotScalePrefix:
      'portrait identity lock, front-facing, neutral expression, chest-up or waist-up',
  });

  const angle_prompts: Record<string, string> = {};
  const anglesIn = input.angle_prompts && typeof input.angle_prompts === 'object' ? input.angle_prompts : {};
  const angleKeys = Object.keys(anglesIn).length
    ? Object.keys(anglesIn)
    : Object.keys(angleFraming);
  for (const key of angleKeys) {
    const raw = (anglesIn[key] || masterRaw).trim();
    const framing = angleFraming[key] || 'character turnaround, consistent identity';
    const directed = compileStillImagePrompt({
      sceneText: raw,
      characterHints: [name],
      styleHint: style,
      genre,
      shotScalePrefix: framing,
    });
    angle_prompts[key] = directed.prompt;
  }

  const expression_prompts: Record<string, string> = {};
  const exprIn =
    input.expression_prompts && typeof input.expression_prompts === 'object'
      ? input.expression_prompts
      : {};
  const emotionKeys = Object.keys(exprIn).length
    ? Object.keys(exprIn)
    : Object.keys(emotionFace);
  for (const key of emotionKeys) {
    const raw = (exprIn[key] || masterRaw).trim();
    const face = emotionFace[key] || 'controlled facial expression';
    const directed = compileStillImagePrompt({
      sceneText: `${raw}. ${face}`,
      characterHints: [name],
      styleHint: style,
      genre,
      shotScalePrefix:
        'close-up face portrait, same face lock and distinctive marks, only expression changes',
    });
    expression_prompts[key] = directed.prompt;
  }

  return {
    prompt: master.prompt,
    angle_prompts,
    expression_prompts,
  };
}

export function compileSeedanceBatch(
  scenes: Array<{
    id: string;
    text: string;
    characters?: string[];
    environment?: string;
    hasStartImage?: boolean;
    durationSec?: number;
  }>,
  opts?: { styleHint?: string; genre?: string },
): Array<SeedanceCompileResult & { id: string }> {
  return scenes.map((s) => ({
    id: s.id,
    ...compileSeedancePrompt({
      sceneText: s.text,
      characterHints: s.characters,
      environmentHint: s.environment,
      hasStartImage: s.hasStartImage,
      durationSec: s.durationSec,
      styleHint: opts?.styleHint,
      genre: opts?.genre,
    }),
  }));
}

export function persistSeedanceCompile(
  result: SeedanceCompileResult | Array<SeedanceCompileResult & { id?: string }>,
  label = 'compile',
): string {
  const paths = getIntegrationPaths();
  ensureWorkDirs(paths);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const file = path.join(paths.seedanceWork, `${label}_${stamp}.json`);
  fs.writeFileSync(file, JSON.stringify(result, null, 2), 'utf8');
  return file;
}

export function seedanceRepoReady(): boolean {
  const p = getIntegrationPaths();
  return (
    fs.existsSync(path.join(p.seedance, 'SKILL.md')) ||
    fs.existsSync(path.join(p.seedance, 'skills', 'seedance-prompt', 'SKILL.md'))
  );
}

/** Load optional reference snippets from the Seedance repo (read-only). */
export function loadSeedanceReference(relPath: string, maxChars = 4000): string | null {
  const p = getIntegrationPaths();
  const full = path.join(p.seedance, relPath);
  if (!fs.existsSync(full)) return null;
  try {
    const raw = fs.readFileSync(full, 'utf8');
    return raw.slice(0, maxChars);
  } catch {
    return null;
  }
}
