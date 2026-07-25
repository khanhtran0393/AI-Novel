/**
 * Build the vendored XinChao-Cut web runtime without using the reference repo.
 * The relative Vite base keeps the artifact portable; Electron serves it over
 * a loopback-only host at runtime.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = process.cwd();
const editorRoot = path.join(root, 'tools', 'xinchao-cut');
const npmCli = process.env.npm_execpath;
assert.ok(npmCli && fs.existsSync(npmCli), 'npm_execpath is unavailable');

function run(args, cwd = root) {
  const result = spawnSync(process.execPath, [npmCli, ...args], {
    cwd,
    encoding: 'utf8',
    windowsHide: true,
    stdio: 'inherit',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`npm ${args.join(' ')} failed with exit ${result.status}`);
  }
}

run(['run', 'xinchao:verify']);
run(['--prefix', editorRoot, 'run', 'typecheck']);
run(['--prefix', editorRoot, 'run', 'build', '--', '--base', './']);

const indexPath = path.join(editorRoot, 'dist', 'index.html');
assert.ok(fs.existsSync(indexPath), `Missing XinChao-Cut build: ${indexPath}`);
const html = fs.readFileSync(indexPath, 'utf8');
assert.match(html, /(?:src|href)=["']\.\/assets\//, 'Build has no relative asset reference');
assert.doesNotMatch(
  html,
  /(?:src|href)=["']\/assets\//,
  'Build contains root-absolute asset references',
);

const assetsDir = path.join(editorRoot, 'dist', 'assets');
const assets = fs.readdirSync(assetsDir);
assert.ok(assets.length > 0, 'XinChao-Cut build produced no assets');

console.log(
  JSON.stringify({
    ok: true,
    editorRoot,
    indexPath,
    assets: assets.length,
    bytes: fs.statSync(indexPath).size,
  }),
);
console.log('BUILD_OK xinchao-web-runtime');
