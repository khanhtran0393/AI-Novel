/**
 * Smoke: HWID multi-version + heartbeat offline logic + proGate modules load.
 */
import assert from 'assert';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import os from 'os';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
process.chdir(root);

async function main() {
  const ent = await import('../src/lib/entitlement.ts');
  const v1 = ent.getHwidV1();
  const v2 = ent.getHwidV2();
  const v3 = ent.getHwidV3();
  const pref = ent.getHwid();
  const cands = ent.getHwidCandidates();
  assert.equal(pref, v3);
  assert.ok(cands.includes(v1.toLowerCase()));
  assert.ok(cands.includes(v2.toLowerCase()));
  assert.ok(cands.includes(v3.toLowerCase()));
  assert.ok(cands.length >= 1 && cands.length <= 3);
  console.log('PASS HWID v3 multi-signal', { v3, n: cands.length });

  // Heartbeat: non-packaged is no-op
  delete process.env.AI_NOVEL_PACKAGED;
  delete process.env.AINOVEL_PUBLISH;
  const hb = await import('../src/lib/commercial/licenseHeartbeat.ts');
  const fakeReq = new Request('http://local/test');
  await hb.enforcePackagedHeartbeat(fakeReq, {}, {
    is_pro: true,
    is_vip: false,
    exp: Math.floor(Date.now() / 1000) + 3600,
  });
  console.log('PASS heartbeat no-op when not packaged');

  // Packaged offline first-run: allow
  process.env.AI_NOVEL_PACKAGED = '1';
  process.env.AINOVEL_PUBLISH = '1';
  process.env.AINOVEL_LICENSE_API_URL = 'https://ai-novel-flax.vercel.app';
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ainovel-hb-'));
  process.env.AINOVEL_DATA_ROOT = dataRoot;
  process.env.AI_NOVEL_USER_DATA = dataRoot;

  // Issue local token bound to this machine
  process.env.AINOVEL_ENTITLEMENT_PUBLIC_KEYS_DIR = path.join(
    root,
    'resources',
    'license',
    'public-keys',
  );
  const sellerPem = path.join(
    process.env.LOCALAPPDATA || '',
    'AI Novel Seller',
    'entitlement-private.pem',
  );
  if (fs.existsSync(sellerPem)) {
    process.env.AINOVEL_ENTITLEMENT_PRIVATE_KEY_FILE = sellerPem;
    const token = ent.issueEntitlementToken({
      is_pro: true,
      is_vip: false,
      plan: 'pro',
      hwid: ent.getHwid(),
      expSeconds: 3600,
    });
    const req = new Request('http://local/test', {
      headers: { 'x-ainovel-entitlement': token },
    });
    // Force offline by pointing license API to blackhole host that fails pin... 
    // Actually pin will throw offline path via probe catch
    process.env.AINOVEL_LICENSE_API_URL = 'https://ai-novel-flax.vercel.app';
    // First call: may online-valid if network works, or offline first-run
    await hb.enforcePackagedHeartbeat(req, {}, {
      is_pro: true,
      is_vip: false,
      exp: Math.floor(Date.now() / 1000) + 3600,
      hwid: ent.getHwid(),
    });
    const st = hb.getHeartbeatPublicStatus();
    assert.ok(st.packaged);
    console.log('PASS packaged heartbeat path', st);
  } else {
    console.log('SKIP heartbeat token path (no seller private key)');
  }

  const integ = await import('../src/lib/commercial/runtimeIntegrity.ts');
  const ir = integ.evaluateRuntimeIntegrity();
  assert.ok(ir.ok, ir.reasons.join('; '));
  console.log('PASS runtime integrity', ir.pinsDigest);

  const hard = await import('../src/lib/commercial/proGateHard.ts');
  assert.equal(typeof hard.assertPremiumAccessHard, 'function');
  assert.equal(typeof hard.assertFeatureAccessHard, 'function');
  console.log('PASS proGateHard export');

  const attest = await import('../src/lib/commercial/packagedAttestation.ts');
  delete process.env.AI_NOVEL_PACKAGED;
  delete process.env.AINOVEL_PUBLISH;
  delete process.env.AINOVEL_ELECTRON_PACKAGED;
  delete process.env.AINOVEL_PACKAGED_ATTEST;
  assert.equal(attest.isPackagedCustomerRuntime(), false);
  process.env.AINOVEL_PACKAGED_ATTEST = 'ainovel-pkg-deadbeefdeadbeef';
  assert.equal(attest.isPackagedCustomerRuntime(), true);
  delete process.env.AINOVEL_PACKAGED_ATTEST;
  process.env.AINOVEL_ELECTRON_PACKAGED = '1';
  assert.equal(attest.isPackagedCustomerRuntime(), true);
  console.log('PASS multi-signal packaged attestation');

  // Grace defaults tightened
  assert.ok(hb.heartbeatGraceSec() <= 48 * 3600);
  assert.ok(hb.heartbeatFirstRunSec() <= 12 * 3600);
  const online = await import('../src/lib/commercial/onlineRevalidate.ts');
  assert.ok(online.strictOnlineGraceSec() <= 6 * 3600);
  console.log('PASS grace defaults', {
    grace: hb.heartbeatGraceSec(),
    first: hb.heartbeatFirstRunSec(),
    strict: online.strictOnlineGraceSec(),
  });

  const host = await import('../src/lib/nav/hostBinding.ts');
  const childEnv = host.hostBindingChildEnv({ action: 'smoke', timeoutMs: 5000 });
  assert.ok(childEnv.AINOVEL_HOST_TOKEN);
  assert.ok(childEnv.AINOVEL_HOST_BINDING_SECRET);
  assert.ok(!childEnv.AINOVEL_ENTITLEMENT_PRIVATE_KEY);
  console.log('PASS host-binding per-spawn scrubbed env');

  const gate = await import('../src/lib/commercial/apiGate.ts');
  assert.equal(typeof gate.requireFeature, 'function');
  assert.equal(typeof gate.requireToolboxAccess, 'function');
  console.log('PASS apiGate hard mesh exports');

  const seat = await import('../src/lib/commercial/seatPresence.ts');
  assert.equal(typeof seat.enforceSeatPresence, 'function');
  const st = seat.getSeatPresencePublicStatus();
  assert.ok(st.windowSec >= 60);
  console.log('PASS seat presence', st);

  const rebind = await import('../src/lib/commercial/hwidRebind.ts');
  assert.equal(typeof rebind.enforceHwidRebind, 'function');
  assert.equal(typeof rebind.clearHwidRebindLock, 'function');
  console.log('PASS hwid rebind exports');

  fs.rmSync(dataRoot, { recursive: true, force: true });
  console.log(JSON.stringify({ ok: true, smoke: 'hardening-remaining' }));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
