/**
 * Diagnose why trial may not unlock Pro features.
 * Run: npx tsx scripts/diag-trial.mts
 */
import fs from 'fs';
import path from 'path';

const envPath = path.join(process.cwd(), '.env.local');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('=');
    if (i < 0) continue;
    const k = t.slice(0, i).trim();
    let v = t.slice(i + 1).trim();
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1);
    }
    if (!process.env[k]) process.env[k] = v;
  }
}

const {
  getHwid,
  getEntitlementMode,
  getEntitlementPublicStatus,
  resolveEntitlementSigningKey,
  verifyEntitlementToken,
  assertProAccess,
  resolveRequestAccessAsync,
} = await import('../src/lib/entitlement.ts');
const { isSupabaseAdminConfigured } = await import('../src/lib/supabase/env.ts');
const { getTrialStatus } = await import('../src/lib/commercial/trial.ts');
const { createServiceSupabase } = await import('../src/lib/supabase/server.ts');
const { resolveLicenseByHwid, startCloudTrial } = await import(
  '../src/lib/cloud/licenseBridge.ts'
);
const { canAccessFeature } = await import('../src/lib/commercial/featureMatrix.ts');

console.log('=== ENV / MODE ===');
console.log({
  mode: getEntitlementMode(),
  hwid: getHwid(),
  supabaseAdmin: isSupabaseAdminConfigured(),
});
const pub = getEntitlementPublicStatus();
console.log('entitlement', {
  mode: pub.mode,
  ready: pub.readyForCommercial,
  blockers: pub.blockers,
  publicKey: pub.publicKeyConfigured,
  signer: pub.signerConfigured,
});
const signer = resolveEntitlementSigningKey();
console.log('signer.ok', signer.ok, !signer.ok ? (signer as { reason?: string }).reason : '');

console.log('=== LOCAL TRIAL VAULT ===');
console.log(getTrialStatus());

let token = '';
if (isSupabaseAdminConfigured()) {
  const s = createServiceSupabase();
  console.log('=== LEDGER BEFORE ===');
  const by = await resolveLicenseByHwid(s, getHwid());
  console.log({
    found: by.found,
    status: by.status,
    plan: by.plan,
    claims: by.claims
      ? {
          plan: by.claims.plan,
          is_trial: by.claims.is_trial,
          is_pro: by.claims.is_pro,
          exp: by.claims.exp,
        }
      : null,
  });

  console.log('=== START CLOUD TRIAL ===');
  try {
    const trial = await startCloudTrial({ service: s, hwid: getHwid() });
    token = trial.token;
    console.log({
      created: trial.created,
      licenseId: trial.licenseId,
      expAt: trial.expAt,
      tokenPrefix: trial.token.slice(0, 28),
      verify: verifyEntitlementToken(trial.token, { requireHwidMatch: true }),
    });
  } catch (e) {
    console.log('startCloudTrial ERR:', e instanceof Error ? e.message : e);
  }

  console.log('=== LEDGER AFTER ===');
  const by2 = await resolveLicenseByHwid(s, getHwid());
  console.log({
    found: by2.found,
    status: by2.status,
    plan: by2.plan,
    claims: by2.claims
      ? {
          plan: by2.claims.plan,
          is_trial: by2.claims.is_trial,
          is_pro: by2.claims.is_pro,
        }
      : null,
  });
} else {
  console.log('No Supabase admin — local vault path only');
}

console.log('=== ACCESS SIMULATION ===');
const headers = new Headers();
if (token) headers.set('x-ainovel-entitlement', token);
const req = new Request('http://localhost/api/generate-video', {
  method: 'POST',
  headers,
});
try {
  const access = await resolveRequestAccessAsync(req, {});
  console.log('resolveRequestAccessAsync', {
    tier: access.tier,
    authority: access.authority,
    is_trial: access.claims.is_trial,
    is_pro: access.claims.is_pro,
    plan: access.claims.plan,
  });
  console.log('can gen_video', canAccessFeature(access.tier, 'gen_video'));
  console.log('can tts_premium', canAccessFeature(access.tier, 'tts_premium'));
  console.log(
    'can toolbox_labs (Pro-only)',
    canAccessFeature(access.tier, 'toolbox_labs'),
  );
  await assertProAccess(req, {});
  console.log('assertProAccess: OK');
} catch (e) {
  console.log(
    'assertProAccess FAIL:',
    e instanceof Error ? e.message : e,
  );
}
