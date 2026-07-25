/**
 * One-shot: inspect + heal licenses row for a HWID.
 * - List active rows
 * - Optionally re-bind token_hash from AINOVEL2 token (min exp with ledger)
 * - Retire local trial
 *
 *   npx tsx scripts/_heal-license-ledger.mts --hwid <id>
 *   npx tsx scripts/_heal-license-ledger.mts --hwid <id> --token "AINOVEL2...."
 *   npx tsx scripts/_heal-license-ledger.mts --hwid <id> --from-status  (uses running :3000 token header if any)
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function loadEnv(p: string) {
  if (!fs.existsSync(p)) return;
  for (const line of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('=');
    if (i <= 0) continue;
    let k = t.slice(0, i).trim();
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
loadEnv(path.join(root, '.env'));
loadEnv(path.join(root, '.env.local'));

function arg(name: string, fallback = ''): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] || fallback : fallback;
}
const hasFlag = (name: string) => process.argv.includes(`--${name}`);

function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token, 'utf8').digest('hex');
}

function decodeAinovel2Exp(token: string): number | null {
  const parts = token.split('.');
  if (parts.length !== 4 || parts[0] !== 'AINOVEL2') return null;
  try {
    const json = Buffer.from(
      parts[2].replace(/-/g, '+').replace(/_/g, '/'),
      'base64',
    ).toString('utf8');
    const payload = JSON.parse(json) as { exp?: number };
    return typeof payload.exp === 'number' ? payload.exp : null;
  } catch {
    return null;
  }
}

/** Try find token in novel_store_backup / level hints */
function findLocalToken(): string | null {
  const candidates = [
    path.join(
      process.env.APPDATA || '',
      'ai-novel-script-generator',
      'novel_store_backup.json',
    ),
    path.join(
      process.env.APPDATA || '',
      'ai-novel-script-generator',
      'store',
      'latest.json',
    ),
  ];
  for (const p of candidates) {
    if (!p || !fs.existsSync(p)) continue;
    try {
      const raw = fs.readFileSync(p, 'utf8');
      const m = raw.match(
        /AINOVEL2\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/,
      );
      if (m) return m[0];
    } catch {
      /* ignore */
    }
  }
  // Local Storage is Chromium binary — skip
  return null;
}

async function main() {
  const url =
    process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || '';
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
  if (!url || !key) {
    console.error(JSON.stringify({ ok: false, error: 'Missing Supabase env' }));
    process.exit(1);
  }

  let hwid = arg('hwid').trim().toLowerCase();
  if (!hwid) {
    try {
      const r = await fetch('http://127.0.0.1:3000/api/entitlement/hwid', {
        signal: AbortSignal.timeout(5000),
      });
      const j = (await r.json()) as { hwid?: string };
      hwid = String(j.hwid || '')
        .trim()
        .toLowerCase();
    } catch {
      /* ignore */
    }
  }
  if (hwid.length < 8) {
    console.error(JSON.stringify({ ok: false, error: 'Need --hwid' }));
    process.exit(1);
  }

  let token = arg('token').trim();
  if (!token) token = findLocalToken() || '';

  const sb = createClient(url, key, { auth: { persistSession: false } });
  const { data: rows, error } = await sb
    .from('licenses')
    .select('id,status,plan,exp_at,hwid,token_hash,created_at')
    .ilike('hwid', hwid)
    .order('created_at', { ascending: false })
    .limit(20);
  if (error) {
    console.error(JSON.stringify({ ok: false, error: error.message }));
    process.exit(1);
  }

  const list = (rows || []).map((r) => ({
    id: r.id,
    status: r.status,
    plan: r.plan,
    exp_at: r.exp_at,
    token_hash12: r.token_hash ? String(r.token_hash).slice(0, 12) : null,
    created_at: r.created_at,
  }));
  console.log(
    JSON.stringify(
      {
        ok: true,
        phase: 'inspect',
        hwid,
        count: list.length,
        rows: list,
        hasLocalToken: Boolean(token),
        localTokenHash12: token ? hashToken(token).slice(0, 12) : null,
        localTokenExp: token ? decodeAinovel2Exp(token) : null,
      },
      null,
      2,
    ),
  );

  const active = (rows || []).filter((r) => r.status === 'active');
  const primary = active[0];
  if (!primary?.id) {
    console.log(JSON.stringify({ ok: false, phase: 'heal', error: 'no active row' }));
    process.exit(2);
  }

  if (!token) {
    console.log(
      JSON.stringify({
        ok: true,
        phase: 'heal',
        skipped: true,
        reason: 'No AINOVEL2 token found locally; pass --token to rebind hash',
        licenseId: primary.id,
        ledgerExp: primary.exp_at,
      }),
    );
    process.exit(0);
  }

  const th = hashToken(token);
  const tokenExp = decodeAinovel2Exp(token);
  const ledgerExpMs = primary.exp_at
    ? new Date(primary.exp_at).getTime()
    : NaN;
  const tokenExpMs = tokenExp ? tokenExp * 1000 : NaN;
  const boundExpMs =
    Number.isFinite(ledgerExpMs) && Number.isFinite(tokenExpMs)
      ? Math.min(ledgerExpMs, tokenExpMs)
      : Number.isFinite(ledgerExpMs)
        ? ledgerExpMs
        : tokenExpMs;
  const expAt = new Date(boundExpMs).toISOString();
  const alreadyMatch =
    primary.token_hash === th &&
    Math.abs(new Date(primary.exp_at).getTime() - boundExpMs) < 5000;

  if (alreadyMatch && !hasFlag('force')) {
    console.log(
      JSON.stringify({
        ok: true,
        phase: 'heal',
        alreadyAligned: true,
        licenseId: primary.id,
        token_hash12: th.slice(0, 12),
        exp_at: primary.exp_at,
      }),
    );
    process.exit(0);
  }

  // Expire extra active trial rows
  const others = active
    .filter((r) => r.id !== primary.id && (r.plan === 'trial' || !r.plan))
    .map((r) => r.id);
  if (others.length) {
    await sb.from('licenses').update({ status: 'expired' }).in('id', others);
  }

  const { error: upErr } = await sb
    .from('licenses')
    .update({
      token_hash: th,
      exp_at: expAt,
      plan: 'pro',
      status: 'active',
      hwid: hwid,
    })
    .eq('id', primary.id);
  if (upErr) {
    console.error(
      JSON.stringify({ ok: false, phase: 'heal', error: upErr.message }),
    );
    process.exit(1);
  }

  // Retire local trial vault file if present
  const trialPath = path.join(
    process.env.APPDATA || '',
    'ai-novel-script-generator',
    '.ainovel-license',
    'trials.json',
  );
  let trialRetired = false;
  if (fs.existsSync(trialPath)) {
    try {
      const vault = JSON.parse(fs.readFileSync(trialPath, 'utf8')) as {
        trials?: Record<string, { endsAt?: number; startedAt?: number }>;
      };
      const rec = vault.trials?.[hwid];
      if (rec && (rec.endsAt || 0) > Math.floor(Date.now() / 1000)) {
        rec.endsAt = Math.floor(Date.now() / 1000) - 1;
        vault.trials![hwid] = rec;
        fs.writeFileSync(trialPath, JSON.stringify(vault, null, 2), 'utf8');
        trialRetired = true;
      }
    } catch {
      /* ignore */
    }
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        phase: 'heal',
        licenseId: primary.id,
        token_hash12: th.slice(0, 12),
        exp_at: expAt,
        expiredOtherRows: others.length,
        trialRetired,
      },
      null,
      2,
    ),
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
