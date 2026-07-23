/**
 * LA Studio local HTTP bridge (OpenAI-compatible audio API).
 *
 * Upstream: https://github.com/dduongtrandai/LA-Studio
 * - GET  /health                         (no auth on loopback)
 * - GET  /v1/models                      (Bearer if LAN)
 * - GET  /v1/audio/voices
 * - POST /v1/audio/speech | /v1/tts/speech  body: { input, voice?, model?, speed?, response_format }
 *
 * Default: http://127.0.0.1:3900  (settings.ini [api] serverPort=3900)
 * App must be running + API enabled (Developer page or [api] serverEnabled=true).
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawn, type ChildProcess } from 'child_process';

export const LA_STUDIO_DEFAULT_PORT = 3900;
export const LA_STUDIO_DEFAULT_BASE = `http://127.0.0.1:${LA_STUDIO_DEFAULT_PORT}`;

const SETTINGS_INI = path.join(os.homedir(), '.lastudio', 'settings.ini');
const DEFAULT_EXE_CANDIDATES = [
  'D:\\LA Studio\\bin\\LA Studio.exe',
  path.join(process.env.LOCALAPPDATA || '', 'Programs', 'LA Studio', 'bin', 'LA Studio.exe'),
  path.join(process.env.ProgramFiles || 'C:\\Program Files', 'LA Studio', 'bin', 'LA Studio.exe'),
];

export type LaStudioHealth = {
  online: boolean;
  baseUrl: string;
  status?: string;
  enabled?: boolean;
  running?: boolean;
  port?: number;
  ttsLoaded?: boolean;
  ttsFamily?: string;
  sttLoaded?: boolean;
  apiKeyRequired?: boolean;
  raw?: Record<string, unknown>;
  error?: string;
};

export type LaStudioVoice = {
  id: string;
  name: string;
  detail?: string;
};

export type LaStudioSynthInput = {
  text: string;
  voice?: string;
  model?: string;
  speed?: number;
  language?: string;
  baseUrl?: string;
  apiKey?: string;
  /** ms — local synth can be slow on cold model */
  timeoutMs?: number;
  /**
   * When true, offline durable user-clone (lsc_*) may return the ref sample WAV.
   * Preview / Nghe mẫu only — never for full scene gen (B10: no soft-success fake TTS).
   */
  allowSampleFallback?: boolean;
};

export type LaStudioSynthResult = {
  buffer: Buffer;
  method: string;
  baseUrl: string;
  contentType: string;
  /** false when Kokoro CLI path (speed applied by FFmpeg post in generate-tts) */
  nativeSpeedApplied?: boolean;
};

/** Catalog default_voice in voices.json (Kokoro-VI pack). */
const KOKORO_DEFAULT_VOICE = 'diem_trinh';

let lastSpawned: ChildProcess | null = null;
let lastSpawnError = '';
/** Active hide-watch (re-hide if Qt recreates windows). */
let hideWatchTimer: ReturnType<typeof setInterval> | null = null;
let hideWatchUntil = 0;

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

export function resolveLaStudioBaseUrl(override?: string): string {
  const fromEnv = (
    process.env.LA_STUDIO_BASE_URL ||
    process.env.AINOVEL_LA_STUDIO_URL ||
    ''
  ).trim();
  const raw = (override || fromEnv || LA_STUDIO_DEFAULT_BASE).trim().replace(/\/+$/, '');
  if (!raw) return LA_STUDIO_DEFAULT_BASE;
  if (!/^https?:\/\//i.test(raw)) return `http://${raw}`;
  return raw;
}

export function resolveLaStudioApiKey(override?: string): string {
  const fromEnv = (
    process.env.LA_STUDIO_API_KEY ||
    process.env.AINOVEL_LA_STUDIO_API_KEY ||
    ''
  ).trim();
  if (override?.trim()) return override.trim();
  if (fromEnv) return fromEnv;
  try {
    const ini = readSettingsIni();
    return String(ini.serverApiKey || '').trim();
  } catch {
    return '';
  }
}

/** Parse ~/.lastudio/settings.ini [api] section (best-effort). */
export function readSettingsIni(): {
  serverEnabled: boolean;
  serverAllowLan: boolean;
  serverPort: number;
  serverApiKey: string;
  modelsPath: string;
  selectedFamily: string;
  raw: string;
} {
  const empty = {
    serverEnabled: false,
    serverAllowLan: false,
    serverPort: LA_STUDIO_DEFAULT_PORT,
    serverApiKey: '',
    modelsPath: path.join(os.homedir(), '.lastudio', 'models'),
    selectedFamily: '',
    raw: '',
  };
  if (!fs.existsSync(SETTINGS_INI)) return empty;
  const raw = fs.readFileSync(SETTINGS_INI, 'utf8');
  const get = (key: string): string => {
    const re = new RegExp(`^${key}=(.*)$`, 'mi');
    const m = raw.match(re);
    return m ? String(m[1] || '').trim() : '';
  };
  return {
    serverEnabled: /^(true|1|yes)$/i.test(get('serverEnabled')),
    serverAllowLan: /^(true|1|yes)$/i.test(get('serverAllowLan')),
    serverPort: Math.max(1, Number(get('serverPort')) || LA_STUDIO_DEFAULT_PORT),
    serverApiKey: get('serverApiKey'),
    modelsPath: get('modelsPath') || empty.modelsPath,
    selectedFamily: get('selectedFamily'),
    raw,
  };
}

/**
 * Ensure [api] serverEnabled=true + port in settings.ini so next LA Studio launch
 * (or restart) binds the local API. Does not hot-reload a running app.
 */
export function ensureLaStudioApiEnabledInSettings(port = LA_STUDIO_DEFAULT_PORT): {
  path: string;
  changed: boolean;
  message: string;
} {
  const p = Math.max(1, Number(port) || LA_STUDIO_DEFAULT_PORT);
  let raw = fs.existsSync(SETTINGS_INI) ? fs.readFileSync(SETTINGS_INI, 'utf8') : '';
  const before = raw;

  const setKey = (key: string, value: string) => {
    const lineRe = new RegExp(`^${key}=.*$`, 'mi');
    if (lineRe.test(raw)) {
      raw = raw.replace(lineRe, `${key}=${value}`);
      return;
    }
    if (/^\[api\]/mi.test(raw)) {
      raw = raw.replace(/^\[api\][ \t]*\r?\n/mi, `[api]\n${key}=${value}\n`);
      return;
    }
    raw = `${raw.trimEnd()}\n\n[api]\n${key}=${value}\n`;
  };

  setKey('serverEnabled', 'true');
  setKey('serverAllowLan', 'false');
  setKey('serverPort', String(p));
  if (!/^serverApiKey=/mi.test(raw)) {
    // Keep existing key if any; otherwise leave empty (loopback auth is open)
    setKey('serverApiKey', readSettingsIni().serverApiKey || '');
  }

  const dir = path.dirname(SETTINGS_INI);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const changed = raw !== before;
  if (changed) fs.writeFileSync(SETTINGS_INI, raw.endsWith('\n') ? raw : `${raw}\n`, 'utf8');

  return {
    path: SETTINGS_INI,
    changed,
    message: changed
      ? `Đã bật API trong ${SETTINGS_INI} (port ${p}). Nếu LA Studio đang mở, restart app hoặc bật API trong trang Developer.`
      : `API đã bật trong settings (port ${p}).`,
  };
}

export function resolveLaStudioExe(): string | null {
  const env = (process.env.LA_STUDIO_EXE || process.env.AINOVEL_LA_STUDIO_EXE || '').trim();
  if (env && fs.existsSync(env)) return env;
  for (const c of DEFAULT_EXE_CANDIDATES) {
    if (c && fs.existsSync(c)) return c;
  }
  return null;
}

export function getLastLaStudioSpawnError(): string {
  return lastSpawnError;
}

/** Persistent hide script path (written once, reused). */
const HIDE_PS1 = path.join(os.tmpdir(), 'ainovel-la-studio', 'hide-la-studio.ps1');

const HIDE_PS1_BODY = `
$ErrorActionPreference = 'SilentlyContinue'
if (-not ('Ainovel.LaHideWin' -as [type])) {
  Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
namespace Ainovel {
  public class LaHideWin {
    public delegate bool EnumProc(IntPtr hWnd, IntPtr lParam);
    [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr lp);
    [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
    public const int SW_HIDE = 0;
    public const int SW_MINIMIZE = 6;
  }
}
"@
}
# Match process name / path only — never window title (other apps may mention "LA Studio")
$targets = @(Get-Process | Where-Object {
  $n = [string]$_.ProcessName
  $p = ''
  try { $p = [string]$_.Path } catch {}
  ($n -eq 'LA Studio') -or ($n -eq 'LAStudio') -or ($n -match '^LA.?Studio$') -or
  ($p -like '*\\LA Studio\\bin\\LA Studio.exe') -or ($p -like '*/LA Studio/bin/LA Studio.exe')
})
$pids = @($targets | ForEach-Object { [int]$_.Id } | Select-Object -Unique)
if ($pids.Count -lt 1) { exit 0 }
[Ainovel.LaHideWin]::EnumWindows({
  param($h, $l)
  $pidOut = [uint32]0
  [void][Ainovel.LaHideWin]::GetWindowThreadProcessId($h, [ref]$pidOut)
  if ($pids -contains [int]$pidOut) {
    [void][Ainovel.LaHideWin]::ShowWindow($h, [Ainovel.LaHideWin]::SW_MINIMIZE)
    [void][Ainovel.LaHideWin]::ShowWindow($h, [Ainovel.LaHideWin]::SW_HIDE)
  }
  return $true
}, [IntPtr]::Zero) | Out-Null
`.trim();

/**
 * Best-effort hide LA Studio UI (engine stays running for API :3900).
 * File-based PowerShell — never CloseMainWindow.
 */
export function hideLaStudioWindows(): void {
  if (process.platform !== 'win32') return;
  try {
    fs.mkdirSync(path.dirname(HIDE_PS1), { recursive: true });
    if (!fs.existsSync(HIDE_PS1) || fs.readFileSync(HIDE_PS1, 'utf8') !== HIDE_PS1_BODY) {
      fs.writeFileSync(HIDE_PS1, HIDE_PS1_BODY, 'utf8');
    }
    spawn(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', HIDE_PS1],
      { detached: true, stdio: 'ignore', windowsHide: true },
    ).unref();
  } catch {
    /* ignore hide failures */
  }
}

/**
 * Keep re-hiding while Qt may recreate windows (cold start / model load).
 * Safe to call multiple times — extends the watch window.
 */
export function startLaStudioHideWatch(durationMs = 60_000): void {
  if (process.platform !== 'win32') return;
  const until = Date.now() + Math.max(5_000, durationMs);
  hideWatchUntil = Math.max(hideWatchUntil, until);
  hideLaStudioWindows();
  if (hideWatchTimer) return;
  hideWatchTimer = setInterval(() => {
    if (Date.now() > hideWatchUntil) {
      if (hideWatchTimer) clearInterval(hideWatchTimer);
      hideWatchTimer = null;
      hideWatchUntil = 0;
      return;
    }
    hideLaStudioWindows();
  }, 700);
}

/**
 * Spawn LA Studio desktop engine.
 * default hidden=true — start Minimized + aggressive SW_HIDE (no full GUI flash).
 */
export function spawnLaStudioApp(opts?: {
  hidden?: boolean;
}): { ok: boolean; exe?: string; error?: string; pid?: number; hidden?: boolean } {
  const exe = resolveLaStudioExe();
  if (!exe) {
    lastSpawnError =
      'Không tìm thấy LA Studio.exe (set LA_STUDIO_EXE hoặc cài vào D:\\LA Studio).';
    return { ok: false, error: lastSpawnError };
  }
  const hidden = opts?.hidden !== false;
  try {
    lastSpawnError = '';
    if (hidden && process.platform === 'win32') {
      // Start-Process Minimized avoids a full normal window flash; then SW_HIDE loop.
      const escaped = exe.replace(/'/g, "''");
      const workDir = path.dirname(exe).replace(/'/g, "''");
      const child = spawn(
        'powershell.exe',
        [
          '-NoProfile',
          '-NonInteractive',
          '-WindowStyle',
          'Hidden',
          '-Command',
          `Start-Process -FilePath '${escaped}' -WorkingDirectory '${workDir}' -WindowStyle Minimized`,
        ],
        { detached: true, stdio: 'ignore', windowsHide: true },
      );
      child.unref();
      lastSpawned = child;
      // Hide immediately + keep re-hiding while Qt boots / model loads (up to ~75s)
      startLaStudioHideWatch(75_000);
      setTimeout(() => hideLaStudioWindows(), 200);
      setTimeout(() => hideLaStudioWindows(), 800);
      setTimeout(() => hideLaStudioWindows(), 2_000);
      setTimeout(() => hideLaStudioWindows(), 5_000);
      return { ok: true, exe, pid: child.pid, hidden: true };
    }

    // Visible spawn (explicit hidden:false only)
    const child = spawn(exe, [], {
      detached: true,
      stdio: 'ignore',
      windowsHide: false,
      cwd: path.dirname(exe),
    });
    child.unref();
    lastSpawned = child;
    return { ok: true, exe, pid: child.pid, hidden: false };
  } catch (e) {
    lastSpawnError = e instanceof Error ? e.message : String(e);
    return { ok: false, exe, error: lastSpawnError };
  }
}

function authHeaders(apiKey?: string): Record<string, string> {
  const key = resolveLaStudioApiKey(apiKey);
  if (!key) return {};
  return { Authorization: `Bearer ${key}` };
}

export async function probeLaStudioHealth(
  baseUrl?: string,
  timeoutMs = 2000,
): Promise<LaStudioHealth> {
  const base = resolveLaStudioBaseUrl(baseUrl);
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${base}/health`, {
      method: 'GET',
      signal: ctrl.signal,
      cache: 'no-store',
    });
    const text = await res.text();
    let json: Record<string, unknown> = {};
    try {
      json = text ? (JSON.parse(text) as Record<string, unknown>) : {};
    } catch {
      return {
        online: res.ok,
        baseUrl: base,
        error: `Health non-JSON (${res.status})`,
      };
    }
    const running = json.running === true || json.status === 'ok';
    return {
      online: res.ok && running,
      baseUrl: base,
      status: String(json.status || ''),
      enabled: json.enabled === true,
      running,
      port: typeof json.port === 'number' ? json.port : undefined,
      ttsLoaded: json.tts_loaded === true,
      ttsFamily: typeof json.tts_family === 'string' ? json.tts_family : undefined,
      sttLoaded: json.stt_loaded === true,
      apiKeyRequired: json.api_key_required === true,
      raw: json,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      online: false,
      baseUrl: base,
      error: msg.includes('abort') ? 'timeout' : msg,
    };
  } finally {
    clearTimeout(t);
  }
}

export async function listLaStudioVoices(
  baseUrl?: string,
  apiKey?: string,
  timeoutMs = 5000,
): Promise<LaStudioVoice[]> {
  const base = resolveLaStudioBaseUrl(baseUrl);
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${base}/v1/audio/voices`, {
      method: 'GET',
      headers: { ...authHeaders(apiKey), Accept: 'application/json' },
      signal: ctrl.signal,
      cache: 'no-store',
    });
    const text = await res.text();
    if (!res.ok) {
      throw new Error(`LA Studio voices HTTP ${res.status}: ${text.slice(0, 200)}`);
    }
    const json = JSON.parse(text) as { data?: Array<Record<string, unknown>> };
    const data = Array.isArray(json.data) ? json.data : [];
    return data
      .map((row) => ({
        id: String(row.id || '').trim(),
        name: String(row.name || row.id || '').trim(),
        detail: row.detail != null ? String(row.detail) : undefined,
      }))
      .filter((v) => v.id);
  } finally {
    clearTimeout(t);
  }
}

function humanizeKokoroVoiceId(id: string): string {
  return String(id || '')
    .split(/[_-]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

/**
 * Parse both LA Studio / Kokoro voice catalogs:
 * - map:  { "diem_trinh": { "label": "…", "filename": "…" }, … }
 * - array: { "schema": "kokoro-vietnamese.cpp.voices.v1", "voices": [{ "id", "file" }, …] }
 * CẤM Object.keys() thô trên schema array (sẽ ra schema/default_voice/voices).
 */
/**
 * Parse voice catalog JSON from Kokoro (id→label/filename) or VieNeu v3
 * (`presets` map with description/gender/style) or `{ voices: [...] }`.
 */
export function parseKokoroVoicesJson(raw: unknown): LaStudioVoice[] {
  if (!raw || typeof raw !== 'object') return [];
  const o = raw as Record<string, unknown>;

  // VieNeu v3: { meta, default_voice, presets: { "Tên giọng": { gender, style, description } } }
  if (o.presets && typeof o.presets === 'object' && !Array.isArray(o.presets)) {
    const out: LaStudioVoice[] = [];
    for (const [id, meta] of Object.entries(o.presets as Record<string, unknown>)) {
      const name = String(id || '').trim();
      if (!name) continue;
      const m =
        meta && typeof meta === 'object'
          ? (meta as Record<string, unknown>)
          : {};
      const gender = String(m.gender || '').trim();
      const style = String(m.style || '').trim();
      const desc = String(m.description || '').trim();
      out.push({
        id: name,
        name,
        detail: [desc || 'VieNeu preset', gender, style].filter(Boolean).join(' · '),
      });
    }
    return out;
  }

  if (Array.isArray(o.voices)) {
    const out: LaStudioVoice[] = [];
    for (const row of o.voices) {
      if (!row || typeof row !== 'object') continue;
      const r = row as Record<string, unknown>;
      const id = String(r.id || r.name || '').trim();
      if (!id || id === 'schema' || id === 'default_voice') continue;
      out.push({
        id,
        name: String(r.label || r.name || humanizeKokoroVoiceId(id)),
        detail: String(r.detail || r.description || 'preset'),
      });
    }
    return out;
  }

  const skip = new Set([
    'schema',
    'default_voice',
    'voices',
    'meta',
    'presets',
    'version',
    'count',
  ]);
  const out: LaStudioVoice[] = [];
  for (const [id, meta] of Object.entries(o)) {
    if (!id || skip.has(id) || id.startsWith('_')) continue;
    if (!meta || typeof meta !== 'object') continue;
    const m = meta as Record<string, unknown>;
    // Kokoro map: label/filename; VieNeu-like: gender/style/description/speaker_emb
    const looksVoice =
      'label' in m ||
      'filename' in m ||
      'file' in m ||
      'name' in m ||
      'gender' in m ||
      'style' in m ||
      'description' in m ||
      'speaker_emb' in m ||
      'codes' in m;
    if (!looksVoice) continue;
    out.push({
      id,
      name: String(m.label || m.name || humanizeKokoroVoiceId(id)),
      detail: String(
        m.description || m.detail || m.gender || 'voice pack',
      ),
    });
  }
  return out;
}

/**
 * Static Kokoro-VI voice list from ship pack + LA Studio model pack (offline catalog).
 */
export function loadLocalKokoroViVoices(): LaStudioVoice[] {
  const ini = readSettingsIni();
  const candidates = [
    // Ship portable (AI Novel pack) — array schema
    ...appRootCandidates().map((root) =>
      path.join(root, 'bin', 'la-studio-kokoro', 'models', 'voices.json'),
    ),
    path.join(ini.modelsPath, 'contextboxai', 'Kokoro-Vietnamese', 'voices.json'),
    path.join(os.homedir(), '.lastudio', 'models', 'contextboxai', 'Kokoro-Vietnamese', 'voices.json'),
    path.join(
      os.homedir(),
      '.lastudio',
      'extensions',
      'backends',
      'kokoro-vietnamese',
      'win-x86_64-cpu-v0.1.0',
      'models',
      'voices.json',
    ),
  ];
  // Prefer richest valid list (bundled often has same 14 + cpp schema)
  let best: LaStudioVoice[] = [];
  for (const p of candidates) {
    try {
      if (!fs.existsSync(p)) continue;
      const raw = JSON.parse(fs.readFileSync(p, 'utf8')) as unknown;
      const list = parseKokoroVoicesJson(raw);
      if (list.length > best.length) best = list;
    } catch {
      /* try next */
    }
  }
  return best;
}

function tryKokoroAt(base: string): {
  cli: string;
  modelDir: string;
  voices: string[];
  root: string;
} | null {
  if (!base || !fs.existsSync(base)) return null;
  const cli = path.join(base, 'bin', 'kokoro-vi-cli.exe');
  const modelDir = path.join(base, 'models');
  const onnx = path.join(modelDir, 'kokoro_vi.onnx');
  if (!fs.existsSync(cli) || !fs.existsSync(onnx)) return null;
  let voices: string[] = [];
  try {
    const voicesJson = path.join(modelDir, 'voices.json');
    const raw = JSON.parse(fs.readFileSync(voicesJson, 'utf8')) as unknown;
    voices = parseKokoroVoicesJson(raw).map((v) => v.id);
  } catch {
    voices = [];
  }
  // Fallback: scan voice bins if json empty/misparsed
  if (!voices.length) {
    try {
      voices = fs
        .readdirSync(modelDir)
        .filter((f) => f.endsWith('.bin') || f.endsWith('.pt'))
        .map((f) => f.replace(/\.(bin|pt)$/i, ''))
        .filter(Boolean);
    } catch {
      /* ignore */
    }
  }
  return { cli, modelDir, voices, root: base };
}

function appRootCandidates(): string[] {
  const roots: string[] = [];
  const envRoot = (process.env.AI_NOVEL_ROOT || '').trim();
  if (envRoot) roots.push(envRoot);
  try {
    const res = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
    if (res) roots.push(res);
  } catch {
    /* ignore */
  }
  roots.push(process.cwd());
  return [...new Set(roots.filter(Boolean))];
}

/**
 * Resolve portable Kokoro-VI runtime shipped with AI Novel (or LA Studio pack).
 * Priority:
 * 1) bin/la-studio-kokoro under AI_NOVEL_ROOT / resources / cwd (ship layout)
 * 2) ~/.lastudio/extensions/backends/kokoro-vietnamese/* (dev machine with LA Studio)
 */
export function resolveKokoroViRuntime(): {
  cli: string;
  modelDir: string;
  voices: string[];
  root: string;
  source: 'bundled' | 'lastudio';
} | null {
  for (const root of appRootCandidates()) {
    const portable = tryKokoroAt(path.join(root, 'bin', 'la-studio-kokoro'));
    if (portable) return { ...portable, source: 'bundled' };
  }

  const lastudioRoot = path.join(
    os.homedir(),
    '.lastudio',
    'extensions',
    'backends',
    'kokoro-vietnamese',
  );
  if (fs.existsSync(lastudioRoot)) {
    try {
      const versions = fs
        .readdirSync(lastudioRoot, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => d.name)
        .sort()
        .reverse();
      for (const ver of versions) {
        const hit = tryKokoroAt(path.join(lastudioRoot, ver));
        if (hit) return { ...hit, source: 'lastudio' };
      }
    } catch {
      /* ignore */
    }
  }
  return null;
}

export function isKokoroCliReady(): boolean {
  return !!resolveKokoroViRuntime();
}

function normalizeKokoroVoiceId(voice: string, available: string[]): string {
  let v = String(voice || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_');
  if (!v || v === 'default' || v === 'active') v = KOKORO_DEFAULT_VOICE;
  if (available.includes(v)) return v;
  // fuzzy: label → id
  const hit = available.find(
    (id) => id === v || id.replace(/_/g, '') === v.replace(/_/g, ''),
  );
  if (hit) return hit;
  if (available.includes(KOKORO_DEFAULT_VOICE)) return KOKORO_DEFAULT_VOICE;
  return available[0] || KOKORO_DEFAULT_VOICE;
}

/**
 * Direct Kokoro-VI CLI (LA Studio backend pack) — always works offline without
 * GUI model load. Same ONNX + voicepacks as LA Studio desktop.
 */
export async function synthesizeKokoroCli(input: {
  text: string;
  voice?: string;
  timeoutMs?: number;
}): Promise<LaStudioSynthResult> {
  const text = String(input.text || '').trim();
  if (!text) throw new Error('LA Studio/Kokoro: thiếu text.');

  let rt = resolveKokoroViRuntime();
  if (!rt) {
    // Best-effort prepare into portable dir (download/copy) then retry
    try {
      const { ensurePortableKokoroRuntime } = await import('./laStudioKokoroEnsure');
      await ensurePortableKokoroRuntime();
      rt = resolveKokoroViRuntime();
    } catch (e) {
      console.warn(
        '[LA Studio] ensure portable kokoro failed',
        e instanceof Error ? e.message : e,
      );
    }
  }
  if (!rt) {
    throw new Error(
      'Kokoro-VI runtime chưa có trong gói app (bin/la-studio-kokoro). ' +
        'Chạy: npm run prepare:la-studio-kokoro rồi pack lại. ' +
        'Hoặc máy dev: cài pack qua LA Studio (Kokoro-Vietnamese).',
    );
  }

  const voiceId = normalizeKokoroVoiceId(input.voice || '', rt.voices);
  const tmpDir = path.join(os.tmpdir(), 'ainovel-la-studio');
  if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
  const outWav = path.join(
    tmpDir,
    `k_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}.wav`,
  );

  const timeoutMs = Math.max(15_000, input.timeoutMs ?? 180_000);

  await new Promise<void>((resolve, reject) => {
    const child = spawn(rt.cli, [rt.modelDir, voiceId, outWav, text], {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stderr = '';
    child.stderr?.on('data', (c) => {
      stderr += String(c);
    });
    const timer = setTimeout(() => {
      try {
        child.kill();
      } catch {
        /* ignore */
      }
      reject(new Error(`Kokoro CLI timeout ${timeoutMs}ms`));
    }, timeoutMs);
    child.on('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        reject(
          new Error(
            `Kokoro CLI exit ${code}: ${stderr.slice(0, 300) || 'no stderr'}`,
          ),
        );
        return;
      }
      resolve();
    });
  });

  if (!fs.existsSync(outWav)) {
    throw new Error('Kokoro CLI: không tạo được file WAV.');
  }
  const buffer = fs.readFileSync(outWav);
  try {
    fs.unlinkSync(outWav);
  } catch {
    /* ignore */
  }
  if (buffer.length < 800) {
    throw new Error(`Kokoro CLI: WAV quá nhỏ (${buffer.length}B).`);
  }
  const isWav =
    buffer[0] === 0x52 &&
    buffer[1] === 0x49 &&
    buffer[2] === 0x46 &&
    buffer[3] === 0x46;
  if (!isWav) {
    throw new Error('Kokoro CLI: output không phải WAV (RIFF).');
  }

  return {
    buffer,
    method: `LAStudio-KokoroCLI:${voiceId}`,
    baseUrl: 'kokoro-vi-cli',
    contentType: 'audio/wav',
    nativeSpeedApplied: false,
  };
}

async function synthesizeViaApi(
  input: LaStudioSynthInput,
  base: string,
): Promise<LaStudioSynthResult> {
  const speed =
    typeof input.speed === 'number' && Number.isFinite(input.speed) && input.speed > 0
      ? input.speed
      : 1;
  const body: Record<string, unknown> = {
    input: input.text,
    response_format: 'wav',
    speed,
  };
  const voice = String(input.voice || '').trim();
  if (voice && voice !== 'default' && voice !== 'active') {
    body.voice = voice;
  }
  if (input.model?.trim()) body.model = input.model.trim();
  if (input.language?.trim()) body.language = input.language.trim();

  const timeoutMs = Math.max(10_000, input.timeoutMs ?? 300_000);
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);

  try {
    const res = await fetch(`${base}/v1/audio/speech`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'audio/wav, application/octet-stream, application/json',
        ...authHeaders(input.apiKey),
      },
      body: JSON.stringify(body),
      signal: ctrl.signal,
      cache: 'no-store',
    });

    const contentType = String(res.headers.get('content-type') || '');
    if (!res.ok) {
      const errText = await res.text();
      let msg = errText.slice(0, 400);
      try {
        const j = JSON.parse(errText) as { error?: { message?: string }; message?: string };
        msg = j.error?.message || j.message || msg;
      } catch {
        /* raw */
      }
      throw new Error(`LA Studio speech HTTP ${res.status}: ${msg}`);
    }

    const ab = await res.arrayBuffer();
    const buffer = Buffer.from(ab);
    if (!buffer.length) throw new Error('LA Studio: response audio rỗng.');
    const isWav =
      buffer.length >= 12 &&
      buffer[0] === 0x52 &&
      buffer[1] === 0x49 &&
      buffer[2] === 0x46 &&
      buffer[3] === 0x46;
    if (!isWav && contentType.includes('json')) {
      throw new Error(`LA Studio: expected WAV, got JSON: ${buffer.toString('utf8').slice(0, 200)}`);
    }

    return {
      buffer,
      method: `LAStudio-API@${base}${voice ? `:${voice}` : ''}`,
      baseUrl: base,
      contentType: contentType || 'audio/wav',
      nativeSpeedApplied: true,
    };
  } finally {
    clearTimeout(t);
  }
}

/**
 * Synth path for platform `la_studio`:
 * 1) Ensure desktop engine ẩn (API) best-effort
 * 2) Prefer HTTP API when model already loaded
 * 3) Else Kokoro-VI CLI (cùng pack runtime LA Studio đã tải) — gen WAV thật không cần load GUI
 */
export async function synthesizeLaStudioSpeech(
  input: LaStudioSynthInput,
): Promise<LaStudioSynthResult> {
  const text = String(input.text || '').trim();
  if (!text) {
    throw new Error('LA Studio: thiếu text (input).');
  }

  const base = resolveLaStudioBaseUrl(input.baseUrl);
  let voice = String(input.voice || '').trim();
  const isCustomApiVoice =
    /^voice[_-]/i.test(voice) ||
    /^cons[_-]/i.test(voice) ||
    /^lsc_/i.test(voice);

  // Durable user-clone (lsc_*): re-register sample on LA Studio API if session lost
  if (/^lsc_/i.test(voice)) {
    try {
      const {
        resolveCloneAudioPath,
        updateLaStudioUserClone,
      } = await import('@/lib/laStudioClones');
      const hit = resolveCloneAudioPath(voice);
      if (hit) {
        // Prefer previous API id if still listed
        const apiId = hit.meta.laStudioApiId;
        await ensureLaStudioApiReady({
          baseUrl: base,
          spawnApp: true,
          hidden: true,
          pollMs: 12_000,
        });
        const health0 = await probeLaStudioHealth(base, 2500);
        if (health0.online && health0.ttsLoaded) {
          let useId = apiId || '';
          if (useId) {
            try {
              const live = await listLaStudioVoices(
                base,
                resolveLaStudioApiKey(input.apiKey),
                3500,
              );
              if (!live.some((v) => v.id === useId)) useId = '';
            } catch {
              useId = '';
            }
          }
          if (!useId) {
            const b64 = fs.readFileSync(hit.path).toString('base64');
            const created = await createLaStudioVoice({
              name: hit.meta.name,
              audioBase64: b64,
              language: hit.meta.language || 'vi',
              baseUrl: base,
              apiKey: input.apiKey,
            });
            useId = created.id;
            updateLaStudioUserClone(voice, { laStudioApiId: created.id });
          }
          voice = useId;
        }
      }
    } catch (e) {
      console.warn(
        '[LA Studio] user-clone re-register:',
        e instanceof Error ? e.message : e,
      );
    }
  }

  // Keep engine alive in background (short poll — do not block CLI path long)
  void ensureLaStudioApiReady({
    baseUrl: base,
    spawnApp: true,
    hidden: true,
    pollMs: 6_000,
  }).catch(() => undefined);

  const health = await probeLaStudioHealth(base, 2000);
  if (health.online && health.ttsLoaded) {
    try {
      return await synthesizeViaApi({ ...input, text, voice }, base);
    } catch (e) {
      if (isCustomApiVoice) {
        throw e instanceof Error ? e : new Error(String(e));
      }
      console.warn(
        '[LA Studio] API synth failed → Kokoro CLI:',
        e instanceof Error ? e.message : e,
      );
    }
  }

  if (isCustomApiVoice) {
    // Preview only: honest sample play of user's ref audio when engine offline.
    // Full scene gen must hard-fail (B10) — never ship ref sample as fake TTS.
    if (
      input.allowSampleFallback &&
      /^lsc_/i.test(String(input.voice || '').trim())
    ) {
      try {
        const { resolveCloneAudioPath } = await import('@/lib/laStudioClones');
        const hit = resolveCloneAudioPath(String(input.voice || '').trim());
        if (hit && fs.existsSync(hit.path)) {
          const buffer = fs.readFileSync(hit.path);
          if (buffer.length > 400) {
            return {
              buffer,
              method: `LAStudio-UserCloneSample:${hit.meta.id}`,
              baseUrl: 'user-clone-sample',
              contentType: hit.path.toLowerCase().endsWith('.mp3')
                ? 'audio/mpeg'
                : 'audio/wav',
              nativeSpeedApplied: false,
            };
          }
        }
      } catch {
        /* fall through */
      }
    }
    throw new Error(
      'Giọng clone custom cần LA Studio API + model TTS đã load (Omni / voice-clone). ' +
        'Bật «Engine ẩn» hoặc chọn family OmniVoice rồi Nghe thử TTS. ' +
        'Mẫu clone đã lưu trên máy — bấm ▶ trong tab Voice Clone để nghe file mẫu.',
    );
  }

  // Only Kokoro-VI CLI offline path — never silently remap VieNeu/Omni names → diem_trinh
  const kokoroRt = resolveKokoroViRuntime();
  const kokoroIds = new Set(
    (kokoroRt?.voices || []).map((x) => x.toLowerCase().replace(/\s+/g, '_')),
  );
  const voiceKey = voice.toLowerCase().replace(/\s+/g, '_');
  const isKokoroVoice =
    !voice ||
    voice === 'default' ||
    voice === 'active' ||
    kokoroIds.has(voiceKey) ||
    kokoroIds.has(voice.toLowerCase()) ||
    /^(diem_trinh|mai_linh|mai_loan|manh_dung|ngoc_huyen|hung_thinh|my_yen|thanh_dat|phat_tai|tuan_ngoc|duc_an|duc_duy|thuc_trinh|storyvert)$/i.test(
      voiceKey,
    );

  if (!isKokoroVoice) {
    throw new Error(
      `Giọng «${voice}» không thuộc pack Kokoro-VI offline. ` +
        `Hiện chỉ nghe thử/gen offline được 14 giọng Kokoro Vietnamese (Diễm Trinh, Mai Linh…). ` +
        `Giọng VieNeu/family khác: cần model đầy đủ + LA Studio API đã load, hoặc chọn lại family «Kokoro Vietnamese».`,
    );
  }

  return synthesizeKokoroCli({
    text,
    voice,
    timeoutMs: input.timeoutMs ?? 180_000,
  });
}

/**
 * Ensure settings + optional app spawn + poll health.
 * Does not claim success without real /health online.
 */
export async function ensureLaStudioApiReady(opts?: {
  baseUrl?: string;
  spawnApp?: boolean;
  /** default true — run engine without focusing a window */
  hidden?: boolean;
  pollMs?: number;
}): Promise<
  LaStudioHealth & {
    settings?: ReturnType<typeof ensureLaStudioApiEnabledInSettings>;
    spawned?: boolean;
  }
> {
  const settings = ensureLaStudioApiEnabledInSettings();
  const base = resolveLaStudioBaseUrl(opts?.baseUrl);
  const wantHidden = opts?.hidden !== false;
  let health = await probeLaStudioHealth(base, 2000);
  if (health.online) {
    // Already linked — keep UI hidden while AI Novel uses the API
    if (wantHidden) {
      hideLaStudioWindows();
      startLaStudioHideWatch(20_000);
    }
    return { ...health, settings, spawned: false };
  }

  let spawned = false;
  let spawnErr = '';
  if (opts?.spawnApp !== false) {
    const r = spawnLaStudioApp({ hidden: wantHidden });
    spawned = r.ok;
    if (!r.ok) spawnErr = r.error || getLastLaStudioSpawnError();
    // Cold start Qt needs a few seconds before /health listens
    if (spawned) {
      if (wantHidden) startLaStudioHideWatch(75_000);
      await sleep(2_500);
      if (wantHidden) hideLaStudioWindows();
    }
  }

  const budget = Math.max(8_000, opts?.pollMs ?? 45_000);
  const start = Date.now();
  while (Date.now() - start < budget) {
    if (wantHidden) hideLaStudioWindows();
    health = await probeLaStudioHealth(base, 2500);
    if (health.online) {
      if (wantHidden) {
        hideLaStudioWindows();
        startLaStudioHideWatch(30_000);
      }
      return { ...health, settings, spawned };
    }
    await sleep(1_200);
  }

  return {
    ...health,
    settings,
    spawned,
    error:
      health.error ||
      spawnErr ||
      (spawned
        ? 'Đã mở LA Studio nhưng API chưa listen trong thời gian chờ — mở LA Studio.exe một lần, kiểm tra [api] serverEnabled=true (port 3900), rồi bấm lại «Engine ẩn».'
        : 'LA Studio API offline. Cài D:\\LA Studio hoặc set LA_STUDIO_EXE. Gen TTS vẫn dùng được Kokoro CLI ship (bin/la-studio-kokoro).'),
  };
}

/** Create custom clone voice on LA Studio (session-scoped until app restart). */
export async function createLaStudioVoice(input: {
  name: string;
  audioBase64: string;
  consentName?: string;
  language?: string;
  baseUrl?: string;
  apiKey?: string;
}): Promise<{ id: string; name: string }> {
  const base = resolveLaStudioBaseUrl(input.baseUrl);
  const health = await probeLaStudioHealth(base, 2500);
  if (!health.online) {
    throw new Error('LA Studio API offline — không tạo được giọng clone.');
  }

  const consentBody = {
    name: input.consentName || input.name || 'consent',
    language: input.language || 'vi',
    recording_base64: input.audioBase64,
  };
  const consRes = await fetch(`${base}/v1/audio/voice_consents`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders(input.apiKey),
    },
    body: JSON.stringify(consentBody),
  });
  const consText = await consRes.text();
  if (!consRes.ok) {
    throw new Error(`LA Studio consent HTTP ${consRes.status}: ${consText.slice(0, 200)}`);
  }
  let consentId = '';
  try {
    consentId = String((JSON.parse(consText) as { id?: string }).id || '');
  } catch {
    /* optional */
  }

  const voiceRes = await fetch(`${base}/v1/audio/voices`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders(input.apiKey),
    },
    body: JSON.stringify({
      name: input.name || 'clone',
      consent: consentId,
      audio_sample_base64: input.audioBase64,
    }),
  });
  const voiceText = await voiceRes.text();
  if (!voiceRes.ok) {
    throw new Error(`LA Studio create voice HTTP ${voiceRes.status}: ${voiceText.slice(0, 200)}`);
  }
  const json = JSON.parse(voiceText) as { id?: string; name?: string };
  if (!json.id) throw new Error('LA Studio create voice: thiếu id');
  return { id: json.id, name: String(json.name || input.name || json.id) };
}
