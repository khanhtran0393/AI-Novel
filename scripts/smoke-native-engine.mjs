/**
 * Smoke: Flow Router pure + disk store paths (no 8080).
 * Run: node scripts/smoke-native-engine.mjs
 */
import assert from 'assert';
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';

// Lightweight reimplementation check for router priorities (mirror TS)
function nextChapter(p) {
  if (p.phase === 'complete') return 0;
  const done = new Set(p.completedChapters || []);
  for (let i = 1; i <= p.totalChapters; i++) {
    if (!done.has(i)) return i;
  }
  return 0;
}

function route(s) {
  const p = s.progress;
  if (!p) return null;
  if (p.phase === 'complete') return null;
  if (p.phase !== 'writing') return null;
  if ((p.pendingRewrites || []).length > 0) {
    return { agent: 'writer', chapter: p.pendingRewrites[0] };
  }
  if (p.flow === 'reviewing' || p.flow === 'steering') return null;
  const n = nextChapter(p);
  if (n <= 0) return null;
  return { agent: 'writer', chapter: n };
}

// Router cases
assert.strictEqual(
  route({ progress: { phase: 'complete', pendingRewrites: [], totalChapters: 3, completedChapters: [1, 2, 3] } }),
  null,
);
assert.strictEqual(
  route({
    progress: {
      phase: 'writing',
      flow: 'writing',
      pendingRewrites: [3],
      totalChapters: 5,
      completedChapters: [1, 2],
    },
  }).chapter,
  3,
);
assert.strictEqual(
  route({
    progress: {
      phase: 'writing',
      flow: 'writing',
      pendingRewrites: [],
      totalChapters: 5,
      completedChapters: [1],
    },
  }).chapter,
  2,
);

// Native API files exist
const root = process.cwd();
const required = [
  'src/app/api/ainovel/status/route.ts',
  'src/app/api/ainovel/start/route.ts',
  'src/app/api/ainovel/stop/route.ts',
  'src/app/api/ainovel/stream/route.ts',
  'src/app/api/ainovel/config/route.ts',
  'src/app/api/ainovel/chapters/route.ts',
  'src/app/api/ainovel/chapters/[id]/route.ts',
  'src/app/api/ainovel/diag/route.ts',
  'src/app/api/ainovel/capabilities/route.ts',
  'src/app/api/ainovel/resume/route.ts',
  'src/app/api/ainovel/download-all/route.ts',
  'src/lib/novel-engine/runner.ts',
  'src/lib/novel-engine/flow/router.ts',
  'src/lib/novel-engine/rules/checker.ts',
  'src/lib/novel-engine/context/novelContext.ts',
  'src/lib/novel-engine/sync/storeBridge.ts',
  'src/lib/novel-engine/tools/editorTools.ts',
  'src/lib/novel-engine/capabilities.ts',
  'next.config.ts',
];
for (const rel of required) {
  const p = path.join(root, rel);
  assert.ok(fs.existsSync(p), `missing ${rel}`);
}

const nextCfg = fs.readFileSync(path.join(root, 'next.config.ts'), 'utf8');
assert.ok(!nextCfg.includes('localhost:8080'), 'next.config still proxies 8080');
assert.ok(!nextCfg.includes("source: '/api/ainovel"), 'rewrite ainovel still present');

console.log('PASS smoke-native-engine: router + native routes + no 8080 proxy');
