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
import { spawn, execSync, type ChildProcess } from 'child_process';
import {
  omniRssMinUptimeS,
  omniRssSoftMb,
  noteOmniRestart,
  withGpuTtsSlot,
} from '@/lib/tts/gpuTtsGuard';

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
let lastSpawnError = '';

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

/** Prefer packaged omnivoice-server.exe (SuperAudioTools), else python -m. */
export function resolveOmniServerLauncher(): {
  cmd: string;
  args: string[];
  cwd: string;
  kind: 'exe' | 'module';
} {
  const py = resolveOmniPython();
  const pyDir = path.dirname(py);
  const exeCandidates = [
    process.env.OMNIVOICE_SERVER_EXE,
    path.join(pyDir, 'Scripts', 'omnivoice-server.exe'),
    path.join('D:', 'SuperAudioTools', 'omnivoice-python', 'Scripts', 'omnivoice-server.exe'),
    path.join(process.cwd(), 'omnivoice-python', 'Scripts', 'omnivoice-server.exe'),
  ].filter(Boolean) as string[];

  const superTools = path.join('D:', 'SuperAudioTools');
  const runCwd = fs.existsSync(superTools) ? superTools : process.cwd();

  for (const exe of exeCandidates) {
    if (fs.existsSync(exe)) {
      return { cmd: exe, args: [], cwd: runCwd, kind: 'exe' };
    }
  }
  return {
    cmd: py,
    args: ['-m', 'omnivoice_server'],
    cwd: runCwd,
    kind: 'module',
  };
}

export function getOmniLogPath(cwd = process.cwd()): string {
  const dir = path.join(cwd, 'data', 'logs');
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, 'omnivoice-server.log');
}

export function getLastOmniSpawnError(): string {
  return lastSpawnError;
}

export type OmniHealth = {
  online: boolean;
  baseUrl: string | null;
  ready?: boolean;
  modelLoaded?: boolean;
  uptimeS?: number;
  memoryRssMb?: number;
};

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

async function fetchWithTimeout(
  url: string,
  timeoutMs: number,
): Promise<Response | null> {
  try {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), timeoutMs);
    const res = await fetch(url, { signal: ac.signal });
    clearTimeout(t);
    return res;
  } catch {
    return null;
  }
}

function collectOmniBases(preferred?: string): string[] {
  const bases: string[] = [];
  if (preferred) bases.push(preferred.replace(/\/$/, ''));
  if (process.env.OMNIVOICE_API_URL) {
    bases.push(process.env.OMNIVOICE_API_URL.replace(/\/$/, ''));
  }
  for (const port of DEFAULT_PORTS) {
    bases.push(`http://127.0.0.1:${port}`);
  }
  const seen = new Set<string>();
  const out: string[] = [];
  for (const base of bases) {
    const b = base.replace(/\/v1\/?$/, '').replace(/\/$/, '');
    if (!b || seen.has(b)) continue;
    seen.add(b);
    out.push(b);
  }
  return out;
}

export async function probeOmniBaseUrl(
  preferred?: string,
  timeoutMs = 1500,
): Promise<string | null> {
  for (const b of collectOmniBases(preferred)) {
    const health = await fetchWithTimeout(`${b}/health`, timeoutMs);
    if (health?.ok) return b;
    // some builds only expose /v1/models
    const models = await fetchWithTimeout(`${b}/v1/models`, timeoutMs);
    if (models?.ok) return b;
  }
  return null;
}

/** Probe + parse /health for UI (ready / model_loaded). */
export async function probeOmniHealth(
  preferred?: string,
  timeoutMs = 1500,
): Promise<OmniHealth> {
  for (const b of collectOmniBases(preferred)) {
    const res = await fetchWithTimeout(`${b}/health`, timeoutMs);
    if (res?.ok) {
      try {
        const j = (await res.json()) as {
          status?: string;
          ready?: boolean;
          model_loaded?: boolean;
          uptime_s?: number;
          memory_rss_mb?: number;
        };
        return {
          online: true,
          baseUrl: b,
          ready: j.ready !== false && (j.status === 'healthy' || j.model_loaded !== false),
          modelLoaded: j.model_loaded !== false,
          uptimeS: typeof j.uptime_s === 'number' ? j.uptime_s : undefined,
          memoryRssMb:
            typeof j.memory_rss_mb === 'number' ? j.memory_rss_mb : undefined,
        };
      } catch {
        return { online: true, baseUrl: b, ready: true, modelLoaded: true };
      }
    }
    const models = await fetchWithTimeout(`${b}/v1/models`, timeoutMs);
    if (models?.ok) {
      return { online: true, baseUrl: b, ready: true, modelLoaded: true };
    }
  }
  return { online: false, baseUrl: null };
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
    lastSpawnError = '';
    // Race: another process may have started while we waited
    const already = await probeOmniBaseUrl(process.env.OMNIVOICE_API_URL, 1200);
    if (already) return already;

    const py = resolveOmniPython();
    patchOmniServerConfigExtraIgnore(py);
    const launcher = resolveOmniServerLauncher();
    const port = Number(process.env.OMNIVOICE_PORT || 8880);
    const profileDir = resolveOmniProfileDir(cwd);
    const host = '127.0.0.1';
    const base = `http://${host}:${port}`;
    const logPath = getOmniLogPath(cwd);

    const superTools = path.join('D:', 'SuperAudioTools');
    const cacheRoot = path.join(superTools, '.cache');
    /**
     * omnivoice_server Settings crash nếu process env / .env
     * chứa GEMINI_KEY_*, API keys lạ… → chỉ truyền env tối thiểu + PATH.
     */
    const pathParts: string[] = [];
    const pyDir = path.dirname(py);
    if (fs.existsSync(path.join(pyDir, 'ffmpeg.exe'))) pathParts.push(pyDir);
    const projectFfmpeg = path.join(cwd, 'bin');
    if (fs.existsSync(path.join(projectFfmpeg, 'ffmpeg.exe'))) pathParts.push(projectFfmpeg);
    const scriptsDir = path.join(pyDir, 'Scripts');
    if (fs.existsSync(scriptsDir)) pathParts.push(scriptsDir);
    pathParts.push(pyDir);
    if (process.env.PATH) pathParts.push(process.env.PATH);

    const device = process.env.OMNIVOICE_DEVICE || 'auto';
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
      PATH: pathParts.join(path.delimiter),
      PYTHONNOUSERSITE: '1',
      PYTHONUTF8: '1',
      OMNIVOICE_HOST: host,
      OMNIVOICE_PORT: String(port),
      OMNIVOICE_PROFILE_DIR: profileDir,
      OMNIVOICE_DEVICE: device,
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

    const cliArgs = [
      ...launcher.args,
      '--host',
      host,
      '--port',
      String(port),
      '--profile-dir',
      profileDir,
      '--device',
      device,
    ];
    const cmdLine = `"${launcher.cmd}" ${cliArgs.join(' ')}`;
    console.log(`[OmniVoice] spawning (${launcher.kind}): ${cmdLine}`);
    try {
      fs.appendFileSync(
        logPath,
        `\n==== spawn ${new Date().toISOString()} ====\n${cmdLine}\ncwd=${launcher.cwd}\n`,
        'utf8',
      );
    } catch {
      /* ignore log write */
    }

    let exitedEarly = false;
    let exitCode: number | null = null;
    try {
      const logFd = fs.openSync(logPath, 'a');
      const child = spawn(launcher.cmd, cliArgs, {
        cwd: launcher.cwd,
        detached: true,
        stdio: ['ignore', logFd, logFd],
        windowsHide: true,
        env,
      });
      lastSpawned = child;
      child.on('error', (err) => {
        lastSpawnError = `spawn error: ${err.message}`;
        console.error('[OmniVoice]', lastSpawnError);
        try {
          fs.appendFileSync(logPath, `ERROR ${err.message}\n`, 'utf8');
        } catch {
          /* ignore */
        }
      });
      child.on('exit', (code) => {
        exitedEarly = true;
        exitCode = code;
        lastSpawnError = `process exited early code=${code}`;
        console.error(`[OmniVoice] child exit code=${code}`);
        try {
          fs.appendFileSync(logPath, `EXIT code=${code}\n`, 'utf8');
        } catch {
          /* ignore */
        }
      });
      child.unref();
      // Do not close logFd immediately — child inherits it on Windows
    } catch (err) {
      lastSpawnError = err instanceof Error ? err.message : String(err);
      console.error('[OmniVoice] spawn failed:', lastSpawnError);
      return null;
    }

    // Model load can take 30–120s first time; poll up to ~120s
    for (let i = 0; i < 60; i++) {
      await sleep(2000);
      const online = await probeOmniBaseUrl(base, 2000);
      if (online) {
        const h = await probeOmniHealth(online, 2000);
        if (h.online && h.modelLoaded !== false) {
          console.log(`[OmniVoice] online at ${online} ready=${h.ready}`);
          lastSpawnError = '';
          return online;
        }
        // Accept HTTP up even if model still warming after ~20s
        if (i >= 10) {
          console.log(`[OmniVoice] HTTP up at ${online} (model may still warm)`);
          return online;
        }
      }
      if (exitedEarly && i >= 2) {
        lastSpawnError =
          lastSpawnError ||
          `OmniVoice process exited (code=${exitCode}). Xem log: ${logPath}`;
        console.error('[OmniVoice]', lastSpawnError);
        return null;
      }
    }
    lastSpawnError =
      lastSpawnError || `Timeout 120s chờ model load. Log: ${logPath}`;
    console.error('[OmniVoice] spawn timeout —', lastSpawnError);
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

  // Last chance: another instance came online during spawn wait
  const again = await probeOmniBaseUrl(preferred, 2000);
  if (again) return again;

  const launcher = resolveOmniServerLauncher();
  const logPath = getOmniLogPath(cwd);
  const detail = lastSpawnError ? ` Chi tiết: ${lastSpawnError}` : '';
  throw new Error(
    'OmniVoice engine chưa sẵn sàng (:8880). ' +
      'App đã thử tự khởi động từ SuperAudioTools/omnivoice-python nhưng chưa lên. ' +
      `Thử: "${launcher.cmd}" --port 8880 --profile-dir "${resolveOmniProfileDir(cwd)}". ` +
      `Log: ${logPath}.${detail}`,
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

/** Giọng từ engine khác (Edge/Piper/TikTok…) — không phải Omni profile/design */
export function isForeignOmniVoiceId(voiceKey: string): boolean {
  const v = (voiceKey || '').trim();
  if (!v) return true;
  if (OPENAI_PRESETS.has(v.toLowerCase())) return false;
  if (v.toLowerCase().startsWith('clone:')) return false;
  if (v.startsWith('omnivoice_') || v.startsWith('omni_')) return false;
  // Edge neural, Piper onnx, TikTok BV*, CapCut-style, Google Cloud ids
  if (/Neural$/i.test(v)) return true;
  if (/\.onnx$/i.test(v)) return true;
  if (/^BV\d/i.test(v)) return true;
  if (/^(vi|en|zh|ja|ko|fr|de|es)-[A-Z]{2}/i.test(v)) return true;
  if (/^(hn_|VBEE_|en_us_|en_uk_|vi_female)/i.test(v)) return true;
  return false;
}

/**
 * Main entry: synthesize text with OmniVoice Local using library voice key.
 * Fail-fast for foreign voice ids (no multi-step 404 spam).
 * Serialized with Vina via GPU slot; may recycle engine when RSS high.
 */
export async function synthesizeOmniVoiceLocal(params: {
  text: string;
  voice: string;
  speed?: number;
  pitch?: number;
  cwd?: string;
  /** Timeout inside GPU slot (always releases exclusive lock). */
  timeoutMs?: number;
}): Promise<OmniSynthResult> {
  return withGpuTtsSlot(
    'omnivoice',
    () => synthesizeOmniVoiceLocalInner(params),
    { timeoutMs: params.timeoutMs },
  );
}

async function synthesizeOmniVoiceLocalInner(params: {
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

  const speed =
    typeof params.speed === 'number' && Number.isFinite(params.speed) ? params.speed : 1;
  const entry = findOmniLibraryEntry(voiceKey, cwd);
  const isDesign = OPENAI_PRESETS.has(voiceKey.toLowerCase());

  // Foreign voice kept from previous engine (Edge/Piper…) — skip clone spam
  if (!isDesign && !entry && isForeignOmniVoiceId(voiceKey)) {
    throw new Error(
      `Giọng "${voiceKey}" không thuộc OmniVoice (đổi sang alloy/nova hoặc clone library).`,
    );
  }

  let baseUrl: string;
  let recycled = false;
  try {
    const mem = await ensureOmniServerMemorySafe(cwd);
    baseUrl = mem.baseUrl;
    recycled = mem.recycled;
    if (typeof mem.memoryRssMb === 'number') {
      console.log(
        `[OmniVoice] synth ready rss=${mem.memoryRssMb.toFixed(0)}MB recycled=${recycled}`,
      );
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(
      msg.startsWith('OmniVoice')
        ? msg
        : `OmniVoice engine offline — app sẽ tự bật khi gen; nếu fail: ${msg.slice(0, 160)}`,
    );
  }

  const language = guessLanguage(entry, voiceKey);
  const recycleTag = recycled ? ' +rss-recycle' : '';

  // OpenAI-style design presets (alloy, nova…) — clean path
  if (isDesign) {
    const buffer = await synthViaJson(baseUrl, text, voiceKey.toLowerCase(), speed, language);
    return {
      buffer,
      method: `OmniVoice Local design (${voiceKey})${recycleTag}`,
      baseUrl,
      mode: 'design-preset',
    };
  }

  const profileId = (entry?.id || voiceKey).replace(/[^a-zA-Z0-9_-]/g, '') || voiceKey;
  const refPath = resolveOmniRefAudioPath(entry || voiceKey, cwd);
  const refText = resolveOmniRefText(entry, profileId, cwd);

  // 1) Registered profile or create from ref
  if (hasOmniProfile(profileId, cwd) || refPath) {
    try {
      if (refPath) {
        await ensureOmniCloneProfile(baseUrl, profileId, refPath, refText);
      }
      const buffer = await synthViaJson(baseUrl, text, `clone:${profileId}`, speed, language);
      return {
        buffer,
        method: `OmniVoice Local clone (${profileId})${recycleTag}`,
        baseUrl,
        mode: 'clone-profile',
      };
    } catch (err) {
      const m = err instanceof Error ? err.message : String(err);
      // Quiet single line (no stack dump)
      console.warn(`[OmniVoice] clone-profile fail (${profileId}): ${m.slice(0, 100)}`);
      // 2) One-shot upload if we still have ref
      if (refPath) {
        try {
          const buffer = await synthViaCloneUpload(
            baseUrl,
            text,
            refPath,
            refText,
            speed,
            language,
          );
          return {
            buffer,
            method: `OmniVoice Local upload (${path.basename(refPath)})${recycleTag}`,
            baseUrl,
            mode: 'clone-upload',
          };
        } catch (err2) {
          const m2 = err2 instanceof Error ? err2.message : String(err2);
          throw new Error(
            `OmniVoice clone/upload thất bại cho "${voiceKey}": ${m2.slice(0, 140)}`,
          );
        }
      }
      throw new Error(`OmniVoice clone thất bại cho "${voiceKey}": ${m.slice(0, 140)}`);
    }
  }

  throw new Error(
    `OmniVoice không có profile/ref audio cho "${voiceKey}". ` +
      `Kiểm tra public/omnivoice-library.json và file ref trong public/omnivoice-refs hoặc D:\\SuperAudioTools\\omnivoice-refs.`,
  );
}

export function getLastSpawnedPid(): number | undefined {
  return lastSpawned?.pid;
}

/** PIDs listening on Omni default port (Windows netstat). */
export function findOmniListenerPids(port = Number(process.env.OMNIVOICE_PORT || 8880)): number[] {
  if (process.platform !== 'win32') return [];
  try {
    const out = execSync(`netstat -ano -p tcp`, {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 5000,
    });
    const pids = new Set<number>();
    const re = new RegExp(`127\\.0\\.0\\.1:${port}\\s+.*?LISTENING\\s+(\\d+)`, 'gi');
    let m: RegExpExecArray | null;
    while ((m = re.exec(out))) {
      const pid = Number(m[1]);
      if (pid > 0) pids.add(pid);
    }
    // also 0.0.0.0:port
    const re2 = new RegExp(`0\\.0\\.0\\.0:${port}\\s+.*?LISTENING\\s+(\\d+)`, 'gi');
    while ((m = re2.exec(out))) {
      const pid = Number(m[1]);
      if (pid > 0) pids.add(pid);
    }
    return [...pids];
  } catch {
    return [];
  }
}

/** Stop OmniVoice server (our spawn and/or orphan on :8880). */
export async function killOmniServerProcesses(): Promise<number[]> {
  const killed: number[] = [];
  const pids = new Set<number>();
  if (lastSpawned?.pid) pids.add(lastSpawned.pid);
  for (const p of findOmniListenerPids()) pids.add(p);

  for (const pid of pids) {
    try {
      if (process.platform === 'win32') {
        execSync(`taskkill /PID ${pid} /T /F`, { windowsHide: true, stdio: 'ignore' });
      } else {
        process.kill(pid, 'SIGTERM');
      }
      killed.push(pid);
    } catch {
      /* already dead */
    }
  }
  lastSpawned = null;
  if (killed.length) {
    console.log(`[OmniVoice] killed pids for recycle: ${killed.join(',')}`);
    await sleep(1200);
  }
  return killed;
}

/**
 * If RSS above soft/hard threshold, kill engine and re-spawn clean.
 * Call under GPU slot so Vina is not mid-flight.
 */
export async function ensureOmniServerMemorySafe(cwd = process.cwd()): Promise<{
  baseUrl: string;
  recycled: boolean;
  memoryRssMb?: number;
}> {
  const soft = omniRssSoftMb();
  const minUp = omniRssMinUptimeS();
  const health = await probeOmniHealth(undefined, 1500);
  const rss = health.memoryRssMb;
  const uptime = health.uptimeS ?? 0;

  // Recycle only when bloated AND process has been warm long enough (no restart thrash)
  if (
    health.online &&
    typeof rss === 'number' &&
    rss >= soft &&
    uptime >= minUp
  ) {
    console.warn(
      `[OmniVoice] RSS ${rss.toFixed(0)}MB ≥ soft ${soft}MB (uptime ${uptime.toFixed(0)}s) — recycling engine`,
    );
    noteOmniRestart();
    await killOmniServerProcesses();
    for (let i = 0; i < 15; i++) {
      const still = await probeOmniBaseUrl(undefined, 800);
      if (!still) break;
      await sleep(500);
    }
    const baseUrl = await ensureOmniServer(cwd);
    const after = await probeOmniHealth(baseUrl, 2000);
    return {
      baseUrl,
      recycled: true,
      memoryRssMb: after.memoryRssMb ?? rss,
    };
  }

  if (
    health.online &&
    typeof rss === 'number' &&
    rss >= soft &&
    uptime < minUp
  ) {
    console.log(
      `[OmniVoice] RSS ${rss.toFixed(0)}MB ≥ soft but uptime ${uptime.toFixed(0)}s < ${minUp}s — skip recycle`,
    );
  }

  const baseUrl = health.baseUrl || (await ensureOmniServer(cwd));
  return { baseUrl, recycled: false, memoryRssMb: rss };
}
