'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');
const { ok, fail, canceled, capture } = require('../core/result');
const { fileUrl, userDataPath } = require('../core/paths');
const { JsonStore } = require('../storage/json-store');
const { createSettingsStore, registerSettingsIpc } = require('../storage/settings-store');
const { register, registerSync } = require('../ipc/register');

async function main() {
  assert.deepStrictEqual(ok(7), { ok: true, data: 7 });
  assert.deepStrictEqual(fail(new Error('bad')), { ok: false, error: 'bad' });
  assert.strictEqual(canceled('x').canceled, true);
  assert.deepStrictEqual(await capture(async () => 3), { ok: true, data: 3 });
  assert.strictEqual((await capture(async () => { throw new Error('captured'); })).error, 'captured');

  assert.strictEqual(fileUrl('C:\\media\\a.mp4'), 'file://C:\\media\\a.mp4');
  assert.strictEqual(fileUrl('file://C:\\media\\a.mp4'), 'file://C:\\media\\a.mp4');
  assert.strictEqual(userDataPath({ getPath: () => 'X:\\data' }), 'X:\\data');
  assert.strictEqual(userDataPath({ getPath: () => { throw new Error('x'); } }, 'fallback'), 'fallback');

  const mainSource = fs.readFileSync(path.join(__dirname, '..', 'main.plain.js'), 'utf8');
  assert(mainSource.includes("com.novastudio.independent"), 'main process must use the independent app id');
  assert(mainSource.includes("persist:nova-studio-independent"), 'main window must use an independent browser partition');
  assert(!mainSource.includes('com.aivideostudio'), 'legacy Windows app id must not be reused');
  const flowSource = fs.readFileSync(path.join(__dirname, '..', 'flow-native.plain.js'), 'utf8');
  assert(!flowSource.includes("persist:flow-"), 'Flow account partitions must not reuse the legacy namespace');
  const runtimePorts = [
    require('../flow-bridge.plain').PORT,
    require('../mcp-bridge-native').PORT,
    require('../voice-native.plain').PORT,
  ];
  assert.strictEqual(new Set(runtimePorts).size, runtimePorts.length, 'Nova runtime services must use distinct ports');

  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'nova-foundation-'));
  try {
    const store = new JsonStore(path.join(temp, 'nested', 'state.json'), { items: [] });
    const firstDefault = store.read();
    firstDefault.items.push('mutated');
    assert.deepStrictEqual(store.read(), { items: [] }, 'default values must not share mutable state');
    store.write({ items: [1] });
    assert.deepStrictEqual(store.read(), { items: [1] });
    store.update(value => { value.items.push(2); });
    assert.deepStrictEqual(store.read(), { items: [1, 2] });
    assert.deepStrictEqual(fs.readdirSync(path.join(temp, 'nested')), ['state.json'], 'atomic write must clean temporary files');

    const invokeHandlers = new Map();
    const removed = [];
    const ipcMain = {
      handle: (channel, handler) => invokeHandlers.set(channel, handler),
      removeHandler: channel => { removed.push(channel); invokeHandlers.delete(channel); },
    };
    assert.deepStrictEqual(register(ipcMain, { alpha: () => 1, invalid: 2 }), ['alpha']);
    const replacement = () => 2;
    register(ipcMain, { alpha: replacement });
    assert.strictEqual(invokeHandlers.get('alpha'), replacement);
    assert.deepStrictEqual(removed, ['alpha', 'alpha']);

    const listeners = new Map();
    const syncMain = {
      on: (channel, handler) => listeners.set(channel, handler),
      removeListener: (channel, handler) => { if (listeners.get(channel) === handler) listeners.delete(channel); },
    };
    const oldSync = () => 1;
    const newSync = () => 2;
    registerSync(syncMain, { seed: oldSync });
    registerSync(syncMain, { seed: newSync });
    assert.strictEqual(listeners.size, 1);
    assert.strictEqual(listeners.get('seed'), newSync);

    const settingsFile = path.join(temp, 'settings', 'nova-settings.json');
    const mainSettings = createSettingsStore(settingsFile, { warn: () => {} });
    assert.deepStrictEqual(mainSettings.read(), {});
    assert.strictEqual(mainSettings.set({ apiKey: 123, enabled: false }), true);
    assert.deepStrictEqual(mainSettings.read(), { apiKey: '123', enabled: 'false' });
    assert.strictEqual(mainSettings.set({ apiKey: null, enabled: undefined }), true);
    assert.deepStrictEqual(mainSettings.read(), {});
    fs.writeFileSync(settingsFile, 'null', 'utf8');
    assert.deepStrictEqual(mainSettings.read(), {}, 'settings must recover from non-object JSON');

    const settingsListeners = new Map();
    const settingsIpc = {
      on: (channel, handler) => settingsListeners.set(channel, handler),
      removeListener: (channel, handler) => { if (settingsListeners.get(channel) === handler) settingsListeners.delete(channel); },
    };
    const settingsChannels = registerSettingsIpc(settingsIpc, { file: settingsFile, logger: { warn: () => {} } });
    registerSettingsIpc(settingsIpc, { file: settingsFile, logger: { warn: () => {} } });
    assert.deepStrictEqual(settingsChannels, ['settings-store-all', 'settings-store-set']);
    assert.strictEqual(settingsListeners.size, 2, 'settings IPC registration must be idempotent');
    const readEvent = {};
    settingsListeners.get('settings-store-all')(readEvent);
    assert.deepStrictEqual(readEvent.returnValue, {});
    const setEvent = {};
    settingsListeners.get('settings-store-set')(setEvent, { token: 'secret' });
    assert.strictEqual(setEvent.returnValue, true);
    assert.deepStrictEqual(JSON.parse(fs.readFileSync(settingsFile, 'utf8')), { token: 'secret' });

    const electron = { app: { getPath: () => temp } };
    const originalLoad = Module._load;
    Module._load = function(request, parent, isMain) {
      if (request === 'electron') return electron;
      return originalLoad.call(this, request, parent, isMain);
    };
    let registerEditorProIpc;
    try { ({ registerEditorProIpc } = require('../editor-pro/ipc-handlers')); }
    finally { Module._load = originalLoad; }

    const editorHandlers = new Map();
    const editorIpc = {
      removeHandler: channel => editorHandlers.delete(channel),
      handle: (channel, handler) => editorHandlers.set(channel, handler),
    };
    const channels = registerEditorProIpc(editorIpc, { userDataDir: temp });
    assert.strictEqual(channels.length, editorHandlers.size);
    for (const expected of ['settings:get', 'settings:set', 'library:get', 'library:set', 'library:ingestFiles']) {
      assert(editorHandlers.has(expected), `missing Editor Pro channel: ${expected}`);
    }
    const settings = editorHandlers.get('settings:set')(null, { theme: 'dark' });
    assert.strictEqual(settings.theme, 'dark');
    assert.strictEqual(settings.isPro, true);
    assert.strictEqual(editorHandlers.get('settings:get')().theme, 'dark');
    const ingest = editorHandlers.get('library:ingestFiles')(null, { files: [{ file: 'C:\\media\\clip.mp4', tags: ['test'] }] });
    assert.strictEqual(ingest.ok, true);
    assert.strictEqual(ingest.items[0].url, 'file://C:\\media\\clip.mp4');
    assert.deepStrictEqual(editorHandlers.get('library:get')().items[0].meta.tags, ['test']);

    const catalog = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'editor-pro', '_channels.json'), 'utf8'))
      .map(channel => String(channel).replace(/'$/, ''));
    const supplemental = new Set(['app:getLocaleBundle', 'library:set', 'library:ingestFiles']);
    const uncatalogued = channels.filter(channel => !catalog.includes(channel));
    assert.deepStrictEqual(uncatalogued.sort(), [...supplemental].sort(), 'unexpected Editor Pro catalog drift');
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
  console.log('foundation tests: passed');
}

main().catch(error => { console.error(error); process.exitCode = 1; });
