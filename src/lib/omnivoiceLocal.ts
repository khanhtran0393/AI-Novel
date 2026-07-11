/**
 * OmniVoice Local — ensure server + resolve library voice → clone synthesis.
 *
 * Root causes đã gặp:
 * 1) App hardcode port 23456 trong khi omnivoice-server mặc định 8880
 * 2) Server không tự bật khi SuperAudioTools.exe không chạy
 * 3) Catalog chỉ gửi library id (omnivoice_preset_…) thay vì clone:<profile>
 *    hoặc multipart ref_audio — server trả 422 Unsupported voice
 * 4) voiceId trong library trỏ E:\SuperFreeVoice\... (máy cũ) trong khi file
 *    thực tế nằm ở public/omnivoice-refs hoặc D:\SuperAudioTools\omnivoice-refs
 */

import fs from 'fs';
import path from 'path';
import { spawn, type ChildProcess } from 'child_process';

export type OmniLibraryEntry = {
  id: string;
  name?: string;
  gender?: string;
  language?: string;
  location?: string;
  style?: string;
  voiceId?: string;
  refText?: string;
  previewUrl?: string;
  createdAt?: string;
};

export type OmniSynthResult = {
  buffer: Buffer;
  method: string;
  baseUrl: string;
  mode: 'clone-profile' | 'clone-upload' | 'design-preset';
};

const DEFAULT_PORTS = [8880, 23456] as const;
const OPENAI_PRESETS = new Set([
  'alloy',
  'ash',
  'ballad',
  'cedar',
  'coral',
  'echo',
  'fable',
  'marin',
  'nova',
  'onyx',
  'sage',
  'shimmer',
  'verse',
  'auto',
]);

let spawnInflight: Promise<string | null> | null = null;
let lastSpawned: ChildProcess | null = null;

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

export function resolveOmniPython(): string {
  const candidates = [
    process.env.OMNIVOICE_PYTHON,
    process.env.PYTHON_PATH,
    'D:\\SuperAudioTools\\omnivoice-python\\python.exe',
    path.join(process.cwd(), 'omnivoice-python', 'python.exe'),
  ].filter(Boolean) as string[];
  for (const p of candidates) {
    if (p === 'python' || p === 'py') continue;
    if (fs.existsSync(p)) return p;
  }
  return 'python';
}

export function resolveOmniProfileDir(cwd = process.cwd()): string {
  if (process.env.OMNIVOICE_PROFILE_DIR && fs.existsSync(process.env.OMNIVOICE_PROFILE_DIR)) {
    return process.env.OMNIVOICE_PROFILE_DIR;
  }
  const candidates = [
    path.join('D:', 'SuperAudioTools', 'omnivoice-profiles'),
    path.join(cwd, 'omnivoice-profiles'),
    path.join(cwd, 'data', 'omnivoice-profiles'),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  const fallback = path.join(cwd, 'data', 'omnivoice-profiles');
  fs.mkdirSync(fallback, { recursive: true });
  return fallback;
}

export function resolveOmniRefsDirs(cwd = process.cwd()): string[] {
  return [
    path.join(cwd, 'public', 'omnivoice-refs'),
    path.join('D:', 'SuperAudioTools', 'omnivoice-refs'),
    path.join(cwd, 'omnivoice-refs'),
  ].filter((p) => fs.existsSync(p));
}

export function loadOmniLibrary(cwd = process.cwd()): OmniLibraryEntry[] {
  const files = [
    path.join(cwd, 'public', 'omnivoice-library.json'),
    path.join(cwd, 'omnivoice-library.json'),
    path.join('D:', 'SuperAudioTools', 'omnivoice-library.json'),
  ];
  for (const f of files) {
    if (!fs.existsSync(f)) continue;
    try {
      const raw = JSON.parse(fs.readFileSync(f, 'utf8'));
      if (Array.isArray(raw)) return raw as OmniLibraryEntry[];
    } catch {
      /* next */
    }
  }
  return [];
}

export function findOmniLibraryEntry(
  voiceKey: string,
  cwd = process.cwd(),
): OmniLibraryEntry | null {
  const key = (voiceKey || '').trim();
  if (!key) return null;
  const lib = loadOmniLibrary(cwd);
  return (
    lib.find((v) => v.id === key) ||
    lib.find((v) => v.voiceId === key) ||
    lib.find((v) => path.basename(String(v.voiceId || '')) === path.basename(key)) ||
    null
  );
}

/** Rewrite legacy E:\SuperFreeVoice\... paths → local copies. */
export function resolveOmniRefAudioPath(
  entryOrPath: string | OmniLibraryEntry | null | undefined,
  cwd = process.cwd(),
): string | null {
  let raw = '';
  let id = '';
  if (!entryOrPath) return null;
  if (typeof entryOrPath === 'string') {
    raw = entryOrPath.trim();
  } else {
    raw = String(entryOrPath.voiceId || '').trim();
    id = String(entryOrPath.id || '').trim();
  }
  if (!raw && !id) return null;

  const candidates: string[] = [];
  if (raw && fs.existsSync(raw)) candidates.push(raw);

  const base = raw ? path.basename(raw) : '';
  for (const dir of resolveOmniRefsDirs(cwd)) {
    if (base) candidates.push(path.join(dir, base));
  }

  // Profile pack on SuperAudioTools
  const profileDir = resolveOmniProfileDir(cwd);
  if (id) {
    candidates.push(path.join(profileDir, id, 'ref_audio.wav'));
    // sanitized id (omnivoice-server only keeps alnum _ -)
    const safe = id.replace(/[^a-zA-Z0-9_-]/g, '');
    if (safe && safe !== id) {
      candidates.push(path.join(profileDir, safe, 'ref_audio.wav'));
    }
  }
  if (raw && raw.includes('omnivoice_')) {
    const m = raw.match(/omnivoice_[a-zA-Z0-9_-]+/);
    if (m) candidates.push(path.join(profileDir, m[0], 'ref_audio.wav'));
  }

  // From library id derived filename: omnivoice_preset_ref_nhat_narrative → ref_nhat_narrative.*
  if (id.startsWith('omnivoice_preset_')) {
    const stem = id.replace(/^omnivoice_preset_/, '');
    for (const dir of resolveOmniRefsDirs(cwd)) {
      for (const ext of ['.wav', '.mp3', '.flac', '.ogg']) {
        candidates.push(path.join(dir, `${stem}${ext}`));
      }
    }
  }

  for (const p of candidates) {
    if (p && fs.existsSync(p)) return p;
  }
  return null;
}

export function resolveOmniRefText(
  entry: OmniLibraryEntry | null,
  profileId?: string,
  cwd = process.cwd(),
): string | undefined {
  if (entry?.refText?.trim()) return entry.refText.trim();
  const pid = profileId || entry?.id;
  if (!pid) return undefined;
  const metaPath = path.join(resolveOmniProfileDir(cwd), pid, 'meta.json');
  if (!fs.existsSync(metaPath)) return undefined;
  try {
    const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
    return typeof meta.ref_text === 'string' && meta.ref_text.trim()
      ? meta.ref_text.trim()
      : undefined;
  } catch {
    return undefined;
  }
}

export function hasOmniProfile(profileId: string, cwd = process.cwd()): boolean {
  const safe = profileId.replace(/[^a-zA-Z0-9_-]/g, '');
  if (!safe) return false;
  const audio = path.join(resolveOmniProfileDir(cwd), safe, 'ref_audio.wav');
  return fs.existsSync(audio);
}

export async function probeOmniBaseUrl(
  preferred?: string,
  timeoutMs = 1500,
): Promise<string | null> {
  const bases: string[] = [];
  if (preferred) bases.push(preferred.replace(/\/$/, ''));
  if (process.env.OMNIVOICE_API_URL) {
    bases.push(process.env.OMNIVOICE_API_URL.replace(/\/$/, ''));
  }
  for (const port of DEFAULT_PORTS) {
    bases.push(`http://127.0.0.1:${port}`);
  }
  const seen = new Set<string>();
  for (const base of bases) {
    const b = base.replace(/\/v1\/?$/, '').replace(/\/$/, '');
    if (!b || seen.has(b)) continue;
    seen.add(b);
    try {
      const ac = new AbortController();
      const t = setTimeout(() => ac.abort(), timeoutMs);
      const res = await fetch(`${b}/health`, { signal: ac.signal });
      clearTimeout(t);
      if (res.ok) return b;
      // some builds only expose /v1/models
      const ac2 = new AbortController();
      const t2 = setTimeout(() => ac2.abort(), timeoutMs);
      const res2 = await fetch(`${b}/v1/models`, { signal: ac2.signal });
      clearTimeout(t2);
      if (res2.ok) return b;
    } catch {
      /* next */
    }
  }
  return null;
}

/** pydantic Settings crash on unrelated .env keys — ensure extra=ignore. */
function patchOmniServerConfigExtraIgnore(pythonExe: string): void {
  try {
    const cfgPath = path.join(
      path.dirname(pythonExe),
      'Lib',
      'site-packages',
      'omnivoice_server',
      'config.py',
    );
    if (!fs.existsSync(cfgPath)) return;
    let t = fs.readFileSync(cfgPath, 'utf8');
    if (/extra\s*=\s*["']ignore["']/.test(t)) return;
    const next = t.replace(
      /SettingsConfigDict\(\s*env_prefix=["']OMNIVOICE_["'],\s*env_file=["']\.env["'],\s*env_file_encoding=["']utf-8["'],\s*\)/,
      `SettingsConfigDict(
        env_prefix="OMNIVOICE_",
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )`,
    );
    if (next !== t) {
      fs.writeFileSync(cfgPath, next, 'utf8');
      console.log('[OmniVoice] patched config.py extra=ignore');
    }
  } catch (err) {
    console.warn('[OmniVoice] config patch skipped:', err);
  }
}

async function spawnOmniServer(cwd = process.cwd()): Promise<string | null> {
  if (spawnInflight) return spawnInflight;
  spawnInflight = (async () => {
    const py = resolveOmniPython();
    patchOmniServerConfigExtraIgnore(py);
    const port = Number(process.env.OMNIVOICE_PORT || 8880);
    const profileDir = resolveOmniProfileDir(cwd);
    const host = '127.0.0.1';
    const base = `http://${host}:${port}`;

    const superTools = path.join('D:', 'SuperAudioTools');
    const cacheRoot = path.join(superTools, '.cache');
    /**
     * omnivoice_server Settings(extra=forbid) crash nếu process env / .env
     * chứa GEMINI_KEY_*, API keys lạ… → chỉ truyền env tối thiểu + PATH.
     */
    const pathParts: string[] = [];
    const pyDir = path.dirname(py);
    if (fs.existsSync(path.join(pyDir, 'ffmpeg.exe'))) pathParts.push(pyDir);
    const projectFfmpeg = path.join(cwd, 'bin');
    if (fs.existsSync(path.join(projectFfmpeg, 'ffmpeg.exe'))) pathParts.push(projectFfmpeg);
    if (process.env.PATH) pathParts.push(process.env.PATH);

    const env: NodeJS.ProcessEnv = {
      NODE_ENV: process.env.NODE_ENV || 'production',
      SystemRoot: process.env.SystemRoot,
      windir: process.env.windir,
      TEMP: process.env.TEMP,
      TMP: process.env.TMP,
      USERPROFILE: process.env.USERPROFILE,
      HOME: process.env.HOME,
      APPDATA: process.env.APPDATA,
      LOCALAPPDATA: process.env.LOCALAPPDATA,
      PATH: pathParts.join(';'),
      PYTHONNOUSERSITE: '1',
      OMNIVOICE_HOST: host,
      OMNIVOICE_PORT: String(port),
      OMNIVOICE_PROFILE_DIR: profileDir,
      OMNIVOICE_DEVICE: process.env.OMNIVOICE_DEVICE || 'auto',
      OMNIVOICE_LOG_LEVEL: process.env.OMNIVOICE_LOG_LEVEL || 'info',
      // Avoid loading project .env with Gemini keys (pydantic extra forbid)
      OMNIVOICE_ENV_FILE: '',
    };
    if (fs.existsSync(cacheRoot)) {
      env.HF_HOME = path.join(cacheRoot, 'huggingface');
      env.TORCH_HOME = path.join(cacheRoot, 'torch');
      env.XDG_CACHE_HOME = cacheRoot;
      env.HUGGINGFACE_HUB_CACHE = path.join(cacheRoot, 'huggingface', 'hub');
    }

    console.log(
      `[OmniVoice] spawning: "${py}" -m omnivoice_server --host ${host} --port ${port} --profile-dir "${profileDir}"`,
    );

    try {
      const child = spawn(
        py,
        [
          '-m',
          'omnivoice_server',
          '--host',
          host,
          '--port',
          String(port),
          '--profile-dir',
          profileDir,
          '--device',
          env.OMNIVOICE_DEVICE || 'auto',
        ],
        {
          cwd: fs.existsSync(superTools) ? superTools : cwd,
          detached: true,
          stdio: 'ignore',
          windowsHide: true,
          env,
        },
      );
      lastSpawned = child;
      child.unref();
    } catch (err) {
      console.error('[OmniVoice] spawn failed:', err);
      return null;
    }

    // Model load can take 30–90s first time; poll up to ~90s
    for (let i = 0; i < 45; i++) {
      await sleep(2000);
      const online = await probeOmniBaseUrl(base, 2000);
      if (online) {
        console.log(`[OmniVoice] online at ${online}`);
        return online;
      }
    }
    console.error('[OmniVoice] spawn timeout — server not healthy yet');
    return null;
  })().finally(() => {
    spawnInflight = null;
  });
  return spawnInflight;
}

/** Ensure OmniVoice HTTP server is reachable; auto-start if needed. */
export async function ensureOmniServer(cwd = process.cwd()): Promise<string> {
  const preferred = process.env.OMNIVOICE_API_URL;
  const existing = await probeOmniBaseUrl(preferred, 1200);
  if (existing) return existing;

  const started = await spawnOmniServer(cwd);
  if (started) return started;

  throw new Error(
    'OmniVoice Local server không chạy (mặc định :8880). ' +
      'Đã thử tự khởi động qua D:\\SuperAudioTools\\omnivoice-python nhưng chưa sẵn sàng. ' +
      'Chạy SuperAudioTools.exe hoặc: ' +
      `"${resolveOmniPython()}" -m omnivoice_server --port 8880 --profile-dir "${resolveOmniProfileDir(cwd)}"`,
  );
}

/**
 * Ensure a clone profile exists for this library voice (upload once).
 * Returns profile_id usable as voice=`clone:<id>`.
 */
export async function ensureOmniCloneProfile(
  baseUrl: string,
  profileId: string,
  refAudioPath: string,
  refText?: string,
): Promise<string> {
  const safe = profileId.replace(/[^a-zA-Z0-9_-]/g, '');
  if (!safe) throw new Error(`Invalid OmniVoice profile id: ${profileId}`);

  // Fast path: already on disk for this server profile_dir
  // (server may use different profile_dir — still try list/create)

  // GET /v1/voices — clone voices listed as id "clone:<profile_id>"
  try {
    const listRes = await fetch(`${baseUrl}/v1/voices`);
    if (listRes.ok) {
      const data = (await listRes.json()) as {
        voices?: Array<{ id?: string; profile_id?: string; type?: string }>;
      };
      const ids = (data.voices || [])
        .filter((v) => v.type === 'clone' || String(v.id || '').startsWith('clone:'))
        .map((v) => v.profile_id || String(v.id || '').replace(/^clone:/, ''));
      if (ids.includes(safe) || ids.includes(profileId)) return safe;
    }
  } catch {
    /* continue to create */
  }

  // Also probe single profile
  try {
    const one = await fetch(`${baseUrl}/v1/voices/profiles/${encodeURIComponent(safe)}`);
    if (one.ok) return safe;
  } catch {
    /* create */
  }

  if (!fs.existsSync(refAudioPath)) {
    throw new Error(`Không tìm thấy file ref audio OmniVoice: ${refAudioPath}`);
  }

  const bytes = fs.readFileSync(refAudioPath);
  const form = new FormData();
  form.append('profile_id', safe);
  form.append('overwrite', 'true');
  if (refText) form.append('ref_text', refText);
  const u8 = new Uint8Array(bytes);
  const blob = new Blob([u8], {
    type: refAudioPath.toLowerCase().endsWith('.mp3') ? 'audio/mpeg' : 'audio/wav',
  });
  form.append('ref_audio', blob, path.basename(refAudioPath));

  // Correct path: POST /v1/voices/profiles (not /v1/audio/voices/profiles)
  const res = await fetch(`${baseUrl}/v1/voices/profiles`, {
    method: 'POST',
    body: form,
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    console.warn(`[OmniVoice] profile create ${res.status}: ${errText.slice(0, 200)}`);
    throw new Error(`Tạo profile OmniVoice thất bại: ${res.status} ${errText.slice(0, 180)}`);
  }
  return safe;
}

async function synthViaJson(
  baseUrl: string,
  text: string,
  voice: string,
  speed: number,
  language?: string,
): Promise<Buffer> {
  const payload: Record<string, unknown> = {
    model: 'omnivoice',
    input: text,
    voice,
    speed: speed || 1.0,
    response_format: 'wav',
  };
  if (language) payload.language = language;

  const res = await fetch(`${baseUrl}/v1/audio/speech`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`OmniVoice /v1/audio/speech ${res.status}: ${errText.slice(0, 300)}`);
  }
  return Buffer.from(await res.arrayBuffer());
}

async function synthViaCloneUpload(
  baseUrl: string,
  text: string,
  refAudioPath: string,
  refText: string | undefined,
  speed: number,
  language?: string,
): Promise<Buffer> {
  const bytes = fs.readFileSync(refAudioPath);
  const form = new FormData();
  form.append('text', text);
  form.append('speed', String(speed || 1.0));
  form.append('response_format', 'wav');
  if (refText) form.append('ref_text', refText);
  if (language) form.append('language', language);
  const u8 = new Uint8Array(bytes);
  const blob = new Blob([u8], {
    type: refAudioPath.toLowerCase().endsWith('.mp3') ? 'audio/mpeg' : 'audio/wav',
  });
  form.append('ref_audio', blob, path.basename(refAudioPath));

  const res = await fetch(`${baseUrl}/v1/audio/speech/clone`, {
    method: 'POST',
    body: form,
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`OmniVoice /v1/audio/speech/clone ${res.status}: ${errText.slice(0, 300)}`);
  }
  return Buffer.from(await res.arrayBuffer());
}

function guessLanguage(entry: OmniLibraryEntry | null, voiceKey: string): string | undefined {
  const lang = (entry?.language || '').toLowerCase();
  if (lang.includes('viet') || lang === 'vi') return 'vi';
  if (lang.includes('japan') || lang === 'ja') return 'ja';
  if (lang.includes('korea') || lang === 'ko') return 'ko';
  if (lang.includes('english') || lang === 'en') return 'en';
  if (lang.includes('thai') || lang === 'th') return 'th';
  if (lang.includes('chinese') || lang === 'zh') return 'zh';
  if (/_vn_|_vi_|ref_vn|vietnamese/i.test(voiceKey)) return 'vi';
  if (/_jp_|japan/i.test(voiceKey)) return 'ja';
  if (/_kr_|korea/i.test(voiceKey)) return 'ko';
  if (/_en_|_us_|_uk_/i.test(voiceKey)) return 'en';
  if (/_th_/i.test(voiceKey)) return 'th';
  return 'vi';
}

/**
 * Main entry: synthesize text with OmniVoice Local using library voice key.
 */
export async function synthesizeOmniVoiceLocal(params: {
  text: string;
  voice: string;
  speed?: number;
  pitch?: number;
  cwd?: string;
}): Promise<OmniSynthResult> {
  const cwd = params.cwd || process.cwd();
  const text = (params.text || '').trim();
  if (!text) throw new Error('OmniVoice: empty text');

  let voiceKey = (params.voice || '').trim();
  if (voiceKey.toLowerCase().startsWith('clone:')) {
    voiceKey = voiceKey.slice(6).trim();
  }
  if (!voiceKey) throw new Error('OmniVoice: chưa chọn giọng (voice).');

  const speed = typeof params.speed === 'number' && Number.isFinite(params.speed) ? params.speed : 1;
  const baseUrl = await ensureOmniServer(cwd);
  const entry = findOmniLibraryEntry(voiceKey, cwd);
  const language = guessLanguage(entry, voiceKey);

  // OpenAI design presets
  if (OPENAI_PRESETS.has(voiceKey.toLowerCase())) {
    const buffer = await synthViaJson(baseUrl, text, voiceKey.toLowerCase(), speed, language);
    return {
      buffer,
      method: `OmniVoice Local design (${voiceKey})`,
      baseUrl,
      mode: 'design-preset',
    };
  }

  const profileId = entry?.id || voiceKey;
  const refPath = resolveOmniRefAudioPath(entry || voiceKey, cwd);
  const refText = resolveOmniRefText(entry, profileId, cwd);

  // 1) Prefer registered profile (clone:id) if server already has it or we can register
  if (hasOmniProfile(profileId, cwd) || refPath) {
    try {
      if (refPath) {
        await ensureOmniCloneProfile(baseUrl, profileId, refPath, refText);
      }
      const buffer = await synthViaJson(baseUrl, text, `clone:${profileId}`, speed, language);
      return {
        buffer,
        method: `OmniVoice Local clone (${profileId})`,
        baseUrl,
        mode: 'clone-profile',
      };
    } catch (err) {
      console.warn('[OmniVoice] clone-profile path failed, trying upload:', err);
    }
  }

  // 2) One-shot multipart clone with resolved ref file
  if (refPath) {
    const buffer = await synthViaCloneUpload(baseUrl, text, refPath, refText, speed, language);
    return {
      buffer,
      method: `OmniVoice Local upload (${path.basename(refPath)})`,
      baseUrl,
      mode: 'clone-upload',
    };
  }

  // 3) Last resort: try voice as profile id anyway
  try {
    const buffer = await synthViaJson(baseUrl, text, `clone:${profileId}`, speed, language);
    return {
      buffer,
      method: `OmniVoice Local clone (${profileId})`,
      baseUrl,
      mode: 'clone-profile',
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(
      `OmniVoice không resolve được giọng "${voiceKey}". ` +
        `Không thấy profile/ref audio (library voiceId cũ trỏ E:\\SuperFreeVoice đã mất). ` +
        `Chi tiết: ${msg}`,
    );
  }
}

export function getLastSpawnedPid(): number | undefined {
  return lastSpawned?.pid;
}
