/**
 * Data layout for independent VinaVoice runtime inside AI Novel.
 * Mirrors Vina app folders without depending on Vina-Voice.exe.
 *
 * data/vina-voices/
 *   profiles_goc.json      — catalog giọng gốc
 *   profiles_user.json     — profile user clone
 *   chunk_profiles.json    — chiến lược chunk/pause
 *   session_state.json     — defaults session (rules, pauses)
 *   help.json              — tooltips/help (từ Vina)
 *   samples/               — WAV mẫu catalog
 *   user-clones/           — WAV user upload
 *   session/               — runtime session override
 *   temp/                  — scratch TTS
 *   roles.json             — multi-role (optional)
 */
import fs from 'fs';
import path from 'path';

/**
 * Resolve data/vina-voices root.
 * Prefer AI_NOVEL_ROOT (Electron packaged = process.resourcesPath) so samples
 * shipped via extraResources are found — not only process.cwd() when Next
 * worker cwd drifts.
 */
export function getVinaRoot(cwd = process.cwd()): string {
  const candidates = [
    process.env.AI_NOVEL_ROOT
      ? path.join(process.env.AI_NOVEL_ROOT, 'data', 'vina-voices')
      : '',
    process.env.AINOVEL_DATA_ROOT
      ? path.join(process.env.AINOVEL_DATA_ROOT, 'vina-voices')
      : '',
    path.join(cwd, 'data', 'vina-voices'),
    path.join(process.cwd(), 'data', 'vina-voices'),
  ].filter(Boolean);
  for (const dir of candidates) {
    try {
      if (fs.existsSync(path.join(dir, 'profiles_goc.json'))) return dir;
      if (fs.existsSync(path.join(dir, 'samples'))) return dir;
    } catch {
      /* try next */
    }
  }
  return path.join(cwd || process.cwd(), 'data', 'vina-voices');
}

/** Locked ONNX brain filenames (must live under src/python_core/models/vina_voice/). */
export const VINA_ONNX_BRAIN_FILES = [
  'model-tts_0.onnx',
  'model-tts_1.onnx',
  'model-tts_2.onnx',
  'vocab.txt',
] as const;

/**
 * Permanent core path for Vina ONNX brain (~1.46GB).
 * Clone native ALWAYS loads from here — never tools/ or external Vina-Voice.exe.
 */
export function getVinaOnnxModelsDir(cwd = process.cwd()): string {
  return path.join(cwd, 'src', 'python_core', 'models', 'vina_voice');
}

export function getVinaInferScript(cwd = process.cwd()): string {
  return path.join(cwd, 'src', 'python_core', 'vina_voice_infer.py');
}

/**
 * Python used for ONNX clone infer. Prefer SuperAudioTools / local omnivoice runtime
 * (has onnxruntime + librosa). System `python` (e.g. 3.14) often hangs or lacks deps.
 */
export function resolveVinaPython(cwd = process.cwd()): string {
  const fromEnv = [
    process.env.VINA_PYTHON,
    process.env.OMNIVOICE_PYTHON,
    process.env.PYTHON_EXE,
  ].filter(Boolean) as string[];
  const candidates = [
    ...fromEnv,
    'D:\\SuperAudioTools\\omnivoice-python\\python.exe',
    path.join(cwd, 'omnivoice-python', 'python.exe'),
    path.join(cwd, 'runtime', 'omnivoice-python', 'python.exe'),
    path.join(cwd, 'python_core', '.venv', 'Scripts', 'python.exe'),
  ];
  for (const p of candidates) {
    try {
      if (p && fs.existsSync(p)) return p;
    } catch {
      /* ignore */
    }
  }
  return process.platform === 'win32' ? 'python.exe' : 'python';
}

/** Integrity check for locked brain assets. */
export function inspectVinaOnnxBrain(cwd = process.cwd()): {
  modelsDir: string;
  ok: boolean;
  totalBytes: number;
  totalGB: number;
  files: { name: string; exists: boolean; bytes: number }[];
  missing: string[];
} {
  const modelsDir = getVinaOnnxModelsDir(cwd);
  const files = VINA_ONNX_BRAIN_FILES.map((name) => {
    const p = path.join(modelsDir, name);
    const exists = fs.existsSync(p) && fs.statSync(p).isFile();
    const bytes = exists ? fs.statSync(p).size : 0;
    return { name, exists, bytes };
  });
  const missing = files.filter((f) => !f.exists).map((f) => f.name);
  const totalBytes = files.reduce((s, f) => s + f.bytes, 0);
  return {
    modelsDir,
    ok: missing.length === 0 && totalBytes > 1_000_000_000,
    totalBytes,
    totalGB: Math.round((totalBytes / 1024 / 1024 / 1024) * 1000) / 1000,
    files,
    missing,
  };
}

export function vinaPaths(cwd = process.cwd()) {
  const root = getVinaRoot(cwd);
  return {
    root,
    profilesGoc: path.join(root, 'profiles_goc.json'),
    profilesUser: path.join(root, 'profiles_user.json'),
    chunkProfiles: path.join(root, 'chunk_profiles.json'),
    sessionState: path.join(root, 'session_state.json'),
    sessionRuntime: path.join(root, 'session', 'runtime.json'),
    help: path.join(root, 'help.json'),
    samples: path.join(root, 'samples'),
    userClones: path.join(root, 'user-clones'),
    temp: path.join(root, 'temp'),
    roles: path.join(root, 'roles.json'),
    publicClones: path.join(cwd, 'public', 'audio', 'clones'),
    engineDir: path.join(cwd, 'tools', 'vina_voice_engine'),
    engineScript: path.join(cwd, 'tools', 'vina_voice_engine', 'engine_server.py'),
    /** Locked ONNX brain (~1.46GB) — clone native only */
    onnxModelsDir: getVinaOnnxModelsDir(cwd),
    inferScript: getVinaInferScript(cwd),
  };
}

export function ensureVinaEnvironment(cwd = process.cwd()): {
  ok: boolean;
  created: string[];
  missing: string[];
  paths: ReturnType<typeof vinaPaths>;
} {
  const p = vinaPaths(cwd);
  const created: string[] = [];
  const missing: string[] = [];

  const dirs = [
    p.root,
    p.samples,
    p.userClones,
    path.dirname(p.sessionRuntime),
    p.temp,
    p.publicClones,
  ];
  for (const d of dirs) {
    if (!fs.existsSync(d)) {
      fs.mkdirSync(d, { recursive: true });
      created.push(d);
    }
  }

  // Touch empty user profiles if missing
  if (!fs.existsSync(p.profilesUser)) {
    fs.writeFileSync(p.profilesUser, '{}', 'utf8');
    created.push(p.profilesUser);
  }
  if (!fs.existsSync(p.roles)) {
    fs.writeFileSync(
      p.roles,
      JSON.stringify(
        {
          version: 1,
          roles: [{ id: 0, name: 'Người kể', voice: '', notes: 'narrator' }],
        },
        null,
        2,
      ),
      'utf8',
    );
    created.push(p.roles);
  }

  const requiredFiles = [p.profilesGoc, p.chunkProfiles, p.sessionState, p.help];
  for (const f of requiredFiles) {
    if (!fs.existsSync(f)) missing.push(f);
  }

  // Locked ONNX brain is required for true clone (not Edge fallback)
  const brain = inspectVinaOnnxBrain(cwd);
  if (!brain.ok) {
    for (const name of brain.missing) {
      missing.push(path.join(brain.modelsDir, name));
    }
    if (brain.missing.length === 0 && brain.totalBytes <= 1_000_000_000) {
      missing.push(
        `${brain.modelsDir} (brain size ${brain.totalGB}GB < 1GB — incomplete)`,
      );
    }
  }

  return {
    ok: missing.length === 0,
    created,
    missing,
    paths: p,
  };
}
