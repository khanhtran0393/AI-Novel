/**
 * Rebuild scratch/voice-probe-progress.json from backups + probe logs.
 * Prevents wipe loss when a probe race overwrites the file.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const cwd = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const scratch = path.join(cwd, 'scratch');
const outPath = path.join(scratch, 'voice-probe-progress.json');
const safePath = path.join(scratch, 'voice-probe-progress.safe.json');

const pass = {};

function mergeFile(f) {
  try {
    if (!fs.existsSync(f)) return 0;
    const j = JSON.parse(fs.readFileSync(f, 'utf8'));
    let n = 0;
    for (const [k, v] of Object.entries(j.pass || {})) {
      if (!pass[k]) {
        pass[k] = v;
        n++;
      }
    }
    return n;
  } catch {
    return 0;
  }
}

for (const name of [
  'voice-probe-progress.broken.json',
  'voice-probe-progress.bak.json',
  'voice-probe-progress.safe.json',
  'voice-probe-progress.json',
]) {
  const f = path.join(scratch, name);
  console.log('merge', name, mergeFile(f));
}

const reA = /\[(\d+)\/(\d+)\]\s+(\S+)\s+·\s+(.+?)\s+…\s+OK\s+\((\d+)B/;
const reB = /OK\s+\[(\d+)\/(\d+)\]\s+(\S+)\s+·\s+(.+?)\s+\((\d+)B/;

for (const name of fs.readdirSync(scratch)) {
  if (!/probe.*\.log$/i.test(name)) continue;
  const txt = fs.readFileSync(path.join(scratch, name), 'utf8');
  for (const line of txt.split(/\r?\n/)) {
    const m = line.match(reA) || line.match(reB);
    if (!m) continue;
    const platform = m[3];
    const id = m[4].trim();
    const bytes = Number(m[5]) || 0;
    const k = `${platform}::${id}`;
    if (!pass[k]) {
      pass[k] = {
        platform,
        id,
        name: id,
        bytes,
        at: new Date().toISOString(),
        recovered: true,
      };
    }
  }
}

const by = {};
for (const k of Object.keys(pass)) {
  const pl = k.split('::')[0];
  by[pl] = (by[pl] || 0) + 1;
}

const out = {
  pass,
  fail: {},
  at: new Date().toISOString(),
  note: 'restored-anti-wipe',
};
fs.writeFileSync(outPath, JSON.stringify(out, null, 2), 'utf8');
fs.writeFileSync(safePath, JSON.stringify(out, null, 2), 'utf8');
console.log('SAFE total', Object.keys(pass).length, by);
