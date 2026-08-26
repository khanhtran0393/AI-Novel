// Registrar IPC cho Editor Pro trong Nova. Cấp dần các kênh editor cần.
const fs = require('fs');
const path = require('path');
const { app } = require('electron');

function registerEditorProIpc(ipcMain, opts = {}) {
  const userDir = opts.userDataDir || path.join(require('os').homedir(), '.nova-editor-pro');
  try { fs.mkdirSync(userDir, { recursive: true }); } catch (_) {}
  const settingsPath = path.join(userDir, 'editor-settings.json');
  const libraryPath = path.join(userDir, 'library.json');

  const readJson = (p, def) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')) || def; } catch (_) { return def; } };
  const writeJson = (p, obj) => { try { fs.writeFileSync(p, JSON.stringify(obj || {}, null, 2)); } catch (_) {} return obj; };

  const readSettings = () => readJson(settingsPath, {});
  const writeSettings = (obj) => writeJson(settingsPath, obj || {});
  const readLibrary = () => { const l = readJson(libraryPath, {}); if (!Array.isArray(l.items)) l.items = []; return l; };
  const toFileUrl = (p) => `file://${String(p || '').replace(/^file:\/\//i, '')}`;

  const H = {
    // Mở khoá entitlement (tool của chính user, gỡ tier-lock bản tải)
    'settings:get': () => ({ ...readSettings(), isPro: true, isDiamond: true, isPlatinum: true, active: true, ai: true, diamond: true, diamondBrowser: true }),
    'settings:set': (_e, next) => {
      const cur = readSettings();
      const merged = (next && typeof next === 'object') ? { ...cur, ...next } : cur;
      writeSettings(merged);
      return { ...merged, isPro: true, isDiamond: true, isPlatinum: true, active: true, ai: true, diamond: true, diamondBrowser: true };
    },
    'app:getLocale': () => 'vi',
    'app:getLocaleBundle': (_e, locale) => {
      const code = String(locale || 'en').split('-')[0];
      const load = (c) => {
        try { return JSON.parse(fs.readFileSync(path.join(__dirname, 'locales', c, 'translation.json'), 'utf8')); } catch (_) { return null; }
      };
      return load(code) || load('en') || {};
    },
    'cookies:getStatus': () => ({ ok: true, status: 'none', hasCookies: false }),
    'videos:ensureHandlers': () => ({ ok: true }),
    'agents:list': () => [],
    'automationBanner:getState': () => ({}),
    'automationBanner:update': () => ({ ok: true }),
    'automationBanner:clear': () => ({ ok: true }),
    'automationBanner:dismiss': () => ({ ok: true }),
    'diagnostics:reportRendererLogs': () => ({ ok: true }),
    'debug:listHandlers': () => [],
    'app:getPath': (_e, name) => { try { return app.getPath(name || 'userData'); } catch (_) { return userDir; } },
    // ---- Library store (JSON) ----
    'library:get': () => readLibrary(),
    'library:set': (_e, payload) => writeJson(libraryPath, payload && typeof payload === 'object' ? payload : readLibrary()),
    'library:ingestFiles': (_e, payload = {}) => {
      const files = Array.isArray(payload.files) ? payload.files : [];
      if (!files.length) return { ok: false, error: 'No files provided' };
      const lib = readLibrary();
      for (const entry of files) {
        const file = String(entry && entry.file || '').trim();
        if (!file) continue;
        const url = toFileUrl(file);
        const title = String(entry.title || '').trim() || (file.split(/[/\\]/).pop() || '').replace(/\.[^.]+$/, '');
        let idx = lib.items.findIndex(it => String(it && it.file || '') === file || String(it && it.url || '') === url);
        const meta = {
          assetType: entry.assetType || '', mediaType: entry.mediaType || '', source: entry.source || '',
          tags: Array.isArray(entry.tags) ? entry.tags : [], transcript: entry.transcript || '',
          durationSec: entry.durationSec ?? null, sizeBytes: entry.sizeBytes ?? null,
          extension: entry.extension || '', fileName: entry.fileName || (file.split(/[/\\]/).pop() || ''),
          updatedAt: new Date().toISOString(),
        };
        if (idx < 0) lib.items.push({ url, kind: 'custom', title, file, category: entry.category || '', meta });
        else lib.items[idx] = { ...lib.items[idx], url, title, file, meta: { ...(lib.items[idx].meta || {}), ...meta } };
      }
      writeJson(libraryPath, lib);
      return { ok: true, items: lib.items };
    },
    'library:getImageFolders': () => readJson(libraryPath, {}).imageFolders || [],
    'library:setImageFolders': (_e, p) => { const l = readLibrary(); l.imageFolders = p || []; return writeJson(libraryPath, l); },
    'library:getVideoFolders': () => readJson(libraryPath, {}).videoFolders || [],
    'library:setVideoFolders': (_e, p) => { const l = readLibrary(); l.videoFolders = p || []; return writeJson(libraryPath, l); },
    'library:getAudioFolders': () => readJson(libraryPath, {}).audioFolders || [],
    'library:setAudioFolders': (_e, p) => { const l = readLibrary(); l.audioFolders = p || []; return writeJson(libraryPath, l); },
    // ---- AI stubs (Phase 3 sẽ đấu về bridge Nova) ----
    'ai:transcribe': () => ({ ok: true, text: '', segments: [], language: '' }),
  };

  for (const [ch, fn] of Object.entries(H)) {
    try { ipcMain.removeHandler(ch); } catch (_) {}
    ipcMain.handle(ch, fn);
  }
  return Object.keys(H);
}

module.exports = { registerEditorProIpc };
