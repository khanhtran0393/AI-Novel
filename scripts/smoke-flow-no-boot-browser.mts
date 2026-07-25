/**
 * Guard: workspace auto-bootstrap must NOT open Chrome on app start.
 * Browser open only on user login / gen preflight.
 */
import fs from 'fs';
import path from 'path';

const root = process.cwd();
const autoPath = path.join(
  root,
  'src/app/workspace/features/media/FlowAutoBootstrap.tsx',
);
const src = fs.readFileSync(autoPath, 'utf8');

function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error('FAIL:', msg);
    process.exit(1);
  }
  console.log('PASS:', msg);
}

assert(fs.existsSync(autoPath), 'FlowAutoBootstrap.tsx exists');
assert(/API\.flowStatus|flowStatus/.test(src), 'warms via flowStatus');
assert(
  !/API\.flowBootstrap|flowBootstrap|forceChrome\s*[:=]/.test(src),
  'no flowBootstrap / forceChrome on workspace mount',
);
assert(
  !/waitLoginMs|waitExtensionMs/.test(src),
  'no login wait on auto bootstrap (browser open path)',
);
assert(
  /bridge only|Bridge-only|không mở Chrome|CẤM/i.test(src),
  'comment documents bridge-only policy',
);

const docs = fs.readFileSync(path.join(root, 'docs/flow-bridge.md'), 'utf8');
assert(
  /warm-up bridge only|không.*mở Chrome/i.test(docs),
  'docs/flow-bridge says bridge only on workspace',
);

console.log('[smoke-flow-no-boot-browser] PASS');
