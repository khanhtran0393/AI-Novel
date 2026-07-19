/** Delete one exact cloud Pro row created by the protected release smoke. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function arg(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? String(process.argv[index + 1] || '').trim() : '';
}

function loadEnvFile(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return {};
  const out = {};
  for (const line of fs.readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const value = line.trim();
    if (!value || value.startsWith('#')) continue;
    const equals = value.indexOf('=');
    if (equals <= 0) continue;
    const key = value.slice(0, equals).trim();
    let content = value.slice(equals + 1).trim();
    if (
      (content.startsWith('"') && content.endsWith('"')) ||
      (content.startsWith("'") && content.endsWith("'"))
    ) {
      content = content.slice(1, -1);
    }
    if (key) out[key] = content;
  }
  return out;
}

const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
const sellerEnv =
  process.env.AINOVEL_SELLER_ENV_FILE ||
  path.join(localAppData, 'AI Novel Seller', '.env.seller');
const env = {
  ...loadEnvFile(path.join(root, '.env')),
  ...loadEnvFile(path.join(root, '.env.local')),
  ...loadEnvFile(sellerEnv),
  ...process.env,
};

const hwid = arg('hwid').toLowerCase();
const licenseId = arg('license-id').toLowerCase();
if (!/^[a-f0-9]{16}$/.test(hwid)) {
  throw new Error('--hwid must be the exact 16-hex release-runner HWID');
}
if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(licenseId)) {
  throw new Error('--license-id must be the exact UUID returned by cloud issue');
}
if (!process.argv.includes('--confirm-release-qa')) {
  throw new Error('--confirm-release-qa is required');
}

const supabaseUrl = String(env.NEXT_PUBLIC_SUPABASE_URL || env.SUPABASE_URL || '').trim();
const serviceKey = String(env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
if (!supabaseUrl || !serviceKey) {
  throw new Error('Supabase URL and service-role key are required');
}

const client = createClient(supabaseUrl, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const { data: row, error: selectError } = await client
  .from('licenses')
  .select('id,hwid,plan,status')
  .eq('id', licenseId)
  .eq('hwid', hwid)
  .eq('plan', 'pro')
  .maybeSingle();
if (selectError) throw selectError;
if (!row) {
  throw new Error('Exact release QA Pro row was not found; refusing broad cleanup');
}

if (process.argv.includes('--dry-run')) {
  console.log(JSON.stringify({ ok: true, dryRun: true, row }));
} else {
  const { error: deleteError } = await client
    .from('licenses')
    .delete()
    .eq('id', licenseId)
    .eq('hwid', hwid)
    .eq('plan', 'pro');
  if (deleteError) throw deleteError;

  const { data: remaining, error: verifyError } = await client
    .from('licenses')
    .select('id')
    .eq('id', licenseId)
    .maybeSingle();
  if (verifyError) throw verifyError;
  if (remaining) throw new Error('Release QA Pro cleanup did not remove the exact row');

  console.log(JSON.stringify({ ok: true, hwid, deletedProLicenseId: licenseId }));
}
