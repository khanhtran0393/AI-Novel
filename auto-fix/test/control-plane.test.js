'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { inspectRepository } = require('../repository-adapter');
const { checkPath } = require('../path-boundary');
const { redact } = require('../redaction');
const { createAuditRecord } = require('../audit');
const { REQUIRED_READINESS_CHECKS, STATUS, evaluateReadiness } = require('../gates');
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
assert.strictEqual(currentRepository.sourceStatus, 'canonical-source-confirmed');
assert.match(currentRepository.canonicalSource.baselineCommit, /^[0-9a-f]{40}$/);
assert.strictEqual(currentRepository.canonicalSource.remote, 'github.com/khanhtran0393/AI-Novel');

const report = evaluateReadiness({ policy, repository });
assert.strictEqual(report.status, STATUS.BLOCKED);
assert.ok(report.gates.some((item) => item.name === 'canonical-source' && item.status === STATUS.BLOCKED));
assert.ok(report.gates.some((item) => item.name === 'ciHost' && item.status === STATUS.BLOCKED));

const currentReport = evaluateReadiness({ policy, repository: currentRepository });
assert.strictEqual(currentReport.status, currentRepository.dirty ? STATUS.FAIL : STATUS.BLOCKED);
assert.ok(currentReport.gates.some((item) => item.name === 'canonical-source' && item.status === STATUS.PASS));
assert.ok(currentReport.gates.some((item) => item.name === 'ciHost' && item.status === STATUS.BLOCKED));

const cleanCanonicalRepository = { ...currentRepository, dirty: false };
const technicalChecksOnly = Object.fromEntries(REQUIRED_READINESS_CHECKS.map((name) => [name, true]));
for (const governanceGate of ['branchProtection', 'sourceProvenance', 'signingSetup', 'releaseGovernance', 'securityReview']) {
  delete technicalChecksOnly[governanceGate];
}
const technicalReport = evaluateReadiness({ policy, repository: cleanCanonicalRepository, checks: technicalChecksOnly });
assert.strictEqual(technicalReport.status, STATUS.BLOCKED);
assert.ok(technicalReport.gates.some((item) => item.name === 'branchProtection' && item.status === STATUS.BLOCKED));

const completeReport = evaluateReadiness({
  policy,
  repository: cleanCanonicalRepository,
  checks: Object.fromEntries(REQUIRED_READINESS_CHECKS.map((name) => [name, true])),
});
assert.strictEqual(completeReport.status, STATUS.PASS);
for (const requiredCheck of REQUIRED_READINESS_CHECKS) {
  assert.ok(completeReport.gates.some((item) => item.name === requiredCheck && item.status === STATUS.PASS));
}

function fixtureGit(repositoryRoot, args) {
  const result = spawnSync('git', ['-C', repositoryRoot, ...args], { encoding: 'utf8', shell: false });
  assert.strictEqual(result.status, 0, result.stderr);
  return result.stdout.trim();
}

const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'auto-fix-canonical-'));
fs.mkdirSync(path.join(fixtureRoot, 'auto-fix', 'config'), { recursive: true });
fs.writeFileSync(path.join(fixtureRoot, 'package.json'), '{"private":true}\n');
fixtureGit(fixtureRoot, ['init']);
fixtureGit(fixtureRoot, ['config', 'user.name', 'Auto-Fix Test']);
fixtureGit(fixtureRoot, ['config', 'user.email', 'auto-fix-test@example.invalid']);
fixtureGit(fixtureRoot, ['add', 'package.json']);
fixtureGit(fixtureRoot, ['commit', '-m', 'fixture baseline']);
const fixtureCommit = fixtureGit(fixtureRoot, ['rev-parse', 'HEAD']);
fs.writeFileSync(path.join(fixtureRoot, 'README.md'), '# fixture\n');
fixtureGit(fixtureRoot, ['add', 'README.md']);
fixtureGit(fixtureRoot, ['commit', '-m', 'fixture descendant']);
const fixtureHead = fixtureGit(fixtureRoot, ['rev-parse', 'HEAD']);
fixtureGit(fixtureRoot, ['remote', 'add', 'origin', 'https://github.com/example/canonical.git']);
fixtureGit(fixtureRoot, ['update-ref', 'refs/remotes/origin/nova-logic', fixtureHead]);
const fixtureManifestPath = path.join(fixtureRoot, 'auto-fix', 'config', 'canonical-source.json');
const fixtureManifest = {
  schemaVersion: 1,
  status: 'approved',
  repositoryUrl: 'git@github.com:example/canonical.git',
  canonicalBranch: 'nova-logic',
  baselineCommit: fixtureCommit,
  applicationRoot: '.',
  requiredTrackedPaths: ['package.json'],
  approvalEvidence: {
    providedBy: 'test-owner',
    providedAt: '2026-08-27',
    source: 'unit-test fixture',
  },
};
const writeFixtureManifest = (value) => fs.writeFileSync(fixtureManifestPath, JSON.stringify(value));
const assertCanonicalBlocked = () => assert.notStrictEqual(inspectRepository(fixtureRoot).sourceStatus, 'canonical-source-confirmed');

assertCanonicalBlocked();
fs.writeFileSync(fixtureManifestPath, '{invalid');
assertCanonicalBlocked();
writeFixtureManifest(fixtureManifest);
assert.strictEqual(inspectRepository(fixtureRoot).sourceStatus, 'canonical-source-confirmed');
fixtureGit(fixtureRoot, ['checkout', '--detach', fixtureHead]);
assert.strictEqual(inspectRepository(fixtureRoot).sourceStatus, 'canonical-source-confirmed');

writeFixtureManifest({ ...fixtureManifest, repositoryUrl: 'https://github.com/example/other.git' });
assertCanonicalBlocked();
writeFixtureManifest({ ...fixtureManifest, canonicalBranch: '--upload-pack=unsafe' });
assertCanonicalBlocked();
writeFixtureManifest({ ...fixtureManifest, baselineCommit: '0'.repeat(40) });
assertCanonicalBlocked();
writeFixtureManifest({ ...fixtureManifest, requiredTrackedPaths: ['../package.json'] });
assertCanonicalBlocked();
fs.writeFileSync(path.join(fixtureRoot, 'untracked.js'), 'module.exports = {};\n');
writeFixtureManifest({ ...fixtureManifest, requiredTrackedPaths: ['untracked.js'] });
assertCanonicalBlocked();
fs.unlinkSync(path.join(fixtureRoot, 'package.json'));
writeFixtureManifest(fixtureManifest);
assertCanonicalBlocked();
fs.writeFileSync(path.join(fixtureRoot, 'package.json'), '{"private":true}\n');
const fixtureTree = fixtureGit(fixtureRoot, ['write-tree']);
const unrelatedCommit = fixtureGit(fixtureRoot, ['commit-tree', fixtureTree, '-m', 'unrelated']);
fixtureGit(fixtureRoot, ['update-ref', 'refs/remotes/origin/nova-logic', unrelatedCommit]);
assertCanonicalBlocked();
fixtureGit(fixtureRoot, ['update-ref', 'refs/remotes/origin/nova-logic', fixtureHead]);
fixtureGit(fixtureRoot, ['remote', 'remove', 'origin']);
assertCanonicalBlocked();

assert.strictEqual(getTool('executeCommand'), null);
assert.deepStrictEqual(listTools().map((tool) => tool.name), ['inspectRepository', 'evaluateReadiness']);
assert.strictEqual(authorizeTool(policy, 'inspectRepository').allowed, false);
assert.strictEqual(authorizeTool(policy, 'unknown').reason, 'unknown-tool');

assert.throws(() => createAuditRecord({ event: 'unsafe', policy: { ...policy, audit: { appendOnly: false, redactSecrets: true } } }), /append-only/);

console.log('CONTROL-PLANE TEST: PASS');
