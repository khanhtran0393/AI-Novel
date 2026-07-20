/**
 * Print kid + SPKI pins for resources/license/public-keys/*.pem
 * Paste into src/lib/commercial/antiTamper.ts EMBEDDED_* arrays after rotation.
 */
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = path.join(root, 'resources', 'license', 'public-keys');
const kids = [];
const spkis = [];

for (const name of fs.readdirSync(dir).sort()) {
  if (!/\.(pem|pub)$/i.test(name)) continue;
  const pem = fs.readFileSync(path.join(dir, name));
  const key = crypto.createPublicKey(pem);
  const der = key.export({ type: 'spki', format: 'der' });
  const kid = crypto.createHash('sha256').update(der).digest('hex').slice(0, 16);
  const spki = crypto.createHash('sha256').update(der).digest('base64');
  kids.push(kid);
  spkis.push(spki);
  console.log(`${name}: kid=${kid} spki=${spki}`);
}

console.log('\n// antiTamper.ts');
console.log(
  'export const EMBEDDED_KEYRING_KID_PINS = ' +
    JSON.stringify(kids, null, 2) +
    ' as const;',
);
console.log(
  'export const EMBEDDED_KEYRING_SPKI_PINS = ' +
    JSON.stringify(spkis, null, 2) +
    ' as const;',
);
