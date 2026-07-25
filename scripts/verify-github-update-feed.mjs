/**
 * Fail-closed check: GitHub release feed is usable by electron-updater.
 *
 * Validates:
 *  - latest (non-draft) release exists
 *  - assets include latest.yml + AI-Novel-*-x64.exe
 *  - latest.yml version/path/sha512/size parse
 *  - latest.yml URL resolves HTTP 200
 *  - optional: package.json version ≤ feed version (warn if app newer than feed)
 *
 *   node scripts/verify-github-update-feed.mjs
 *   node scripts/verify-github-update-feed.mjs --owner x --repo y
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseAndValidateLatestYml } from './lib/latestYml.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

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

function parseLatestYml(text) {
  try {
    const p = parseAndValidateLatestYml(text);
    return {
      version: p.version,
      path: p.path,
      sha512: p.sha512,
      size: p.size,
    };
  } catch (e) {
    return {
      version: null,
      path: null,
      sha512: null,
      size: null,
      parseError: e instanceof Error ? e.message : String(e),
    };
  }
}

function compareSemver(a, b) {
  const pa = String(a || '0')
    .replace(/^v/i, '')
    .split(/[-+]/)[0]
    .split('.')
    .map((x) => parseInt(x, 10) || 0);
  const pb = String(b || '0')
    .replace(/^v/i, '')
    .split(/[-+]/)[0]
    .split('.')
    .map((x) => parseInt(x, 10) || 0);
  const n = Math.max(pa.length, pb.length);
  for (let i = 0; i < n; i++) {
    const x = pa[i] ?? 0;
    const y = pb[i] ?? 0;
    if (x < y) return -1;
    if (x > y) return 1;
  }
  return 0;
}

const pub = loadEnvFile(path.join(root, 'resources/commercial/public.env'));
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

const owner = (
  arg('owner', pub.AINOVEL_UPDATE_GITHUB_OWNER || 'khanhtran0393') || ''
).trim();
const repo = (
  arg('repo', pub.AINOVEL_UPDATE_GITHUB_REPO || 'AI-Novel-release-') || ''
).trim();

const failures = [];
const warnings = [];

const apiHeaders = {
  Accept: 'application/vnd.github+json',
  'User-Agent': 'ainovel-verify-github-update-feed',
  'X-GitHub-Api-Version': '2022-11-28',
};

async function main() {
  if (String(pub.AINOVEL_UPDATE_PROVIDER || '').toLowerCase() !== 'github') {
    failures.push(
      `public.env AINOVEL_UPDATE_PROVIDER must be github (got ${pub.AINOVEL_UPDATE_PROVIDER || '(empty)'})`,
    );
  }
  if (!owner || !repo) {
    failures.push('Missing GitHub owner/repo');
  }

  const latestApi = `https://api.github.com/repos/${owner}/${repo}/releases/latest`;
  let release;
  // Retry — GitHub occasionally 502/504
  let lastErr = null;
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const res = await fetch(latestApi, { headers: apiHeaders });
      if (res.ok) {
        release = await res.json();
        lastErr = null;
        break;
      }
      lastErr = `HTTP ${res.status}`;
      if (res.status === 502 || res.status === 503 || res.status === 504) {
        await new Promise((r) => setTimeout(r, 800 * attempt));
        continue;
      }
      break;
    } catch (e) {
      lastErr = e?.message || String(e);
      await new Promise((r) => setTimeout(r, 800 * attempt));
    }
  }
  if (!release) {
    failures.push(`GET releases/latest → ${lastErr || 'unknown'}`);
  }

  if (release) {
    if (release.draft) failures.push('Latest release is draft (updater ignores drafts)');
    if (release.prerelease) {
      warnings.push(
        'Latest release is prerelease — stable channel (allowPrerelease=0) may skip it',
      );
    }
    const assets = Array.isArray(release.assets) ? release.assets : [];
    const names = assets.map((a) => a.name);
    const hasYml = names.includes('latest.yml');
    const exe = assets.find((a) => /^AI-Novel-.*-x64\.exe$/i.test(a.name || ''));
    if (!hasYml) {
      failures.push(
        `Release ${release.tag_name} missing asset latest.yml (electron-updater hard-requires it). Assets: ${names.join(', ') || '(none)'}`,
      );
    }
    if (!exe) {
      failures.push(
        `Release ${release.tag_name} missing AI-Novel-*-x64.exe. Assets: ${names.join(', ') || '(none)'}`,
      );
    }

    // Fetch latest.yml via release asset API path used by updater
    const tag = release.tag_name;
    const ymlUrl = `https://github.com/${owner}/${repo}/releases/download/${encodeURIComponent(tag)}/latest.yml`;
    let ymlText = '';
    try {
      const yres = await fetch(ymlUrl, {
        headers: { 'User-Agent': 'ainovel-verify-github-update-feed' },
        redirect: 'follow',
      });
      if (!yres.ok) {
        failures.push(`GET ${ymlUrl} → HTTP ${yres.status}`);
      } else {
        ymlText = await yres.text();
      }
    } catch (e) {
      failures.push(`GET latest.yml: ${e?.message || e}`);
    }

    if (ymlText) {
      const parsed = parseLatestYml(ymlText);
      if (parsed.parseError) {
        failures.push(`latest.yml invalid schema: ${parsed.parseError}`);
      }
      if (!parsed.version) {
        failures.push(
          'latest.yml missing version — regenerate: npm run release:manifest -- --strict',
        );
      }
      if (!parsed.path) failures.push('latest.yml missing path/url');
      if (!parsed.sha512 || parsed.sha512.length < 40) {
        failures.push('latest.yml missing/invalid sha512');
      }
      if (!parsed.size || parsed.size < 1_000_000) {
        failures.push(
          `latest.yml size suspicious: ${parsed.size} (expect multi-MB installer)`,
        );
      }
      if (exe && parsed.path && exe.name !== parsed.path) {
        failures.push(
          `latest.yml path "${parsed.path}" ≠ release asset "${exe.name}"`,
        );
      }
      if (exe && parsed.size && Number(exe.size) !== Number(parsed.size)) {
        warnings.push(
          `latest.yml size ${parsed.size} ≠ asset size ${exe.size} (sha512 may still fail)`,
        );
      }
      if (parsed.version && compareSemver(pkg.version, parsed.version) > 0) {
        failures.push(
          `package.json ${pkg.version} > feed ${parsed.version} — shipping newer app than published feed; users on feed cannot "update" to local-only builds`,
        );
      }
      if (parsed.version && compareSemver(pkg.version, parsed.version) === 0) {
        warnings.push(
          `package.json == feed ${parsed.version} — users already on this version get update-not-available (need bump to ship the updater fix)`,
        );
      }

      console.log(
        JSON.stringify(
          {
            ok: failures.length === 0,
            owner,
            repo,
            tag,
            releaseUrl: release.html_url,
            feedVersion: parsed.version,
            packageVersion: pkg.version,
            exe: exe?.name || null,
            exeSize: exe?.size || null,
            ymlUrl,
            failures,
            warnings,
          },
          null,
          2,
        ),
      );
    } else {
      console.log(
        JSON.stringify(
          {
            ok: false,
            owner,
            repo,
            tag: release.tag_name,
            releaseUrl: release.html_url,
            assets: names,
            failures,
            warnings,
          },
          null,
          2,
        ),
      );
    }
  } else {
    console.log(JSON.stringify({ ok: false, failures, warnings }, null, 2));
  }

  if (failures.length) {
    console.error(
      '\n[FAIL] GitHub update feed not ready for electron-updater.\n' +
        failures.map((f) => ` - ${f}`).join('\n') +
        '\n\nFix: npm run release:manifest && npm run release:github  (attach latest.yml + exe)\n',
    );
    process.exit(1);
  }
  if (warnings.length) {
    console.warn('[WARN]\n' + warnings.map((w) => ` - ${w}`).join('\n'));
  }
  console.log('[PASS] GitHub update feed ready for auto-update clients');
}

main().catch((e) => {
  console.error('[FAIL]', e instanceof Error ? e.message : e);
  process.exit(1);
});
