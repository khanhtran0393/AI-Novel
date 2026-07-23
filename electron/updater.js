/**
 * Desktop auto-update via electron-updater.
 *
 * Providers (bundled public.env):
 * - github (preferred): AINOVEL_UPDATE_GITHUB_OWNER / REPO
 * - generic (fallback): AINOVEL_UPDATE_FEED_URL (HTTPS host-pinned)
 *
 * Policy C' (docs/SHIP_GUIDE.md + updateChannel.ts):
 *   check on launch → auto download (stage) → do NOT install on quit
 *   → next launch applies staged update (no prompt) → changelog UI
 *
 * ALLOW_UNSIGNED=1 → verifyUpdateCodeSignature = async () => null
 *   (NsisUpdater setter ignores falsy; never assign `false`)
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { autoUpdater } = require('electron-updater');
const { app, BrowserWindow } = require('electron');
const releaseNotes = require('./releaseNotes');

let lastStatus = {
  enabled: false,
  provider: null,
  activeProvider: null,
  channel: 'stable',
  feedUrl: null,
  checking: false,
  available: false,
  downloaded: false,
  error: null,
  version: null,
  releaseNotes: null,
  progress: null,
  justUpdated: null,
  stagedVersion: null,
};

/** When true, update-downloaded will call quitAndInstall (next-launch apply). */
let applyStagedOnDownload = false;
let listenersBound = false;
/** Last successful feed config applied to autoUpdater */
let activeFeed = null;

function resolveChannel() {
  const raw = String(process.env.AINOVEL_UPDATE_CHANNEL || 'stable').toLowerCase();
  return raw === 'beta' || raw === 'dev' ? raw : 'stable';
}

function resolveProviderPreference() {
  const raw = String(process.env.AINOVEL_UPDATE_PROVIDER || 'github')
    .trim()
    .toLowerCase();
  return raw === 'generic' ? 'generic' : 'github';
}

function resolveGithub() {
  const owner = String(
    process.env.AINOVEL_UPDATE_GITHUB_OWNER || 'khanhtran0393',
  ).trim();
  const repo = String(
    process.env.AINOVEL_UPDATE_GITHUB_REPO || 'AI-Novel-release-',
  ).trim();
  return { owner, repo };
}

function resolveGenericFeedUrl() {
  const raw = (process.env.AINOVEL_UPDATE_FEED_URL || '').trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:') return null;
    if (url.hostname === 'example.com' || url.hostname.endsWith('.example.com')) {
      return null;
    }
    const builtin = ['azlizrbjkqcyqnsmuccv.supabase.co'];
    const extra = String(process.env.AINOVEL_UPDATE_FEED_HOSTS || '')
      .split(/[,\s]+/)
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);
    const allowed = new Set([...builtin, ...extra]);
    if (!allowed.has(url.hostname.toLowerCase())) {
      console.warn(
        '[updater] feed host not in pin allowlist:',
        url.hostname,
        'allowed=',
        [...allowed].join(','),
      );
      return null;
    }
    return url.toString().replace(/\/$/, '');
  } catch {
    return null;
  }
}

/**
 * Build ordered feed candidates: preferred provider first, then the other if configured.
 * Dual-feed = resilience (GitHub outage / missing latest.yml → Supabase generic).
 */
function listFeedCandidates() {
  const channel = resolveChannel();
  const preferred = resolveProviderPreference();
  const candidates = [];

  const github = () => {
    const { owner, repo } = resolveGithub();
    if (!owner || !repo) return null;
    return {
      provider: 'github',
      channel,
      feedUrl: `https://github.com/${owner}/${repo}/releases`,
      setFeed: {
        provider: 'github',
        owner,
        repo,
        vPrefixedTagName: true,
        private: false,
      },
    };
  };

  const generic = () => {
    const feedUrl = resolveGenericFeedUrl();
    if (!feedUrl) return null;
    return {
      provider: 'generic',
      channel,
      feedUrl,
      setFeed: {
        provider: 'generic',
        url: feedUrl,
        channel: channel === 'stable' ? 'latest' : channel,
      },
    };
  };

  if (preferred === 'github') {
    const g = github();
    if (g) candidates.push(g);
    const gen = generic();
    if (gen) candidates.push(gen);
  } else {
    const gen = generic();
    if (gen) candidates.push(gen);
    const g = github();
    if (g) candidates.push(g);
  }
  return candidates;
}

function shouldCheckOnLaunch() {
  return process.env.AINOVEL_UPDATE_CHECK_ON_LAUNCH !== '0';
}

function qaAutoInstall() {
  return process.env.AINOVEL_UPDATE_QA_AUTORUN === '1';
}

function allowPrerelease() {
  if (process.env.AINOVEL_UPDATE_ALLOW_PRERELEASE === '1') return true;
  return resolveChannel() !== 'stable';
}

function allowUnsigned() {
  return process.env.AINOVEL_UPDATE_ALLOW_UNSIGNED === '1';
}

function pendingPath() {
  return path.join(app.getPath('userData'), 'update-pending.json');
}

function readPending() {
  try {
    const p = pendingPath();
    if (!fs.existsSync(p)) return null;
    return JSON.parse(fs.readFileSync(p, 'utf8')) || null;
  } catch {
    return null;
  }
}

function writePending(partial) {
  const prev = readPending() || {};
  const next = {
    ...prev,
    ...partial,
    updatedAt: new Date().toISOString(),
  };
  try {
    fs.writeFileSync(pendingPath(), JSON.stringify(next, null, 2), 'utf8');
  } catch (e) {
    console.warn('[updater] write pending fail', e?.message || e);
  }
  return next;
}

function clearPending() {
  try {
    const p = pendingPath();
    if (fs.existsSync(p)) fs.unlinkSync(p);
  } catch {
    /* ignore */
  }
}

function broadcast(channel, payload) {
  for (const win of BrowserWindow.getAllWindows()) {
    try {
      if (!win.isDestroyed()) {
        win.webContents.send(channel, payload);
      }
    } catch {
      /* ignore */
    }
  }
}

function setStatus(partial) {
  lastStatus = { ...lastStatus, ...partial, at: new Date().toISOString() };
  broadcast('ainovel-update-status', lastStatus);
  return lastStatus;
}

function getStatus() {
  return {
    ...lastStatus,
    appVersion: app.getVersion(),
    packaged: app.isPackaged,
  };
}

function acknowledgeJustUpdated() {
  releaseNotes.acknowledgeJustUpdated(app.getVersion());
  return setStatus({ justUpdated: null });
}

function applyFeedConfig(cfg, log) {
  autoUpdater.setFeedURL(cfg.setFeed);
  activeFeed = cfg;
  log(
    `feed active provider=${cfg.provider} channel=${cfg.channel} url=${cfg.feedUrl}`,
  );
  setStatus({
    provider: resolveProviderPreference(),
    activeProvider: cfg.provider,
    feedUrl: cfg.feedUrl,
    channel: cfg.channel,
  });
}

function isPortableRuntime() {
  return Boolean(
    process.env.PORTABLE_EXECUTABLE_DIR ||
      process.env.PORTABLE_EXECUTABLE_FILE ||
      process.env.PORTABLE_EXECUTABLE_APP_FILENAME,
  );
}

function quitAndInstall() {
  try {
    try {
      releaseNotes.markPendingUpdate(
        app.getVersion(),
        lastStatus.version || readPending()?.downloadedVersion,
        lastStatus.releaseNotes,
      );
    } catch {
      /* ignore */
    }
    if (isPortableRuntime()) {
      console.log(
        '[Updater] portable runtime — install without /S (NSIS package preferred)',
      );
    }
    // isSilent=false → no /S; isForceRunAfter=true → relaunch
    autoUpdater.quitAndInstall(false, true);
    return { ok: true };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

function bindListeners(log) {
  if (listenersBound) return;
  listenersBound = true;

  autoUpdater.on('checking-for-update', () => {
    log('checking…');
    setStatus({ checking: true, error: null, enabled: true });
  });

  autoUpdater.on('update-available', (info) => {
    log(`available ${info?.version || '?'}`);
    setStatus({
      checking: false,
      available: true,
      version: info?.version || null,
      releaseNotes: info?.releaseNotes || null,
      enabled: true,
      error: null,
    });
    writePending({
      availableVersion: info?.version || null,
      installOnNextLaunch: true,
    });
  });

  autoUpdater.on('update-not-available', () => {
    log('up to date');
    const pending = readPending();
    if (
      pending?.downloadedVersion &&
      releaseNotes.compareSemver(app.getVersion(), pending.downloadedVersion) >=
        0
    ) {
      clearPending();
    }
    setStatus({
      checking: false,
      available: false,
      enabled: true,
      error: null,
      stagedVersion: null,
    });
  });

  autoUpdater.on('download-progress', (p) => {
    setStatus({
      progress: {
        percent: Math.round(p.percent || 0),
        transferred: p.transferred,
        total: p.total,
        bytesPerSecond: p.bytesPerSecond,
      },
      enabled: true,
    });
  });

  autoUpdater.on('update-downloaded', (info) => {
    const ver = info?.version || null;
    log(`downloaded ${ver || ''}`);
    try {
      releaseNotes.markPendingUpdate(
        app.getVersion(),
        ver,
        info?.releaseNotes || null,
      );
    } catch {
      /* ignore */
    }
    writePending({
      downloadedVersion: ver,
      installOnNextLaunch: true,
      fromVersion: app.getVersion(),
    });
    setStatus({
      downloaded: true,
      available: true,
      version: ver,
      stagedVersion: ver,
      progress: { percent: 100 },
      enabled: true,
      error: null,
    });

    if (applyStagedOnDownload || qaAutoInstall()) {
      log(
        applyStagedOnDownload
          ? 'applying staged update on launch'
          : 'QA autorun: installing downloaded update',
      );
      setTimeout(() => {
        const r = quitAndInstall();
        if (!r.ok) log(`quitAndInstall fail ${r.error}`);
      }, applyStagedOnDownload ? 1200 : 250);
      return;
    }

    log('staged — will install on next launch');
  });

  autoUpdater.on('error', (err) => {
    const msg = err?.message || String(err);
    log(`error ${msg}`);
    setStatus({ checking: false, error: msg, enabled: true });
  });
}

/**
 * Wire autoUpdater. Safe to call once after app.ready when packaged.
 * @param {{ log?: (s: string) => void }} opts
 */
function initAutoUpdater(opts = {}) {
  const log = opts.log || ((s) => console.log(`[Updater] ${s}`));

  try {
    const just = releaseNotes.detectJustUpdated(app.getVersion());
    if (just) {
      setStatus({ justUpdated: just });
      log(`justUpdated ${just.fromVersion} → ${just.toVersion}`);
    }
  } catch (e) {
    log(`justUpdated detect fail ${e?.message || e}`);
  }

  if (!app.isPackaged) {
    return setStatus({
      enabled: false,
      error: 'Dev mode — auto-update chỉ chạy bản packaged.',
      channel: resolveChannel(),
      provider: resolveProviderPreference(),
      feedUrl: listFeedCandidates()[0]?.feedUrl || null,
    });
  }

  const candidates = listFeedCandidates();
  if (!candidates.length) {
    return setStatus({
      enabled: false,
      error:
        'Chưa cấu hình nguồn cập nhật (GitHub owner/repo hoặc FEED_URL HTTPS).',
      channel: resolveChannel(),
      provider: resolveProviderPreference(),
      feedUrl: null,
    });
  }

  try {
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = false;
    autoUpdater.disableWebInstaller = true;
    autoUpdater.allowPrerelease = allowPrerelease();
    autoUpdater.channel =
      resolveChannel() === 'stable' ? 'latest' : resolveChannel();

    if (allowUnsigned()) {
      try {
        autoUpdater.verifyUpdateCodeSignature = async () => null;
        log('ALLOW_UNSIGNED=1 — skip update code-signature check');
      } catch (e) {
        log(`ALLOW_UNSIGNED verify hook fail ${e?.message || e}`);
      }
    }

    applyFeedConfig(candidates[0], log);
    bindListeners(log);

    const pending = readPending();
    if (
      pending?.installOnNextLaunch &&
      pending?.downloadedVersion &&
      releaseNotes.compareSemver(app.getVersion(), pending.downloadedVersion) <
        0
    ) {
      applyStagedOnDownload = true;
      setStatus({
        stagedVersion: pending.downloadedVersion,
        downloaded: true,
        available: true,
        version: pending.downloadedVersion,
      });
      log(
        `pending staged ${pending.downloadedVersion} — will apply after re-check`,
      );
    }

    setStatus({
      enabled: true,
      channel: resolveChannel(),
      provider: resolveProviderPreference(),
      activeProvider: candidates[0].provider,
      feedUrl: candidates[0].feedUrl,
      error: null,
    });

    if (shouldCheckOnLaunch() || applyStagedOnDownload) {
      const delay = applyStagedOnDownload ? 2_500 : 8_000;
      setTimeout(() => {
        checkForUpdates().catch((e) => log(`check fail ${e?.message || e}`));
      }, delay);
    }

    return getStatus();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log(`init fail ${msg}`);
    return setStatus({
      enabled: false,
      error: msg,
      channel: resolveChannel(),
      provider: resolveProviderPreference(),
    });
  }
}

/**
 * Check primary feed; on channel/network failure try next candidate (dual-feed).
 */
async function checkForUpdates() {
  if (!app.isPackaged) {
    return setStatus({
      enabled: false,
      error: 'Chỉ kiểm tra cập nhật trên bản packaged.',
    });
  }

  const candidates = listFeedCandidates();
  if (!candidates.length) {
    return setStatus({
      enabled: false,
      error: 'Thiếu cấu hình update feed.',
    });
  }

  setStatus({ checking: true, error: null, enabled: true });
  const errors = [];

  for (let i = 0; i < candidates.length; i++) {
    const cfg = candidates[i];
    try {
      applyFeedConfig(cfg, (s) => console.log(`[Updater] ${s}`));
      const result = await autoUpdater.checkForUpdates();
      return {
        ...getStatus(),
        updateInfo: result?.updateInfo || null,
        triedProviders: candidates.slice(0, i + 1).map((c) => c.provider),
      };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      errors.push(`${cfg.provider}: ${msg}`);
      console.warn(`[Updater] check failed on ${cfg.provider}: ${msg}`);
    }
  }

  return setStatus({
    checking: false,
    error: errors.join(' | ') || 'Kiểm tra cập nhật thất bại.',
    enabled: true,
  });
}

async function downloadUpdate() {
  try {
    await autoUpdater.downloadUpdate();
    return getStatus();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return setStatus({ error: msg });
  }
}

module.exports = {
  initAutoUpdater,
  checkForUpdates,
  downloadUpdate,
  quitAndInstall,
  getStatus,
  acknowledgeJustUpdated,
  listFeedCandidates,
};
