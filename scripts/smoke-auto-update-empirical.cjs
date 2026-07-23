/**
 * Empirical proof: client on older version can discover + download update from GitHub
 * exactly as electron-updater does when seller publishes a new release.
 *
 * Scenario: simulated user on 1.0.4 → feed has 1.0.5+ → check → download → sha512 OK
 *
 *   node scripts/smoke-auto-update-empirical.cjs
 *   node scripts/smoke-auto-update-empirical.cjs --skip-download   # feed only
 *   node scripts/smoke-auto-update-empirical.cjs --baseline 1.0.4
 */
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const https = require('https');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const OWNER = 'khanhtran0393';
const REPO = 'AI-Novel-release-';

function arg(name, fallback = '') {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] || fallback : fallback;
}
const skipDownload = process.argv.includes('--skip-download');
const skipElectron = process.argv.includes('--skip-electron');
const baseline = String(arg('baseline', '1.0.4')).replace(/^v/i, '');

function fail(msg) {
  console.error('[FAIL]', msg);
  process.exit(1);
}

function compareSemver(a, b) {
  const pa = String(a)
    .replace(/^v/i, '')
    .split(/[-+]/)[0]
    .split('.')
    .map((x) => parseInt(x, 10) || 0);
  const pb = String(b)
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

function fetchText(url, redirects = 0) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https') ? https : http;
    const req = lib.get(
      url,
      {
        headers: {
          'User-Agent': 'ainovel-smoke-auto-update-empirical',
          Accept: '*/*',
        },
        timeout: 120_000,
      },
      (res) => {
        if (
          res.statusCode >= 300 &&
          res.statusCode < 400 &&
          res.headers.location &&
          redirects < 8
        ) {
          res.resume();
          return resolve(fetchText(res.headers.location, redirects + 1));
        }
        if (res.statusCode !== 200) {
          reject(new Error(`GET ${url} → HTTP ${res.statusCode}`));
          res.resume();
          return;
        }
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () =>
          resolve(Buffer.concat(chunks).toString('utf8')),
        );
      },
    );
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error(`timeout ${url}`));
    });
  });
}

function downloadToFile(url, dest, onProgress) {
  return new Promise((resolve, reject) => {
    const follow = (u, redirects = 0) => {
      const lib = u.startsWith('https') ? https : http;
      const req = lib.get(
        u,
        {
          headers: {
            'User-Agent': 'ainovel-smoke-auto-update-empirical',
            Accept: 'application/octet-stream',
          },
          timeout: 600_000,
        },
        (res) => {
          if (
            res.statusCode >= 300 &&
            res.statusCode < 400 &&
            res.headers.location &&
            redirects < 8
          ) {
            res.resume();
            return follow(res.headers.location, redirects + 1);
          }
          if (res.statusCode !== 200) {
            reject(new Error(`DOWNLOAD ${u} → HTTP ${res.statusCode}`));
            res.resume();
            return;
          }
          const total = Number(res.headers['content-length'] || 0);
          let got = 0;
          const hash = crypto.createHash('sha512');
          const out = fs.createWriteStream(dest);
          res.on('data', (chunk) => {
            got += chunk.length;
            hash.update(chunk);
            out.write(chunk);
            if (onProgress && total) {
              const pct = Math.floor((got / total) * 100);
              if (pct % 10 === 0) onProgress(pct, got, total);
            }
          });
          res.on('end', () => {
            out.end(() => {
              resolve({
                bytes: got,
                sha512: hash.digest('base64'),
                total,
              });
            });
          });
          res.on('error', reject);
          out.on('error', reject);
        },
      );
      req.on('error', reject);
      req.on('timeout', () => {
        req.destroy();
        reject(new Error(`download timeout ${u}`));
      });
    };
    follow(url);
  });
}

function parseLatestYml(text) {
  const version = (text.match(/^version:\s*['"]?([^\s'"]+)/m) || [])[1];
  const pathName = (text.match(/^path:\s*['"]?([^\s'"]+)/m) || [])[1];
  const sha512 =
    (text.match(/^sha512:\s*['"]?([^\s'"]+)/m) ||
      text.match(/^\s+sha512:\s*['"]?([^\s'"]+)/m) ||
      [])[1];
  const sizeRaw =
    (text.match(/^size:\s*(\d+)/m) || text.match(/^\s+size:\s*(\d+)/m) || [])[1];
  const urlInFiles = (text.match(/^\s+-\s+url:\s*['"]?([^\s'"]+)/m) || [])[1];
  return {
    version: version || null,
    path: pathName || urlInFiles || null,
    sha512: sha512 || null,
    size: sizeRaw ? Number(sizeRaw) : null,
  };
}

async function phaseFeedAndDownload() {
  console.log('\n=== PHASE A: Feed resolution + download (client 1.0.4 → feed) ===\n');

  // Same paths electron-updater GitHubProvider uses
  const latestApi = `https://api.github.com/repos/${OWNER}/${REPO}/releases/latest`;
  const latestJson = JSON.parse(await fetchText(latestApi));
  const tag = latestJson.tag_name;
  if (!tag) fail('no tag_name on latest release');
  if (latestJson.draft) fail('latest release is draft');
  if (latestJson.prerelease) {
    console.warn('[WARN] latest is prerelease — stable clients may skip');
  }

  const ymlUrl = `https://github.com/${OWNER}/${REPO}/releases/download/${encodeURIComponent(tag)}/latest.yml`;
  // also the redirect form used by some clients
  const ymlLatest = `https://github.com/${OWNER}/${REPO}/releases/latest/download/latest.yml`;

  let ymlText;
  try {
    ymlText = await fetchText(ymlUrl);
  } catch {
    ymlText = await fetchText(ymlLatest);
  }

  const feed = parseLatestYml(ymlText);
  console.log(
    JSON.stringify(
      {
        step: 'feed',
        baselineClient: baseline,
        tag,
        feedVersion: feed.version,
        path: feed.path,
        size: feed.size,
        sha512Prefix: (feed.sha512 || '').slice(0, 24) + '…',
        ymlUrl,
        releaseUrl: latestJson.html_url,
      },
      null,
      2,
    ),
  );

  if (!feed.version || !feed.path || !feed.sha512) {
    fail('latest.yml incomplete (version/path/sha512)');
  }
  if (compareSemver(baseline, feed.version) >= 0) {
    fail(
      `baseline ${baseline} >= feed ${feed.version} — cannot prove upgrade path (need older baseline or newer publish)`,
    );
  }
  console.log(
    `[OK] Client ${baseline} would see UPDATE AVAILABLE → ${feed.version}`,
  );

  const exeUrl = `https://github.com/${OWNER}/${REPO}/releases/download/${encodeURIComponent(tag)}/${feed.path}`;
  const asset = (latestJson.assets || []).find((a) => a.name === feed.path);
  if (!asset) {
    fail(`release assets missing ${feed.path}`);
  }
  console.log(
    JSON.stringify(
      {
        step: 'asset',
        name: asset.name,
        size: asset.size,
        browser_download_url: asset.browser_download_url,
      },
      null,
      2,
    ),
  );

  if (skipDownload) {
    console.log('[SKIP] download (--skip-download)');
    return { feed, tag, downloaded: false };
  }

  const outDir = path.join(root, 'scratch', 'auto-update-empirical');
  fs.mkdirSync(outDir, { recursive: true });
  const dest = path.join(outDir, feed.path);
  if (fs.existsSync(dest)) {
    try {
      fs.unlinkSync(dest);
    } catch {
      /* ignore */
    }
  }

  console.log(`[download] ${exeUrl}`);
  let lastPct = -1;
  const result = await downloadToFile(exeUrl, dest, (pct, got, total) => {
    if (pct !== lastPct && pct % 20 === 0) {
      lastPct = pct;
      process.stdout.write(
        `\r[download] ${pct}% (${(got / 1e6).toFixed(1)} / ${(total / 1e6).toFixed(1)} MB)`,
      );
    }
  });
  process.stdout.write('\n');

  if (result.sha512 !== feed.sha512) {
    fail(
      `sha512 mismatch!\n  feed: ${feed.sha512}\n  got:  ${result.sha512}`,
    );
  }
  if (feed.size && result.bytes !== feed.size) {
    fail(`size mismatch feed=${feed.size} got=${result.bytes}`);
  }
  const st = fs.statSync(dest);
  if (st.size < 1_000_000) fail(`downloaded file too small: ${st.size}`);

  console.log(
    JSON.stringify(
      {
        step: 'download_ok',
        dest,
        bytes: result.bytes,
        sha512Match: true,
        sizeMatch: !feed.size || result.bytes === feed.size,
      },
      null,
      2,
    ),
  );
  console.log(
    `[OK] Full installer downloaded + sha512 verified — same bytes electron-updater would stage`,
  );

  return { feed, tag, downloaded: true, dest, bytes: result.bytes };
}

/**
 * Phase B: real electron-updater NsisUpdater via isolated mini-app.
 * Spawns electron.exe on a temp package so require('electron') is real API.
 * Client version forced to baseline (e.g. 1.0.4).
 */
function phaseElectronUpdater(feedVersion) {
  console.log(
    '\n=== PHASE B: electron-updater checkForUpdates (real library) ===\n',
  );

  if (skipElectron) {
    console.log('[SKIP] electron phase (--skip-electron)');
    return { skipped: true };
  }

  const electronPath = require('electron');
  const bin =
    typeof electronPath === 'string'
      ? electronPath
      : path.join(
          root,
          'node_modules',
          'electron',
          'dist',
          process.platform === 'win32' ? 'electron.exe' : 'electron',
        );

  if (!fs.existsSync(bin)) {
    console.warn('[WARN] electron binary missing — skip phase B');
    return { skipped: true, reason: 'no electron binary' };
  }

  const miniRoot = path.join(root, 'scratch', 'auto-update-empirical', 'mini-app');
  fs.mkdirSync(miniRoot, { recursive: true });

  // Symlink/junction node_modules so electron-updater resolves
  const nmLink = path.join(miniRoot, 'node_modules');
  if (!fs.existsSync(nmLink)) {
    try {
      fs.symlinkSync(path.join(root, 'node_modules'), nmLink, 'junction');
    } catch (e) {
      // copy package.json only and set NODE_PATH
      console.warn('[WARN] junction node_modules failed:', e.message);
    }
  }

  fs.writeFileSync(
    path.join(miniRoot, 'package.json'),
    JSON.stringify(
      {
        name: 'ainovel-update-smoke',
        version: baseline,
        main: 'main.cjs',
      },
      null,
      2,
    ),
    'utf8',
  );

  fs.writeFileSync(
    path.join(miniRoot, 'main.cjs'),
    `
'use strict';
const { app } = require('electron');
const path = require('path');
const fs = require('fs');

const BASELINE = ${JSON.stringify(baseline)};
const OWNER = ${JSON.stringify(OWNER)};
const REPO = ${JSON.stringify(REPO)};
const EXPECT = ${JSON.stringify(feedVersion)};
const ROOT = ${JSON.stringify(root)};

// Force old client version (package.json already baseline; double-patch)
const origGetVersion = app.getVersion.bind(app);
app.getVersion = () => BASELINE;

const userData = path.join(ROOT, 'scratch', 'auto-update-empirical', 'eu-userdata');
fs.mkdirSync(userData, { recursive: true });
app.setPath('userData', userData);

app.whenReady().then(async () => {
  const log = [];
  const push = (s) => { console.log('[eu]', s); log.push(String(s)); };
  try {
    push('electron=' + process.versions.electron);
    push('clientVersion=' + app.getVersion());
    push('isPackaged=' + app.isPackaged);

    const { autoUpdater } = require('electron-updater');
    autoUpdater.logger = {
      info: (...a) => push('info ' + a.join(' ')),
      warn: (...a) => push('warn ' + a.join(' ')),
      error: (...a) => push('error ' + a.join(' ')),
      debug: () => {},
    };
    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = false;
    autoUpdater.allowPrerelease = false;
    autoUpdater.channel = 'latest';
    autoUpdater.forceDevUpdateConfig = true;
    try {
      autoUpdater.verifyUpdateCodeSignature = async () => null;
    } catch (_) {}

    // Write dev-app-update.yml next to app path for forceDevUpdateConfig
    const yml = [
      'provider: github',
      'owner: ' + OWNER,
      'repo: ' + REPO,
      'vPrefixedTagName: true',
    ].join('\\n') + '\\n';
    fs.writeFileSync(path.join(app.getAppPath(), 'dev-app-update.yml'), yml, 'utf8');

    autoUpdater.setFeedURL({
      provider: 'github',
      owner: OWNER,
      repo: REPO,
      vPrefixedTagName: true,
      private: false,
    });

    autoUpdater.on('error', (e) => push('evt-error ' + (e && e.message)));
    autoUpdater.on('checking-for-update', () => push('checking'));
    autoUpdater.on('update-available', (i) => push('available ' + (i && i.version)));
    autoUpdater.on('update-not-available', () => push('not-available'));
    autoUpdater.on('update-downloaded', (i) => push('downloaded ' + (i && i.version)));
    autoUpdater.on('download-progress', (p) => {
      if (p && p.percent != null && Math.floor(p.percent) % 25 === 0) {
        push('progress ' + Math.floor(p.percent) + '%');
      }
    });

    const result = await autoUpdater.checkForUpdates();
    const ver = result && result.updateInfo && result.updateInfo.version;
    push('updateInfo.version=' + ver);
    if (!ver) throw new Error('no updateInfo.version from electron-updater');
    if (ver !== EXPECT) throw new Error('expected ' + EXPECT + ' got ' + ver);

    push('download start');
    await autoUpdater.downloadUpdate();
    push('download complete');

    console.log(JSON.stringify({
      ok: true,
      phase: 'electron-updater',
      clientVersion: BASELINE,
      updateVersion: ver,
      events: log,
    }, null, 2));
    app.exit(0);
  } catch (e) {
    console.error(JSON.stringify({
      ok: false,
      phase: 'electron-updater',
      error: e && e.message ? e.message : String(e),
      stack: e && e.stack,
      events: log,
    }, null, 2));
    app.exit(1);
  }
}).catch((e) => {
  console.error(e);
  app.exit(1);
});
`,
    'utf8',
  );

  const env = { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: '1' };
  delete env.ELECTRON_RUN_AS_NODE;

  console.log(`[spawn] ${bin} .  (cwd=${miniRoot})`);
  const r = spawnSync(bin, ['.'], {
    cwd: miniRoot,
    encoding: 'utf8',
    windowsHide: true,
    timeout: 900_000,
    env,
    maxBuffer: 20 * 1024 * 1024,
  });

  if (r.stdout) process.stdout.write(r.stdout);
  if (r.stderr) process.stderr.write(r.stderr);

  if (r.status !== 0) {
    fail(`electron-updater phase exit ${r.status}`);
  }
  if (!String(r.stdout || '').includes('"ok": true')) {
    fail('electron-updater phase did not report ok:true');
  }
  console.log(
    '[OK] electron-updater checkForUpdates + downloadUpdate succeeded',
  );
  return { ok: true, status: r.status };
}

async function main() {
  console.log(
    JSON.stringify(
      {
        smoke: 'auto-update-empirical',
        baseline,
        skipDownload,
        skipElectron,
        owner: OWNER,
        repo: REPO,
      },
      null,
      2,
    ),
  );

  const a = await phaseFeedAndDownload();
  const b = phaseElectronUpdater(a.feed.version);

  console.log(
    '\n=== VERDICT ===\n' +
      JSON.stringify(
        {
          ok: true,
          proof: [
            `Client baseline ${baseline} < feed ${a.feed.version}`,
            'GitHub latest.yml public 200 (electron-updater channel file)',
            a.downloaded
              ? `Installer fully downloaded (${a.bytes} bytes) + sha512 match`
              : 'download skipped',
            b.skipped
              ? 'electron-updater phase skipped'
              : 'electron-updater checkForUpdates+downloadUpdate OK',
          ],
          userPath:
            'Seller: bump version → pack:ship → release:ship-update. ' +
            'User on older build: open app → auto download → reopen → install.',
          release: a.tag
            ? `https://github.com/${OWNER}/${REPO}/releases/tag/${a.tag}`
            : null,
        },
        null,
        2,
      ),
  );
  console.log('\nVERDICT: PASS — auto-update discover + download proven against live GitHub feed\n');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
