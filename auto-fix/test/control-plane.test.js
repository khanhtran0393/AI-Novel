'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { inspectRepository } = require('../repository-adapter');
const { checkPath } = require('../path-boundary');
const { redact } = require('../redaction');
const { createAuditRecord } = require('../audit');
const { STATUS, evaluateReadiness } = require('../gates');
const { loadPolicy } = require('../policy');
const { authorizeTool, getTool, listTools } = require('../tool-registry');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'auto-fix-test-'));
fs.mkdirSync(path.join(root, 'auto-fix'), { recursive: true });
fs.writeFileSync(path.join(root, 'auto-fix', 'evidence.json'), '{}');
fs.mkdirSync(path.join(root, 'resources', 'app'), { recursive: true });
fs.writeFileSync(path.join(root, 'resources', 'app', 'main.js'), 'production');

const policy = loadPolicy();
assert.strictEqual(checkPath(path.join(root, 'auto-fix', 'evidence.json'), { workspaceRoot: root, policy }).allowed, true);
assert.strictEqual(checkPath(path.join(root, 'resources', 'app', 'main.js'), { workspaceRoot: root }).reason, 'denied-root');
assert.strictEqual(checkPath(path.join(root, 'outside.txt'), { workspaceRoot: root }).reason, 'not-allowlisted');
assert.strictEqual(checkPath(path.join(root, 'auto-fix', 'token.json'), { workspaceRoot: root }).reason, 'sensitive-name');

const secretInput = {
  password: 'do-not-store',
  authorization: 'Bearer abc123',
  message: 'path C:\\Users\\Khanh\\secret.txt token=abc123',
  nested: ['-----BEGIN PRIVATE KEY-----\nsecret\n-----END PRIVATE KEY-----'],
};
const safe = redact(secretInput);
assert.strictEqual(safe.password, '[REDACTED]');
assert.ok(!JSON.stringify(safe).includes('do-not-store'));
assert.ok(!JSON.stringify(safe).includes('abc123'));
assert.ok(!JSON.stringify(safe).includes('Khanh'));

const record = createAuditRecord({ event: 'test', evidence: secretInput, policy });
assert.ok(record.recordHash);
assert.ok(!JSON.stringify(record).includes('do-not-store'));
assert.ok(Buffer.byteLength(JSON.stringify(record), 'utf8') < policy.limits.maxAuditRecordBytes);

const repository = inspectRepository(root);
assert.strictEqual(repository.readOnly, true);
assert.strictEqual(repository.isGitRepository, false);
assert.strictEqual(repository.dirty, null);

const currentRepository = inspectRepository(path.resolve(__dirname, '..', '..'));
assert.strictEqual(currentRepository.readOnly, true);
assert.strictEqual(currentRepository.isGitRepository, true);
assert.match(currentRepository.commitSha, /^[0-9a-f]{40}$/);
assert.ok(currentRepository.branch || currentRepository.branch === 'DETACHED');
assert.strictEqual(typeof currentRepository.dirty, 'boolean');

const report = evaluateReadiness({ policy, repository });
assert.strictEqual(report.status, STATUS.BLOCKED);
assert.ok(report.gates.some((item) => item.name === 'canonical-source' && item.status === STATUS.BLOCKED));
assert.ok(report.gates.some((item) => item.name === 'ciHost' && item.status === STATUS.BLOCKED));

assert.strictEqual(getTool('executeCommand'), null);
assert.deepStrictEqual(listTools().map((tool) => tool.name), ['inspectRepository', 'evaluateReadiness']);
assert.strictEqual(authorizeTool(policy, 'inspectRepository').allowed, false);
assert.strictEqual(authorizeTool(policy, 'unknown').reason, 'unknown-tool');

assert.throws(() => createAuditRecord({ event: 'unsafe', policy: { ...policy, audit: { appendOnly: false, redactSecrets: true } } }), /append-only/);

console.log('CONTROL-PLANE TEST: PASS');
