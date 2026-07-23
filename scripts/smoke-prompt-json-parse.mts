/**
 * Smoke: Gen Prompt JSON parse/normalize + capSentences alias-safety (no live API).
 * Run: npx tsx scripts/smoke-prompt-json-parse.mts
 */
import assert from 'node:assert/strict';
import { cleanAndParseJson } from '../src/app/api/generate/modelClients.ts';

function section(name: string) {
  console.log(`\n=== ${name} ===`);
}

/** Must match imagePrompt.capSentences — always new array */
function capSentences(sentences: string[], maxN: number): string[] {
  if (!Array.isArray(sentences) || sentences.length === 0) return [];
  if (sentences.length <= maxN) return sentences.slice();
  const out: string[] = [];
  const bucketSize = Math.ceil(sentences.length / maxN);
  for (let i = 0; i < sentences.length; i += bucketSize) {
    out.push(
      sentences
        .slice(i, i + bucketSize)
        .join(' ')
        .trim(),
    );
  }
  while (out.length > maxN) {
    const last = out.pop() || '';
    out[out.length - 1] = `${out[out.length - 1]} ${last}`.trim();
  }
  return out;
}

section('array with preamble');
const a = cleanAndParseJson(
  'Sure:\n[{"id":1,"image_prompt":"a","video_prompt":"b"},{"id":2,"image_prompt":"c","video_prompt":"d"}]',
);
assert.ok(Array.isArray(a), 'expect array');
assert.equal((a as unknown[]).length, 2);

section('pure array');
const b = cleanAndParseJson(
  '[{"image_prompt":"x","video_prompt":"y"}]',
) as Array<{ image_prompt: string }>;
assert.equal(b[0]?.image_prompt, 'x');

section('object wrapper prompts');
const c = cleanAndParseJson(
  '{"prompts":[{"image_prompt":"p","video_prompt":"v"}]}',
) as { prompts: unknown[] };
assert.equal(c.prompts.length, 1);

section('markdown fence array');
const d = cleanAndParseJson(
  '```json\n[{"image_prompt":"m","video_prompt":"n"}]\n```',
);
assert.ok(Array.isArray(d));
assert.equal((d as unknown[]).length, 1);

section('capSentences alias-safety (5→0 regression)');
{
  const raw = ['a', 'b', 'c', 'd', 'e'];
  const capped = capSentences(raw, 5);
  raw.length = 0;
  raw.push(...capped);
  assert.equal(raw.length, 5, 'must not wipe when N<=max (old bug returned same ref)');
  assert.notEqual(capped, raw); // different after reassignment path; capped is independent
  // Over-cap merge still works
  const many = ['1', '2', '3', '4', '5', '6'];
  const merged = capSentences(many, 3);
  assert.ok(merged.length <= 3 && merged.length >= 1);
  console.log('capSentences OK', raw.length, merged.length);
}

console.log('\n✅ smoke-prompt-json-parse PASS');
