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

const { GET } = await import('../src/app/api/commercial/status/route.ts');
const { getHwid } = await import('../src/lib/entitlement.ts');
const { createServiceSupabase } = await import('../src/lib/supabase/server.ts');
const { startCloudTrial } = await import('../src/lib/cloud/licenseBridge.ts');

// status without token
const res0 = await GET(new Request('http://local/api/commercial/status'));
const j0 = await res0.json();
console.log('status no token', {
  tier: j0.tier,
  claims: j0.claims,
  trial: j0.trial,
  authority: j0.authority,
  tokenValid: j0.tokenValid,
});

// start trial and status with token
const s = createServiceSupabase();
let token = '';
try {
  const t = await startCloudTrial({ service: s, hwid: getHwid() });
  token = t.token;
  console.log('trial token ok', t.created, t.licenseId);
} catch (e) {
  console.log('trial err', e instanceof Error ? e.message : e);
}

const res1 = await GET(
  new Request('http://local/api/commercial/status', {
    headers: token ? { 'x-ainovel-entitlement': token } : {},
  }),
);
const j1 = await res1.json();
console.log('status with trial token', {
  tier: j1.tier,
  claims: j1.claims,
  trial: j1.trial,
  authority: j1.authority,
  tokenValid: j1.tokenValid,
});
