/** CLI: write hardened shell preview under build/shell-hardened-preview (no source mutation). */
'use strict';

const {
  writeShellHardenPreview,
  assertShellParses,
  PREVIEW_DIR,
} = require('./lib/desktop-re-harden.cjs');
const fs = require('fs');
const path = require('path');

async function main() {
  const result = await writeShellHardenPreview();
  for (const rel of result.files) {
    const code = fs.readFileSync(path.join(PREVIEW_DIR, rel), 'utf8');
    assertShellParses(code);
  }
  console.log(JSON.stringify({ ok: true, ...result }, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
