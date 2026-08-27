'use strict';

const assert = require('assert');
const {
  REQUIRED_AUTHORITIES,
  authorization,
  loadPolicy,
  policyPath,
  validatePolicy,
} = require('../policy');

const policy = loadPolicy();

assert.deepStrictEqual(validatePolicy(policy), []);
assert.strictEqual(policy.runtimeEnabled, false);

for (const authority of REQUIRED_AUTHORITIES) {
  const decision = authorization(policy, authority);
  assert.strictEqual(decision.allowed, false);
  assert.strictEqual(decision.reason, 'deny-by-default');
}

assert.strictEqual(authorization(policy, 'not-a-real-authority').allowed, false);
assert.strictEqual(authorization(policy, 'not-a-real-authority').reason, 'unknown-authority');

const invalidPolicy = { ...policy, runtimeEnabled: true };
assert.ok(validatePolicy(invalidPolicy).includes('runtimeEnabled must be false'));
assert.strictEqual(authorization(invalidPolicy, 'build').reason, 'invalid-policy');

console.log(`POLICY TEST: PASS (${policyPath()})`);
