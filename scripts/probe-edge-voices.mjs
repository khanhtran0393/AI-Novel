import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { EdgeTTS } = require('node-edge-tts');
const cwd = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const src = fs.readFileSync(path.join(cwd, 'src/lib/voiceCatalog.ts'), 'utf8');
const s2 = src.indexOf('const EDGE_VI');
const e2 = src.indexOf('const HOTAI_VI');
const edge = src.slice(s2, e2);
const ids = [...new Set([...edge.matchAll(/v\('([^']+)'/g)].map((m) => m[1]))];

const out = path.join(cwd, 'scratch', 'voice-audit');
fs.mkdirSync(out, { recursive: true });

async function probe(id, text) {
  const p = path.join(out, id.replace(/[^a-zA-Z0-9_-]/g, '_') + '.mp3');
  try {
    if (fs.existsSync(p)) fs.unlinkSync(p);
  } catch {
    /* ignore */
  }
  const parts = id.split('-');
  const lang = parts.length >= 2 ? `${parts[0]}-${parts[1]}` : 'en-US';
  const tts = new EdgeTTS({
    voice: id,
    lang,
    outputFormat: 'audio-24khz-48kbitrate-mono-mp3',
    timeout: 60_000,
  });
  await tts.ttsPromise(text, p);
  const sz = fs.statSync(p).size;
  if (sz < 200) throw new Error(`small ${sz}`);
  return sz;
}

console.log('Probing', ids.length, 'Edge catalog voices…');
let pass = 0;
let fail = 0;
const fails = [];
for (let i = 0; i < ids.length; i++) {
  const id = ids[i];
  try {
    const text = id.startsWith('vi-')
      ? 'Xin chao, day la giong doc thu.'
      : 'Hello, this is a voice test.';
    const sz = await probe(id, text);
    pass++;
    console.log(`OK  [${i + 1}/${ids.length}] ${id} (${sz}B)`);
  } catch (e) {
    fail++;
    fails.push(id);
    console.log(
      `FAIL [${i + 1}/${ids.length}] ${id}: ${(e.message || e).toString().slice(0, 100)}`,
    );
  }
  await new Promise((r) => setTimeout(r, 250));
}
console.log(`DONE pass=${pass} fail=${fail}`);
if (fails.length) console.log('FAILS:', fails.join(', '));
fs.writeFileSync(
  path.join(cwd, 'scratch', 'edge-probe-result.json'),
  JSON.stringify({ pass, fail, fails, total: ids.length, at: new Date().toISOString() }, null, 2),
);
process.exit(fail ? 1 : 0);
