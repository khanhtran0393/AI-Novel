/**
 * Public-interface smoke for the packaged XinChao-Cut runtime host.
 * Uses the real vendored production build and a real loopback HTTP server.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  inspectXinChaoRuntime,
  startXinChaoRuntimeHost,
  stopXinChaoRuntimeHost,
} = require('../electron/xinchaoRuntimeHost.cjs');

const root = process.cwd();
const editorRoot = path.join(root, 'tools', 'xinchao-cut');
const runtime = inspectXinChaoRuntime(editorRoot);

assert.equal(runtime.sourcePresent, true, 'Vendored XinChao-Cut source is incomplete');
assert.equal(runtime.distPresent, true, 'XinChao-Cut dist is missing');
assert.equal(runtime.runnable, true, 'XinChao-Cut runtime is not runnable');
const nodeModulesStat = fs.lstatSync(path.join(editorRoot, 'node_modules'));
assert.equal(
  nodeModulesStat.isSymbolicLink() || nodeModulesStat.isDirectory(),
  true,
  'Vendored node_modules is unavailable',
);
assert.equal(
  Boolean(nodeModulesStat.mode && (nodeModulesStat.mode & 0o170000) === 0o120000),
  false,
  'Vendored node_modules must not be a symlink',
);
assert.equal(
  path.resolve(fs.realpathSync(path.join(editorRoot, 'node_modules'))).startsWith(
    path.resolve(editorRoot) + path.sep,
  ),
  true,
  'Vendored dependencies resolve outside the AI Novel workspace',
);

const hosted = await startXinChaoRuntimeHost(editorRoot);
try {
  const indexResponse = await fetch(hosted.url);
  assert.equal(indexResponse.status, 200);
  assert.equal(indexResponse.headers.get('cross-origin-opener-policy'), 'same-origin');
  assert.equal(indexResponse.headers.get('cross-origin-embedder-policy'), 'require-corp');

  const html = await indexResponse.text();
  const assetMatch = html.match(/(?:src|href)=["']([^"']*assets\/[^"']+)["']/i);
  assert.ok(assetMatch, 'Built editor HTML does not reference an asset');

  const assetUrl = new URL(assetMatch[1], hosted.url);
  const assetResponse = await fetch(assetUrl);
  assert.equal(assetResponse.status, 200, `Editor asset did not load: ${assetUrl}`);
  const assetPath = decodeURIComponent(assetUrl.pathname).replace(/^\/+/, '');
  assert.ok(
    fs.existsSync(path.join(editorRoot, 'dist', ...assetPath.split('/'))),
    `Served asset is not from the editor dist: ${assetPath}`,
  );

  console.log(
    JSON.stringify({
      ok: true,
      mode: hosted.mode,
      url: hosted.url,
      asset: assetPath,
      sourceFiles: runtime.sourceFiles,
    }),
  );
  console.log('SMOKE_OK xinchao-runtime-host');
} finally {
  await stopXinChaoRuntimeHost();
}
