'use strict';

const { validatePolicy } = require('./policy');

const STATUS = Object.freeze({ PASS: 'PASS', FAIL: 'FAIL', BLOCKED: 'BLOCKED' });

function gate(name, status, reason, evidence = {}) {
  return { name, status, reason, evidence };
}

function evaluateReadiness({ policy, repository, checks = {} }) {
  const results = [];
  const policyErrors = validatePolicy(policy);
  results.push(policyErrors.length
    ? gate('policy', STATUS.FAIL, 'policy validation failed', { errors: policyErrors })
    : gate('policy', STATUS.PASS, 'deny-by-default policy is valid', { runtimeEnabled: false }));

  results.push(repository?.isGitRepository
    ? gate('git-repository', STATUS.PASS, 'Git repository detected', { path: repository.path })
    : gate('git-repository', STATUS.BLOCKED, 'Git repository is unavailable', { errors: repository?.errors || [] }));
  results.push(repository?.isGitRepository && repository.commitSha
    ? gate('revision', STATUS.PASS, 'revision captured', { commitSha: repository.commitSha })
    : gate('revision', STATUS.BLOCKED, 'commit SHA cannot be captured'));
  results.push(repository?.isGitRepository && repository.dirty === false
    ? gate('clean-worktree', STATUS.PASS, 'worktree is clean')
    : repository?.isGitRepository
      ? gate('clean-worktree', STATUS.FAIL, 'worktree contains changes')
      : gate('clean-worktree', STATUS.BLOCKED, 'worktree state cannot be determined'));
  results.push(repository?.sourceStatus === 'canonical-source-confirmed'
    ? gate('canonical-source', STATUS.PASS, 'canonical source confirmed')
    : gate('canonical-source', STATUS.BLOCKED, 'canonical source is not confirmed', { sourceStatus: repository?.sourceStatus }));

  const requiredChecks = ['ciHost', 'dependencyInstall', 'staticChecks', 'tests', 'buildVerification', 'artifactVerification', 'securityScan'];
  for (const name of requiredChecks) {
    const value = checks[name];
    results.push(value === true
      ? gate(name, STATUS.PASS, 'check reported pass')
      : value === false
        ? gate(name, STATUS.FAIL, 'check reported failure')
        : gate(name, STATUS.BLOCKED, 'check has not been executed'));
  }

  const overall = results.some((item) => item.status === STATUS.FAIL)
    ? STATUS.FAIL
    : results.some((item) => item.status === STATUS.BLOCKED)
      ? STATUS.BLOCKED
      : STATUS.PASS;
  return { schemaVersion: 1, status: overall, generatedAt: new Date().toISOString(), gates: results };
}

module.exports = { STATUS, evaluateReadiness };
