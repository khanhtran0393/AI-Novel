/**
 * Full commercial cloud bootstrap:
 * 1) Validate .env.local
 * 2) Apply SQL migration (ACCESS_TOKEN or DATABASE_URL)
 * 3) Verify tables
 * 4) Smoke issue HMAC + cloud status shape
 *
 * If migration cannot run remotely, exits 3 with SQL path — user Run once in Dashboard,
 * then re-run: npm run cloud:bootstrap
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync, spawn } from 'child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

function loadEnvFile(name) {
  const p = path.isAbsolute(name) ? name : path.join(root, name);
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
    )
      v = v.slice(1, -1);
    if (v === '') continue;
    out[t.slice(0, i).trim()] = v;
  }
  return out;
}

const env = {
  ...process.env,
  ...loadEnvFile('.env'),
  ...loadEnvFile('.env.local'),
};

const url = (env.NEXT_PUBLIC_SUPABASE_URL || env.SUPABASE_URL || '').trim();
const service = (env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
const accessToken = (env.SUPABASE_ACCESS_TOKEN || '').trim();
const databaseUrl = (env.DATABASE_URL || env.SUPABASE_DB_URL || '').trim();
const projectRef =
  (env.SUPABASE_PROJECT_REF || '').trim() ||
  (url ? new URL(url).hostname.split('.')[0] : 'azlizrbjkqcyqnsmuccv');

const migrationPath = path.join(
  root,
  'supabase',
  'migrations',
  '001_commercial_rls.sql',
);
const sql = fs.readFileSync(migrationPath, 'utf8');

function log(step, obj) {
  console.log(`[${step}]`, typeof obj === 'string' ? obj : JSON.stringify(obj));
}

async function restProfiles() {
  const r = await fetch(`${url}/rest/v1/profiles?select=id&limit=1`, {
    headers: { apikey: service, Authorization: `Bearer ${service}` },
  });
  const text = await r.text();
  return { status: r.status, text, missing: text.includes('PGRST205') };
}

async function applyMigration() {
  if (accessToken) {
    log('migrate', 'Management API…');
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
    if (!res.ok) throw new Error(`Management ${res.status}: ${text.slice(0, 400)}`);
    log('migrate', 'OK via Management API');
    return true;
  }
  if (databaseUrl) {
    log('migrate', 'Postgres URI…');
    let pg;
    try {
      pg = await import('pg');
    } catch {
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
    } finally {
      await client.end();
    }
    log('migrate', 'OK via DATABASE_URL');
    return true;
  }
  return false;
}

async function smokeIssue() {
  // Pure local HMAC via existing modules (tsx)
  const script = `
    import { issueEntitlementToken, verifyEntitlementToken, getHwid } from './src/lib/entitlement.ts';
    import { hashToken, issueHmacForPlan } from './src/lib/cloud/licenseBridge.ts';
    process.env.AINOVEL_ENTITLEMENT_MODE = process.env.AINOVEL_ENTITLEMENT_MODE || 'open';
    const hwid = getHwid();
    const { token } = issueHmacForPlan('month', hwid);
    const claims = verifyEntitlementToken(token, { requireHwidMatch: true });
    if (!claims?.is_pro) throw new Error('hmac fail');
    console.log(JSON.stringify({ hwid, tokenHash: hashToken(token).slice(0,12), exp: claims.exp }));
  `;
  const tmp = path.join(root, 'scratch', 'smoke-hmac-tmp.mts');
  fs.mkdirSync(path.dirname(tmp), { recursive: true });
  fs.writeFileSync(tmp, script, 'utf8');
  execSync(`npx tsx "${tmp}"`, {
    cwd: root,
    stdio: 'inherit',
    env: { ...process.env, ...env },
  });
}

function openSqlEditor() {
  try {
    if (process.platform === 'win32') {
      execSync(
        `powershell -NoProfile -Command "Set-Clipboard -Value ([IO.File]::ReadAllText('${migrationPath.replace(/'/g, "''")}')); Start-Process 'https://supabase.com/dashboard/project/${projectRef}/sql/new'"`,
        { stdio: 'inherit' },
      );
      log('ui', 'SQL copied + SQL Editor opened');
    }
  } catch (e) {
    log('ui', String(e));
  }
}

async function waitForTables(maxPolls = 60, ms = 5000) {
  for (let i = 1; i <= maxPolls; i++) {
    const p = await restProfiles();
    if (!p.missing && p.status !== 401 && p.status < 500) {
      log('wait', { ready: true, poll: i, status: p.status });
      return true;
    }
    log('wait', { poll: i, status: p.status, missing: p.missing });
    await new Promise((r) => setTimeout(r, ms));
  }
  return false;
}

async function main() {
  if (!url || !service) {
    console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local');
    process.exit(1);
  }
  log('env', {
    url: new URL(url).host,
    servicePrefix: service.slice(0, 10),
    hasAccessToken: Boolean(accessToken),
    hasDatabaseUrl: Boolean(databaseUrl),
    projectRef,
  });

  let probe = await restProfiles();
  log('probe', { status: probe.status, missing: probe.missing });

  if (probe.missing || probe.status === 404) {
    let applied = false;
    try {
      applied = await applyMigration();
    } catch (e) {
      log('migrate-error', e instanceof Error ? e.message : String(e));
    }
    if (!applied) {
      openSqlEditor();
      console.log(`
═══════════════════════════════════════════════════════════
  CẦN 1 THAO TÁC (15 giây) — agent không có quyền DDL:
  1) Cửa sổ Supabase SQL Editor đã mở
  2) Ctrl+V  (SQL đã copy sẵn)
  3) Bấm Run
  Agent đang chờ bảng profiles xuất hiện…
═══════════════════════════════════════════════════════════
`);
      const ok = await waitForTables(72, 5000); // 6 min
      if (!ok) {
        console.error(`
TIMEOUT. Để agent tự Run SQL, thêm vào .env.local (đừng chat):

  SUPABASE_ACCESS_TOKEN=sbp_...   # https://supabase.com/dashboard/account/tokens

hoặc

  DATABASE_URL=postgresql://postgres.${projectRef}:YOUR_DB_PASSWORD@...

Rồi: npm run cloud:bootstrap
`);
        process.exit(3);
      }
    } else {
      // brief wait for schema cache
      await new Promise((r) => setTimeout(r, 2000));
      probe = await restProfiles();
      if (probe.missing) {
        log('cache', 'reload wait…');
        await new Promise((r) => setTimeout(r, 3000));
        probe = await restProfiles();
      }
    }
  }

  probe = await restProfiles();
  if (probe.missing) {
    console.error('profiles still missing after apply', probe);
    process.exit(1);
  }
  log('tables', 'profiles OK');

  // list tables lightly
  for (const t of ['orders', 'licenses', 'devices', 'audit_logs']) {
    const r = await fetch(`${url}/rest/v1/${t}?select=id&limit=1`, {
      headers: { apikey: service, Authorization: `Bearer ${service}` },
    });
    const text = await r.text();
    log('table', { t, status: r.status, ok: !text.includes('PGRST205') });
  }

  await smokeIssue();

  const report = {
    ok: true,
    projectRef,
    tablesReady: true,
    adminUrl: 'http://localhost:3000/admin',
    next: [
      'npm run dev',
      'Open /admin — paste AINOVEL_ENTITLEMENT_ADMIN_KEY from .env.local',
      'Optional: set NEXT_PUBLIC_SUPABASE_ANON_KEY (publishable) for Auth UI',
      'Optional: update profiles set role=admin where email=...',
    ],
  };
  fs.mkdirSync(path.join(root, 'scratch'), { recursive: true });
  fs.writeFileSync(
    path.join(root, 'scratch', 'cloud-bootstrap-ok.json'),
    JSON.stringify(report, null, 2),
    'utf8',
  );
  console.log('\nBOOTSTRAP OK\n', JSON.stringify(report, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
