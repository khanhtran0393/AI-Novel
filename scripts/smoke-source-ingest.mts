/**
 * Smoke: multi-source ingest (detect + SSRF + HTML extract + optional live web).
 * Run: npx tsx scripts/smoke-source-ingest.mts
 */
import assert from 'node:assert/strict';
import {
  detectSourcePlatform,
  extractArticleFromHtml,
  assertSafePublicHttpUrl,
  fetchSourceIngest,
} from '../src/lib/source-ingest/index.ts';
import {
  detectClientSourcePlatform,
  isAnalyzableSourceUrl,
  sourceUrlHint,
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

console.log('=== smoke:source-ingest ===');

check('detect youtube watch', () => {
  assert.equal(
    detectSourcePlatform('https://www.youtube.com/watch?v=dQw4w9WgXcQ'),
    'youtube',
  );
  assert.equal(detectClientSourcePlatform('https://youtu.be/dQw4w9WgXcQ'), 'youtube');
  assert.equal(isAnalyzableSourceUrl('https://youtu.be/dQw4w9WgXcQ'), true);
});

check('detect youtube playlist host still youtube (invalid id)', () => {
  assert.equal(
    detectSourcePlatform('https://www.youtube.com/playlist?list=PLtest'),
    'youtube',
  );
  assert.equal(isAnalyzableSourceUrl('https://www.youtube.com/playlist?list=PLtest'), false);
  assert.ok(sourceUrlHint('https://www.youtube.com/playlist?list=PLtest').length > 0);
});

check('detect web article', () => {
  assert.equal(detectSourcePlatform('https://example.com/blog/my-post'), 'web');
  assert.equal(detectClientSourcePlatform('https://example.com/a'), 'web');
  assert.equal(isAnalyzableSourceUrl('https://example.com/a'), true);
});

check('ssrf blocks localhost', () => {
  const r = assertSafePublicHttpUrl('http://127.0.0.1/secret');
  assert.equal(r.ok, false);
  const r2 = assertSafePublicHttpUrl('http://localhost:3000');
  assert.equal(r2.ok, false);
});

check('ssrf allows public https', () => {
  const r = assertSafePublicHttpUrl('https://example.com/path');
  assert.equal(r.ok, true);
  if (r.ok) assert.equal(r.url.hostname, 'example.com');
});

check('html extract article', () => {
  const html = `
    <html><head>
      <title>Demo Story Title</title>
      <meta name="description" content="A short blurb about the story." />
    </head><body>
      <nav>Home About</nav>
      <article>
        <h1>Demo Story Title</h1>
        <p>Once upon a time there was a hero who walked into the dark forest.
        The trees whispered secrets about a forgotten kingdom and a broken crown.
        After three nights of rain the hero found a lantern that never went out.
        This paragraph is long enough to pass the extract threshold for readability scoring.
        More sentences help the scorer prefer article over nav noise. End.</p>
      </article>
      <footer>Copyright</footer>
    </body></html>
  `;
  const ex = extractArticleFromHtml(html, { siteHost: 'example.com' });
  assert.ok(ex.title.toLowerCase().includes('demo story'));
  assert.ok(ex.text.length >= 80, `text too short: ${ex.text.length}`);
  assert.ok(
    ex.method === 'web_readability' || ex.method === 'web_direct',
    `method=${ex.method}`,
  );
});

await checkAsync('youtube invalid does not become web scrape path', async () => {
  const r = await fetchSourceIngest('https://www.youtube.com/playlist?list=PLxxxx');
  assert.equal(r.platform, 'youtube');
  assert.equal(r.ok, false);
  assert.equal(r.errorCode, 'INVALID_URL');
});

await checkAsync('live fetch example.com (network)', async () => {
  const r = await fetchSourceIngest('https://example.com/');
  assert.equal(r.platform, 'web');
  if (r.ok) {
    assert.ok((r.text || '').length > 20 || (r.title || '').length > 0);
    console.log(`    live ok source=${r.source} words=${r.wordCount} title=${r.title}`);
  } else {
    assert.ok(r.errorCode);
    console.log(`    live soft: ${r.errorCode} (network may be restricted)`);
  }
});

if (failed > 0) {
  console.error(`\nFAILED ${failed} check(s)`);
  process.exit(1);
}
console.log('\nAll source-ingest smoke checks passed.');
