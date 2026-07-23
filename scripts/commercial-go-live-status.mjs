/**
 * Print commercial go-live readiness + residual Authenticode requirements.
 *   node scripts/commercial-go-live-status.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawnSync } from 'child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

function loadEnvFile(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return {};
  const values = {};
  for (const line of fs.readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const equals = trimmed.indexOf('=');
    if (equals <= 0) continue;
    const key = trimmed.slice(0, equals).trim();
    let value = trimmed.slice(equals + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (key) values[key] = value;
  }
  return values;
}

const sellerEnvPath = path.join(
  process.env.LOCALAPPDATA || '',
  'AI Novel Seller',
  '.env.seller',
);
const operationalEnv = {
  ...loadEnvFile(path.join(root, '.env')),
  ...loadEnvFile(path.join(root, '.env.local')),
  ...loadEnvFile(sellerEnvPath),
  ...process.env,
};

function hasEnv(...names) {
  return names.some((n) => String(process.env[n] || '').trim().length > 0);
}

function runOk(cmd, args) {
  const r = spawnSync(cmd, args, {
    cwd: root,
    encoding: 'utf8',
    shell: true,
    env: (() => {
      const e = { ...process.env };
      for (const k of Object.keys(e)) {
        if (k.toUpperCase() === 'ELECTRON_RUN_AS_NODE') delete e[k];
      }
      return e;
    })(),
  });
  return r.status === 0;
}

const checks = [];
function add(name, ok, detail = '') {
  checks.push({ name, ok: !!ok, detail });
}

add(
  'CSC / WINDOWS_CSC cert material in env',
  hasEnv('CSC_LINK', 'WINDOWS_CSC_LINK'),
  hasEnv('CSC_LINK', 'WINDOWS_CSC_LINK') ? 'present' : 'MISSING',
);
add(
  'WIN_CSC_PUBLISHER_NAME',
  hasEnv('WIN_CSC_PUBLISHER_NAME'),
  process.env.WIN_CSC_PUBLISHER_NAME || 'MISSING',
);
add(
  'WIN_CSC_CERTIFICATE_SHA1',
  /^[A-Fa-f0-9]{40}$/.test(
    String(process.env.WIN_CSC_CERTIFICATE_SHA1 || '').replace(/[^A-Fa-f0-9]/g, ''),
  ),
  process.env.WIN_CSC_CERTIFICATE_SHA1
    ? `len=${String(process.env.WIN_CSC_CERTIFICATE_SHA1).replace(/[^A-Fa-f0-9]/g, '').length}`
    : 'MISSING',
);

const sellerKey = path.join(
  process.env.LOCALAPPDATA || '',
  'AI Novel Seller',
  'entitlement-private.pem',
);
add('Seller Ed25519 private key', fs.existsSync(sellerKey), sellerKey);

const publicKeys = path.join(root, 'resources', 'license', 'public-keys');
const pems = fs.existsSync(publicKeys)
  ? fs.readdirSync(publicKeys).filter((f) => f.endsWith('.pem'))
  : [];
add('Packaged public keys', pems.length > 0, pems.join(', '));

const publicEnv = path.join(root, 'resources', 'commercial', 'public.env');
const pub = fs.existsSync(publicEnv) ? fs.readFileSync(publicEnv, 'utf8') : '';
add(
  'Public commercial env HTTPS API',
  /AINOVEL_LICENSE_API_URL=https:\/\//.test(pub),
);
add(
  'Public commercial env HTTPS feed',
  /AINOVEL_UPDATE_FEED_URL=https:\/\//.test(pub),
);

const customerEnv = path.join(
  process.env.APPDATA || '',
  'ai-novel-script-generator',
  '.env.commercial',
);
add('Customer .env.commercial exists', fs.existsSync(customerEnv), customerEnv);
const customerConfig = fs.existsSync(customerEnv)
  ? fs.readFileSync(customerEnv, 'utf8')
  : '';
add(
  'Customer config enables cloud Trial',
  /^AINOVEL_TRIAL_ENABLED=1$/m.test(customerConfig),
);
add(
  'Customer config contains public values only',
  !/(?:PRIVATE_KEY|ADMIN_KEY|WEBHOOK_SECRET|SERVICE_ROLE_KEY)\s*=/i.test(
    customerConfig,
  ),
);

const pkgVersion = String(pkg.version || '0.0.0').trim();
const qaPortableCandidates = [
  path.join(root, 'dist-qa-unsigned', `AI-Novel-${pkgVersion}-x64.exe`),
  path.join(root, 'dist-qa-unsigned', 'AI-Novel-1.0.0-x64.exe'),
];
const qaPortable =
  qaPortableCandidates.find((p) => fs.existsSync(p)) || qaPortableCandidates[0];
const qaUnpackedCandidates = [
  path.join(root, 'dist-qa-unsigned', 'win-unpacked', 'Ai Novel.exe'),
  path.join(root, 'dist-qa-unsigned', 'win-unpacked', 'AI Novel & Script Generator.exe'),
];
const qaUnpacked =
  qaUnpackedCandidates.find((p) => fs.existsSync(p)) || qaUnpackedCandidates[0];
add('QA unsigned portable artifact', fs.existsSync(qaPortable), qaPortable);
add('QA win-unpacked exe', fs.existsSync(qaUnpacked), qaUnpacked);

// Live endpoints (non-fatal if offline)
async function live() {
  try {
    const r = await fetch('https://ai-novel-flax.vercel.app/api/commercial/status', {
      signal: AbortSignal.timeout(15_000),
    });
    const j = await r.json();
    add(
      'Prod license API ready',
      r.ok && j.entitlement?.readyForCommercial,
      `mode=${j.entitlement?.mode}`,
    );
  } catch (e) {
    add('Prod license API ready', false, e instanceof Error ? e.message : String(e));
  }
  const adminKey = String(
    operationalEnv.AINOVEL_ENTITLEMENT_ADMIN_KEY || '',
  ).trim();
  if (!adminKey) {
    add('Production admin key synchronized', false, 'local seller key MISSING');
  } else {
    try {
      const r = await fetch(
        'https://ai-novel-flax.vercel.app/api/cloud/license/issue',
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-ainovel-admin-key': adminKey,
          },
          body: JSON.stringify({
            planId: 'month',
            issueMode: 'token',
            hwid: 'probe',
          }),
          signal: AbortSignal.timeout(15_000),
        },
      );
      add(
        'Production admin key synchronized',
        r.status === 400,
        `http=${r.status}; non-mutating invalid-HWID probe`,
      );
    } catch (e) {
      add(
        'Production admin key synchronized',
        false,
        e instanceof Error ? e.message : String(e),
      );
    }
  }
  try {
    const r = await fetch(
      'https://ainovel-telegram-bridge.vercel.app/api/entitlement/telegram-webhook',
      { signal: AbortSignal.timeout(15_000) },
    );
    const j = await r.json();
    add('Telegram bridge configured', r.ok && j.configured, j.service || '');
  } catch (e) {
    add('Telegram bridge configured', false, e instanceof Error ? e.message : String(e));
  }
  try {
    const r = await fetch(
      'https://azlizrbjkqcyqnsmuccv.supabase.co/storage/v1/object/public/desktop-updates/latest/feed-ready.json',
      { signal: AbortSignal.timeout(15_000) },
    );
    const j = await r.json();
    add('Update feed marker', r.ok && j.appId === pkg.build?.appId, j.feedUrl || '');
  } catch (e) {
    add('Update feed marker', false, e instanceof Error ? e.message : String(e));
  }
}

await live();

const certReady =
  hasEnv('CSC_LINK', 'WINDOWS_CSC_LINK') &&
  hasEnv('WIN_CSC_PUBLISHER_NAME') &&
  /^[A-Fa-f0-9]{40}$/.test(
    String(process.env.WIN_CSC_CERTIFICATE_SHA1 || '').replace(/[^A-Fa-f0-9]/g, ''),
  );

const softReady = checks
  .filter((c) => !c.name.startsWith('CSC') && !c.name.startsWith('WIN_CSC'))
  .every((c) => c.ok);

const report = {
  at: new Date().toISOString(),
  version: pkg.version,
  softwareReady: softReady,
  authenticodeReady: certReady,
  canRunBuildDesktop: certReady,
  canPushReleaseTag: certReady,
  releaseTagRequiresVerifiedGithubSigningEnvironment: !certReady,
  next:
    certReady
      ? 'npm run build:desktop  then  git tag v' + pkg.version + ' && git push origin v' + pkg.version
      : 'Cấu hình Authenticode (CSC_LINK + WIN_CSC_*) — xem docs/COMMERCIAL_GO_LIVE.md §B',
  checks,
  residual: certReady
    ? []
    : [
        'Mua/cài Windows Code Signing certificate (.pfx)',
        'Set CSC_LINK, CSC_KEY_PASSWORD, WIN_CSC_PUBLISHER_NAME, WIN_CSC_CERTIFICATE_SHA1',
        'npm run build:desktop  OR  GitHub secrets + tag v' + pkg.version,
        'npm run commercial:white-machine trên máy trắng với installer đã ký',
      ],
};

fs.mkdirSync(path.join(root, 'scratch'), { recursive: true });
fs.writeFileSync(
  path.join(root, 'scratch', 'go-live-status.json'),
  JSON.stringify(report, null, 2),
);

console.log(JSON.stringify(report, null, 2));
console.log(
  certReady && softReady
    ? '\nGO-LIVE: READY TO BUILD SIGNED INSTALLER'
    : softReady
      ? '\nGO-LIVE: SOFTWARE READY — ONLY AUTHENTICODE REMAINS'
      : '\nGO-LIVE: BLOCKED — fix failed checks',
);
process.exit(softReady ? 0 : 2);
