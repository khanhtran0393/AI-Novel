/**
 * List Supabase licenses rows for this machine HWID.
 * Run: npx tsx scripts/diag-supabase-rows.mts
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

const { getHwid } = await import('../src/lib/entitlement.ts');
const { isSupabaseAdminConfigured } = await import('../src/lib/supabase/env.ts');
const { createServiceSupabase } = await import('../src/lib/supabase/server.ts');
const { resolveLicenseByHwid } = await import('../src/lib/cloud/licenseBridge.ts');

const hwid = getHwid().toLowerCase();
console.log('hwid', hwid.toUpperCase());
console.log('supabaseAdmin', isSupabaseAdminConfigured());

if (!isSupabaseAdminConfigured()) {
  console.log('NO SERVICE_ROLE — cannot read licenses table');
  process.exit(0);
}

const s = createServiceSupabase();
const { data: rows, error } = await s
  .from('licenses')
  .select('id,status,plan,hwid,exp_at,created_at,revoked_at')
  .ilike('hwid', hwid)
  .order('created_at', { ascending: false })
  .limit(20);

if (error) {
  console.error('query error', error.message);
  process.exit(1);
}

console.log('rowCount', (rows || []).length);
for (const r of rows || []) {
  const expMs = new Date(r.exp_at).getTime();
  const activeNow = r.status === 'active' && Number.isFinite(expMs) && expMs >= Date.now();
  console.log(
    JSON.stringify({
      id: r.id,
      status: r.status,
      plan: r.plan,
      exp_at: r.exp_at,
      created_at: r.created_at,
      activeNow,
      daysLeft: activeNow ? Math.round((expMs - Date.now()) / 86400000) : null,
    }),
  );
}

const best = await resolveLicenseByHwid(s, hwid);
console.log(
  'resolveLicenseByHwid',
  JSON.stringify({
    found: best.found,
    status: best.status,
    plan: best.plan,
    licenseId: best.licenseId,
    claims: best.claims
      ? {
          plan: best.claims.plan,
          is_pro: best.claims.is_pro,
          is_trial: best.claims.is_trial,
          expIso: new Date((best.claims.exp || 0) * 1000).toISOString(),
        }
      : null,
  }),
);
