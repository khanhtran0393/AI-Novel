/**
 * Publish release using Git Credential Manager token for github.com
 * (no GH_TOKEN env required when git already authenticated).
 *
 *   node scripts/publish-github-via-git-credential.mjs --dir dist-qa-unsigned
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function arg(name, fallback = '') {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] || fallback : fallback;
}

function gitCredentialToken() {
  const r = spawnSync(
    'git',
    ['credential', 'fill'],
    {
      input: 'protocol=https\nhost=github.com\n\n',
      encoding: 'utf8',
      windowsHide: true,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
    },
  );
  if (r.status !== 0) {
    throw new Error(
      `git credential fill failed: ${r.stderr || r.stdout || r.status}`,
    );
  }
  const lines = String(r.stdout || '').split(/\r?\n/);
  const map = {};
  for (const line of lines) {
    const i = line.indexOf('=');
    if (i > 0) map[line.slice(0, i)] = line.slice(i + 1);
  }
  const token = map.password || map.token;
  if (!token) throw new Error('git credential fill: no password/token for github.com');
  return token;
}

const dir = arg('dir', 'dist-qa-unsigned');
const version = arg('version', '');

const token = gitCredentialToken();
// Never print token
process.env.GH_TOKEN = token;
process.env.GITHUB_TOKEN = token;

const args = [
  path.join(root, 'scripts', 'publish-github-release.mjs'),
  '--dir',
  dir,
];
if (version) args.push('--version', version);

console.log('[publish-github-via-git-credential] using git credential for github.com');
const pub = spawnSync(process.execPath, args, {
  cwd: root,
  encoding: 'utf8',
  windowsHide: true,
  stdio: 'inherit',
  env: process.env,
  shell: false,
});
if (pub.status !== 0) process.exit(pub.status || 1);

const ver = spawnSync(
  process.execPath,
  [path.join(root, 'scripts', 'verify-github-update-feed.mjs')],
  {
    cwd: root,
    encoding: 'utf8',
    windowsHide: true,
    stdio: 'inherit',
    shell: false,
  },
);
process.exit(ver.status || 0);
