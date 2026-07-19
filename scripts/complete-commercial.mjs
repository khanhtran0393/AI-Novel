/**
 * Commercial completion gate (local machine).
 * Runs every automated check that does not require a Windows Authenticode cert.
 *
 *   node scripts/complete-commercial.mjs
 *   node scripts/complete-commercial.mjs --with-unsigned-pack
 */
import { spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const withPack = process.argv.includes('--with-unsigned-pack');
const steps = [];

function run(name, cmd, args = [], opts = {}) {
  console.log(`\n=== ${name} ===`);
  const env = { ...process.env, ...opts.env };
  for (const k of Object.keys(env)) {
    if (k.toUpperCase() === 'ELECTRON_RUN_AS_NODE') delete env[k];
  }
  const r = spawnSync(cmd, args, {
    cwd: root,
    env,
    encoding: 'utf8',
    shell: true,
    stdio: 'inherit',
  });
  const ok = r.status === 0;
  steps.push({ name, ok, status: r.status });
  if (!ok && !opts.allowFail) {
    console.error(`[FAIL] ${name} exit=${r.status}`);
    summarize(1);
  }
  return ok;
}

function summarize(code) {
  const pass = steps.filter((s) => s.ok).length;
  const fail = steps.filter((s) => !s.ok).length;
  const residual = [
    {
      id: 'authenticode',
      required: true,
      status: process.env.CSC_LINK || process.env.WINDOWS_CSC_LINK ? 'env-present' : 'MISSING',
      action:
        'Set CSC_LINK + CSC_KEY_PASSWORD (+ WIN_CSC_PUBLISHER_NAME + WIN_CSC_CERTIFICATE_SHA1) then: npm run build:desktop',
    },
    {
      id: 'github-tag-release',
      required: true,
      status: 'manual',
      action:
        'Push tag v' +
        JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version +
        ' after secrets in GitHub environments signing/production',
    },
    {
      id: 'white-machine',
      required: true,
      status: 'checklist',
      action: 'npm run commercial:white-machine then tick Free/Trial/Pro on clean PC with signed installer',
    },
  ];
  const report = {
    at: new Date().toISOString(),
    pass,
    fail,
    steps,
    residual,
    verdict:
      fail === 0
        ? 'SOFTWARE_READY — remaining ops: Authenticode cert + signed build + white-machine tick'
        : 'BLOCKED — fix FAIL steps',
  };
  fs.mkdirSync(path.join(root, 'scratch'), { recursive: true });
  fs.writeFileSync(
    path.join(root, 'scratch', 'complete-commercial-report.json'),
    JSON.stringify(report, null, 2),
  );
  console.log('\n' + JSON.stringify(report, null, 2));
  process.exit(code ?? (fail ? 2 : 0));
}

// 1) Customer env (public only)
run(
  'commercial:setup-env',
  'npm',
  [
    'run',
    'commercial:setup-env',
    '--',
    '--license-api',
    'https://ai-novel-flax.vercel.app',
    '--update-feed',
    'https://azlizrbjkqcyqnsmuccv.supabase.co/storage/v1/object/public/desktop-updates/latest',
    '--force',
  ],
);

// 2) Source tracking for CI
run('audit:release-source', 'npm', ['run', 'audit:release-source']);

// 3) Feed + unit release tests
run('test:desktop-release', 'npm', ['run', 'test:desktop-release']);
run('release:feed:verify', 'npm', ['run', 'release:feed:verify']);

// 4) Non-strict ship + full prepare
run('ship:check', 'npm', ['run', 'ship:check']);
run('prepare:publish', 'npm', ['run', 'prepare:publish']);

// 5) License roundtrip
run(
  'license:issue-token-fixture',
  'node',
  [
    'scripts/issue-license.mjs',
    '--token',
    '--hwid',
    '0011223344556677',
    '--plan',
    'pro',
    '--expDays',
    '7',
  ],
);

// 6–7) Telegram bridge + production license API (live)
run('probe-commercial-live', 'node', ['scripts/probe-commercial-live.mjs']);

if (withPack) {
  run('pack:unsigned:qa', 'npm', ['run', 'pack:unsigned:qa'], { allowFail: false });
}

run('commercial:white-machine', 'npm', ['run', 'commercial:white-machine']);

summarize(0);
