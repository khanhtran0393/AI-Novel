/**
 * Seller CLI: issue activation codes (local vault) or print curl for HMAC token.
 *
 * Usage:
 *   node scripts/issue-license.mjs --plan pro --count 1
 *   node scripts/issue-license.mjs --plan vip --count 5 --note "promo"
 *   node scripts/issue-license.mjs --token --hwid abc123 --expDays 365
 *
 * Requires env (enforce): AINOVEL_ENTITLEMENT_SECRET, AINOVEL_ENTITLEMENT_ADMIN_KEY
 * For --token mode uses HMAC directly (same secret).
 */
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  if (i >= 0 && process.argv[i + 1]) return process.argv[i + 1];
  return fallback;
}

function hasFlag(name) {
  return process.argv.includes(`--${name}`);
}

function b64url(buf) {
  return buf
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function segment() {
  return crypto.randomBytes(3).toString('hex').toUpperCase().slice(0, 4);
}

function genCode() {
  return `AINOVEL-${segment()}-${segment()}-${segment()}`;
}

const plan = (arg('plan', 'pro') || 'pro').toLowerCase() === 'vip' ? 'vip' : 'pro';
const count = Math.max(1, Math.min(100, Number(arg('count', '1')) || 1));
const note = arg('note', '');
const expDays = Math.max(1, Number(arg('expDays', '365')) || 365);
const expSeconds = expDays * 86400;

if (hasFlag('token')) {
  const secret =
    process.env.AINOVEL_ENTITLEMENT_SECRET ||
    process.env.ENTITLEMENT_SECRET ||
    '';
  if (!secret || secret.length < 24) {
    console.error('Need strong AINOVEL_ENTITLEMENT_SECRET for --token');
    process.exit(1);
  }
  const hwid = (arg('hwid', '') || '').toLowerCase();
  if (!hwid) {
    console.error('--token requires --hwid');
    process.exit(1);
  }
  const payload = {
    is_pro: true,
    is_vip: plan === 'vip',
    exp: Math.floor(Date.now() / 1000) + expSeconds,
    hwid,
  };
  const body = b64url(Buffer.from(JSON.stringify(payload), 'utf8'));
  const sig = b64url(
    crypto.createHmac('sha256', secret).update(body).digest(),
  );
  const token = `${body}.${sig}`;
  console.log(JSON.stringify({ ok: true, kind: 'token', plan, hwid, token }, null, 2));
  process.exit(0);
}

// Code vault mode
// Skip auto-write when --dry-run; otherwise write vault (seller machine only)
const dataRoot = process.env.AINOVEL_DATA_ROOT || root;
const vaultPath = path.join(dataRoot, 'data', 'licenses', 'activation-codes.json');
fs.mkdirSync(path.dirname(vaultPath), { recursive: true });
let vault = { version: 1, codes: {} };
if (fs.existsSync(vaultPath)) {
  try {
    vault = JSON.parse(fs.readFileSync(vaultPath, 'utf8'));
  } catch {
    vault = { version: 1, codes: {} };
  }
}
if (!vault.codes) vault.codes = {};

const created = [];
for (let i = 0; i < count; i++) {
  let code = genCode();
  while (vault.codes[code]) code = genCode();
  const rec = {
    code,
    plan,
    expSeconds,
    createdAt: Math.floor(Date.now() / 1000),
    note: note || undefined,
  };
  vault.codes[code] = rec;
  created.push(rec);
}
if (!hasFlag('dry-run')) {
  fs.writeFileSync(vaultPath, JSON.stringify(vault, null, 2), 'utf8');
}
console.log(
  JSON.stringify(
    {
      ok: true,
      kind: 'codes',
      vault: hasFlag('dry-run') ? null : vaultPath,
      dryRun: hasFlag('dry-run'),
      count: created.length,
      codes: created.map((c) => c.code),
      plan,
      expDays,
    },
    null,
    2,
  ),
);
