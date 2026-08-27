'use strict';

const assert = require('assert');
const { environmentProfile } = require('../environment');

const env = environmentProfile();
assert.ok(env.environment_id, 'environment_id must be present');
assert.strictEqual(env.environment_id.length, 24);
assert.ok(['Windows', 'macOS', 'Linux'].includes(env.OS));
assert.ok(env['OS build']);
assert.ok(env.architecture);
assert.strictEqual(env.locale, null, 'locale must be null (privacy minimization)');
assert.strictEqual(env.timezone, null, 'timezone must be null (privacy minimization)');
assert.strictEqual(typeof env.timezone_offset_minutes, 'number');

// Deterministic: same host yields the same environment id.
assert.strictEqual(env.environment_id, environmentProfile().environment_id);

console.log('environment tests: passed');