/**
 * Session inheritance: browser user-data-dir (cookies, cache, LocalStorage,
 * fingerprint) IS the account. App profile only stores identity metadata +
 * binds ops to that profile's browser/extension/token/project.
 */
import fs from 'fs';
import path from 'path';
import {
  accountRootDir,
  profileDirForAccount,
} from './chromeSession';
import type { FlowProjectInfo } from './types';

export type SessionBundle = {
  accountId: string;
  email?: string;
  name?: string;
  credits?: number | null;
  paygateTier?: string | null;
  projectId?: string;
  projects?: Array<{ id: string; title?: string }>;
  profileDir: string;
  extensionDir?: string;
  /** Live Bearer — local only, never leave machine */
  flowKey?: string | null;
  flowKeyPresent: boolean;
  tokenCapturedAt?: number | null;
  sessionExpires?: string | null;
  inheritedAt: number;
  browserExe?: string;
  note?: string;
};

function bundlePath(accountId: string): string {
  const root = accountRootDir(accountId);
  fs.mkdirSync(root, { recursive: true });
  return path.join(root, 'SESSION_BUNDLE.json');
}

export function writeSessionBundle(
  accountId: string,
  partial: Partial<SessionBundle> & { accountId?: string },
): SessionBundle {
  const id = String(accountId || '').trim();
  const prev = loadSessionBundle(id);
  const profileDir = partial.profileDir || prev?.profileDir || profileDirForAccount(id);
  const row: SessionBundle = {
    accountId: id,
    email: partial.email ?? prev?.email ?? '',
    name: partial.name ?? prev?.name ?? '',
    credits: partial.credits !== undefined ? partial.credits : prev?.credits ?? null,
    paygateTier:
      partial.paygateTier !== undefined
        ? partial.paygateTier
        : prev?.paygateTier ?? null,
    projectId: partial.projectId ?? prev?.projectId ?? '',
    projects: partial.projects ?? prev?.projects ?? [],
    profileDir,
    extensionDir: partial.extensionDir ?? prev?.extensionDir,
    flowKey:
      partial.flowKey !== undefined ? partial.flowKey : prev?.flowKey ?? null,
    flowKeyPresent: Boolean(
      partial.flowKeyPresent ??
        (partial.flowKey && String(partial.flowKey).length >= 20) ??
        prev?.flowKeyPresent,
    ),
    tokenCapturedAt:
      partial.tokenCapturedAt !== undefined
        ? partial.tokenCapturedAt
        : prev?.tokenCapturedAt ?? null,
    sessionExpires:
      partial.sessionExpires !== undefined
        ? partial.sessionExpires
        : prev?.sessionExpires ?? null,
    inheritedAt: partial.inheritedAt || Date.now(),
    browserExe: partial.browserExe ?? prev?.browserExe,
    note:
      partial.note ||
      prev?.note ||
      'App inherits browser user-data-dir (cookies/cache/fingerprint). Gen = this account only.',
  };
  fs.writeFileSync(bundlePath(id), JSON.stringify(row, null, 2), 'utf8');
  // Mirror compact meta for operators
  try {
    const metaPath = path.join(accountRootDir(id), 'ACCOUNT_META.json');
    let meta: Record<string, unknown> = {};
    if (fs.existsSync(metaPath)) {
      try {
        meta = JSON.parse(fs.readFileSync(metaPath, 'utf8')) as Record<
          string,
          unknown
        >;
      } catch {
        meta = {};
      }
    }
    fs.writeFileSync(
      metaPath,
      JSON.stringify(
        {
          ...meta,
          accountId: id,
          userDataDir: row.profileDir,
          extensionDir: row.extensionDir || meta.extensionDir,
          email: row.email,
          projectId: row.projectId,
          flowKeyPresent: row.flowKeyPresent,
          sessionInheritedAt: row.inheritedAt,
          note: row.note,
          updatedAt: new Date().toISOString(),
        },
        null,
        2,
      ),
      'utf8',
    );
  } catch {
    /* ignore */
  }
  return row;
}

export function loadSessionBundle(accountId: string): SessionBundle | null {
  try {
    const p = bundlePath(accountId);
    if (!fs.existsSync(p)) return null;
    const raw = JSON.parse(fs.readFileSync(p, 'utf8')) as SessionBundle;
    if (!raw || typeof raw !== 'object') return null;
    return {
      ...raw,
      accountId: String(raw.accountId || accountId),
      profileDir: String(raw.profileDir || profileDirForAccount(accountId)),
      flowKeyPresent: Boolean(raw.flowKeyPresent || raw.flowKey),
    };
  } catch {
    return null;
  }
}

/** Detect whether Chrome profile already has cookie/session artifacts on disk. */
export function profileHasBrowserSession(accountId: string): {
  hasCookies: boolean;
  hasLocalStorage: boolean;
  hasCache: boolean;
  profileDir: string;
} {
  const profileDir = profileDirForAccount(accountId);
  const def = path.join(profileDir, 'Default');
  const cookies =
    fs.existsSync(path.join(def, 'Network', 'Cookies')) ||
    fs.existsSync(path.join(def, 'Cookies'));
  const ls = fs.existsSync(path.join(def, 'Local Storage'));
  const cache =
    fs.existsSync(path.join(def, 'Cache')) ||
    fs.existsSync(path.join(def, 'Code Cache'));
  return {
    hasCookies: cookies,
    hasLocalStorage: ls,
    hasCache: cache,
    profileDir,
  };
}

export function projectsFromBundle(
  bundle: SessionBundle | null,
): FlowProjectInfo[] {
  if (!bundle?.projects?.length) return [];
  const now = Date.now();
  return bundle.projects
    .map((p) => ({
      id: String(p.id || '').trim(),
      title: String(p.title || p.id || 'Project').trim(),
      source: 'capture' as const,
      createdAt: now,
      updatedAt: now,
    }))
    .filter((p) => p.id);
}

/**
 * Full Browser Digital Footprint Sync:
 * Clones 100% of user's PC Chrome User Data (Cookies, Passwords, History, Web Data,
 * Local Storage, Preferences, Bookmarks) from %LOCALAPPDATA%\Google\Chrome\User Data\Default
 * into the isolated profile directory for this accountId before Google Flow navigation.
 */
export function syncFullChromeFootprintToAccountProfile(
  accountId: string,
  stockProfileName = 'Default',
): { ok: boolean; copiedFiles: number; message: string } {
  try {
    const localAppData =
      process.env.LOCALAPPDATA ||
      path.join(
        process.env.USERPROFILE || 'C:\\Users\\Default',
        'AppData',
        'Local',
      );
    const sourceDir = path.join(
      localAppData,
      'Google',
      'Chrome',
      'User Data',
      stockProfileName,
    );

    if (!fs.existsSync(sourceDir)) {
      return {
        ok: false,
        copiedFiles: 0,
        message: `Không tìm thấy thư mục Chrome PC tại: ${sourceDir}`,
      };
    }

    const targetProfileDir = profileDirForAccount(accountId);
    const targetDir = path.join(targetProfileDir, 'Default');
    fs.mkdirSync(targetDir, { recursive: true });

    let copiedCount = 0;

    const copyRecursiveGraceful = (src: string, dest: string) => {
      if (!fs.existsSync(src)) return;
      const stat = fs.statSync(src);

      if (stat.isDirectory()) {
        const baseName = path.basename(src);
        if (
          baseName === 'Cache' ||
          baseName === 'Code Cache' ||
          baseName === 'GPUCache'
        ) {
          return; // Skip heavy binary caches
        }
        fs.mkdirSync(dest, { recursive: true });
        const items = fs.readdirSync(src);
        for (const item of items) {
          copyRecursiveGraceful(path.join(src, item), path.join(dest, item));
        }
      } else {
        const baseName = path.basename(src);
        if (
          baseName.endsWith('.lock') ||
          baseName === 'LOCK' ||
          baseName.startsWith('Singleton')
        ) {
          return; // Skip lock files
        }
        try {
          fs.copyFileSync(src, dest);
          copiedCount++;
        } catch {
          // Graceful skip if file is locked by running Chrome
        }
      }
    };

    copyRecursiveGraceful(sourceDir, targetDir);

    writeSessionBundle(accountId, {
      profileDir: targetProfileDir,
      inheritedAt: Date.now(),
      note: `Full Footprint Synced from Chrome PC (${stockProfileName}) — ${copiedCount} files cloned.`,
    });

    return {
      ok: true,
      copiedFiles: copiedCount,
      message: `Đã đồng bộ thành công ${copiedCount} tệp dữ liệu (Cookie, Mật khẩu, History) từ Chrome PC sang Profile ${accountId}.`,
    };
  } catch (err: any) {
    return {
      ok: false,
      copiedFiles: 0,
      message: `Lỗi đồng bộ vết chân sinh hoạt: ${err?.message || String(err)}`,
    };
  }
}

