/**
 * Smoke Phase A/B re-harden without packing Electron.
 * - preview minify
 * - round-trip backup/apply/restore must leave main.js identical
 * - package.json hooks wired
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const {
  ROOT,
  SHELL_FILES,
  writeShellHardenPreview,
  applyShellHardenInPlace,
  restoreShellFromBackup,
  assertShellParses,
} = require('./lib/desktop-re-harden.cjs');

function sha(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

async function main() {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert.equal(pkg.build.beforePack, 'scripts/electron-before-pack.cjs');
  assert.equal(pkg.build.afterPack, 'scripts/electron-after-pack.cjs');
  assert.ok(
    fs.existsSync(path.join(ROOT, 'scripts', 'electron-before-pack.cjs')),
    'beforePack script missing',
  );
  assert.ok(
    fs.existsSync(path.join(ROOT, 'scripts', 'electron-after-pack.cjs')),
    'afterPack script missing',
  );
  assert.ok(
    fs.existsSync(path.join(ROOT, 'scripts', 'electron-fuses.cjs')),
    'fuses script missing',
  );

  // Ensure clean restore state
  restoreShellFromBackup();

  const hashesBefore = {};
  for (const rel of SHELL_FILES) {
    const abs = path.join(ROOT, rel);
    if (fs.existsSync(abs)) hashesBefore[rel] = sha(abs);
  }
  assert.ok(Object.keys(hashesBefore).length >= 4, 'expected shell files');

  const preview = await writeShellHardenPreview();
  assert.ok(preview.files.length >= 4);
  for (const rel of preview.files) {
    const code = fs.readFileSync(path.join(preview.previewDir, rel), 'utf8');
    assertShellParses(code);
    assert.ok(code.includes('ainovel-re-harden'), rel);
    const before = preview.bytes[rel].before;
    const after = preview.bytes[rel].after;
    // Hardened should not explode size wildly
    assert.ok(after > 50, rel);
    assert.ok(after <= before * 1.2 + 200, `unexpected size growth ${rel}`);
  }
  console.log('PASS re-harden preview', { engine: preview.engine, n: preview.files.length });

  // In-place harden then restore must be bit-identical
  const applied = await applyShellHardenInPlace();
  const mainHard = fs.readFileSync(path.join(ROOT, 'main.js'), 'utf8');
  assert.ok(mainHard.includes('ainovel-re-harden'));
  assertShellParses(mainHard);

  const restored = restoreShellFromBackup();
  assert.ok(restored.restored.length >= 4, 'restore count');

  for (const rel of Object.keys(hashesBefore)) {
    const after = sha(path.join(ROOT, rel));
    assert.equal(after, hashesBefore[rel], `source drift after restore: ${rel}`);
  }
  console.log('PASS re-harden apply/restore round-trip', {
    engine: applied.engine,
    files: applied.hardened.length,
  });

  // next.config production maps off
  const nextCfg = fs.readFileSync(path.join(ROOT, 'next.config.ts'), 'utf8');
  assert.ok(nextCfg.includes('productionBrowserSourceMaps: false'));

  console.log(JSON.stringify({ ok: true, smoke: 're-harden', engine: applied.engine }));
}

main().catch((err) => {
  try {
    restoreShellFromBackup();
  } catch {
    /* ignore */
  }
  console.error(err);
  process.exit(1);
});
