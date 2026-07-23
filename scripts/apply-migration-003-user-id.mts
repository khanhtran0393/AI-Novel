/**
 * Apply ONLY 003_licenses_user_id_device.sql then backfill user_id=hwid.
 * Needs SUPABASE_ACCESS_TOKEN or DATABASE_URL in .env.local
 *
 *   npx tsx scripts/apply-migration-003-user-id.mts
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawnSync } from 'child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sqlPath = path.join(
  root,
  'supabase',
  'migrations',
  '003_licenses_user_id_device.sql',
);

function loadEnv() {
  const out: Record<string, string> = { ...process.env } as Record<string, string>;
  for (const name of ['.env', '.env.local']) {
    const p = path.join(root, name);
    if (!fs.existsSync(p)) continue;
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
      out[t.slice(0, i).trim()] = v;
    }
  }
  return out;
}

const env = loadEnv();
const sql = fs.readFileSync(sqlPath, 'utf8');
const projectRef =
  (env.SUPABASE_PROJECT_REF || '').trim() ||
  (() => {
    try {
      return new URL(env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL || '')
        .hostname.split('.')[0];
    } catch {
      return 'azlizrbjkqcyqnsmuccv';
    }
  })();
const accessToken = (env.SUPABASE_ACCESS_TOKEN || '').trim();
const databaseUrl = (env.DATABASE_URL || env.SUPABASE_DB_URL || '').trim();

console.log('SQL file:', sqlPath);
console.log('projectRef:', projectRef);
console.log('hasAccessToken:', Boolean(accessToken));
console.log('hasDatabaseUrl:', Boolean(databaseUrl));

if (!accessToken && !databaseUrl) {
  console.log('\n--- COPY THIS SQL INTO Supabase SQL Editor ---\n');
  console.log(sql);
  console.log('\n--- END SQL ---\n');
  console.log(
    'Then: npx tsx scripts/backfill-license-user-id-device.mts',
  );
  process.exit(2);
}

if (accessToken) {
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
    console.error('Management API fail', res.status, text.slice(0, 600));
    process.exit(1);
  }
  console.log('Migration 003 OK via Management API');
} else if (databaseUrl) {
  const r = spawnSync(
    process.execPath,
    [
      '-e',
      `
      const { Client } = require('pg');
      const c = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
      c.connect().then(() => c.query(process.env.SQL)).then(() => c.end()).catch((e) => { console.error(e); process.exit(1); });
      `,
    ],
    {
      cwd: root,
      env: { ...process.env, DATABASE_URL: databaseUrl, SQL: sql },
      encoding: 'utf8',
    },
  );
  if (r.status !== 0) {
    console.error(r.stderr || r.stdout);
    process.exit(1);
  }
  console.log('Migration 003 OK via DATABASE_URL');
}

const back = spawnSync(
  process.execPath,
  ['--import', 'tsx', path.join(root, 'scripts/backfill-license-user-id-device.mts')],
  { cwd: root, encoding: 'utf8', env: process.env },
);
// prefer npx tsx
const back2 = spawnSync('npx', ['tsx', 'scripts/backfill-license-user-id-device.mts'], {
  cwd: root,
  encoding: 'utf8',
  shell: true,
  env: process.env,
});
console.log(back2.stdout || '');
if (back2.status !== 0) {
  console.error(back2.stderr || '');
  process.exit(back2.status || 1);
}
