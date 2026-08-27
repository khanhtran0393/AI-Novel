'use strict';

const fs = require('fs');
const path = require('path');

const DEFAULT_DENIED_NAMES = [
  '.env', '.env.local', '.git-credentials', 'credentials', 'secrets', 'cookies',
  'tokens', 'token', 'private-key', 'private_key', 'id_rsa', 'id_ed25519',
];
const DEFAULT_DENIED_ROOTS = ['resources', 'build-output', 'node_modules', 'appdata', 'program files'];

function normalize(value) { return value.replace(/\\/g, '/').toLowerCase().replace(/\/+$/, ''); }
function under(root, candidate) {
  const r = normalize(root);
  const c = normalize(candidate);
  return c === r || c.startsWith(`${r}/`);
}
function sensitiveName(relativePath) {
  const parts = normalize(relativePath).split('/');
  return parts.some((part) => DEFAULT_DENIED_NAMES.includes(part) || /(^|[._-])(secret|credential|password|cookie|token|private.?key)([._-]|$)/i.test(part));
}

function checkPath(candidate, options = {}) {
  const workspaceRoot = path.resolve(options.workspaceRoot || process.cwd());
  const target = path.resolve(candidate);
  const relativePath = path.relative(workspaceRoot, target);
  const normalizedRelative = normalize(relativePath || '.');
  const policyBoundaries = options.policy?.boundaries || {};
  const allowedRoots = options.allowedRelativeRoots || policyBoundaries.approvedRelativeRoots || ['auto-fix'];
  const deniedRoots = options.deniedRelativeRoots || policyBoundaries.deniedRelativeRoots || DEFAULT_DENIED_ROOTS;
  const denySensitiveNames = options.denySensitiveNames ?? policyBoundaries.denySensitiveNames ?? true;
  const result = { allowed: false, path: target, relativePath: normalizedRelative, reason: null };

  if (!relativePath || relativePath === '..' || relativePath.startsWith(`..${path.sep}`) || path.isAbsolute(relativePath)) {
    result.reason = 'outside-workspace'; return result;
  }
  if (deniedRoots.some((root) => normalizedRelative === root || normalizedRelative.startsWith(`${normalize(root)}/`))) {
    result.reason = 'denied-root'; return result;
  }
  if (denySensitiveNames && sensitiveName(normalizedRelative)) {
    result.reason = 'sensitive-name'; return result;
  }
  if (!allowedRoots.some((root) => normalizedRelative === normalize(root) || normalizedRelative.startsWith(`${normalize(root)}/`))) {
    result.reason = 'not-allowlisted'; return result;
  }

  try {
    const realTarget = fs.realpathSync.native(target);
    if (!under(workspaceRoot, realTarget)) { result.reason = 'symlink-outside-workspace'; return result; }
    result.path = realTarget;
  } catch (_) { /* A not-yet-created path is still checked lexically. */ }
  result.allowed = true;
  result.reason = 'allowlisted';
  return result;
}

module.exports = { DEFAULT_DENIED_NAMES, checkPath };
