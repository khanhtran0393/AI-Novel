/**
 * Decisive diagnostic: does vite 7.3.5 html-inline-proxy fail only when the
 * project root path contains a space (e.g. "AI Novel")?
 *
 * Builds a minimal index.html (inline <style> + module script) via the SAME
 * vite 7.3.5 installed in tools/xinchao-cut, from two temp roots:
 *   1) path WITH a space
 *   2) path WITHOUT a space
 * Prints PASS/FAIL for each.
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const vendorRoot = path.join(here, '..', 'tools', 'xinchao-cut');
const require = createRequire(path.join(vendorRoot, 'package.json'));
const { build } = require('vite');

const INDEX_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <style>html, body { margin: 0; background: #0a0a0b; } #app { color: #fff; }</style>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.ts"></script>
  </body>
</html>
`;
const MAIN_TS = `document.getElementById('root')!.textContent = 'ok';\n`;

async function tryBuild(dir) {
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'index.html'), INDEX_HTML);
  fs.writeFileSync(path.join(dir, 'src', 'main.ts'), MAIN_TS);
  const out = path.join(dir, 'dist');
  try {
    await build({
      root: dir,
      logLevel: 'silent',
      build: { outDir: out, emptyOutDir: true },
    });
    return 'PASS';
  } catch (e) {
    const msg = String((e && e.message) || e);
    return 'FAIL: ' + msg.split('\n')[0].slice(0, 220);
  }
}

const base = path.join(os.tmpdir(), 'xinchao-diag-' + Date.now());
const withSpace = path.join(base, 'AI Novel', 'xinchao-cut');
const noSpace = path.join(base, 'nospace-xinchao');

const r1 = await tryBuild(withSpace);
const r2 = await tryBuild(noSpace);
console.log('WITH_SPACE:', r1);
console.log('NO_SPACE  :', r2);

if (r1.startsWith('FAIL') && r2.startsWith('PASS')) {
  console.log('VERDICT: space-in-path triggers vite html-inline-proxy miss');
} else if (r1.startsWith('FAIL') && r2.startsWith('FAIL')) {
  console.log('VERDICT: inline <style> breaks vite 7.3.5 regardless of path');
} else {
  console.log('VERDICT: both pass — mismatch needs deeper instrumentation');
}
