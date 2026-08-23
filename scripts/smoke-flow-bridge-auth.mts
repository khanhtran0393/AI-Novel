/**
 * Smoke: Flow bridge WS auth accepts dynamic unpacked extension IDs only with
 * the per-launch token, and still rejects non-extension foreign origins.
 */
import {
  getOrCreateSessionToken,
  validateWsConnection,
} from '../src/lib/flow-bridge/bridgeSecurity.ts';

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(`FAIL: ${msg}`);
  console.log(`PASS: ${msg}`);
}

console.log('[smoke-flow-bridge-auth] start');

const token = getOrCreateSessionToken();

assert(
  validateWsConnection('chrome-extension://mhlccbhaflodmbkiokfjhidahhhjcjep', token)
    .allowed,
  'dynamic unpacked chrome-extension origin is allowed with session token',
);
assert(
  !validateWsConnection(
    'chrome-extension://mhlccbhaflodmbkiokfjhidahhhjcjep',
    'bad-token',
  ).allowed,
  'dynamic unpacked chrome-extension origin is rejected without valid token',
);
assert(
  validateWsConnection('chrome-extension://egjidjbpglichdcondbcbdnbeeppgdph', null)
    .allowed,
  'pinned extension origin remains allowed',
);
assert(
  !validateWsConnection('https://example.invalid', token).allowed,
  'foreign web origin is rejected even with token',
);

console.log('[smoke-flow-bridge-auth] PASS');
