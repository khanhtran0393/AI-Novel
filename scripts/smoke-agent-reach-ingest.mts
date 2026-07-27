/**
 * Smoke test: Agent-Reach Multi-Source Ingestion Engine (Runtime Verification)
 * Run: npx tsx scripts/smoke-agent-reach-ingest.mts
 */
import assert from 'node:assert/strict';
import {
  fetchMultiSourceIngest,
  fetchSourceIngest,
} from '../src/lib/source-ingest/index.ts';
import {
  extractUrlsFromInput,
  isAnalyzableMultiSourceInput,
} from '../src/lib/sourceIngestId.ts';

let failed = 0;

function check(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  OK  ${name}`);
  } catch (e) {
    failed += 1;
    console.error(`  FAIL ${name}`);
    console.error(e);
  }
}

async function checkAsync(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    console.log(`  OK  ${name}`);
  } catch (e) {
    failed += 1;
    console.error(`  FAIL ${name}`);
    console.error(e);
  }
}

console.log('=== AGENT-REACH MULTI-SOURCE INGESTION SMOKE TEST ===\n');

check('extractUrlsFromInput handles single and multiline URLs', () => {
  const multiline = `
    https://www.youtube.com/watch?v=dQw4w9WgXcQ
    https://example.com/blog/my-story
    https://youtu.be/dQw4w9WgXcQ
  `;
  const urls = extractUrlsFromInput(multiline);
  assert.equal(urls.length, 3, `Expected 3 distinct URL strings, got ${urls.length}`);
  assert.ok(urls.includes('https://www.youtube.com/watch?v=dQw4w9WgXcQ'));
  assert.ok(urls.includes('https://example.com/blog/my-story'));
});

check('isAnalyzableMultiSourceInput validates multi-line inputs', () => {
  const input = `
    invalid garbage line
    https://example.com/article-1
  `;
  assert.equal(isAnalyzableMultiSourceInput(input), true);
});

await checkAsync('fetchMultiSourceIngest combines YouTube + Web into fused knowledge block', async () => {
  const multiInput = `
    https://example.com/
    https://www.youtube.com/watch?v=dQw4w9WgXcQ
  `;
  const res = await fetchMultiSourceIngest(multiInput);
  assert.equal(res.ok, true, `Ingest failed: ${res.error}`);
  assert.equal(res.isMultiSource, true);
  assert.ok((res.sourcesCount || 0) >= 1, `Expected sourcesCount >= 1, got ${res.sourcesCount}`);
  assert.ok(res.text && res.text.includes('[NGUỒN 1:'), 'Fused text missing [NGUỒN 1:] tag');
  console.log(`    Multi-source OK: sources=${res.sourcesCount} totalWords=${res.wordCount}`);
  console.log(`    Fused Sample:\n${(res.text || '').slice(0, 200)}...\n`);
});

if (failed > 0) {
  console.error(`\nFAILED ${failed} check(s)`);
  process.exit(1);
}

console.log('All Agent-Reach multi-source smoke checks passed cleanly.');
