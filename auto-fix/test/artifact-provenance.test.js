'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { generateProvenance } = require('../artifact-provenance');

const repositoryRoot = path.resolve(__dirname, '..', '..');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'auto-fix-provenance-'));
const artifacts = path.join(root, 'win-unpacked');
const output = path.join(root, 'provenance.json');
fs.mkdirSync(path.join(artifacts, 'resources'), { recursive: true });
fs.writeFileSync(path.join(artifacts, 'AI Video Studio.exe'), 'executable fixture');
fs.writeFileSync(path.join(artifacts, 'resources', 'app.asar'), 'asar fixture');

const evidence = generateProvenance({ artifactRoot: artifacts, outputPath: output, repositoryRoot });
assert.strictEqual(evidence.schemaVersion, 1);
assert.strictEqual(evidence.build.publishing, 'disabled');
assert.strictEqual(evidence.build.signingIdentityAutoDiscovery, 'disabled');
assert.match(evidence.source.commitSha, /^[0-9a-f]{40}$/);
assert.deepStrictEqual(evidence.artifacts.map((item) => item.path), ['AI Video Studio.exe', 'resources/app.asar']);
assert.strictEqual(
  evidence.artifacts[0].sha256,
  crypto.createHash('sha256').update('executable fixture').digest('hex'),
);
assert.deepStrictEqual(JSON.parse(fs.readFileSync(output, 'utf8')), evidence);
assert.throws(
  () => generateProvenance({ artifactRoot: artifacts, outputPath: output, repositoryRoot }),
  /EEXIST/,
);

console.log('ARTIFACT PROVENANCE TEST: PASS');
