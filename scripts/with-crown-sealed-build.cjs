/**
 * Run a command with crown formula stubs active (production anti-theft build).
 * Always restores plain sources in finally.
 *
 * Example:
 *   node scripts/with-crown-sealed-build.cjs next build
 */
'use strict';

const { spawnSync } = require('child_process');
const path = require('path');
const { restoreStubs } = require('./lib/crown-ip-stub.cjs');
const { sealJsCrowns } = require('./lib/crown-ip-seal.cjs');

const ROOT = path.resolve(__dirname, '..');

async function prepare() {
  // Ensure clean sources before sealing
  restoreStubs();
  await sealJsCrowns();
  // Re-require apply after seal
  const { applyStubs } = require('./lib/crown-ip-stub.cjs');
  applyStubs();
}

function main() {
  const args = process.argv.slice(2);
  if (!args.length) {
    console.error('Usage: node scripts/with-crown-sealed-build.cjs <command> [args...]');
    process.exit(2);
  }

  return prepare()
    .then(() => {
      let cmd = args[0];
      let cmdArgs = args.slice(1);
      // Prefer local bin / npm scripts
      if (cmd === 'next') {
        cmd = process.platform === 'win32' ? 'npx.cmd' : 'npx';
        cmdArgs = ['--no-install', 'next', ...cmdArgs];
      }
      const binPath = path.join(ROOT, 'node_modules', '.bin');
      const r = spawnSync(cmd, cmdArgs, {
        cwd: ROOT,
        stdio: 'inherit',
        shell: true,
        env: {
          ...process.env,
          AINOVEL_CROWN_SEALED: '1',
          PATH: `${binPath}${path.delimiter}${process.env.PATH || ''}`,
        },
      });
      const code = r.status == null ? 1 : r.status;
      restoreStubs();
      process.exit(code);
    })
    .catch((err) => {
      console.error('[with-crown-sealed-build]', err?.stack || err);
      try {
        restoreStubs();
      } catch {
        /* ignore */
      }
      process.exit(1);
    });
}

main();
