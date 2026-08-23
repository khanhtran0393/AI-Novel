/**
 * Smoke: Google /sorry/ challenge resolution wiring (source + error map).
 * Does not hit live Google (no network captcha).
 */
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const packageVersion = String(pkg.version || '').trim();
let failed = 0;

function ok(cond, msg) {
  if (cond) console.log(`  PASS  ${msg}`);
  else {
    console.error(`  FAIL  ${msg}`);
    failed++;
  }
}

function mustInclude(file, needles, label) {
  const p = join(root, file);
  ok(existsSync(p), `${label}: exists ${file}`);
  if (!existsSync(p)) return;
  const text = readFileSync(p, 'utf8');
  for (const n of needles) {
    ok(text.includes(n), `${label}: contains ${JSON.stringify(n)}`);
  }
}

console.log('smoke-flow-sorry-challenge');

mustInclude(
  'extensions/ainovel-flow/manifest.json',
  [
    `"version": "${packageVersion}"`,
    'https://www.google.com/*',
    'https://www.gstatic.com/*',
  ],
  'manifest',
);

mustInclude(
  'extensions/ainovel-flow/background.js',
  [
    'resolveGoogleChallenge',
    'focusTabAndWindow',
    'resolve_google_challenge',
    'human_verified',
    'GOOGLE_CHALLENGE_TIMEOUT',
    'sorry-challenge-resolve',
    'does not auto-click or solve Google /sorry/ challenges',
  ],
  'background',
);

mustInclude(
  'src/lib/flow-bridge/queueEngine.ts',
  ['resolve_google_challenge', 'challengeTimeoutMs', 'GOOGLE_CHALLENGE'],
  'queueEngine',
);

mustInclude(
  'src/lib/flow-bridge/flowRuntimeErrors.ts',
  ['google_challenge_timeout', 'google.com/sorry', 'permanent: true'],
  'flowRuntimeErrors',
);

{
  const bg = readFileSync(join(root, 'extensions/ainovel-flow/background.js'), 'utf8');
  ok(
    !/function\s+tryAutoClickRecaptcha\b/.test(bg) &&
      !/recaptcha-anchor/.test(bg) &&
      /does not auto-click or solve Google \/sorry\/ challenges/.test(bg),
    'background: Google /sorry/ path is manual-only (no auto-click helper)',
  );
}

mustInclude(
  'src/lib/flow-bridge/bridgeServer.ts',
  ['challenge_status', 'Google /sorry/'],
  'bridgeServer',
);

// Runtime taxonomy via tsx (shell for Windows npx)
try {
  const { spawnSync } = await import('node:child_process');
  const r = spawnSync(
    'npx tsx -e "import { describeFlowError } from \'./src/lib/flow-bridge/flowRuntimeErrors.ts\'; const d = describeFlowError(undefined, \'GOOGLE_CHALLENGE_TIMEOUT: google.com/sorry\'); if (d.category !== \'forbidden_403\') process.exit(2); if (!d.permanent) process.exit(3); if (!/sorry|reCAPTCHA|người máy/i.test(d.userMessage)) process.exit(4); console.log(\'TAXONOMY_OK\');"',
    {
      cwd: root,
      encoding: 'utf8',
      shell: true,
      timeout: 60_000,
    },
  );
  const out = `${r.stdout || ''}${r.stderr || ''}`;
  ok(
    r.status === 0 && /TAXONOMY_OK/.test(out),
    `describeFlowError maps GOOGLE_CHALLENGE_TIMEOUT (exit=${r.status})`,
  );
  if (r.status !== 0) console.error(out.slice(0, 500));
} catch (e) {
  console.log('  SKIP  describeFlowError runtime', e);
}

if (failed) {
  console.error(`\nSMOKE_FAIL failures=${failed}`);
  process.exit(1);
}
console.log('\nSMOKE_OK smoke-flow-sorry-challenge');
process.exit(0);
