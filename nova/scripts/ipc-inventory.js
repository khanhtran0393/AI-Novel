'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const IGNORE = /(?:node_modules|\\bundle(?:\\|$)|remotion-browser|app\.asar\.unpacked)/i;
const SOURCE = /\.js$/i;
const invoke = /ipc(?:Main|Renderer)\.(?:handle|on|invoke|send|sendSync)\(\s*['"]([^'"]+)['"]/g;
const event = /(?:sender|webContents)\.send\(\s*['"]([^'"]+)['"]/g;

function files(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (IGNORE.test(full)) continue;
    if (entry.isDirectory()) out.push(...files(full));
    else if (SOURCE.test(entry.name)) out.push(full);
  }
  return out;
}

function collect(re, text, set) {
  let match;
  while ((match = re.exec(text))) set.add(match[1]);
}

const channels = new Set();
const progress = new Set();
const scanned = files(ROOT);
for (const file of scanned) {
  const text = fs.readFileSync(file, 'utf8');
  collect(invoke, text, channels);
  collect(event, text, progress);
}
const result = {
  generatedAt: new Date().toISOString(),
  sourceFiles: scanned.map(file => path.relative(ROOT, file).replace(/\\/g, '/')).sort(),
  channels: [...channels].sort(),
  progressEvents: [...progress].sort(),
};
const output = path.join(ROOT, 'ipc-inventory.json');
fs.writeFileSync(output, JSON.stringify(result, null, 2) + '\n', 'utf8');
console.log(`IPC inventory: ${result.channels.length} channels, ${result.progressEvents.length} events, ${scanned.length} files`);
console.log(output);
