/**
 * Empirical: does Trial unlock Pro-equivalent gates right now?
 * Run: npx tsx scripts/diag-trial-open.mts
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
    )
      v = v.slice(1, -1);
    if (!process.env[k]) process.env[k] = v;
  }
}

const {
  getHwid,
  getTrialStatus,
  assertProAccess,
  resolveRequestAccessAsync,
  issueEntitlementToken,
  verifyEntitlementToken,
} = await import('../src/lib/entitlement.ts').then(async (e) => {
  const trial = await import('../src/lib/commercial/trial.ts');
  return { ...e, getTrialStatus: trial.getTrialStatus, startTrial: trial.startTrial };
});
const { startTrial } = await import('../src/lib/commercial/trial.ts');
const { canAccessFeature } = await import('../src/lib/commercial/featureMatrix.ts');
const { isSupabaseAdminConfigured } = await import('../src/lib/supabase/env.ts');
const { createServiceSupabase } = await import('../src/lib/supabase/server.ts');
const { resolveLicenseByHwid, startCloudTrial } = await import(
  '../src/lib/cloud/licenseBridge.ts'
);
const { GET: statusGET } = await import(
  '../src/app/api/commercial/status/route.ts'
);
const { assertPremiumAccessHard } = await import(
  '../src/lib/commercial/proGateHard.ts'
);

const hwid = getHwid().toLowerCase();
console.log('=== MACHINE ===');
console.log({ hwid: hwid.toUpperCase(), supabaseAdmin: isSupabaseAdminConfigured() });

console.log('\n=== LOCAL TRIAL VAULT ===');
const vault = getTrialStatus(hwid);
console.log({
  enabled: vault.enabled,
  active: vault.active,
  used: vault.used,
  endsAt: vault.record?.endsAt
    ? new Date(vault.record.endsAt * 1000).toISOString()
    : null,
});

console.log('\n=== SUPABASE LEDGER ===');
let ledger: Awaited<ReturnType<typeof resolveLicenseByHwid>> | null = null;
if (isSupabaseAdminConfigured()) {
  const s = createServiceSupabase();
  ledger = await resolveLicenseByHwid(s, hwid);
  console.log({
    found: ledger.found,
    plan: ledger.plan,
    status: ledger.status,
    licenseId: ledger.licenseId,
    claims: ledger.claims
      ? {
          plan: ledger.claims.plan,
          is_pro: ledger.claims.is_pro,
          is_trial: ledger.claims.is_trial,
          expIso: new Date((ledger.claims.exp || 0) * 1000).toISOString(),
        }
      : null,
  });
} else {
  console.log('no SERVICE_ROLE');
}

// Mint / refresh trial token (local)
const started = startTrial(hwid);
console.log('\n=== startTrial ===');
console.log({
  ok: started.ok,
  created: started.created,
  active: started.status.active,
  hasToken: Boolean(started.token),
  error: started.error,
});

let trialToken = started.token || '';
// Prefer pure trial claims token for gate test
if (vault.active || started.status.active) {
  const ends =
    started.status.record?.endsAt ||
    vault.record?.endsAt ||
    Math.floor(Date.now() / 1000) + 7 * 86400;
  try {
    trialToken = issueEntitlementToken({
      is_pro: true,
      is_vip: false,
      is_trial: true,
      plan: 'trial',
      hwid,
      expSeconds: Math.max(60, ends - Math.floor(Date.now() / 1000)),
    });
  } catch (e) {
    console.log('mint trial token fail', e instanceof Error ? e.message : e);
  }
}
console.log(
  'trialToken verify',
  trialToken
    ? verifyEntitlementToken(trialToken, { requireHwidMatch: true })
    : null,
);

async function checkAccess(label: string, token: string | null) {
  const headers = new Headers();
  if (token) headers.set('x-ainovel-entitlement', token);
  const req = new Request('http://localhost/api/generate-video', {
    method: 'POST',
    headers,
  });
  const access = await resolveRequestAccessAsync(req, {});
  const features = {
    gen_video: canAccessFeature(access.tier, 'gen_video'),
    export_capcut: canAccessFeature(access.tier, 'export_capcut'),
    ship_pack: canAccessFeature(access.tier, 'ship_pack'),
    tts_premium: canAccessFeature(access.tier, 'tts_premium'),
    toolbox_labs: canAccessFeature(access.tier, 'toolbox_labs'),
    multi_channel: canAccessFeature(access.tier, 'multi_channel'),
  };
  let assertPro: 'OK' | string = 'OK';
  try {
    await assertProAccess(req, {});
  } catch (e) {
    assertPro = e instanceof Error ? e.message.slice(0, 120) : String(e);
  }
  let hard: 'OK' | string = 'OK';
  try {
    await assertPremiumAccessHard(req, {});
  } catch (e) {
    hard = e instanceof Error ? e.message.slice(0, 120) : String(e);
  }
  console.log(`\n=== ACCESS ${label} ===`);
  console.log({
    tier: access.tier,
    authority: access.authority,
    is_trial: access.claims.is_trial,
    is_pro: access.claims.is_pro,
    plan: access.claims.plan,
    features,
    assertProAccess: assertPro,
    assertPremiumAccessHard: hard,
  });
  return { access, features, assertPro, hard };
}

// 1) Current machine (ledger may be Pro)
const current = await checkAccess(
  'CURRENT (ledger+token trial)',
  trialToken || null,
);

// 2) Status API
const statusRes = await statusGET(
  new Request('http://localhost/api/commercial/status', {
    headers: trialToken
      ? { 'x-ainovel-entitlement': trialToken }
      : undefined,
  }),
);
const status = await statusRes.json();
console.log('\n=== commercial/status ===');
console.log({
  tier: status.tier,
  authority: status.authority,
  tokenValid: status.tokenValid,
  claims: status.claims,
  trial: {
    active: status.trial?.active,
    used: status.trial?.used,
    fromVault: status.trial?.fromVault,
    fromSupabase: status.trial?.fromSupabase,
  },
});

// 3) Pure trial-tier matrix (no env) — product contract
console.log('\n=== MATRIX contract (tier=trial) ===');
const matrix = {
  gen_video: canAccessFeature('trial', 'gen_video'),
  export_capcut: canAccessFeature('trial', 'export_capcut'),
  ship_pack: canAccessFeature('trial', 'ship_pack'),
  tts_premium: canAccessFeature('trial', 'tts_premium'),
  toolbox_labs: canAccessFeature('trial', 'toolbox_labs'),
  multi_channel: canAccessFeature('trial', 'multi_channel'),
};
console.log(matrix);

const trialFeaturesOk =
  matrix.gen_video &&
  matrix.export_capcut &&
  matrix.ship_pack &&
  matrix.tts_premium &&
  !matrix.toolbox_labs &&
  !matrix.multi_channel;

const gateOk =
  current.assertPro === 'OK' &&
  (current.access.tier === 'trial' || current.access.tier === 'pro');

const statusOk =
  status.tier === 'trial' ||
  status.tier === 'pro' ||
  status.trial?.active === true;

console.log('\n=== VERDICT ===');
console.log({
  matrixTrialOpensProEquivalent: trialFeaturesOk ? 'PASS' : 'FAIL',
  thisMachineGate: gateOk ? 'PASS' : 'FAIL',
  thisMachineTier: current.access.tier,
  statusTier: status.tier,
  statusOk: statusOk ? 'PASS' : 'FAIL',
  note:
    current.access.tier === 'pro'
      ? 'Máy này ledger ưu tiên PRO (có row pro active) — gate Pro mở 100%. Trial row vẫn tồn tại song song.'
      : current.access.tier === 'trial'
        ? 'Máy đang resolve TRIAL — gate Pro-equivalent phải mở.'
        : 'Máy đang FREE — trial CHƯA mở gate.',
});

if (!trialFeaturesOk || !gateOk) process.exitCode = 1;
else console.log('\nPASS trial unlock check');
