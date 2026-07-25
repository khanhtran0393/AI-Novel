/**
 * Guard: auto-update must install silently (NSIS /S), no Setup wizard.
 * Runtime proof of silent install is packaged-only; this smoke locks source policy.
 */
import fs from 'fs';
import path from 'path';

const root = process.cwd();
const updaterPath = path.join(root, 'electron', 'updater.js');
const src = fs.readFileSync(updaterPath, 'utf8');

function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error('FAIL:', msg);
    process.exit(1);
  }
  console.log('PASS:', msg);
}

assert(
  /quitAndInstall\s*\(\s*true\s*,\s*true\s*\)/.test(src),
  'quitAndInstall(true, true) — silent + force-run',
);
assert(
  !/quitAndInstall\s*\(\s*false\s*,/.test(src),
  'no quitAndInstall(false, …) non-silent path',
);
assert(
  /isSilent=true|silent\s*\/S|Silent NSIS|direct silent NSIS|\/S/i.test(src),
  'comment/docs in updater mention silent /S',
);
assert(
  /spawnSilentNsis|direct-nsis-s/.test(src),
  'direct silent NSIS spawn (avoid shell.openPath Setup UI)',
);
assert(
  /windowsHide:\s*true/.test(src),
  'windowsHide true on silent installer spawn',
);
assert(/['"]\/S['"]/.test(src) || /\/S/.test(src), 'NSIS /S flag present');

// Packaged installer must be oneClick (no assisted Back/Next wizard)
const pkg = JSON.parse(
  fs.readFileSync(path.join(root, 'package.json'), 'utf8'),
);
const nsis = pkg?.build?.nsis || {};
assert(
  nsis.oneClick === true,
  'package.json build.nsis.oneClick=true (assisted wizard is Setup-style)',
);
assert(
  nsis.allowToChangeInstallationDirectory !== true,
  'no allowToChangeInstallationDirectory (forces assisted installer)',
);
assert(
  fs.existsSync(
    path.join(root, 'src/app/workspace/features/onboarding/UpdateSuccessModal.tsx'),
  ),
  'UpdateSuccessModal present (post-update notification)',
);

const page = fs.readFileSync(
  path.join(root, 'src/app/workspace/page.tsx'),
  'utf8',
);
assert(
  /UpdateSuccessModal/.test(page),
  'workspace mounts UpdateSuccessModal',
);

// NsisUpdater contract: isSilent → /S
const nsisUpdaterJs = path.join(
  root,
  'node_modules/electron-updater/out/NsisUpdater.js',
);
if (fs.existsSync(nsisUpdaterJs)) {
  const n = fs.readFileSync(nsisUpdaterJs, 'utf8');
  assert(
    /isSilent[\s\S]{0,80}\/S/.test(n) || /args\.push\("\/S"\)/.test(n),
    'electron-updater NsisUpdater maps isSilent → /S',
  );
} else {
  console.log('SKIP: electron-updater NsisUpdater.js not found');
}

console.log('SMOKE_OK silent-update policy');
process.exit(0);
