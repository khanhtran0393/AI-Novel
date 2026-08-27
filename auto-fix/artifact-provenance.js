'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const MAX_ARTIFACTS = 32;

function runGit(root, args) {
  const result = spawnSync('git', ['-C', root, ...args], {
    encoding: 'utf8',
    shell: false,
    windowsHide: true,
    timeout: 5000,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error((result.stderr || '').trim() || `git exited with ${result.status}`);
  return (result.stdout || '').trim();
}

function sha256(file) {
  const hash = crypto.createHash('sha256');
  const descriptor = fs.openSync(file, 'r');
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  try {
    let bytesRead;
    do {
      bytesRead = fs.readSync(descriptor, buffer, 0, buffer.length, null);
      if (bytesRead > 0) hash.update(buffer.subarray(0, bytesRead));
    } while (bytesRead > 0);
  } finally {
    fs.closeSync(descriptor);
  }
  return hash.digest('hex');
}

function collectFiles(root) {
  const files = [];
  function visit(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const fullPath = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`artifact symlink is not allowed: ${fullPath}`);
      if (entry.isDirectory()) visit(fullPath);
      else if (entry.isFile()) files.push(fullPath);
      if (files.length > MAX_ARTIFACTS) throw new Error(`artifact count exceeds ${MAX_ARTIFACTS}`);
    }
  }
  visit(root);
  return files.sort((left, right) => left.localeCompare(right));
}

function generateProvenance({ artifactRoot, outputPath, repositoryRoot }) {
  const artifactDirectory = fs.realpathSync.native(path.resolve(artifactRoot));
  if (!fs.statSync(artifactDirectory).isDirectory()) throw new Error('artifact root must be a directory');
  const repository = fs.realpathSync.native(path.resolve(repositoryRoot));
  const packageJson = JSON.parse(fs.readFileSync(path.join(repository, 'package.json'), 'utf8'));
  const packageLock = JSON.parse(fs.readFileSync(path.join(repository, 'package-lock.json'), 'utf8'));
  const artifacts = collectFiles(artifactDirectory).map((file) => ({
    path: path.relative(artifactDirectory, file).split(path.sep).join('/'),
    bytes: fs.statSync(file).size,
    sha256: sha256(file),
  }));
  if (artifacts.length === 0) throw new Error('artifact root contains no files');

  const evidence = {
    schemaVersion: 1,
    artifactType: 'electron-windows-unpacked',
    application: { name: packageJson.name, version: packageJson.version },
    source: {
      repository: process.env.GITHUB_SERVER_URL && process.env.GITHUB_REPOSITORY
        ? `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}`
        : runGit(repository, ['remote', 'get-url', 'origin']),
      commitSha: process.env.GITHUB_SHA || runGit(repository, ['rev-parse', 'HEAD']),
      ref: process.env.GITHUB_REF || null,
    },
    build: {
      runner: process.env.RUNNER_NAME || null,
      runnerOs: process.env.RUNNER_OS || process.platform,
      runnerArch: process.env.RUNNER_ARCH || process.arch,
      workflow: process.env.GITHUB_WORKFLOW || null,
      runId: process.env.GITHUB_RUN_ID || null,
      runAttempt: process.env.GITHUB_RUN_ATTEMPT || null,
      node: process.version,
      lockfileVersion: packageLock.lockfileVersion,
      command: 'electron-builder --config electron-builder.json --win --dir --publish never',
      publishing: 'disabled',
      signingIdentityAutoDiscovery: 'disabled',
    },
    artifacts,
  };

  const destination = path.resolve(outputPath);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.writeFileSync(destination, `${JSON.stringify(evidence, null, 2)}\n`, { flag: 'wx' });
  return evidence;
}

module.exports = { MAX_ARTIFACTS, generateProvenance };
