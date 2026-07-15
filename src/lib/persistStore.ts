import fs from 'fs';
import path from 'path';
import os from 'os';

export const ZUSTAND_STORE_KEY = 'novel_generator_v2_store';

const SECRET_KEYS = [
  'apiKey',
  'apiKeys',
  'openaiApiKey',
  'openaiApiKeys',
  'grokApiKey',
  'grokApiKeys',
  'lumaApiKey',
  'lumaApiKeys',
  'runwayApiKey',
  'runwayApiKeys',
  'falaiApiKey',
  'falaiApiKeys',
  'imageApiKey',
  'videoApiKey',
  'aiMasterApiKey',
  'googleStudioCookie',
  'googleStudioCookies',
  'tiktokSessionIds',
  'ttsConfig',
] as const;

function resolveUserData(): string | null {
  const env = process.env.AI_NOVEL_USER_DATA?.trim();
  if (env) return env;
  if (process.platform === 'win32') {
    const roaming = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
    return path.join(roaming, 'ai-novel-script-generator');
  }
  return null;
}

/** Primary durable backup path (Electron userData or local scratch). */
export function getStoreBackupPath(): string {
  const userData = resolveUserData();
  if (userData) return path.join(userData, 'novel_store_backup.json');
  const root = process.env.AI_NOVEL_ROOT?.trim() || process.cwd();
  return path.join(root, 'scratch', 'novel_store_backup.json');
}

function getAllBackupPaths(): string[] {
  const userData = resolveUserData();
  const root = process.env.AI_NOVEL_ROOT?.trim() || process.cwd();
  const docs = path.join(os.homedir(), 'Documents', 'AINovel', 'novel_store_backup.json');
  const list: string[] = [];
  if (userData) {
    list.push(path.join(userData, 'novel_store_backup.json'));
    list.push(path.join(userData, 'store', 'latest.json'));
    // history
    const histDir = path.join(userData, 'store', 'history');
    try {
      if (fs.existsSync(histDir)) {
        for (const f of fs.readdirSync(histDir).filter((x) => x.endsWith('.json'))) {
          list.push(path.join(histDir, f));
        }
      }
    } catch {
      // ignore
    }
  }
  list.push(docs);
  list.push(path.join(root, 'scratch', 'novel_store_backup.json'));
  return list;
}

function getSecretsPath(): string | null {
  const userData = resolveUserData();
  if (!userData) return null;
  return path.join(userData, 'store', 'secrets.json');
}

export function scorePersistedStore(raw: string | null | undefined): {
  score: number;
  chapterContentChars: number;
  keyCount: number;
} {
  if (!raw || typeof raw !== 'string') {
    return { score: 0, chapterContentChars: 0, keyCount: 0 };
  }

  try {
    const parsed = JSON.parse(raw);
    const state = parsed?.state || parsed;
    const chapters = Array.isArray(state?.danh_sach_chuong) ? state.danh_sach_chuong : [];
    const chapterContentChars = chapters.reduce((sum: number, chapter: { noi_dung?: string }) => {
      return sum + String(chapter?.noi_dung || '').trim().length;
    }, 0);
    const readyChapters = chapters.filter(
      (chapter: { noi_dung?: string }) => String(chapter?.noi_dung || '').trim().length > 0,
    ).length;
    const keyCount = [
      state?.apiKey,
      state?.openaiApiKey,
      state?.grokApiKey,
      state?.lumaApiKey,
      state?.runwayApiKey,
      state?.falaiApiKey,
      state?.imageApiKey,
      state?.videoApiKey,
      state?.aiMasterApiKey,
      state?.googleStudioCookie,
      ...(Array.isArray(state?.apiKeys) ? state.apiKeys : []),
      ...(Array.isArray(state?.openaiApiKeys) ? state.openaiApiKeys : []),
      ...(Array.isArray(state?.grokApiKeys) ? state.grokApiKeys : []),
      ...(Array.isArray(state?.lumaApiKeys) ? state.lumaApiKeys : []),
      ...(Array.isArray(state?.runwayApiKeys) ? state.runwayApiKeys : []),
      ...(Array.isArray(state?.falaiApiKeys) ? state.falaiApiKeys : []),
      ...(Array.isArray(state?.googleStudioCookies) ? state.googleStudioCookies : []),
      ...(Array.isArray(state?.tiktokSessionIds) ? state.tiktokSessionIds : []),
    ].filter(Boolean).length;
    const generatedAssets =
      Object.keys(state?.generatedAudioPaths || {}).length +
      Object.keys(state?.generatedPrompts || {}).length +
      Object.keys(state?.generatedImages || {}).length +
      Object.keys(state?.generatedVideos || {}).length;
    const loreLen = String(state?.lorebook || '').trim().length;
    const outlineLen = String(state?.dan_y_tong_the || '').trim().length;
    // Media/DNA settings richness — prevents wipe when chapter-heavy snapshot lacks DNA
    const dnaLen = String(state?.visualDnaPrompt || '').trim().length;
    const styleLen = String(state?.mediaStylePreset || '').trim().length;
    const mediaFlags = [
      state?.imageProvider,
      state?.videoProvider,
      state?.imageAspectRatio,
      state?.videoAspectRatio,
      state?.imageModel,
      state?.videoModel,
      state?.ttsConfig,
    ].filter(Boolean).length;
    const settingsScore = Math.min(dnaLen, 3000) + Math.min(styleLen, 500) + mediaFlags * 40;

    return {
      score:
        chapterContentChars +
        readyChapters * 5000 +
        keyCount * 1000 +
        generatedAssets * 100 +
        (state?.giai_doan === 2 ? 2000 : 0) +
        (String(state?.ten_tac_pham || '').trim() ? 50 : 0) +
        Math.min(loreLen, 2000) +
        Math.min(outlineLen, 2000) +
        settingsScore,
      chapterContentChars,
      keyCount,
    };
  } catch {
    return { score: 0, chapterContentChars: 0, keyCount: 0 };
  }
}

function atomicWrite(filePath: string, content: string) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, content, 'utf8');
  try {
    fs.renameSync(tmp, filePath);
  } catch {
    fs.writeFileSync(filePath, content, 'utf8');
    try {
      fs.unlinkSync(tmp);
    } catch {
      // ignore
    }
  }
}

function mergeSecrets(raw: string): string {
  const secretsPath = getSecretsPath();
  if (!secretsPath || !fs.existsSync(secretsPath)) return raw;
  try {
    const secrets = JSON.parse(fs.readFileSync(secretsPath, 'utf8'));
    const parsed = JSON.parse(raw);
    const hasWrapper = parsed && typeof parsed === 'object' && parsed.state;
    const state = hasWrapper ? { ...parsed.state } : { ...parsed };
    let changed = false;
    for (const key of SECRET_KEYS) {
      const incoming = secrets[key];
      if (incoming === undefined || incoming === null || incoming === '') continue;
      const current = state[key];
      const empty =
        current === undefined ||
        current === null ||
        current === '' ||
        (Array.isArray(current) && current.length === 0);
      if (empty) {
        state[key] = incoming;
        changed = true;
      }
    }
    if (!changed) return raw;
    return JSON.stringify(hasWrapper ? { ...parsed, state } : state);
  } catch {
    return raw;
  }
}

export function readStoreBackup(): string | null {
  let best: { raw: string; score: number; mtime: number } | null = null;

  for (const filePath of getAllBackupPaths()) {
    try {
      if (!fs.existsSync(filePath)) continue;
      const raw = fs.readFileSync(filePath, 'utf8').trim();
      if (!raw) continue;
      JSON.parse(raw);
      const score = scorePersistedStore(raw).score;
      if (score <= 0) continue;
      let mtime = 0;
      try {
        mtime = fs.statSync(filePath).mtimeMs;
      } catch {
        // ignore
      }
      if (!best || score > best.score || (score === best.score && mtime > best.mtime)) {
        best = { raw, score, mtime };
      }
    } catch {
      // skip bad file
    }
  }

  if (!best) return null;
  return mergeSecrets(best.raw);
}

export function writeStoreBackup(raw: string): { ok: boolean; path: string; error?: string } {
  const primary = getStoreBackupPath();
  try {
    if (!raw || typeof raw !== 'string') {
      return { ok: false, path: primary, error: 'Empty payload' };
    }
    JSON.parse(raw);
    const incoming = scorePersistedStore(raw);
    if (incoming.score <= 0) {
      return { ok: false, path: primary, error: 'score_zero' };
    }

    const existing = readStoreBackup();
    const existingScore = scorePersistedStore(existing).score;
    if (existingScore > 500 && incoming.score < existingScore * 0.25 && incoming.score < 500) {
      return { ok: true, path: primary, error: 'skipped_weaker' };
    }

    const userData = resolveUserData();
    const targets = [
      primary,
      userData ? path.join(userData, 'store', 'latest.json') : null,
      path.join(os.homedir(), 'Documents', 'AINovel', 'novel_store_backup.json'),
      path.join(process.env.AI_NOVEL_ROOT?.trim() || process.cwd(), 'scratch', 'novel_store_backup.json'),
    ].filter(Boolean) as string[];

    for (const target of targets) {
      try {
        atomicWrite(target, raw);
      } catch (err) {
        console.warn('[PersistStore] write fail', target, (err as Error)?.message);
      }
    }

    // secrets sidecar
    try {
      const parsed = JSON.parse(raw);
      const state = parsed?.state || parsed;
      const secrets: Record<string, unknown> = {};
      for (const key of SECRET_KEYS) {
        if (state?.[key] !== undefined && state[key] !== null && state[key] !== '') {
          secrets[key] = state[key];
        }
      }
      const secretsPath = getSecretsPath();
      if (secretsPath && Object.keys(secrets).length) {
        atomicWrite(secretsPath, JSON.stringify(secrets, null, 2));
      }
    } catch {
      // ignore secrets errors
    }

    return { ok: true, path: primary };
  } catch (err) {
    const message = (err as Error)?.message || String(err);
    console.warn('[PersistStore] Ghi backup thất bại:', message);
    return { ok: false, path: primary, error: message };
  }
}

/** Pick the richer of two persisted store payloads. */
export function pickRicherStore(a: string | null | undefined, b: string | null | undefined): string | null {
  const scoreA = scorePersistedStore(a);
  const scoreB = scorePersistedStore(b);
  if (scoreA.score === 0 && scoreB.score === 0) return null;
  if (scoreB.score > scoreA.score) return b || null;
  return a || null;
}
