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

function normalizeRemote(value) {
  const remote = String(value || '').trim();
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(remote)) {
    try {
      const parsed = new URL(remote);
      return `${parsed.hostname.toLowerCase()}/${parsed.pathname.replace(/\.git\/?$/i, '').replace(/^\/+|\/+$/g, '')}`;
    } catch (_) { return null; }
  }
  const scp = remote.match(/^(?:[^@]+@)?([^:/]+):(.+)$/);
  if (scp && !/^[a-z]:/i.test(remote)) {
    return `${scp[1].toLowerCase()}/${scp[2].replace(/\.git\/?$/i, '').replace(/^\/+|\/+$/g, '')}`;
  }
  return null;
}

function isSafeBranch(value) {
  return typeof value === 'string'
    && /^(?!-)(?!.*(?:\.\.|\/\/|@\{|[~^:?*\[\\]))[A-Za-z0-9._/-]+$/.test(value)
    && !value.endsWith('/')
    && !value.endsWith('.')
    && !value.endsWith('.lock');
}

function isSafeRelativePath(value) {
  return typeof value === 'string'
    && value.length > 0
    && !path.isAbsolute(value)
    && !value.split(/[\\/]/).includes('..')
    && !value.includes('\0');
}

function readCanonicalSourceRecord(controlPlane) {
  const recordPath = path.join(controlPlane, 'config', 'canonical-source.json');
  try {
    return { path: recordPath, record: JSON.parse(fs.readFileSync(recordPath, 'utf8')), errors: [] };
  } catch (error) {
    return { path: recordPath, record: null, errors: [error.code === 'ENOENT' ? 'canonical source record is missing' : 'canonical source record is invalid'] };
  }
}

function verifyCanonicalSource(repository, controlPlane) {
  const loaded = readCanonicalSourceRecord(controlPlane);
  const errors = [...loaded.errors];
  const record = loaded.record;
  const evidence = { recordPath: loaded.path, remote: null, canonicalBranch: null, baselineCommit: null };

  if (!record) return { confirmed: false, errors, evidence };
  if (record.schemaVersion !== 1) errors.push('canonical source schemaVersion must be 1');
  if (record.status !== 'approved') errors.push('canonical source record is not approved');
  if (!normalizeRemote(record.repositoryUrl)) errors.push('canonical repository URL is missing or invalid');
  if (!isSafeBranch(record.canonicalBranch)) errors.push('canonical branch is missing or invalid');
  if (!/^[0-9a-f]{40}$/.test(record.baselineCommit || '')) errors.push('canonical baseline commit is invalid');
  if (record.applicationRoot !== '.') errors.push('canonical applicationRoot must be repository root');
  const approval = record.approvalEvidence;
  if (!approval || !['providedBy', 'providedAt', 'source'].every((key) => typeof approval[key] === 'string' && approval[key])) {
    errors.push('canonical approval evidence is incomplete');
  }
  if (!Array.isArray(record.requiredTrackedPaths) || record.requiredTrackedPaths.length === 0) {
    errors.push('required tracked paths are missing');
  } else if (record.requiredTrackedPaths.some((item) => !isSafeRelativePath(item))) {
    errors.push('canonical source record contains an unsafe required path');
  }

  evidence.canonicalBranch = record.canonicalBranch || null;
  evidence.baselineCommit = record.baselineCommit || null;
  if (errors.length || !repository.isGitRepository) return { confirmed: false, errors, evidence };

  try {
    const actualRemote = normalizeRemote(runGit(repository.path, ['remote', 'get-url', 'origin']));
    const expectedRemote = normalizeRemote(record.repositoryUrl);
    evidence.remote = actualRemote;
    if (!actualRemote || actualRemote !== expectedRemote) errors.push('origin does not match approved canonical repository');

    runGit(repository.path, ['check-ref-format', '--branch', record.canonicalBranch]);
    const branchRef = `refs/remotes/origin/${record.canonicalBranch}`;
    evidence.branchCommit = runGit(repository.path, ['rev-parse', '--verify', `${branchRef}^{commit}`]);

    runGit(repository.path, ['cat-file', '-e', `${record.baselineCommit}^{commit}`]);
    runGit(repository.path, ['merge-base', '--is-ancestor', record.baselineCommit, branchRef]);
    runGit(repository.path, ['merge-base', '--is-ancestor', record.baselineCommit, 'HEAD']);

    for (const relativePath of record.requiredTrackedPaths) {
      runGit(repository.path, ['cat-file', '-e', `${record.baselineCommit}:${relativePath}`]);
      runGit(repository.path, ['ls-files', '--error-unmatch', '--', relativePath]);
      if (!fs.existsSync(path.join(repository.path, relativePath))) errors.push(`required source path is missing: ${relativePath}`);
    }
  } catch (error) {
    errors.push(error.code === 'GIT_COMMAND_FAILED' ? 'canonical Git evidence does not match this checkout' : 'canonical source verification failed');
  }

  return { confirmed: errors.length === 0, errors, evidence };
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
    canonicalSource: null,
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
  if (fs.existsSync(controlPlane)) {
    const verification = verifyCanonicalSource(result, controlPlane);
    result.canonicalSource = verification.evidence;
    if (verification.confirmed) {
      result.sourceStatus = 'canonical-source-confirmed';
    } else {
      result.sourceStatus = fs.existsSync(packagedSource)
        ? 'packaged-source-present-canonical-unconfirmed'
        : 'control-plane-only-canonical-unconfirmed';
      result.errors.push(...verification.errors);
    }
  } else {
    result.sourceStatus = 'canonical-source-unconfirmed';
  }
  return result;
}

module.exports = { inspectRepository };
