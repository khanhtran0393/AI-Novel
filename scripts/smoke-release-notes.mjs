/**
 * Smoke: release notes changelog between versions.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const require = createRequire(import.meta.url);

const jsonPath = path.join(root, 'resources', 'commercial', 'release-notes.json');
assert.ok(fs.existsSync(jsonPath), 'release-notes.json missing');
const doc = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
assert.ok(doc.versions?.['1.0.3']?.items?.length > 0);

const en = require(path.join(root, 'electron', 'releaseNotes.js'));
const between = en.collectChangelogBetween('1.0.2', '1.0.3', doc);
assert.equal(between.fromVersion, '1.0.2');
assert.equal(between.toVersion, '1.0.3');
assert.ok(between.blocks.length >= 1);
assert.ok(between.items.length >= 1);
assert.ok(
  between.items.some((s) => /LA Studio|Trial|Pro/i.test(s)),
  'expected LA Studio item in 1.0.3 notes',
);

const multi = en.collectChangelogBetween('1.0.0', '1.0.3', doc);
assert.ok(multi.blocks.length >= 2, 'multi-version span should list several blocks');

const feed = en.normalizeFeedReleaseNotes('- Fix A\n* Fix B\n');
assert.deepEqual(feed, ['Fix A', 'Fix B']);

console.log(
  JSON.stringify({
    ok: true,
    betweenItems: between.items.length,
    multiBlocks: multi.blocks.length,
  }),
);
console.log('PASS smoke-release-notes');
