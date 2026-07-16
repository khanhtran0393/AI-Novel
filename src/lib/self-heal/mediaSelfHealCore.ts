import fs from 'fs';
import path from 'path';

export type MediaSelfHealDomain = 'image' | 'video' | 'audio' | 'ui_click';

export type MediaSelfHealIssueKind =
  | 'invalid_key'
  | 'missing_key'
  | 'quota'
  | 'model_mismatch'
  | 'missing_module'
  | 'missing_field'
  | 'network'
  | 'unknown';

export interface MediaSelfHealCredentials {
  googleApiKey?: string;
  googleApiKeys?: string[];
  openaiApiKey?: string;
  openaiApiKeys?: string[];
  grokApiKey?: string;
  grokApiKeys?: string[];
  googleStudioCookie?: string;
  googleStudioCookies?: string[];
  tiktokSessionId?: string;
}

export interface MediaSelfHealConfig {
  imageProvider?: string;
  imageModel?: string;
  videoProvider?: string;
  videoModel?: string;
  ttsPlatform?: string;
  ttsVoice?: string;
  ttsApiUrl?: string;
  operation?: string;
  routeProvider?: string;
  routeModel?: string;
}

export interface MediaSelfHealPatch {
  imageProvider?: string;
  imageModel?: string;
  videoProvider?: string;
  videoModel?: string;
  pickerStrategy?: 'windows_dialog' | 'compat_dialog';
  ttsConfig?: {
    platform?: string;
    voice?: string;
    api_url_vieneu?: string;
    /** VinaVoice clone / universal brain flag used by self-heal patches */
    vinaUseClone?: boolean;
  };
}

export interface MediaSelfHealRequest {
  domain: MediaSelfHealDomain;
  error: string;
  config: MediaSelfHealConfig;
  credentials: MediaSelfHealCredentials;
}

export interface ProviderProbeResult {
  provider: string;
  ok: boolean;
  status?: number;
  reason: string;
  models?: string[];
}

export interface MediaSelfHealDiagnosis {
  logId: string;
  logPath: string;
  issue: {
    kind: MediaSelfHealIssueKind;
    message: string;
  };
  patch: MediaSelfHealPatch;
  shouldRetry: boolean;
  summary: string;
  checkedProviders: ProviderProbeResult[];
}

interface LogEntry extends MediaSelfHealDiagnosis {
  createdAt: string;
  domain: MediaSelfHealDomain;
  config: MediaSelfHealConfig;
}

const PROJECT_ROOT = process.env.INIT_CWD && fs.existsSync(path.join(process.env.INIT_CWD, 'package.json'))
  ? process.env.INIT_CWD
  : process.cwd();
const LOG_DIR = path.join(PROJECT_ROOT, 'scratch', 'self-heal');
const LOG_PATH = path.join(LOG_DIR, 'media-errors.jsonl');

const VALID_DOMAINS: MediaSelfHealDomain[] = ['image', 'video', 'audio', 'ui_click'];

export function extractMediaErrorMessage(error: unknown): string {
  if (error == null) return 'Unknown media error';
  if (typeof error === 'string') {
    const trimmed = error.trim();
    return trimmed || 'Unknown media error';
  }
  if (error instanceof Error) {
    const trimmed = error.message.trim();
    return trimmed || error.name || 'Unknown media error';
  }
  if (typeof error === 'object') {
    const obj = error as Record<string, unknown>;
    if (typeof obj.message === 'string' && obj.message.trim()) return obj.message.trim();
    if (typeof obj.error === 'string' && obj.error.trim()) return obj.error.trim();
    if (typeof obj.detail === 'string' && obj.detail.trim()) return obj.detail.trim();
    if (obj.error && typeof obj.error === 'object') {
      const nested = obj.error as Record<string, unknown>;
      if (typeof nested.message === 'string' && nested.message.trim()) return nested.message.trim();
    }
    try {
      const serialized = JSON.stringify(error);
      if (serialized && serialized !== '{}') return serialized;
    } catch {
      // fall through
    }
  }
  const text = String(error).trim();
  return text || 'Unknown media error';
}

export function normalizeMediaSelfHealDomain(domain: unknown): MediaSelfHealDomain | null {
  if (typeof domain !== 'string') return null;
  const normalized = domain.trim().toLowerCase();
  if (normalized === 'tts' || normalized === 'tts_audio') return 'audio';
  return VALID_DOMAINS.includes(normalized as MediaSelfHealDomain)
    ? (normalized as MediaSelfHealDomain)
    : null;
}

export function normalizeMediaSelfHealRequest(body: unknown): MediaSelfHealRequest | { error: string; received?: unknown } {
  const raw = body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
  const domain = normalizeMediaSelfHealDomain(raw.domain);
  if (!domain) {
    return {
      error: `Invalid or missing domain. Expected one of: ${VALID_DOMAINS.join(', ')}`,
      received: raw.domain,
    };
  }

  const errorSource = raw.error ?? raw.err ?? raw.message ?? raw.lastError ?? raw.failure;
  const error = extractMediaErrorMessage(errorSource);
  if (!error || error === 'Unknown media error') {
    return {
      error: 'Missing or unrecognizable error payload.',
      received: { error: raw.error, message: raw.message },
    };
  }

  const config = raw.config && typeof raw.config === 'object' ? (raw.config as MediaSelfHealConfig) : {};
  const credentials = raw.credentials && typeof raw.credentials === 'object'
    ? (raw.credentials as MediaSelfHealCredentials)
    : {};

  return { domain, error, config, credentials };
}

function firstKey(mainKey?: string, keys?: string[]) {
  return mainKey || (Array.isArray(keys) ? keys.find((key) => !!key && key.trim().length > 0) : '') || '';
}

function hasCookie(credentials: MediaSelfHealCredentials) {
  return !!credentials.googleStudioCookie || !!(credentials.googleStudioCookies && credentials.googleStudioCookies.length > 0);
}

function maskConfig(config: MediaSelfHealConfig) {
  return { ...config };
}

function classifyMediaError(error: string): { kind: MediaSelfHealIssueKind; message: string } {
  const message = error || '';
  const normalized = message.toLowerCase();

  if (
    normalized.includes('incorrect api key') ||
    normalized.includes('invalid api key') ||
    normalized.includes('api key not valid') ||
    normalized.includes('unauthorized') ||
    normalized.includes('forbidden') ||
    normalized.includes('401') ||
    normalized.includes('403')
  ) return { kind: 'invalid_key', message };

  if (
    normalized.includes('missing api key') ||
    normalized.includes('khong co api key') ||
    normalized.includes('không có api key') ||
    normalized.includes('khong co key') ||
    normalized.includes('chua cau hinh') ||
    normalized.includes('chưa cấu hình') ||
    normalized.includes('vui long cau hinh') ||
    normalized.includes('vui lòng cấu hình') ||
    normalized.includes('api key') && (normalized.includes('chua') || normalized.includes('chưa') || normalized.includes('thieu') || normalized.includes('thiếu'))
  ) return { kind: 'missing_key', message };

  if (
    normalized.includes('quota') ||
    normalized.includes('rate limit') ||
    normalized.includes('too many requests') ||
    normalized.includes('429') ||
    normalized.includes('limit') ||
    normalized.includes('no credits') ||
    normalized.includes('credits or licenses') ||
    normalized.includes('licenses yet') ||
    normalized.includes('purchase those') ||
    normalized.includes('billing') ||
    normalized.includes('payment required') ||
    normalized.includes('insufficient balance')
  ) return { kind: 'quota', message };

  if (
    normalized.includes('module') ||
    normalized.includes('cannot find') ||
    normalized.includes('khong tim thay') ||
    normalized.includes('không tìm thấy') ||
    normalized.includes('sscronet') ||
    normalized.includes('piper')
  ) return { kind: 'missing_module', message };

  if (
    normalized.includes('model') ||
    normalized.includes('unsupported') ||
    normalized.includes('not found') ||
    normalized.includes('deprecated') ||
    normalized.includes('404')
  ) return { kind: 'model_mismatch', message };

  if (
    normalized.includes('missing field') ||
    normalized.includes('invalid request') ||
    normalized.includes('bad request') ||
    normalized.includes('400')
  ) return { kind: 'missing_field', message };

  if (
    normalized.includes('timeout') ||
    normalized.includes('network') ||
    normalized.includes('fetch failed') ||
    normalized.includes('econnreset') ||
    normalized.includes('enotfound')
  ) return { kind: 'network', message };

  return { kind: 'unknown', message };
}

async function fetchJsonWithTimeout(url: string, init: RequestInit, timeoutMs = 5000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    const text = await response.text();
    let json: unknown = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    return { ok: response.ok, status: response.status, text, json };
  } finally {
    clearTimeout(timeout);
  }
}

async function probeOpenAI(key: string): Promise<ProviderProbeResult> {
  if (!key) return { provider: 'openai', ok: false, reason: 'missing_key' };
  try {
    const res = await fetchJsonWithTimeout('https://api.openai.com/v1/models', {
      headers: { Authorization: `Bearer ${key}` },
    });
    const models = Array.isArray((res.json as { data?: { id?: string }[] } | null)?.data)
      ? ((res.json as { data: { id?: string }[] }).data || []).map((item) => item.id || '').filter(Boolean)
      : [];
    return { provider: 'openai', ok: res.ok, status: res.status, reason: res.ok ? 'api_ok' : res.text.slice(0, 240), models };
  } catch (err) {
    return { provider: 'openai', ok: false, reason: err instanceof Error ? err.message : String(err) };
  }
}

async function probeGrok(key: string): Promise<ProviderProbeResult> {
  if (!key) return { provider: 'grok', ok: false, reason: 'missing_key' };
  try {
    const res = await fetchJsonWithTimeout('https://api.x.ai/v1/models', {
      headers: { Authorization: `Bearer ${key}` },
    });
    const models = Array.isArray((res.json as { data?: { id?: string }[] } | null)?.data)
      ? ((res.json as { data: { id?: string }[] }).data || []).map((item) => item.id || '').filter(Boolean)
      : [];
    return { provider: 'grok', ok: res.ok, status: res.status, reason: res.ok ? 'api_ok' : res.text.slice(0, 240), models };
  } catch (err) {
    return { provider: 'grok', ok: false, reason: err instanceof Error ? err.message : String(err) };
  }
}

async function probeGoogle(key: string): Promise<ProviderProbeResult> {
  if (!key) return { provider: 'gemini', ok: false, reason: 'missing_key' };
  try {
    const res = await fetchJsonWithTimeout(`https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(key)}`, {
      headers: { 'Content-Type': 'application/json' },
    });
    const models = Array.isArray((res.json as { models?: { name?: string }[] } | null)?.models)
      ? ((res.json as { models: { name?: string }[] }).models || []).map((item) => (item.name || '').replace(/^models\//, '')).filter(Boolean)
      : [];
    return { provider: 'gemini', ok: res.ok, status: res.status, reason: res.ok ? 'api_ok' : res.text.slice(0, 240), models };
  } catch (err) {
    return { provider: 'gemini', ok: false, reason: err instanceof Error ? err.message : String(err) };
  }
}

async function probeAvailableProviders(credentials: MediaSelfHealCredentials) {
  const googleKey = firstKey(credentials.googleApiKey, credentials.googleApiKeys);
  const openaiKey = firstKey(credentials.openaiApiKey, credentials.openaiApiKeys);
  const grokKey = firstKey(credentials.grokApiKey, credentials.grokApiKeys);

  const checks = await Promise.all([
    probeGoogle(googleKey),
    probeOpenAI(openaiKey),
    probeGrok(grokKey),
  ]);

  if (hasCookie(credentials)) {
    checks.push({ provider: 'google_studio_cookie', ok: true, reason: 'cookie_present' });
  }

  return checks;
}

function buildImagePatch(
  request: MediaSelfHealRequest,
  checks: ProviderProbeResult[],
  issueKind: MediaSelfHealIssueKind,
): MediaSelfHealPatch {
  void request;
  void checks;
  void issueKind;
  return {};
}

function buildVideoPatch(request: MediaSelfHealRequest, checks: ProviderProbeResult[]): MediaSelfHealPatch {
  void request;
  void checks;
  return {};
}

function buildAudioPatch(request: MediaSelfHealRequest, checks: ProviderProbeResult[], issueKind: MediaSelfHealIssueKind): MediaSelfHealPatch {
  void request;
  void checks;
  void issueKind;
  return {};
}

function hasPatch(patch: MediaSelfHealPatch) {
  return !!(
    patch.imageProvider ||
    patch.imageModel ||
    patch.videoProvider ||
    patch.videoModel ||
    patch.pickerStrategy ||
    patch.ttsConfig
  );
}

function writeLog(entry: LogEntry) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
  fs.appendFileSync(LOG_PATH, `${JSON.stringify(entry)}\n`, 'utf8');
}

export function resolveMediaSelfHealLog(logId?: string) {
  if (!fs.existsSync(LOG_PATH)) return { removed: false, pending: 0 };
  if (!logId) {
    fs.rmSync(LOG_PATH, { force: true });
    return { removed: true, pending: 0 };
  }

  const lines = fs.readFileSync(LOG_PATH, 'utf8').split(/\r?\n/).filter(Boolean);
  const pending = lines.filter((line) => {
    try {
      const entry = JSON.parse(line) as { logId?: string };
      return entry.logId !== logId;
    } catch {
      return true;
    }
  });

  if (pending.length === 0) {
    fs.rmSync(LOG_PATH, { force: true });
    return { removed: true, pending: 0 };
  }

  fs.writeFileSync(LOG_PATH, `${pending.join('\n')}\n`, 'utf8');
  return { removed: true, pending: pending.length };
}

export async function diagnoseMediaSelfHeal(input: MediaSelfHealRequest | unknown): Promise<MediaSelfHealDiagnosis> {
  const normalized = normalizeMediaSelfHealRequest(input);
  if ('error' in normalized && !('domain' in normalized)) {
    throw new Error((normalized as { error: string }).error);
  }
  const request = normalized as MediaSelfHealRequest;

  console.info(
    `[Self-Heal Brain] Input recognized: domain=${request.domain}, error="${request.error.slice(0, 120)}", operation=${request.config?.operation || 'n/a'}`,
  );

  const issue = classifyMediaError(request.error);
  const checkedProviders = await probeAvailableProviders(request.credentials || {});

  const patch =
    request.domain === 'image'
      ? buildImagePatch(request, checkedProviders, issue.kind)
      : request.domain === 'video'
        ? buildVideoPatch(request, checkedProviders)
        : request.domain === 'audio'
          ? buildAudioPatch(request, checkedProviders, issue.kind)
          : { pickerStrategy: 'compat_dialog' as const };

  const logId = `heal_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const shouldRetry = hasPatch(patch);
  const summary = shouldRetry
    ? `Self-heal brain prepared repair for ${request.domain}: ${JSON.stringify(patch)} | issue=${issue.kind} | probes=${checkedProviders.map((p) => `${p.provider}:${p.ok ? 'ok' : 'fail'}`).join(',')}`
    : request.domain === 'ui_click'
      ? `Self-heal logged UI click error and is waiting for user approval.`
      : `Self-heal logged ${request.domain} error but did not find a safe media config patch. issue=${issue.kind}`;

  const diagnosis: MediaSelfHealDiagnosis = {
    logId,
    logPath: LOG_PATH,
    issue,
    patch,
    shouldRetry,
    summary,
    checkedProviders,
  };

  writeLog({
    ...diagnosis,
    createdAt: new Date().toISOString(),
    domain: request.domain,
    config: maskConfig(request.config || {}),
  });

  console.info(
    `[Self-Heal Brain] Diagnosis complete: domain=${request.domain} kind=${issue.kind} shouldRetry=${shouldRetry} logId=${logId}`,
  );

  return diagnosis;
}

export const MEDIA_SELF_HEAL_LOG_PATH = LOG_PATH;
