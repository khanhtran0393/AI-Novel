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
  'claudeApiKey',
  'claudeApiKeys',
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
] as const;

const TTS_SECRET_KEYS = [
  'tiktokSessionId',
  'googleCloudApiKey',
  'vbeeApiKey',
  'vbeeAppId',
  'vinaReferenceAudioB64',
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
    const keyCount = 0;
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

export function stripSecretsFromStoreRaw(raw: string): string {
  try {
    const parsed = JSON.parse(raw);
    const hasWrapper = parsed && typeof parsed === 'object' && parsed.state;
    const state = { ...(hasWrapper ? parsed.state : parsed) };
    for (const key of SECRET_KEYS) delete state[key];
    if (state.ttsConfig && typeof state.ttsConfig === 'object') {
      const ttsConfig = { ...state.ttsConfig };
      for (const key of TTS_SECRET_KEYS) delete ttsConfig[key];
      state.ttsConfig = ttsConfig;
    }
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
  return stripSecretsFromStoreRaw(best.raw);
}

export function writeStoreBackup(raw: string): { ok: boolean; path: string; error?: string } {
  const primary = getStoreBackupPath();
  try {
    if (!raw || typeof raw !== 'string') {
      return { ok: false, path: primary, error: 'Empty payload' };
    }
    JSON.parse(raw);
    const safeRaw = stripSecretsFromStoreRaw(raw);
    const incoming = scorePersistedStore(safeRaw);
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
        atomicWrite(target, safeRaw);
      } catch (err) {
        console.warn('[PersistStore] write fail', target, (err as Error)?.message);
      }
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
