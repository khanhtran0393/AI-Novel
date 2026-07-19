/**
 * Desktop auto-update via electron-updater (generic provider).
 * Feed URL: AINOVEL_UPDATE_FEED_URL or electron-builder publish.url
 *
 * Env:
 * - AINOVEL_UPDATE_FEED_URL=https://cdn.example.com/ai-novel/updates
 * - AINOVEL_UPDATE_CHANNEL=stable|beta|dev
 * - AINOVEL_UPDATE_CHECK_ON_LAUNCH=1
 * - AINOVEL_UPDATE_ALLOW_PRERELEASE=1 (optional; auto for beta/dev)
 */
'use strict';

const { autoUpdater } = require('electron-updater');
const { app, dialog, BrowserWindow } = require('electron');

let lastStatus = {
  enabled: false,
  channel: 'stable',
  feedUrl: null,
  checking: false,
  available: false,
  downloaded: false,
  error: null,
  version: null,
  releaseNotes: null,
  progress: null,
};

function resolveChannel() {
  const raw = String(process.env.AINOVEL_UPDATE_CHANNEL || 'stable').toLowerCase();
  return raw === 'beta' || raw === 'dev' ? raw : 'stable';
}

function resolveFeedUrl() {
  const raw = (process.env.AINOVEL_UPDATE_FEED_URL || '').trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:') return null;
    if (url.hostname === 'example.com' || url.hostname.endsWith('.example.com')) return null;
    return url.toString().replace(/\/$/, '');
  } catch {
    return null;
  }
}

function shouldCheckOnLaunch() {
  return process.env.AINOVEL_UPDATE_CHECK_ON_LAUNCH === '1';
}

function qaAutoInstall() {
  return process.env.AINOVEL_UPDATE_QA_AUTORUN === '1';
}

function allowPrerelease() {
  if (process.env.AINOVEL_UPDATE_ALLOW_PRERELEASE === '1') return true;
  return resolveChannel() !== 'stable';
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

/**
 * Wire autoUpdater. Safe to call once after app.ready when packaged.
 * @param {{ log?: (s: string) => void }} opts
 */
function initAutoUpdater(opts = {}) {
  const log = opts.log || ((s) => console.log(`[Updater] ${s}`));

  if (!app.isPackaged) {
    return setStatus({
      enabled: false,
      error: 'Dev mode — auto-update chỉ chạy bản packaged.',
      channel: resolveChannel(),
      feedUrl: resolveFeedUrl(),
    });
  }

  const feedUrl = resolveFeedUrl();
  const channel = resolveChannel();

  if (!feedUrl) {
    return setStatus({
      enabled: false,
      error:
        'Chưa đặt AINOVEL_UPDATE_FEED_URL — cập nhật tay (tải installer mới).',
      channel,
      feedUrl: null,
    });
  }

  try {
    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.disableWebInstaller = true;
    autoUpdater.allowPrerelease = allowPrerelease();
    autoUpdater.channel = channel === 'stable' ? 'latest' : channel;

    // generic provider feed root (must host latest.yml + artifacts)
    autoUpdater.setFeedURL({
      provider: 'generic',
      url: feedUrl.replace(/\/$/, ''),
      channel: channel === 'stable' ? 'latest' : channel,
    });

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
      });
      if (qaAutoInstall()) {
        log('QA autorun: downloading signed update');
        downloadUpdate().catch((e) => log(`QA download fail ${e?.message || e}`));
      }
    });

    autoUpdater.on('update-not-available', () => {
      log('up to date');
      setStatus({
        checking: false,
        available: false,
        enabled: true,
        error: null,
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
      log(`downloaded ${info?.version || ''}`);
      setStatus({
        downloaded: true,
        available: true,
        version: info?.version || null,
        progress: { percent: 100 },
        enabled: true,
      });
      if (qaAutoInstall()) {
        log('QA autorun: installing downloaded update');
        setTimeout(() => autoUpdater.quitAndInstall(true, true), 250);
        return;
      }
      try {
        const win = BrowserWindow.getFocusedWindow();
        dialog
          .showMessageBox(win || undefined, {
            type: 'info',
            title: 'Cập nhật sẵn sàng',
            message: `AI Novel ${info?.version || ''} đã tải xong.`,
            detail: 'Cài ngay (khởi động lại) hoặc lần đóng app sau.',
            buttons: ['Cài ngay', 'Để sau'],
            defaultId: 0,
            cancelId: 1,
          })
          .then((r) => {
            if (r.response === 0) {
              autoUpdater.quitAndInstall(false, true);
            }
          })
          .catch(() => undefined);
      } catch {
        /* ignore dialog errors */
      }
    });

    autoUpdater.on('error', (err) => {
      const msg = err?.message || String(err);
      log(`error ${msg}`);
      setStatus({ checking: false, error: msg, enabled: true });
    });

    setStatus({
      enabled: true,
      channel,
      feedUrl,
      error: null,
    });

    if (shouldCheckOnLaunch()) {
      setTimeout(() => {
        checkForUpdates().catch((e) => log(`check fail ${e?.message || e}`));
      }, 8_000);
    }

    return getStatus();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log(`init fail ${msg}`);
    return setStatus({ enabled: false, error: msg, channel, feedUrl });
  }
}

async function checkForUpdates() {
  if (!app.isPackaged) {
    return setStatus({
      enabled: false,
      error: 'Chỉ kiểm tra cập nhật trên bản packaged.',
    });
  }
  if (!resolveFeedUrl()) {
    return setStatus({
      enabled: false,
      error: 'Thiếu AINOVEL_UPDATE_FEED_URL.',
    });
  }
  setStatus({ checking: true, error: null });
  try {
    const result = await autoUpdater.checkForUpdates();
    return { ...getStatus(), updateInfo: result?.updateInfo || null };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return setStatus({ checking: false, error: msg });
  }
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

function quitAndInstall() {
  try {
    autoUpdater.quitAndInstall(false, true);
    return { ok: true };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

module.exports = {
  initAutoUpdater,
  checkForUpdates,
  downloadUpdate,
  quitAndInstall,
  getStatus,
};
