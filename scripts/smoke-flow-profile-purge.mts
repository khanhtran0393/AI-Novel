/**
 * Smoke: Flow profile hard-delete contracts + live orphan purge of empty test dirs.
 * Does NOT delete the live active Google session folder.
 */
import fs from 'fs';
import path from 'path';
import {
  purgeAccountProfile,
  listOrphanProfileDirs,
  profileDirForAccount,
  accountRootDir,
  ensureIsolatedAccountProfile,
} from '../src/lib/flow-bridge/chromeSession.ts';
import {
  createAccount,
  deleteAccountHard,
  loadAccounts,
} from '../src/lib/flow-bridge/accountStore.ts';

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

function main() {
  console.log('[smoke-flow-profile-purge] start');

  const root = process.cwd();
  const accountsData = path.join(root, 'accounts_data');
  assert(fs.existsSync(accountsData), 'accounts_data exists');

  // 1) Source contracts
  const storeSrc = fs.readFileSync(
    path.join(root, 'src/lib/flow-bridge/accountStore.ts'),
    'utf8',
  );
  assert(storeSrc.includes('deleteAccountHard'), 'deleteAccountHard exists');
  assert(storeSrc.includes('purgeAccountProfile'), 'store calls purgeAccountProfile');

  const chromeSrc = fs.readFileSync(
    path.join(root, 'src/lib/flow-bridge/chromeSession.ts'),
    'utf8',
  );
  assert(chromeSrc.includes('export function purgeAccountProfile'), 'purge export');
  assert(chromeSrc.includes('listOrphanProfileDirs'), 'orphan list export');

  const routeSrc = fs.readFileSync(
    path.join(root, 'src/app/api/flow/accounts/route.ts'),
    'utf8',
  );
  assert(routeSrc.includes('deleteAccountHard'), 'API delete uses hard delete');
  assert(routeSrc.includes('purgeDeletedAccountRuntime'), 'API clears runtime bearer');

  // 2) Create throwaway account + fake profile dir, then hard delete
  const beforeIds = new Set(loadAccounts().map((a) => a.id));
  const acc = createAccount({ name: '__smoke_purge_only__' });
  assert(acc.id && !beforeIds.has(acc.id), 'created unique smoke account');
  console.log('  created', acc.id);

  const rootDir = accountRootDir(acc.id);
  const profileDir = profileDirForAccount(acc.id);
  // Ensure isolation materializes folders
  ensureIsolatedAccountProfile(
    acc.id,
    path.join(root, 'extensions', 'ainovel-flow'),
  );
  // Write a fake cookie file so wipe has something to remove
  const defaultDir = path.join(profileDir, 'Default');
  fs.mkdirSync(defaultDir, { recursive: true });
  fs.writeFileSync(path.join(defaultDir, 'Cookies'), 'smoke-cookie', 'utf8');
  fs.writeFileSync(
    path.join(rootDir, 'SESSION_BUNDLE.json'),
    JSON.stringify({ accountId: acc.id, flowKey: 'ya29.smoke_not_real' }),
    'utf8',
  );
  assert(fs.existsSync(rootDir), 'profile root exists before purge');
  assert(
    fs.existsSync(path.join(rootDir, 'SESSION_BUNDLE.json')),
    'SESSION_BUNDLE present',
  );

  const hard = deleteAccountHard(acc.id);
  console.log('  deleteAccountHard →', {
    ok: hard.ok,
    killed: hard.killed,
    removed: hard.removed.length,
    errors: hard.errors,
  });
  assert(hard.ok, 'hard delete ok');
  assert(
    !loadAccounts().some((a) => a.id === acc.id),
    'account removed from accounts.json',
  );
  assert(
    !fs.existsSync(rootDir) || hard.errors.length > 0,
    `profile root must be gone (exists=${fs.existsSync(rootDir)})`,
  );
  if (fs.existsSync(rootDir)) {
    throw new Error(`FAIL: profile still on disk: ${rootDir}`);
  }
  console.log('  disk purged for', acc.id);

  // 3) Orphan listing (should include old empty stubs if any)
  const known = loadAccounts().map((a) => a.id);
  const orphans = listOrphanProfileDirs(known);
  console.log(
    `  orphans on disk (not in store): ${orphans.length}`,
    orphans.map((p) => path.basename(p)),
  );

  // 4) Live bind check for remaining accounts
  for (const a of loadAccounts()) {
    const metaPath = path.join(accountRootDir(a.id), 'ACCOUNT_META.json');
    const bindPath = path.join(
      accountRootDir(a.id),
      'extension',
      'ACCOUNT_BIND.json',
    );
    if (fs.existsSync(bindPath)) {
      const bind = JSON.parse(fs.readFileSync(bindPath, 'utf8')) as {
        accountId?: string;
      };
      assert(
        String(bind.accountId) === a.id,
        `ACCOUNT_BIND mismatch for ${a.id}: ${bind.accountId}`,
      );
      console.log(`  bind OK ${a.id} → ${bind.accountId}`);
    }
    if (fs.existsSync(metaPath)) {
      const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8')) as {
        accountId?: string;
        userDataDir?: string;
      };
      assert(String(meta.accountId) === a.id, `META mismatch ${a.id}`);
      if (meta.userDataDir) {
        assert(
          String(meta.userDataDir).includes(a.id),
          `userDataDir must contain account id ${a.id}`,
        );
      }
      console.log(`  meta OK ${a.id}`);
    }
  }

  // 5) purgeAccountProfile on ghost id is safe
  const ghost = purgeAccountProfile('__smoke_ghost_no_such__');
  assert(ghost.killed === 0, 'ghost kill 0');
  console.log('  ghost purge safe', ghost);

  console.log('[smoke-flow-profile-purge] PASS');
}

main();
