/**
 * Re-seed Trial on Supabase for this machine HWID (sole truth).
 * Run: npx tsx scripts/seed-cloud-trial.mts
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

const { getHwid } = await import('../src/lib/entitlement.ts');
const { createServiceSupabase } = await import('../src/lib/supabase/server.ts');
const { startCloudTrial, resolveLicenseByHwid } = await import(
  '../src/lib/cloud/licenseBridge.ts'
);
const { GET } = await import('../src/app/api/commercial/status/route.ts');

const hwid = getHwid();
const s = createServiceSupabase();
console.log('hwid', hwid.toUpperCase());
console.log('before', await resolveLicenseByHwid(s, hwid));

try {
  const t = await startCloudTrial({ service: s, hwid });
  console.log('startCloudTrial OK', {
    created: t.created,
    licenseId: t.licenseId,
    expAt: t.expAt,
    tokenPrefix: t.token.slice(0, 24),
  });
} catch (e) {
  console.error(
    'startCloudTrial ERR',
    e instanceof Error ? e.message : e,
  );
  process.exitCode = 1;
}

const after = await resolveLicenseByHwid(s, hwid);
console.log('after', {
  found: after.found,
  plan: after.plan,
  status: after.status,
  licenseId: after.licenseId,
});

const st = await GET(new Request('http://local/api/commercial/status'));
const j = await st.json();
console.log('commercial/status', {
  tier: j.tier,
  authority: j.authority,
  cloudStatus: j.cloudStatus,
  tokenValid: j.tokenValid,
  trial: j.trial,
  claims: j.claims,
});

if (!after.found) {
  console.error('FAIL: still no Supabase row after startCloudTrial');
  process.exitCode = 1;
} else if (j.tier !== 'trial' && j.tier !== 'pro') {
  console.error('FAIL: status tier not trial/pro:', j.tier);
  process.exitCode = 1;
} else {
  console.log('PASS: ledger + status aligned');
}
