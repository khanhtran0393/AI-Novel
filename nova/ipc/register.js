'use strict';

const syncRegistrations = new WeakMap();

/** Register invoke handlers idempotently. */
function register(ipcMain, handlers) {
  if (!ipcMain || typeof ipcMain.handle !== 'function') throw new TypeError('ipcMain.handle is required');
  const channels = [];
  for (const [channel, handler] of Object.entries(handlers || {})) {
    if (typeof handler !== 'function') continue;
    try { ipcMain.removeHandler(channel); } catch (_) {}
    ipcMain.handle(channel, handler);
    channels.push(channel);
  }
  return channels;
}

function registerSync(ipcMain, handlers) {
  if (!ipcMain || typeof ipcMain.on !== 'function') throw new TypeError('ipcMain.on is required');
  let registered = syncRegistrations.get(ipcMain);
  if (!registered) {
    registered = new Map();
    syncRegistrations.set(ipcMain, registered);
  }
  const channels = [];
  for (const [channel, handler] of Object.entries(handlers || {})) {
    if (typeof handler !== 'function') continue;
    const previous = registered.get(channel);
    if (previous && typeof ipcMain.removeListener === 'function') ipcMain.removeListener(channel, previous);
    ipcMain.on(channel, handler);
    registered.set(channel, handler);
    channels.push(channel);
  }
  return channels;
}

module.exports = { register, registerSync };
