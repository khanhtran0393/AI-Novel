/**
 * Verify that tools/xinchao-cut preserves the canonical repository structure.
 *
 * Local/generated trees are intentionally excluded. When the source checkout
 * is unavailable (for example on CI), the verifier still enforces structural
 * anchors and a minimum canonical source-file count.
 */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const SKIP_DIRS = new Set([
  '.git',
  '.pytest_cache',
  '.venv',
  '.vite',
  '.work',
  '__pycache__',
  'backend-bundle',
  'coverage',
  'dist',
  'dist-ssr',
  'node_modules',
  'release',
  'target',
  'venv',
]);
const SKIP_FILE = /\.(?:log|pyc|tsbuildinfo)$/i;
const SKIP_PATHS = new Set([
  'XinChao-Cut.exe',
  'src-tauri/gen',
]);
// The reference tree remains the behavioral baseline. These are the only
// permitted source deltas: a narrow install-owned bridge that consumes an
// AI Novel media manifest through the original project/media/timeline engines.
const INTEGRATION_OVERLAY_CHANGED = new Set([
  'src/app/App.tsx',
  'src-tauri/src/lib.rs',
]);
const INTEGRATION_OVERLAY_ADDED = new Set([
  'src/components/shared/AiNovelPackBootstrap.tsx',
  'src/lib/ainovel-pack.test.ts',
  'src/lib/ainovel-pack.ts',
]);
const REQUIRED = [
  '.env.example',
  '.env.production',
  '.env.test',
  'LICENSE',
  'backend/app/main.py',
  'docs/03-folder-structure.md',
  'package-lock.json',
  'package.json',
  'public/logo.png',
  'scripts/stage-backend.ps1',
  'src/app/App.tsx',
  'src-tauri/src/lib.rs',
  'src-tauri/tauri.conf.json',
];

function argValue(name) {
  const direct = process.argv.find((value) => value.startsWith(`${name}=`));
  if (direct) return direct.slice(name.length + 1);
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : '';
}

function listCanonicalFiles(root) {
  const files = [];
  const stack = [root];
  while (stack.length > 0) {
    const current = stack.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) continue;
      const absolute = path.join(current, entry.name);
      const relative = path.relative(root, absolute).replace(/\\/g, '/');
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name) && !SKIP_PATHS.has(relative)) {
          stack.push(absolute);
        }
      } else if (
        entry.isFile() &&
        !SKIP_FILE.test(entry.name) &&
        !SKIP_PATHS.has(relative)
      ) {
        files.push(relative);
      }
    }
  }
  return files.sort();
}

function digest(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

const appRoot = process.cwd();
const vendorRoot = path.join(appRoot, 'tools', 'xinchao-cut');
assert.ok(fs.existsSync(vendorRoot), `Missing vendored root: ${vendorRoot}`);
for (const marker of REQUIRED) {
  assert.ok(fs.existsSync(path.join(vendorRoot, marker)), `Missing vendored file: ${marker}`);
}

const vendorFiles = listCanonicalFiles(vendorRoot);
assert.ok(
  vendorFiles.length >= 500,
  `Vendored source is unexpectedly small (${vendorFiles.length} files)`,
);

const configuredSource =
  argValue('--source') ||
  process.env.AINOVEL_XINCHAO_SOURCE ||
  path.join('D:', 'repo', 'XinChao-Cut-main');
const sourceRoot = path.resolve(configuredSource);

if (!fs.existsSync(path.join(sourceRoot, 'package.json'))) {
  console.log(
    JSON.stringify({
      ok: true,
      mode: 'structure-only',
      vendorRoot,
      vendorFiles: vendorFiles.length,
      sourceRoot,
    }),
  );
  console.log('VERIFY_OK xinchao-vendor-structure');
  process.exit(0);
}

const sourceFiles = listCanonicalFiles(sourceRoot);
const sourceSet = new Set(sourceFiles);
const vendorSet = new Set(vendorFiles);
const missing = sourceFiles.filter((relative) => !vendorSet.has(relative));
const extra = vendorFiles.filter((relative) => !sourceSet.has(relative));
const changed = sourceFiles.filter(
  (relative) =>
    vendorSet.has(relative) &&
    digest(path.join(sourceRoot, relative)) !== digest(path.join(vendorRoot, relative)),
);
const unexpectedExtra = extra.filter(
  (relative) => !INTEGRATION_OVERLAY_ADDED.has(relative),
);
const unexpectedChanged = changed.filter(
  (relative) => !INTEGRATION_OVERLAY_CHANGED.has(relative),
);
const missingOverlay = [
  ...INTEGRATION_OVERLAY_ADDED,
  ...INTEGRATION_OVERLAY_CHANGED,
].filter((relative) => !vendorSet.has(relative));

assert.deepEqual(missing, [], `Vendored source is missing:\n${missing.join('\n')}`);
assert.deepEqual(
  unexpectedExtra,
  [],
  `Vendored source has unexpected structural drift:\n${unexpectedExtra.join('\n')}`,
);
assert.deepEqual(
  unexpectedChanged,
  [],
  `Vendored source has unexpected content drift:\n${unexpectedChanged.join('\n')}`,
);
assert.deepEqual(
  missingOverlay,
  [],
  `AI Novel integration overlay is incomplete:\n${missingOverlay.join('\n')}`,
);

console.log(
  JSON.stringify({
    ok: true,
    mode: 'reference-plus-integration-overlay',
    sourceRoot,
    vendorRoot,
    sourceFiles: sourceFiles.length,
    vendorFiles: vendorFiles.length,
    upstreamExactFiles: sourceFiles.length - changed.length,
    intentionalChanged: changed.sort(),
    intentionalAdded: extra.sort(),
    unexpectedDrift: 0,
  }),
);
console.log('VERIFY_OK xinchao-vendor-reference-plus-overlay');
