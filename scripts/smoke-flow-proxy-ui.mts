/**
 * Smoke: proxy normalize + account patch field allowed.
 */
import assert from 'assert';

async function main() {
  const { normalizeProxyServer, resolveAccountProxyServer } = await import(
    '../src/lib/flow-bridge/resolveAccountProxy.ts'
  );

  assert.strictEqual(normalizeProxyServer('1.2.3.4:8080'), '1.2.3.4:8080');
  assert.strictEqual(
    normalizeProxyServer('http://1.2.3.4:8080'),
    'http://1.2.3.4:8080',
  );
  assert.strictEqual(
    normalizeProxyServer('user:pass@1.2.3.4:8080'),
    'http://user:pass@1.2.3.4:8080',
  );
  assert.strictEqual(
    normalizeProxyServer('socks5://1.2.3.4:1080'),
    'socks5://1.2.3.4:1080',
  );
  assert.strictEqual(normalizeProxyServer('  '), '');

  // No account / empty ops → empty
  const empty = resolveAccountProxyServer('acc_missing_xyz', '');
  assert.strictEqual(typeof empty, 'string');

  console.log('SMOKE_OK smoke-flow-proxy-ui');
}

main().catch((e) => {
  console.error('SMOKE_FAIL', e);
  process.exit(1);
});
