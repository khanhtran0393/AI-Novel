/**
 * Smoke: 1 profile = 1 isolated user-data-dir + extension bound to accountId
 */
import fs from 'fs';
import path from 'path';
import {
  ensureIsolatedAccountProfile,
  profileDirForAccount,
  accountRootDir,
} from '../src/lib/flow-bridge/chromeSession.ts';

const ids = ['acc_test_iso_login_a', 'acc_test_iso_login_b'];
const src = path.join(process.cwd(), 'extensions', 'ainovel-flow');

let ok = true;
for (const id of ids) {
  const r = ensureIsolatedAccountProfile(id, src);
  const root = accountRootDir(id);
  const profile = profileDirForAccount(id);
  const bg = path.join(r.extDir, 'background.js');
  const bindPath = path.join(r.extDir, 'ACCOUNT_BIND.json');

  if (!fs.existsSync(path.join(r.extDir, 'manifest.json'))) {
    console.error('FAIL missing manifest', id);
    ok = false;
    continue;
  }
  const text = fs.readFileSync(bg, 'utf8');
  const m = text.match(/ws:\/\/127\.0\.0\.1:9223[^\s'"]*/);
  const ws = m?.[0] || '';
  const bind = JSON.parse(fs.readFileSync(bindPath, 'utf8')) as {
    accountId: string;
  };

  const checks = {
    id,
    root,
    profile,
    extDir: r.extDir,
    ws,
    bindId: bind.accountId,
    wsHasId: ws.includes(`accountId=${id}`),
    bindOk: bind.accountId === id,
    profileIsolated: profile.includes(id) || root.includes(id),
  };
  console.log(JSON.stringify(checks, null, 2));

  if (!checks.wsHasId || !checks.bindOk || !checks.profileIsolated) {
    console.error('FAIL isolation checks', id);
    ok = false;
  }
}

// Cross-check: two profiles must not share the same user-data-dir
const p0 = profileDirForAccount(ids[0]);
const p1 = profileDirForAccount(ids[1]);
if (path.resolve(p0) === path.resolve(p1)) {
  console.error('FAIL profiles share user-data-dir', p0);
  ok = false;
} else {
  console.log('OK distinct user-data-dirs');
}

if (!ok) {
  process.exit(1);
}
console.log('PASS profile isolation smoke');
