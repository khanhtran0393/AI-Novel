/**
 * Deploy slim Telegram bridge (deploy/telegram-bridge) to Vercel + setWebhook.
 *   node scripts/deploy-telegram-bridge.mjs
 */
import { spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const bridge = path.join(root, 'deploy', 'telegram-bridge');
const projectName = process.env.AINOVEL_TG_VERCEL_PROJECT || 'ainovel-telegram-bridge';

function loadEnv(name) {
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
    )
      v = v.slice(1, -1);
    if (v) out[t.slice(0, i).trim()] = v;
  }
  return out;
}

function run(cmd, args, opts = {}) {
  return spawnSync(cmd, args, {
    cwd: opts.cwd || bridge,
    encoding: 'utf8',
    shell: true,
    input: opts.input,
    env: { ...process.env, ...opts.env },
    maxBuffer: 20 * 1024 * 1024,
  });
}

function log(s, m) {
  console.log(`[${s}] ${m}`);
}

const env = { ...process.env, ...loadEnv('.env'), ...loadEnv('.env.local') };
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
  'AINOVEL_TELEGRAM_BOT_TOKEN',
  'AINOVEL_TELEGRAM_CHAT_ID',
];
for (const k of required) {
  if (!env[k]) {
    console.error(`Missing ${k}`);
    process.exit(1);
  }
}
if (!privateKeyB64) {
  console.error('Missing Ed25519 private key (B64 or FILE)');
  process.exit(1);
}

const supabaseUrl =
  env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseService = env.SUPABASE_SERVICE_ROLE_KEY || '';
if (!supabaseUrl || !supabaseService) {
  console.error(
    'Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY — bridge must write licenses or app rejects keys',
  );
  process.exit(1);
}

const envs = {
  AINOVEL_ENTITLEMENT_MODE: 'enforce',
  AINOVEL_ENTITLEMENT_PRIVATE_KEY_B64: privateKeyB64,
  AINOVEL_TELEGRAM_BOT_TOKEN: env.AINOVEL_TELEGRAM_BOT_TOKEN,
  AINOVEL_TELEGRAM_CHAT_ID: env.AINOVEL_TELEGRAM_CHAT_ID,
  AINOVEL_TELEGRAM_WEBHOOK_SECRET: env.AINOVEL_TELEGRAM_WEBHOOK_SECRET || '',
  // One-path ledger: Cấp Key must INSERT/UPDATE licenses for HWID
  SUPABASE_URL: supabaseUrl,
  NEXT_PUBLIC_SUPABASE_URL: supabaseUrl,
  SUPABASE_SERVICE_ROLE_KEY: supabaseService,
};

log('link', projectName);
run('vercel', ['link', '--yes', '--project', projectName]);

function upsert(key, value, target) {
  if (!value) return;
  run('vercel', ['env', 'rm', key, target, '--yes']);
  let r = run('vercel', ['env', 'add', key, target, '--force'], {
    input: `${value}\n`,
  });
  if (r.status !== 0) {
    r = run('vercel', ['env', 'add', key, target], { input: `${value}\n` });
  }
  log('env', `${key}@${target} status=${r.status}`);
}

for (const [k, v] of Object.entries(envs)) {
  upsert(k, v, 'production');
  upsert(k, v, 'preview');
}

log('deploy', 'prod…');
const deploy = run('vercel', ['deploy', '--prod', '--yes']);
const out = `${deploy.stdout || ''}\n${deploy.stderr || ''}`;
fs.mkdirSync(path.join(root, 'scratch'), { recursive: true });
fs.writeFileSync(path.join(root, 'scratch', 'tg-bridge-deploy.log'), out, 'utf8');
if (deploy.status !== 0) {
  console.error(out.slice(-2500));
  process.exit(1);
}

const urls = out.match(/https:\/\/[a-z0-9.-]+\.vercel\.app/gi) || [];
let base =
  urls.find((u) => u.includes(projectName) && !u.includes('-git-')) ||
  `https://${projectName}.vercel.app`;

// Prefer stable alias
base = `https://${projectName}.vercel.app`;
log('base', base);

// Health
try {
  const h = await fetch(`${base}/api/entitlement/telegram-webhook`, {
    signal: AbortSignal.timeout(30_000),
  });
  const j = await h.json().catch(() => ({}));
  log('health', `HTTP ${h.status} configured=${j.configured}`);
} catch (e) {
  log('health', e instanceof Error ? e.message : String(e));
}

// setWebhook via setup route + direct API
try {
  const setup = await fetch(
    `${base}/api/entitlement/telegram-webhook?setup=true&url=${encodeURIComponent(base)}`,
    { signal: AbortSignal.timeout(30_000) },
  );
  const sj = await setup.json().catch(() => ({}));
  log('setup', `ok=${sj.ok} url=${sj.webhookUrl || ''} err=${sj.error || ''}`);
} catch (e) {
  log('setup', e instanceof Error ? e.message : String(e));
}

// Direct Telegram setWebhook (belt + suspenders)
const token = envs.AINOVEL_TELEGRAM_BOT_TOKEN;
const secret = envs.AINOVEL_TELEGRAM_WEBHOOK_SECRET;
const webhookUrl = `${base}/api/entitlement/telegram-webhook`;
const body = {
  url: webhookUrl,
  allowed_updates: ['callback_query', 'message'],
  drop_pending_updates: false,
};
if (secret) body.secret_token = secret;
const sw = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});
const swj = await sw.json();
log('setWebhook', `ok=${swj.ok} desc=${swj.description || ''}`);

const info = await fetch(
  `https://api.telegram.org/bot${token}/getWebhookInfo`,
).then((r) => r.json());
const infoUrl = info?.result?.url || '';
log('getWebhookInfo', infoUrl);

// ping test message
try {
  await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: envs.AINOVEL_TELEGRAM_CHAT_ID,
      text: `🔗 Webhook gắn xong\n${webhookUrl}\nBấm ✅ Cấp Key trên tin báo thanh toán sẽ cấp key qua bridge.`,
    }),
  });
} catch {
  /* ignore */
}

const summary = {
  // setup route or getWebhookInfo is enough (setWebhook may 429 if called twice)
  ok: Boolean(
    infoUrl.includes('telegram-webhook') ||
      (swj.ok && String(webhookUrl).includes('telegram-webhook')),
  ),
  project: projectName,
  baseUrl: base,
  webhookUrl: infoUrl || webhookUrl,
  at: new Date().toISOString(),
};
fs.writeFileSync(
  path.join(root, 'scratch', 'telegram-webhook-status.json'),
  JSON.stringify(summary, null, 2),
);
// also remember for main app docs
const note = `# Telegram bridge production
# Base: ${base}
# Webhook: ${infoUrl || webhookUrl}
# Deploy: node scripts/deploy-telegram-bridge.mjs
AINOVEL_TELEGRAM_BRIDGE_URL=${base}
`;
fs.writeFileSync(path.join(root, 'scratch', 'telegram-bridge.url.env'), note);
console.log(JSON.stringify(summary, null, 2));
if (!summary.ok) process.exit(2);
