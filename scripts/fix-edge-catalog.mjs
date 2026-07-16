/**
 * Remove Edge voice entries not present in Microsoft online list.
 * Only touches EDGE_* blocks in voiceCatalog.ts.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const cwd = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const catalogPath = path.join(cwd, 'src', 'lib', 'voiceCatalog.ts');
const EDGE_LIST_URL =
  'https://speech.platform.bing.com/consumer/speech/synthesize/readaloud/voices/list?trustedclienttoken=6A5AA1D4EAFF4E9FB37E23D68491D6F4';

const ms = await (await fetch(EDGE_LIST_URL, { signal: AbortSignal.timeout(30_000) })).json();
const msSet = new Set(ms.map((v) => v.ShortName));

let src = fs.readFileSync(catalogPath, 'utf8');
const start = src.indexOf('// ─── Edge TTS');
const end = src.indexOf('// ─── HotAI / VieNeu');
if (start < 0 || end < 0) throw new Error('Edge/HotAI markers not found');

const before = src.slice(0, start);
let edge = src.slice(start, end);
const after = src.slice(end);

const removed = [];
// Match full v(...) lines (with optional trailing comma)
edge = edge.replace(/^[ \t]*v\('([^']+)'[^;\n]*\),?[ \t]*\r?\n/gm, (full, id) => {
  if (!/Neural|Multilingual/i.test(id) && !/^[a-z]{2}-[A-Z]{2}-/.test(id)) {
    return full;
  }
  if (msSet.has(id)) return full;
  removed.push(id);
  return '';
});

// tidy empty lines
edge = edge.replace(/\n{3,}/g, '\n\n');
// trailing comma before ]
edge = edge.replace(/,(\s*\])/g, '$1');

src = before + edge + after;
fs.writeFileSync(catalogPath, src, 'utf8');

const edge2 = src.slice(src.indexOf('// ─── Edge TTS'), src.indexOf('// ─── HotAI'));
const ids = [...edge2.matchAll(/v\('([^']+)'/g)].map((m) => m[1]);
const uniq = [...new Set(ids)];
const ok = uniq.filter((id) => msSet.has(id));
const bad = uniq.filter((id) => !msSet.has(id));

console.log(`Removed ${removed.length} dead Edge voices`);
console.log(removed.map((x) => `  - ${x}`).join('\n'));
console.log(`After unique=${uniq.length} ok=${ok.length} bad=${bad.length}`);
if (bad.length) {
  console.log('Still bad:', bad);
  process.exit(1);
}
console.log('PASS edge catalog cleaned');
