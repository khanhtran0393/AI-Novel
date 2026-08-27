'use strict';

const os = require('os');
const path = require('path');

const NOVA_DATA_FOLDER = 'AI Video Studio Independent';

function appRoot(dirname) { return path.resolve(dirname || __dirname, '..'); }
function userDataPath(electronApp, fallback) {
  try {
    if (electronApp && typeof electronApp.getPath === 'function') {
      const value = electronApp.getPath('userData');
      if (value) return path.resolve(value);
    }
  } catch (_) {}
  return fallback || path.join(os.homedir(), NOVA_DATA_FOLDER);
}
function joinRoot(root, ...parts) { return path.join(root, ...parts); }
function fileUrl(file) {
  const value = String(file || '').replace(/^file:\/\//i, '');
  return `file://${value}`;
}

module.exports = { appRoot, userDataPath, joinRoot, fileUrl, NOVA_DATA_FOLDER };

