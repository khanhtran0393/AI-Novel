'use strict';

const path = require('path');

function appRoot(dirname) { return path.resolve(dirname || __dirname, '..'); }
function userDataPath(electronApp, fallback) {
  try { if (electronApp && typeof electronApp.getPath === 'function') return electronApp.getPath('userData'); }
  catch (_) {}
  return fallback || path.join(require('os').homedir(), '.nova-studio');
}
function joinRoot(root, ...parts) { return path.join(root, ...parts); }
function fileUrl(file) {
  const value = String(file || '').replace(/^file:\/\//i, '');
  return `file://${value}`;
}

module.exports = { appRoot, userDataPath, joinRoot, fileUrl };
