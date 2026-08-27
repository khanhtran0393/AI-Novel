'use strict';

const assert = require('assert');
const http = require('http');
const { Uploader, httpsPostJson } = require('../uploader');

// Retry + backoff behavior verified with an injected transport; no network needed.
(async () => {
  let calls = 0;
  const failing = async () => { calls++; throw new Error('boom'); };
  const uploader = new Uploader({ transport: failing, maxAttempts: 3, baseDelayMs: 1, maxDelayMs: 2 });
  await assert.rejects(() => uploader.send({ ok: 1 }), /boom/);
  assert.strictEqual(calls, 3, 'must retry exactly maxAttempts times');

  let recovery = 0;
  const flaky = async () => { recovery++; if (recovery < 2) throw new Error('flaky'); return { status: 200 }; };
  const uploader2 = new Uploader({ transport: flaky, maxAttempts: 3, baseDelayMs: 1, maxDelayMs: 2 });
  const result = await uploader2.send({ ok: 1 });
  assert.strictEqual(result.status, 200);
  assert.strictEqual(recovery, 2, 'must succeed on retry');

  // Real HTTP transport against a local server (also exercises httpsPostJson).
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ received: JSON.parse(body) }));
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const port = server.address().port;
    const post = httpsPostJson({ url: `http://127.0.0.1:${port}/crash`, timeoutMs: 5000 });
    const resp = await post({ crash_id: 'c1', fingerprint: 'f1' });
    assert.strictEqual(resp.status, 200);
    assert.deepStrictEqual(JSON.parse(resp.body).received, { crash_id: 'c1', fingerprint: 'f1' });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }

  console.log('uploader tests: passed');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});