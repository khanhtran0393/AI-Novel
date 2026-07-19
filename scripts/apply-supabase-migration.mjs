/**
 * Apply every SQL migration in supabase/migrations, in lexical order.
 *
 * Option A — Management API (recommended):
 *   SUPABASE_ACCESS_TOKEN = token từ https://supabase.com/dashboard/account/tokens
 *   SUPABASE_PROJECT_REF = azlizrbjkqcyqnsmuccv (optional)
 *
 * Option B — Direct Postgres:
 *   DATABASE_URL = postgresql://postgres.[ref]:[PASSWORD]@...pooler.supabase.com:6543/postgres
 *
 * Never commit tokens. Put them only in .env.local
 *
 * Usage: node scripts/apply-supabase-migration.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const migrationsDir = path.join(root, 'supabase', 'migrations');
const migrationPaths = fs
  .readdirSync(migrationsDir)
  .filter((name) => name.toLowerCase().endsWith('.sql'))
  .sort((a, b) => a.localeCompare(b))
  .map((name) => path.join(migrationsDir, name));
if (migrationPaths.length === 0) {
  throw new Error(`No SQL migrations found in ${migrationsDir}`);
}

function loadEnvFile(name) {
  const p = path.join(root, name);
  if (!fs.existsSync(p)) return {};
  const out = {};
  for (const line of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('=');
    if (i <= 0) continue;
    let v = t.slice(i + 1).trim();
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1);
    }
    out[t.slice(0, i).trim()] = v;
  }
  return out;
}

const env = {
  ...process.env,
  ...loadEnvFile('.env'),
  ...loadEnvFile('.env.local'),
};

const sql = migrationPaths
  .map((migrationPath) =>
    `-- BEGIN ${path.basename(migrationPath)}\n${fs.readFileSync(migrationPath, 'utf8')}\n-- END ${path.basename(migrationPath)}`,
  )
  .join('\n\n');
const projectRef =
  (env.SUPABASE_PROJECT_REF || '').trim() ||
  (() => {
    const u = (env.NEXT_PUBLIC_SUPABASE_URL || env.SUPABASE_URL || '').trim();
    try {
      const host = new URL(u).hostname; // xxx.supabase.co
      return host.split('.')[0] || '';
    } catch {
      return 'azlizrbjkqcyqnsmuccv';
    }
  })();

const accessToken = (env.SUPABASE_ACCESS_TOKEN || '').trim();
const databaseUrl = (env.DATABASE_URL || env.SUPABASE_DB_URL || '').trim();
const serviceKey = (env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
const supabaseUrl = (
  env.NEXT_PUBLIC_SUPABASE_URL ||
  env.SUPABASE_URL ||
  ''
).trim();

async function applyViaManagementApi() {
  if (!accessToken) return null;
  console.log('Applying via Supabase Management API…');
  const res = await fetch(
    `https://api.supabase.com/v1/projects/${projectRef}/database/query`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query: sql }),
    },
  );
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Management API ${res.status}: ${text.slice(0, 500)}`);
  }
  console.log('Management API OK:', text.slice(0, 300));
  return true;
}

async function applyViaPg() {
  if (!databaseUrl) return null;
  console.log('Applying via DATABASE_URL (pg)…');
  let pg;
  try {
    pg = await import('pg');
  } catch {
    console.log('Installing pg…');
    const { execSync } = await import('child_process');
    execSync('npm install pg --no-save', { cwd: root, stdio: 'inherit' });
    pg = await import('pg');
  }
  const client = new pg.default.Client({
    connectionString: databaseUrl,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();
  try {
    await client.query(sql);
    console.log('Postgres apply OK');
  } finally {
    await client.end();
  }
  return true;
}

async function verifyRest() {
  if (!supabaseUrl || !serviceKey) {
    console.warn('Skip REST verify (no URL/service key)');
    return false;
  }
  const res = await fetch(`${supabaseUrl}/rest/v1/profiles?select=id&limit=1`, {
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
    },
  });
  const text = await res.text();
  const ok =
    res.ok ||
    res.status === 200 ||
    res.status === 206 ||
    (res.status === 200 && text.startsWith('['));
  // empty array 200 is success; PGRST205 means still missing
  if (text.includes('PGRST205')) {
    console.error('Verify FAIL: profiles still missing');
    return false;
  }
  if (res.status === 401 || res.status === 403) {
    console.error('Verify FAIL auth:', text.slice(0, 200));
    return false;
  }
  console.log('Verify REST profiles:', res.status, text.slice(0, 120));
  return res.status < 500;
}

async function main() {
  console.log(
    JSON.stringify(
      {
        projectRef,
        migrations: migrationPaths.map((migrationPath) => path.basename(migrationPath)),
        migrationBytes: sql.length,
        hasAccessToken: Boolean(accessToken),
        hasDatabaseUrl: Boolean(databaseUrl),
        hasServiceKey: Boolean(serviceKey),
      },
      null,
      2,
    ),
  );

  let applied = false;
  try {
    applied = (await applyViaManagementApi()) || applied;
  } catch (e) {
    console.error('Management API:', e instanceof Error ? e.message : e);
  }
  if (!applied) {
    try {
      applied = (await applyViaPg()) || applied;
    } catch (e) {
      console.error('Postgres:', e instanceof Error ? e.message : e);
    }
  }

  if (!applied) {
    console.error(`
Chưa apply được SQL từ máy này (thiếu SUPABASE_ACCESS_TOKEN hoặc DATABASE_URL).

Cách 1 — nhanh (Dashboard):
  1. Mở SQL Editor (đã copy sẵn nội dung migration nếu script clipboard chạy)
  2. Paste + Run file 001_commercial_rls.sql

Cách 2 — token account (để agent chạy giúp):
  https://supabase.com/dashboard/account/tokens
  Tạo token → ghi vào .env.local:
    SUPABASE_ACCESS_TOKEN=sbp_...
  Rồi: node scripts/apply-supabase-migration.mjs

Cách 3 — database password:
  Settings → Database → Connection string (URI)
  Ghi vào .env.local:
    DATABASE_URL=postgresql://...
  Rồi chạy lại script này.
`);
    process.exit(2);
  }

  const ok = await verifyRest();
  process.exit(ok ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
