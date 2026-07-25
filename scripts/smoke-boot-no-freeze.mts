/**
 * Guard: Electron boot path must not block main event loop (hosts Next :3000).
 * Freeze root: sendSync boot + commitWrite/LevelDB on every navigation.
 */
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const main = fs.readFileSync(path.join(root, 'main.js'), 'utf8');
const preload = fs.readFileSync(path.join(root, 'preload.js'), 'utf8');

function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error('FAIL:', msg);
    process.exit(1);
  }
  console.log('PASS:', msg);
}

assert(main.includes('BOOT_STORE_CACHE_MS'), 'boot store cache');
assert(main.includes('BOOT_SKIP_LEVELDB_SCORE'), 'skip LevelDB when disk rich');
assert(
  /resolveBootStore\(\s*\{[^}]*allowLevelDb:\s*false/.test(main),
  'persist-boot uses allowLevelDb:false',
);
assert(
  /mirror:\s*false/.test(main) && main.includes('scheduleWrite'),
  'boot path can scheduleWrite without sync commitWrite',
);
// Hot snapshot must not commitWrite
assert(
  /async function snapshotFromRenderer[\s\S]*?scheduleWrite\(raw\)/.test(main),
  'snapshotFromRenderer uses scheduleWrite',
);
assert(
  !/async function snapshotFromRenderer[\s\S]*?commitWrite\(raw/.test(main),
  'snapshotFromRenderer must not commitWrite',
);
assert(main.includes('restoreInjectedOnce'), 'recovery inject once only');
assert(
  /ainovel-persist-set-sync[\s\S]*?scheduleWrite/.test(main),
  'set-sync schedules write (no blocking writeAll)',
);
assert(
  preload.includes('__ainovelCredMigrated') ||
    preload.includes('ainovelCredMigrated'),
  'preload migrates credentials once per session',
);

const persist = fs.readFileSync(
  path.join(root, 'src/store/persistStorage.ts'),
  'utf8',
);
assert(
  /hardTimeoutMs\s*=\s*1500/.test(persist),
  'getItem hard-timeout 1500ms (not 4s)',
);

console.log('SMOKE_OK boot-no-freeze');
process.exit(0);
