/**
 * Backfill licenses.user_id = hwid (mã thiết bị).
 * Requires SERVICE_ROLE. Run AFTER migration 003 (user_id text).
 *
 *   npx tsx scripts/backfill-license-user-id-device.mts
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

const { isSupabaseAdminConfigured } = await import('../src/lib/supabase/env.ts');
const { createServiceSupabase } = await import('../src/lib/supabase/server.ts');
const { licenseDeviceUserId } = await import('../src/lib/cloud/licenseBridge.ts');

if (!isSupabaseAdminConfigured()) {
  console.error('Need SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const s = createServiceSupabase();
const { data: rows, error } = await s
  .from('licenses')
  .select('id,user_id,hwid,plan,status')
  .order('created_at', { ascending: false })
  .limit(500);

if (error) {
  console.error('select fail:', error.message);
  console.error(
    'If error is uuid/type: run supabase/migrations/003_licenses_user_id_device.sql in SQL Editor first.',
  );
  process.exit(1);
}

let updated = 0;
let skipped = 0;
for (const r of rows || []) {
  const device = licenseDeviceUserId(String(r.hwid || ''));
  if (!device || device.length < 6) {
    skipped++;
    continue;
  }
  const cur = r.user_id == null ? '' : String(r.user_id).trim().toLowerCase();
  if (cur === device) {
    skipped++;
    continue;
  }
  const { error: upErr } = await s
    .from('licenses')
    .update({ user_id: device })
    .eq('id', r.id);
  if (upErr) {
    console.error('update fail', r.id, upErr.message);
    console.error(
      '→ Chạy migration 003 (drop FK + user_id text) trong Supabase SQL Editor rồi chạy lại script.',
    );
    process.exit(1);
  }
  updated++;
  console.log('updated', r.id, { plan: r.plan, status: r.status, user_id: device });
}

console.log(JSON.stringify({ ok: true, updated, skipped, total: (rows || []).length }));
