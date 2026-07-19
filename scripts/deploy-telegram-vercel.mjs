/**
 * Deploy commercial Telegram webhook surface to Vercel + setWebhook.
 *
 * Usage:
 *   node scripts/deploy-telegram-vercel.mjs
 *
 * Reads secrets from .env.local (never prints values).
 * Requires: vercel CLI logged in.
 */
import { spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

function loadEnvFile(name) {
  const p = path.join(root, name);
  const out = {};
  if (!fs.existsSync(p)) return out;
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
    if (v === '') continue;
    out[t.slice(0, i).trim()] = v;
  }
  return out;
}

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, {
    cwd: root,
    encoding: 'utf8',
    shell: true,
    env: { ...process.env, ...opts.env },
    input: opts.input,
    maxBuffer: 20 * 1024 * 1024,
  });
  return r;
}

function log(step, msg) {
  console.log(`[${step}] ${msg}`);
}

const env = {
  ...process.env,
  ...loadEnvFile('.env'),
  ...loadEnvFile('.env.local'),
};

const privateKeyB64 = (() => {
  if (env.AINOVEL_ENTITLEMENT_PRIVATE_KEY_B64) {
    return env.AINOVEL_ENTITLEMENT_PRIVATE_KEY_B64;
  }
  const file = env.AINOVEL_ENTITLEMENT_PRIVATE_KEY_FILE;
  if (file && fs.existsSync(file)) {
    return fs.readFileSync(file).toString('base64');
  }
  return '';
})();

const required = [
  'AINOVEL_ENTITLEMENT_ADMIN_KEY',
  'AINOVEL_TELEGRAM_BOT_TOKEN',
  'AINOVEL_TELEGRAM_CHAT_ID',
];
for (const k of required) {
  if (!env[k]) {
    console.error(`Missing ${k} in .env.local`);
    process.exit(1);
  }
}
if (!privateKeyB64) {
  console.error('Missing Ed25519 private key (B64 or FILE)');
  process.exit(1);
}

const projectName = process.env.AINOVEL_VERCEL_PROJECT || 'ai-novel';
const envsToSet = {
  AINOVEL_ENTITLEMENT_MODE: env.AINOVEL_ENTITLEMENT_MODE || 'enforce',
  // entitlement.ts accepts base64 PKCS#8 through the standard private-key env.
  AINOVEL_ENTITLEMENT_PRIVATE_KEY: privateKeyB64,
  AINOVEL_ENTITLEMENT_ADMIN_KEY: env.AINOVEL_ENTITLEMENT_ADMIN_KEY,
  AINOVEL_PAYMENT_WEBHOOK_SECRET: env.AINOVEL_PAYMENT_WEBHOOK_SECRET || '',
  AINOVEL_TELEGRAM_BOT_TOKEN: env.AINOVEL_TELEGRAM_BOT_TOKEN,
  AINOVEL_TELEGRAM_CHAT_ID: env.AINOVEL_TELEGRAM_CHAT_ID,
  AINOVEL_TELEGRAM_WEBHOOK_SECRET: env.AINOVEL_TELEGRAM_WEBHOOK_SECRET || '',
  AINOVEL_TRIAL_ENABLED: env.AINOVEL_TRIAL_ENABLED || '1',
  AINOVEL_TRIAL_DAYS: env.AINOVEL_TRIAL_DAYS || '3',
  NEXT_PUBLIC_SUPABASE_URL:
    env.NEXT_PUBLIC_SUPABASE_URL || env.SUPABASE_URL || '',
  SUPABASE_URL: env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL || '',
  SUPABASE_SERVICE_ROLE_KEY: env.SUPABASE_SERVICE_ROLE_KEY || '',
  NEXT_PUBLIC_SUPABASE_ANON_KEY:
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY || env.SUPABASE_ANON_KEY || '',
};

// 1) Link project (non-interactive)
log('link', `project=${projectName}`);
const link = run('vercel', [
  'link',
  '--yes',
  '--project',
  projectName,
]);
if (link.status !== 0) {
  // try create via deploy first-time
  log('link', `warn: ${ (link.stderr || link.stdout || '').slice(0, 400)}`);
}

// 2) Upsert env vars for production + preview
function upsertEnv(key, value, target) {
  if (!value) {
    log('env', `skip empty ${key}`);
    return true;
  }
  // Remove existing to avoid interactive conflict
  run('vercel', ['env', 'rm', key, target, '--yes']);
  const add = run('vercel', ['env', 'add', key, target, '--force'], {
    input: `${value}\n`,
  });
  // Older CLI: no --force, use stdin only
  if (add.status !== 0) {
    const add2 = run('vercel', ['env', 'add', key, target], {
      input: `${value}\n`,
    });
    if (add2.status !== 0) {
      log(
        'env',
        `FAIL ${key}@${target}: ${(add2.stderr || add2.stdout || '').slice(0, 200)}`,
      );
      return false;
    }
  }
  log('env', `set ${key}@${target} (len=${value.length})`);
  return true;
}

let envFails = 0;
for (const [k, v] of Object.entries(envsToSet)) {
  for (const target of ['production', 'preview']) {
    if (!upsertEnv(k, v, target)) envFails += 1;
  }
}

// 3) Deploy production
log('deploy', 'vercel --prod --yes …');
const deploy = run('vercel', ['deploy', '--prod', '--yes']);
const deployOut = `${deploy.stdout || ''}\n${deploy.stderr || ''}`;
fs.writeFileSync(
  path.join(root, 'scratch', 'vercel-deploy-last.log'),
  deployOut,
  'utf8',
);

if (deploy.status !== 0) {
  console.error('[deploy] FAILED — see scratch/vercel-deploy-last.log');
  console.error(deployOut.slice(-2000));
  process.exit(1);
}

// Extract production URL
const urlMatch =
  deployOut.match(/https:\/\/[a-z0-9-]+\.vercel\.app/gi) || [];
// Prefer project alias (shortest path without hash) or last Production
let prodUrl =
  urlMatch.find((u) => u.includes(projectName) && !u.includes('-git-')) ||
  urlMatch[urlMatch.length - 1];

// Also check .vercel/project.json + inspect
const inspect = run('vercel', ['ls', projectName]);
const inspectOut = `${inspect.stdout || ''}\n${inspect.stderr || ''}`;
const urls2 = inspectOut.match(/https:\/\/[a-z0-9.-]+\.vercel\.app/gi) || [];
if (urls2.length) {
  prodUrl =
    urls2.find((u) => u === `https://${projectName}.vercel.app`) ||
    urls2[0] ||
    prodUrl;
}

// Common alias
const aliasCandidates = [
  `https://${projectName}.vercel.app`,
  prodUrl,
].filter(Boolean);

log('deploy', `candidate urls: ${aliasCandidates.join(', ')}`);

// 4) setWebhook via Telegram API (direct — works even if GET setup route cold)
async function setWebhook(baseUrl) {
  const token = envsToSet.AINOVEL_TELEGRAM_BOT_TOKEN;
  const secret = envsToSet.AINOVEL_TELEGRAM_WEBHOOK_SECRET;
  const webhookUrl = `${baseUrl.replace(/\/$/, '')}/api/entitlement/telegram-webhook`;
  const body = {
    url: webhookUrl,
    allowed_updates: ['callback_query', 'message'],
    drop_pending_updates: false,
  };
  if (secret) body.secret_token = secret;

  const res = await fetch(
    `https://api.telegram.org/bot${token}/setWebhook`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(20_000),
    },
  );
  const data = await res.json().catch(() => ({}));
  return { webhookUrl, data, ok: Boolean(data.ok) };
}

async function getWebhookInfo() {
  const token = envsToSet.AINOVEL_TELEGRAM_BOT_TOKEN;
  const res = await fetch(
    `https://api.telegram.org/bot${token}/getWebhookInfo`,
    { signal: AbortSignal.timeout(15_000) },
  );
  return res.json();
}

async function probeHealth(base) {
  try {
    const r = await fetch(
      `${base.replace(/\/$/, '')}/api/entitlement/telegram-webhook`,
      { signal: AbortSignal.timeout(20_000) },
    );
    const j = await r.json().catch(() => ({}));
    return { status: r.status, body: j };
  } catch (e) {
    return { status: 0, error: e instanceof Error ? e.message : String(e) };
  }
}

const main = async () => {
  // Prefer stable alias
  let base = `https://${projectName}.vercel.app`;
  let health = await probeHealth(base);
  if (health.status === 0 || health.status >= 500) {
    for (const c of aliasCandidates) {
      health = await probeHealth(c);
      log('probe', `${c} → ${health.status}`);
      if (health.status && health.status < 500) {
        base = c;
        break;
      }
    }
  } else {
    log('probe', `${base} → ${health.status}`);
  }

  // Also try setup endpoint (needs env on server)
  try {
    const setupUrl = `${base}/api/entitlement/telegram-webhook?setup=true&url=${encodeURIComponent(base)}`;
    const sr = await fetch(setupUrl, { signal: AbortSignal.timeout(30_000) });
    const sj = await sr.json().catch(() => ({}));
    log('setup-route', `HTTP ${sr.status} ok=${sj.ok} err=${sj.error || ''}`);
  } catch (e) {
    log('setup-route', e instanceof Error ? e.message : String(e));
  }

  const wh = await setWebhook(base);
  log(
    'setWebhook',
    `ok=${wh.ok} url=${wh.webhookUrl} desc=${wh.data?.description || ''}`,
  );

  const info = await getWebhookInfo();
  const url = info?.result?.url || '';
  log('getWebhookInfo', `url=${url} pending=${info?.result?.pending_update_count}`);

  // Save public result (no secrets)
  const summary = {
    ok: Boolean(wh.ok && url),
    project: projectName,
    baseUrl: base,
    webhookUrl: wh.webhookUrl,
    telegramWebhook: url,
    envFails,
    healthStatus: health.status,
    at: new Date().toISOString(),
  };
  fs.mkdirSync(path.join(root, 'scratch'), { recursive: true });
  fs.writeFileSync(
    path.join(root, 'scratch', 'telegram-webhook-status.json'),
    JSON.stringify(summary, null, 2),
    'utf8',
  );
  console.log(JSON.stringify(summary, null, 2));
  if (!summary.ok) process.exit(2);
};

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
