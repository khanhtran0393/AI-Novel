'use strict';

const assert = require('assert');
const {
  isExactOriginUrl,
  isTrustedNavigationUrl,
} = require('../electron/securityPolicy');

const origin = 'http://127.0.0.1:3000';
const splash = 'data:text/html;charset=utf-8,known-splash';
const trustedData = new Set([splash]);

assert.equal(isExactOriginUrl(`${origin}/workspace`, origin), true);
assert.equal(isExactOriginUrl(`${origin}@evil.example/workspace`, origin), false);
assert.equal(isExactOriginUrl('http://127.0.0.1:30000/workspace', origin), false);
assert.equal(isExactOriginUrl('data:text/html,<script>evil()</script>', origin), false);
assert.equal(isTrustedNavigationUrl(splash, origin, trustedData), true);
assert.equal(
  isTrustedNavigationUrl('data:text/html,<script>evil()</script>', origin, trustedData),
  false,
);

console.log('PASS smoke-electron-security');
