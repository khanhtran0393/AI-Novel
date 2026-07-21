/**
 * Publish Windows installer + latest.yml to the public release-only GitHub repo.
 *
 * Env:
 *   GH_TOKEN or GITHUB_TOKEN  — fine-grained: Contents R/W on AI-Novel-release- only
 *   AINOVEL_UPDATE_GITHUB_OWNER (default khanhtran0393)
 *   AINOVEL_UPDATE_GITHUB_REPO  (default AI-Novel-release-)
 *
 * Usage:
 *   node scripts/publish-github-release.mjs
 *   node scripts/publish-github-release.mjs --dir dist-qa-unsigned --version 1.0.0
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const packageJson = JSON.parse(
  fs.readFileSync(path.join(root, 'package.json'), 'utf8'),
);

function arg(name, fallback = '') {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] || fallback : fallback;
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

const env = {
  ...loadEnvFile(path.join(root, '.env')),
  ...loadEnvFile(path.join(root, '.env.local')),
  ...process.env,
};

const owner =
  arg('owner', env.AINOVEL_UPDATE_GITHUB_OWNER || 'khanhtran0393').trim();
const repo = arg(
  'repo',
  env.AINOVEL_UPDATE_GITHUB_REPO || 'AI-Novel-release-',
).trim();
const version = arg('version', packageJson.version).trim();
const tag = arg('tag', `v${version}`).trim();
const releaseDir = path.resolve(root, arg('dir', 'dist-qa-unsigned'));
const token = String(env.GH_TOKEN || env.GITHUB_TOKEN || '').trim();

if (!token) {
  console.error(`
Missing GH_TOKEN / GITHUB_TOKEN.

1) GitHub → Settings → Developer settings → Personal access tokens
2) Fine-grained token: only repo ${owner}/${repo}
   Permissions: Contents = Read and write
3) PowerShell:
   $env:GH_TOKEN = "github_pat_..."
   npm run release:github

Or upload manually on:
   https://github.com/${owner}/${repo}/releases/new
   Tag: ${tag}
   Attach: .exe + latest.yml from ${releaseDir}
`);
  process.exit(1);
}

const exeName = `AI-Novel-${version}-x64.exe`;
const exePath = path.join(releaseDir, exeName);
if (!fs.existsSync(exePath)) {
  const found = fs
    .readdirSync(releaseDir)
    .filter((n) => /^AI-Novel-.*-x64\.exe$/i.test(n));
  throw new Error(
    `Missing ${exeName} in ${releaseDir}. Found: ${found.join(', ') || '(none)'}`,
  );
}

// Ensure latest.yml exists
const ymlPath = path.join(releaseDir, 'latest.yml');
if (!fs.existsSync(ymlPath)) {
  const gen = spawnSync(
    process.execPath,
    [
      path.join(root, 'scripts', 'generate-update-manifest.mjs'),
      '--dir',
      releaseDir,
      '--channel',
      'latest',
      '--version',
      version,
    ],
    { cwd: root, encoding: 'utf8', windowsHide: true },
  );
  if (gen.status !== 0) {
    throw new Error(gen.stderr || gen.stdout || 'generate-update-manifest failed');
  }
}

const api = 'https://api.github.com';
const headers = {
  Accept: 'application/vnd.github+json',
  Authorization: `Bearer ${token}`,
  'X-GitHub-Api-Version': '2022-11-28',
  'User-Agent': 'ainovel-release-publisher',
};

async function gh(method, urlPath, body, isJson = true) {
  const res = await fetch(`${api}${urlPath}`, {
    method,
    headers: {
      ...headers,
      ...(isJson && body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body && isJson ? JSON.stringify(body) : body || undefined,
  });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text };
  }
  if (!res.ok) {
    throw new Error(
      `${method} ${urlPath} → HTTP ${res.status}: ${text.slice(0, 500)}`,
    );
  }
  return data;
}

async function uploadAsset(uploadUrlTemplate, filePath, contentType) {
  const name = path.basename(filePath);
  const url = uploadUrlTemplate.replace(/\{.*\}/, '') + `?name=${encodeURIComponent(name)}`;
  const buf = fs.readFileSync(filePath);
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      ...headers,
      'Content-Type': contentType,
      'Content-Length': String(buf.length),
    },
    body: buf,
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Upload ${name} HTTP ${res.status}: ${text.slice(0, 400)}`);
  }
  return JSON.parse(text);
}

// Ensure README exists on default branch (best-effort)
async function ensureReadme() {
  const readmeLocal = path.join(root, 'release-repo', 'README.md');
  if (!fs.existsSync(readmeLocal)) return;
  const content = fs.readFileSync(readmeLocal);
  const b64 = content.toString('base64');
  let sha;
  try {
    const existing = await gh(
      'GET',
      `/repos/${owner}/${repo}/contents/README.md`,
    );
    sha = existing.sha;
  } catch {
    sha = undefined;
  }
  await gh('PUT', `/repos/${owner}/${repo}/contents/README.md`, {
    message: sha ? 'docs: update release README' : 'docs: add release README',
    content: b64,
    ...(sha ? { sha } : {}),
  });
  console.log('[ok] README.md on default branch');
}

async function main() {
  console.log(
    JSON.stringify(
      { owner, repo, version, tag, exe: exePath, size: fs.statSync(exePath).size },
      null,
      2,
    ),
  );

  await ensureReadme();

  // Find or create release
  let release;
  try {
    release = await gh('GET', `/repos/${owner}/${repo}/releases/tags/${tag}`);
    console.log('[ok] existing release', release.html_url);
  } catch {
    release = await gh('POST', `/repos/${owner}/${repo}/releases`, {
      tag_name: tag,
      name: version,
      body: [
        `## AI Novel ${version}`,
        '',
        '- Windows x64 installer / portable package',
        '- Auto-update channel: **stable** (this repo)',
        '',
        'Source code is **not** published here — release binaries only.',
      ].join('\n'),
      draft: false,
      prerelease: false,
      generate_release_notes: false,
    });
    console.log('[ok] created release', release.html_url);
  }

  const uploadUrl = release.upload_url;
  const existingAssets = Array.isArray(release.assets) ? release.assets : [];

  async function replaceAsset(filePath, contentType) {
    const name = path.basename(filePath);
    const old = existingAssets.find((a) => a.name === name);
    if (old?.id) {
      await gh('DELETE', `/repos/${owner}/${repo}/releases/assets/${old.id}`);
      console.log('[ok] deleted old asset', name);
    }
    const up = await uploadAsset(uploadUrl, filePath, contentType);
    console.log('[ok] uploaded', name, up.browser_download_url);
    return up;
  }

  await replaceAsset(exePath, 'application/octet-stream');
  await replaceAsset(ymlPath, 'application/x-yaml');

  const blockmap = `${exePath}.blockmap`;
  if (fs.existsSync(blockmap)) {
    await replaceAsset(blockmap, 'application/octet-stream');
  }

  const sha = crypto
    .createHash('sha512')
    .update(fs.readFileSync(exePath))
    .digest('base64');

  console.log(
    JSON.stringify(
      {
        ok: true,
        releaseUrl: release.html_url,
        tag,
        version,
        sha512Prefix: sha.slice(0, 24) + '…',
        check: `https://github.com/${owner}/${repo}/releases/tag/${tag}`,
      },
      null,
      2,
    ),
  );
}

main().catch((e) => {
  console.error('[fail]', e instanceof Error ? e.message : e);
  process.exit(1);
});
