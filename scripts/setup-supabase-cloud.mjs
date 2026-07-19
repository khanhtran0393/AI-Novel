/**
 * Verify Supabase env + print next steps for SQL migration.
 * Does NOT print secret values.
 *
 * Usage: node scripts/setup-supabase-cloud.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

function loadEnvFile(name) {
  const p = path.join(root, name);
  if (!fs.existsSync(p)) return {};
  const out = {};
  for (const line of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('=');
    if (i <= 0) continue;
    const k = t.slice(0, i).trim();
    let v = t.slice(i + 1).trim();
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1);
    }
    out[k] = v;
  }
  return out;
}

// File wins over empty process env
const env = {
  ...process.env,
  ...loadEnvFile('.env'),
  ...loadEnvFile('.env.local'),
};
// Drop empty strings so file values aren't wiped by empty process.env
for (const [k, v] of Object.entries(env)) {
  if (v === '') delete env[k];
}
const fileLocal = loadEnvFile('.env.local');
const fileEnv = loadEnvFile('.env');
Object.assign(env, fileEnv, fileLocal);

const url = (env.NEXT_PUBLIC_SUPABASE_URL || env.SUPABASE_URL || '').trim();
const anon = (
  env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  env.SUPABASE_ANON_KEY ||
  ''
).trim();
const service = (env.SUPABASE_SERVICE_ROLE_KEY || '').trim();

console.log(
  JSON.stringify(
    {
      urlPresent: Boolean(url),
      urlHost: url ? new URL(url).host : null,
      anonPresent: Boolean(anon),
      anonLooksJwt: anon.startsWith('eyJ'),
      anonLooksPublishable: anon.startsWith('sb_publishable_'),
      servicePresent: Boolean(service),
      serviceLooksJwt: service.startsWith('eyJ'),
      serviceLooksSecret: service.startsWith('sb_secret_'),
      migrationFile: 'supabase/migrations/001_commercial_rls.sql',
      adminPage: '/admin',
    },
    null,
    2,
  ),
);

if (!url || !service) {
  console.error('\nFAIL: need NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in .env.local');
  process.exit(1);
}

if (!anon) {
  console.warn(
    '\nWARN: NEXT_PUBLIC_SUPABASE_ANON_KEY empty — lấy Publishable/anon key trong Supabase → Settings → API Keys.',
  );
}

// Probe REST
async function probe(key, label) {
  if (!key) return { label, skipped: true };
  try {
    const res = await fetch(`${url}/rest/v1/profiles?select=id&limit=1`, {
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
      },
    });
    const text = await res.text();
    return {
      label,
      status: res.status,
      ok: res.ok || res.status === 200 || res.status === 206,
      bodyPreview: text.slice(0, 160),
    };
  } catch (e) {
    return { label, error: e instanceof Error ? e.message : String(e) };
  }
}

const results = {
  service: await probe(service, 'service/secret'),
  anon: await probe(anon, 'anon/publishable'),
};
console.log('\nProbes:', JSON.stringify(results, null, 2));

if (results.service.status === 401 || results.service.status === 403) {
  console.error(`
FAIL auth với secret key.

Supabase dashboard:
1) Publishable / anon  → NEXT_PUBLIC_SUPABASE_ANON_KEY
2) Secret / service_role JWT (eyJ...) hoặc sb_secret_ → SUPABASE_SERVICE_ROLE_KEY

Nếu sb_secret_… bị 401: copy **service_role** (legacy JWT) từ Settings → API.

SQL: dán supabase/migrations/001_commercial_rls.sql vào SQL Editor → Run.
`);
  process.exit(2);
}

// 404 PGRST205 = auth OK, table not migrated yet
const authOk =
  results.service.ok ||
  results.service.status === 404 ||
  results.service.status === 200 ||
  results.service.status === 206 ||
  (typeof results.service.bodyPreview === 'string' &&
    results.service.bodyPreview.includes('PGRST205'));

if (authOk) {
  const needsMigration =
    results.service.status === 404 ||
    (typeof results.service.bodyPreview === 'string' &&
      results.service.bodyPreview.includes('PGRST205'));
  console.log(`
OK Supabase API auth (HTTP ${results.service.status}).
${needsMigration ? '→ Bảng chưa có: chạy SQL migration trong Dashboard.' : '→ Bảng profiles đã thấy.'}

NEXT:
1) Supabase → SQL Editor → paste file supabase/migrations/001_commercial_rls.sql → Run
2) (Khuyến nghị) Settings → API Keys → copy Publishable/anon vào NEXT_PUBLIC_SUPABASE_ANON_KEY trong .env.local
3) Auth → Users → tạo user admin → SQL:
   update public.profiles set role = 'admin' where email = 'BAN@EMAIL.com';
4) npm run dev → http://localhost:3000/admin
5) Dán AINOVEL_ENTITLEMENT_ADMIN_KEY (trong .env.local) vào form admin
`);
  process.exit(needsMigration ? 0 : 0);
}

console.error('Unexpected probe result — xem Probes ở trên.');
process.exit(1);
