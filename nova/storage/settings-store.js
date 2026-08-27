'use strict';

const { registerSync } = require('../ipc/register');
const { JsonStore } = require('./json-store');

function createSettingsStore(file, logger = console) {
  const store = new JsonStore(file, {});

  function read() {
    const value = store.read();
    return value && typeof value === 'object' ? value : {};
  }

  function write(value) {
    try {
      store.write(value);
      return true;
    } catch (error) {
      if (logger && typeof logger.warn === 'function') logger.warn('[settings] write:', error && error.message);
      return false;
    }
  }

  function set(patch) {
    const current = read();
    if (patch && typeof patch === 'object') {
      for (const [key, value] of Object.entries(patch)) {
        if (value === null || value === undefined) delete current[key];
        else current[key] = String(value);
      }
    }
    return write(current);
  }

  return { read, set };
}

function registerSettingsIpc(ipcMain, options = {}) {
  const settings = options.store || createSettingsStore(options.file, options.logger);
  return registerSync(ipcMain, {
    'settings-store-all': event => { event.returnValue = settings.read(); },
    'settings-store-set': (event, patch) => { event.returnValue = settings.set(patch); },
  });
}

module.exports = { createSettingsStore, registerSettingsIpc };
