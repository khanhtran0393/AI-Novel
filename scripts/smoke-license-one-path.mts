/**
 * Smoke: License One-Path policy module + catalog + ban list.
 * Docs: docs/LICENSE_ONE_PATH.md
 */
import assert from 'assert';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
process.chdir(root);

async function main() {
  const one = await import('../src/lib/commercial/licenseOnePath.ts');

  assert.equal(one.LICENSE_ONE_PATH_VERSION, 1);
  const pub = one.getLicenseOnePathPublicStatus();
  assert.equal(pub.model, 'ticket_ledger_cloud_ip');
  assert.equal(pub.privateKeyRole, 'sign_only');
  assert.equal(pub.tokenRole, 'ticket_not_content_key');
  assert.equal(pub.dailyQuota, false);
  assert.equal(pub.complete.dailyQuota, false);
  assert.equal(pub.complete.policyModule, true);
  assert.equal(pub.complete.cloudIpBridges, true);
  assert.equal(
    pub.outOfScope.daily_request_quota_supabase.status,
    'rejected',
  );
  assert.equal(pub.outOfScope.token_text_as_content_key.status, 'rejected');

  assert.ok(one.FORBIDDEN_UNLOCK_PATTERNS.includes('derive_aes_from_token_text'));
  assert.ok(one.FORBIDDEN_UNLOCK_PATTERNS.includes('private_key_on_client'));
  assert.ok(one.FORBIDDEN_UNLOCK_PATTERNS.includes('substring_token_as_module_key'));
  assert.ok(one.APPROVED_CONTENT_UNLOCK.includes('cloud_ip_execution'));
  assert.ok(one.APPROVED_CONTENT_UNLOCK.includes('server_ttl_content_key'));

  // Approved path must not throw
  one.assertApprovedContentUnlock('cloud_ip_execution', 'smoke');
  one.assertApprovedContentUnlock('local_free_or_non_ip', 'smoke');
  one.assertApprovedContentUnlock('server_gate_only', 'smoke');

  // Forbidden derive must hard-fail
  let banned = false;
  try {
    one.rejectTokenDerivedContentKey('token_slice', 'smoke');
  } catch (e) {
    banned = true;
    assert.ok(e instanceof Error && /CẤM derive|license-one-path/i.test(e.message));
  }
  assert.ok(banned, 'rejectTokenDerivedContentKey must throw');

  assert.ok(pub.entryPoints.activate.includes('entitlement/activate'));
  assert.ok(pub.entryPoints.status.includes('commercial/status'));
  assert.equal(pub.docs, 'docs/LICENSE_ONE_PATH.md');
  assert.ok(pub.layers.A_ticket);
  assert.ok(pub.layers.B_ledger);
  assert.ok(pub.layers.C_crown_ip);
  assert.ok(
    /NO daily request quota/i.test(pub.layers.B_ledger.summary),
    'ledger summary must reject daily quota',
  );

  // Catalog registers one-path
  const cat = await import('../src/lib/commercial/ipCatalog.ts');
  assert.ok(cat.IP_CATALOG.some((e: { id: string }) => e.id === 'license_one_path'));

  // Bridges + cloud auth load with policy pin (module top-level assert)
  await import('../src/lib/commercial/ip/seedanceCloudBridge.ts');
  await import('../src/lib/commercial/ip/psychCloudBridge.ts');
  await import('../src/lib/commercial/ip/cloudIpAuth.ts');

  // API map has both crown IP endpoints
  const { API } = await import('../src/contracts/apiMap.ts');
  assert.equal(API.cloudIpSeedance, '/api/cloud/ip/seedance');
  assert.equal(API.cloudIpPsych, '/api/cloud/ip/psych');

  // commercial barrel exports one-path
  const barrel = await import('../src/lib/commercial/index.ts');
  assert.equal(typeof barrel.getLicenseOnePathPublicStatus, 'function');
  assert.equal(typeof barrel.rejectTokenDerivedContentKey, 'function');
  assert.equal(typeof barrel.LICENSE_OUT_OF_SCOPE, 'object');

  console.log(
    JSON.stringify({
      ok: true,
      smoke: 'license-one-path',
      version: one.LICENSE_ONE_PATH_VERSION,
      model: pub.model,
      dailyQuota: pub.dailyQuota,
      forbidden: pub.forbidden.length,
      approved: pub.approvedUnlock.length,
      outOfScope: Object.keys(pub.outOfScope),
    }),
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
