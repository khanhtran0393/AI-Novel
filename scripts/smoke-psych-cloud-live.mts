/**
 * Live POST to production psych cloud IP (ai-novel-flax).
 * Requires seller private key on this machine.
 */
import assert from 'assert';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
process.chdir(root);

async function main() {
  const seller = path.join(
    process.env.LOCALAPPDATA || '',
    'AI Novel Seller',
    'entitlement-private.pem',
  );
  if (!fs.existsSync(seller)) {
    console.log('SKIP live psych cloud (no seller private key)');
    return;
  }
  process.env.AINOVEL_ENTITLEMENT_PRIVATE_KEY_FILE = seller;
  process.env.AINOVEL_ENTITLEMENT_PUBLIC_KEYS_DIR = path.join(
    root,
    'resources',
    'license',
    'public-keys',
  );

  const ent = await import('../src/lib/entitlement.ts');
  const token = ent.issueEntitlementToken({
    is_pro: true,
    is_vip: false,
    plan: 'pro',
    hwid: ent.getHwid(),
    expSeconds: 3600,
  });

  const endpoint = 'https://ai-novel-flax.vercel.app/api/cloud/ip/psych';

  const getRes = await fetch(endpoint, { signal: AbortSignal.timeout(30_000) });
  const getText = await getRes.text();
  assert.equal(getRes.status, 200, getText);
  const getJson = JSON.parse(getText) as { service?: string };
  assert.equal(getJson.service, 'cloud-ip-psych');
  console.log('PASS live GET psych cloud');

  const deny = await fetch(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      action: 'score_title',
      input: { title: 'Test title' },
    }),
    signal: AbortSignal.timeout(30_000),
  });
  assert.ok(deny.status === 401 || deny.status === 403, `expected deny got ${deny.status}`);
  console.log('PASS live POST without token denied', deny.status);

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-ainovel-entitlement': token,
    },
    body: JSON.stringify({
      action: 'score_title',
      hwid: ent.getHwid(),
      input: {
        title: 'Cô gái 0 xu mở cửa lò luyện: cả thành chết lặng',
      },
    }),
    signal: AbortSignal.timeout(60_000),
  });
  const text = await res.text();
  console.log('HTTP', res.status, text.slice(0, 280));
  assert.ok(res.status === 200, text);
  const j = JSON.parse(text) as { success?: boolean; source?: string; result?: unknown };
  assert.equal(j.success, true);
  console.log(
    JSON.stringify({
      ok: true,
      live: 'psych-cloud-prod',
      source: j.source,
      hasResult: j.result != null,
    }),
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
