/**
 * One-shot: make auto-update feed live after pack:ship / pack:unsigned:qa.
 *
 *   npm run pack:ship
 *   npm run release:ship-update
 *
 * Does:
 *  1) generate latest.yml from dist exe
 *  2) publish generic feed → Supabase (needs SUPABASE_* in .env)
 *  3) publish GitHub release if GH_TOKEN set
 *  4) verify public latest.yml on both channels
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const version = pkg.version;
const dir = process.argv.includes('--dir')
  ? process.argv[process.argv.indexOf('--dir') + 1]
  : 'dist-qa-unsigned';
const releaseDir = path.resolve(root, dir);

function run(cmd, args, opts = {}) {
  console.log(`\n> ${cmd} ${args.join(' ')}`);
  // shell:false — Windows paths with spaces (e.g. Program Files\node.exe) break shell:true
  const r = spawnSync(cmd, args, {
    cwd: root,
    encoding: 'utf8',
    shell: false,
    windowsHide: true,
    stdio: 'inherit',
    env: process.env,
    ...opts,
  });
  if (r.status !== 0) {
    throw new Error(`${cmd} ${args.join(' ')} exit ${r.status}`);
  }
}

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return {};
  const out = {};
  for (const line of fs.readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq <= 0) continue;
    let k = t.slice(0, eq).trim();
    let v = t.slice(eq + 1).trim();
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1);
    }
    out[k] = v;
  }
  return out;
}

// Merge local env for publish (do not print secrets)
Object.assign(
  process.env,
  loadEnvFile(path.join(root, '.env')),
  loadEnvFile(path.join(root, '.env.local')),
);

const exeName = `AI-Novel-${version}-x64.exe`;
const exePath = path.join(releaseDir, exeName);

if (!fs.existsSync(releaseDir)) {
  console.error(`[FAIL] Missing release dir: ${releaseDir}`);
  console.error('Run: npm run pack:ship   (or pack:unsigned:qa)');
  process.exit(1);
}

if (!fs.existsSync(exePath)) {
  const found = fs
    .readdirSync(releaseDir)
    .filter((n) => /^AI-Novel-.*-x64\.exe$/i.test(n));
  console.error(
    `[FAIL] Missing ${exeName}. Found: ${found.join(', ') || '(none)'}`,
  );
  process.exit(1);
}

const sizeMb = (fs.statSync(exePath).size / 1024 / 1024).toFixed(1);
console.log(
  JSON.stringify(
    {
      step: 'start',
      version,
      exe: exePath,
      sizeMb,
      hasGhToken: Boolean(
        process.env.GH_TOKEN || process.env.GITHUB_TOKEN,
      ),
      hasSupabase: Boolean(
        process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL,
      ),
    },
    null,
    2,
  ),
);

// 1) latest.yml — always canonical rewrite (version required, match package.json)
run(process.execPath, [
  path.join(root, 'scripts', 'generate-update-manifest.mjs'),
  '--dir',
  releaseDir,
  '--channel',
  'latest',
  '--version',
  version,
  '--strict',
]);

// 2) Supabase generic feed (unsigned). Large exe may 413 if Storage limit < 500MB —
// do not abort the whole ship; GitHub is primary for big installers.
const hasSupabase = Boolean(
  (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL) &&
    process.env.SUPABASE_SERVICE_ROLE_KEY,
);
let supabaseOk = false;
if (hasSupabase) {
  try {
    run(process.execPath, [
      path.join(root, 'scripts', 'publish-desktop-update.mjs'),
      '--publish',
      '--allow-unsigned',
      '--dir',
      releaseDir,
    ]);
    run(process.execPath, [
      path.join(root, 'scripts', 'publish-desktop-update.mjs'),
      '--verify-feed',
    ]);
    supabaseOk = true;
  } catch (e) {
    console.warn(
      '[WARN] Supabase publish failed (often HTTP 413 file size limit).',
      e?.message || e,
    );
    console.warn(
      '  Fix: Dashboard → Storage → Global file size limit ≥ 500MB, or rely on GitHub feed.',
    );
  }
} else {
  console.warn(
    '[WARN] Skip Supabase publish — set SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY',
  );
}

// 3) GitHub — preferred host for ~500MB installers
let hasGh = Boolean(process.env.GH_TOKEN || process.env.GITHUB_TOKEN);
let githubOk = false;
if (!hasGh) {
  // Fall back to Windows Git Credential Manager (origin github login)
  try {
    run(process.execPath, [
      path.join(root, 'scripts', 'publish-github-via-git-credential.mjs'),
      '--dir',
      releaseDir,
      '--version',
      version,
    ]);
    githubOk = true;
    hasGh = true;
  } catch (e) {
    console.warn(
      '[WARN] GitHub via git credential failed:',
      e?.message || e,
    );
  }
} else {
  try {
    run(process.execPath, [
      path.join(root, 'scripts', 'publish-github-release.mjs'),
      '--dir',
      releaseDir,
      '--version',
      version,
    ]);
    run(process.execPath, [
      path.join(root, 'scripts', 'verify-github-update-feed.mjs'),
    ]);
    githubOk = true;
  } catch (e) {
    console.warn('[WARN] GitHub publish failed:', e?.message || e);
  }
}
if (!githubOk) {
  console.warn(
    `Manual: upload ${exeName} + latest.yml → https://github.com/khanhtran0393/AI-Novel-release-/releases`,
  );
}

// 4) Verify generic public latest.yml if we published
const feedUrl =
  'https://azlizrbjkqcyqnsmuccv.supabase.co/storage/v1/object/public/desktop-updates/latest/latest.yml';
try {
  const res = await fetch(feedUrl, { redirect: 'follow' });
  const text = res.ok ? await res.text() : '';
  const ver = (text.match(/^version:\s*['"]?([^\s'"]+)/m) || [])[1];
  console.log(
    JSON.stringify(
      {
        supabaseLatestYml: res.status,
        feedVersion: ver || null,
        expectVersion: version,
        match: ver === version,
      },
      null,
      2,
    ),
  );
  if (supabaseOk && (!res.ok || ver !== version)) {
    console.warn(
      '[WARN] Supabase feed version mismatch — generic fallback may lag until Storage limit raised',
    );
  }
} catch (e) {
  console.warn('[WARN] Could not fetch Supabase latest.yml:', e?.message || e);
}

const githubReady = githubOk;
if (!githubReady && !supabaseOk) {
  console.error(`
[FAIL] No feed published.
  - Set GH_TOKEN and re-run: npm run release:ship-update
  - Or raise Supabase Storage limit ≥ 500MB and re-run
Local artifacts ready:
  ${exePath}
  ${path.join(releaseDir, 'latest.yml')}
`);
  process.exit(1);
}

console.log(`
[PASS] release:ship-update finished for ${version}
  githubPublished: ${githubReady}
  supabasePublished: ${supabaseOk}

Customer path:
  1) User on OLD broken updater → install ${exeName} once manually
  2) User on ${version}+ → open app → auto download → reopen → installed

Feeds:
  - generic: ${feedUrl}
  - github:  https://github.com/khanhtran0393/AI-Novel-release-/releases
`);
