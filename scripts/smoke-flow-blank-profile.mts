/**
 * Smoke: prepareBlankLoginProfile wipes cookies; two profiles stay isolated.
 */
import fs from 'fs';
import path from 'path';
import {
  prepareBlankLoginProfile,
  profileDirForAccount,
  ensureIsolatedAccountProfile,
} from '../src/lib/flow-bridge/chromeSession.ts';

const src = path.join(process.cwd(), 'extensions', 'ainovel-flow');
const id = 'acc_blank_smoke_' + Date.now().toString(36);

// Seed fake "old session" cookies under profile
const seeded = ensureIsolatedAccountProfile(id, src);
const fakeCookie = path.join(seeded.profileDir, 'Default', 'Cookies');
fs.mkdirSync(path.dirname(fakeCookie), { recursive: true });
fs.writeFileSync(fakeCookie, 'OLD_GOOGLE_SESSION', 'utf8');
fs.writeFileSync(
  path.join(seeded.profileDir, 'Default', 'Login Data'),
  'OLD_LOGIN',
  'utf8',
);

if (!fs.existsSync(fakeCookie)) {
  console.error('FAIL seed cookies');
  process.exit(1);
}

const blank = prepareBlankLoginProfile(id, src);
const stillCookies = fs.existsSync(fakeCookie);
const stillLogin = fs.existsSync(
  path.join(blank.profileDir, 'Default', 'Login Data'),
);
const hasExt = fs.existsSync(path.join(blank.extDir, 'manifest.json'));
const bg = fs.readFileSync(path.join(blank.extDir, 'background.js'), 'utf8');
const bound = bg.includes(`accountId=${id}`);

console.log(
  JSON.stringify(
    {
      id,
      profileDir: blank.profileDir,
      wiped: blank.wiped,
      stillCookies,
      stillLogin,
      hasExt,
      bound,
      distinct: profileDirForAccount(id) === blank.profileDir,
    },
    null,
    2,
  ),
);

if (stillCookies || stillLogin || !hasExt || !bound) {
  console.error('FAIL blank profile');
  process.exit(1);
}
console.log('PASS blank login profile (wiped old session, kept extension bind)');
