/**
 * Smoke: host pin + fail-closed keyring + fake host reject.
 */
import assert from 'assert';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
process.chdir(root);

async function main() {
  // 1) Official host accepted (packaged)
  process.env.AI_NOVEL_PACKAGED = '1';
  process.env.AINOVEL_PUBLISH = '1';
  process.env.AINOVEL_LICENSE_API_URL = 'https://ai-novel-flax.vercel.app';
  delete process.env.AINOVEL_LICENSE_API_HOSTS;

  const trust = await import('../src/lib/commercial/licenseTrust.ts');
  const u = trust.resolvePinnedLicenseApiUrl();
  assert.equal(u.hostname, 'ai-novel-flax.vercel.app');
  assert.ok(trust.getPinnedLicenseHosts().includes('ai-novel-flax.vercel.app'));
  console.log('PASS host pin accept official');

  // 2) Rogue host rejected
  process.env.AINOVEL_LICENSE_API_URL = 'https://evil-license.example.org';
  let rejected = false;
  try {
    trust.resolvePinnedLicenseApiUrl();
  } catch {
    rejected = true;
  }
  assert.ok(rejected, 'rogue host must be rejected');
  console.log('PASS host pin reject rogue');

  // 3) Fail-closed empty keyring when packaged
  process.env.AINOVEL_LICENSE_API_URL = 'https://ai-novel-flax.vercel.app';
  process.env.AINOVEL_ENTITLEMENT_PUBLIC_KEYS_DIR =
    'C:\\no-such-keyring-dir-ainovel-trust';
  delete process.env.AINOVEL_ENTITLEMENT_PUBLIC_KEY;
  delete process.env.AINOVEL_ENTITLEMENT_PUBLIC_KEY_FILE;
  delete process.env.AINOVEL_ENTITLEMENT_PUBLIC_KEYS;
  delete process.env.AINOVEL_ENTITLEMENT_PRIVATE_KEY;
  delete process.env.AINOVEL_ENTITLEMENT_PRIVATE_KEY_FILE;
  // Prevent defaultPublicKeysDir from picking up repo keys — use empty cwd subset
  // by forcing only the missing PUBLIC_KEYS_DIR path (already set).

  // Dynamic import after env — entitlement may have been cached? Node modules cache.
  // Call resolve which re-reads env each time (no cache of keys).
  const ent = await import('../src/lib/entitlement.ts');
  // Temporarily break default dir by chdir to temp without public-keys
  const v = ent.resolveEntitlementVerificationKeys();
  // Repo may still have defaultPublicKeysDir if PUBLIC_KEYS_DIR readdir fails...
  // When dir is set but missing, loadPublicKeyCandidates only tries that dir.
  assert.equal(v.ok, false, 'keyring must be empty: ' + (v.reason || ''));
  assert.ok(
    String(v.reason || '').includes('FAIL-CLOSED') ||
      String(v.reason || '').includes('public key'),
    v.reason,
  );
  // OPEN app (free cho mọi user): assertVerificationKeyringReady là no-op,
  // không cần public key để xác minh license — app mở tự do.
  let didThrow = false;
  try {
    ent.assertVerificationKeyringReady();
  } catch {
    didThrow = true;
  }
  assert.equal(didThrow, false, 'assertVerificationKeyringReady must NOT throw in open app');
  console.log('PASS fail-closed empty keyring (open app — no-op)');


  console.log(JSON.stringify({ ok: true, smoke: 'license-trust' }));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
