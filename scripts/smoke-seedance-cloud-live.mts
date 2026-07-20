/**
 * Live POST to production Seedance cloud IP (ai-novel-flax).
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
    console.log('SKIP live seedance cloud (no seller private key)');
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

  const endpoint = 'https://ai-novel-flax.vercel.app/api/cloud/ip/seedance';

  // GET capabilities surface
  const getRes = await fetch(endpoint, { signal: AbortSignal.timeout(30_000) });
  const getText = await getRes.text();
  assert.equal(getRes.status, 200, getText);
  const getJson = JSON.parse(getText) as { success?: boolean; service?: string };
  assert.equal(getJson.service, 'cloud-ip-seedance');
  console.log('PASS live GET seedance cloud');

  // POST compile without token → 403-ish
  const deny = await fetch(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      action: 'compile_prompt',
      input: {
        sceneText: 'x',
        styleHint: 's',
        durationSec: 6,
      },
    }),
    signal: AbortSignal.timeout(30_000),
  });
  assert.ok(deny.status === 401 || deny.status === 403, `expected auth deny, got ${deny.status}`);
  console.log('PASS live POST without token denied', deny.status);

  // POST compile with Pro token
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-ainovel-entitlement': token,
    },
    body: JSON.stringify({
      action: 'compile_prompt',
      input: {
        sceneText:
          'Hai nhân vật đối thoại căng thẳng trong phòng tối, một người nắm chặt nắm đấm.',
        styleHint: 'cinematic noir',
        genre: 'tâm lý / trinh thám',
        durationSec: 8,
        secondsPerBeat: 4,
        hasStartImage: true,
      },
    }),
    signal: AbortSignal.timeout(60_000),
  });
  const text = await res.text();
  console.log('HTTP', res.status, text.slice(0, 280));
  assert.ok(res.status === 200, text);
  const j = JSON.parse(text) as {
    success?: boolean;
    source?: string;
    result?: { prompt?: string; function?: string; source?: string };
  };
  assert.equal(j.success, true);
  assert.ok(j.result?.prompt && j.result.prompt.length > 40);
  console.log(
    JSON.stringify({
      ok: true,
      live: 'seedance-cloud-prod',
      source: j.source,
      fn: j.result?.function,
      promptLen: j.result?.prompt?.length,
    }),
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
