'use strict';

const assert = require('assert');
const path = require('path');
const { sanitizeString, sanitizeCrashReport } = require('../sanitizer');

// Redacts common secret patterns.
assert.strictEqual(sanitizeString('password=supersecret123'), 'password=[REDACTED]');
const auth = sanitizeString('Authorization: Bearer abcdef123456');
assert.ok(auth.includes('[REDACTED]'), 'Authorization must be redacted');
assert.ok(!auth.includes('abcdef123456'), 'token value must not leak');
assert.strictEqual(sanitizeString('sk-abcdefghijklmnop'), '[REDACTED_SECRET]');

// Redacts JWT tokens.
const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ.abcDEF123456';
assert.ok(!sanitizeString(jwt).includes('eyJ'), 'JWT must be redacted');

// Normalizes local paths to avoid leaking the user's home folder.
const home = path.join('C:', 'Users', 'Khanh');
const normalized = sanitizeString(`${home}\\Documents\\secret.txt`);
assert.ok(
  normalized.includes('[REDACTED_LOCAL_PATH]') || normalized.includes('[HOME]'),
  'local path must be normalized',
);
assert.ok(!normalized.includes('Khanh'), 'username must not leak');

// Structured report keeps stable fields but scrubs secret key values.
const report = sanitizeCrashReport({
  fingerprint: 'abc123',
  error_type: 'TypeError',
  message: 'Cannot read x of undefined',
  stack_trace: 'Error: boom\n    at f (C:\\app\\main.js:1:2)',
  api_key: 'topsecret',
  nested: { token: 'v', safe: 1 },
});
assert.strictEqual(report.fingerprint, 'abc123');
assert.strictEqual(report.error_type, 'TypeError');
assert.strictEqual(report.api_key, '[REDACTED]');
assert.strictEqual(report.nested.token, '[REDACTED]');
assert.strictEqual(report.nested.safe, 1);

console.log('sanitizer tests: passed');