'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

function runGit(root, args) {
  const result = spawnSync('git', ['-C', root, ...args], {
    encoding: 'utf8',
    shell: false,
    windowsHide: true,
    timeout: 5000,
    maxBuffer: 1024 * 1024,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const error = new Error((result.stderr || '').trim() || `git exited with ${result.status}`);
    error.code = 'GIT_COMMAND_FAILED';
    throw error;
  }
  return (result.stdout || '').trim();
}

function existingPath(candidate) {
  try { return fs.realpathSync.native(candidate); } catch (_) { return path.resolve(candidate); }
}

function inspectRepository(rootPath = process.cwd()) {
  const requestedPath = path.resolve(rootPath);
  const result = {
    path: existingPath(requestedPath),
    branch: null,
    commitSha: null,
    dirty: null,
    isGitRepository: false,
    sourceStatus: 'unconfirmed',
    errors: [],
    readOnly: true,
  };

  try {
    const topLevel = runGit(requestedPath, ['rev-parse', '--show-toplevel']);
    result.path = existingPath(topLevel);
    result.isGitRepository = true;
    result.commitSha = runGit(result.path, ['rev-parse', 'HEAD']) || null;
    result.branch = runGit(result.path, ['symbolic-ref', '--short', '-q', 'HEAD']) || 'DETACHED';
    result.dirty = runGit(result.path, ['status', '--porcelain=v1', '--untracked-files=normal']).length > 0;
  } catch (error) {
    result.errors.push(error.code === 'GIT_COMMAND_FAILED' ? error.message : 'git unavailable');
  }

  const packagedSource = path.join(result.path, 'resources', 'app');
  const controlPlane = path.join(result.path, 'auto-fix');
  if (fs.existsSync(controlPlane) && fs.existsSync(packagedSource)) {
    result.sourceStatus = 'packaged-source-present-canonical-unconfirmed';
  } else if (fs.existsSync(controlPlane)) {
    result.sourceStatus = 'control-plane-only-canonical-unconfirmed';
  } else {
    result.sourceStatus = 'canonical-source-unconfirmed';
  }
  return result;
}

module.exports = { inspectRepository };
