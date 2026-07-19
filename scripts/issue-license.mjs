/**
 * Seller CLI: issue a HWID-bound Ed25519 Pro token.
 *
 *   node scripts/issue-license.mjs --hwid abc12345 --expDays 365
 *   node scripts/issue-license.mjs --hwid abc12345 --expDays 36500
 */
import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';

function arg(name, fallback = '') {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] || fallback : fallback;
}

function b64url(buffer) {
  return buffer
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

const localAppData =
  process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
const defaultKey = path.join(localAppData, 'AI Novel Seller', 'entitlement-private.pem');
const keyPath = path.resolve(
  arg('private-key') || process.env.AINOVEL_ENTITLEMENT_PRIVATE_KEY_FILE || defaultKey,
);
const hwid = arg('hwid').trim().toLowerCase();
const expDays = Math.max(1, Number(arg('expDays', '365')) || 365);

if (hwid.length < 8) {
  console.error('--hwid must contain at least 8 characters.');
  process.exit(1);
}
if (!fs.existsSync(keyPath)) {
  console.error(`Private key not found: ${keyPath}`);
  console.error('Run npm run commercial:secrets first.');
  process.exit(1);
}

const privateKey = crypto.createPrivateKey(fs.readFileSync(keyPath, 'utf8'));
if (privateKey.asymmetricKeyType !== 'ed25519') {
  console.error('License private key must be Ed25519.');
  process.exit(1);
}
const publicKey = crypto.createPublicKey(privateKey);
const kid = crypto
  .createHash('sha256')
  .update(publicKey.export({ type: 'spki', format: 'der' }))
  .digest('hex')
  .slice(0, 16);
const now = Math.floor(Date.now() / 1000);
const payload = {
  is_pro: true,
  is_vip: false,
  plan: 'pro',
  exp: now + expDays * 86400,
  iat: now,
  ver: 2,
  hwid,
};
const body = b64url(Buffer.from(JSON.stringify(payload), 'utf8'));
const input = `AINOVEL2.${kid}.${body}`;
const signature = b64url(crypto.sign(null, Buffer.from(input, 'utf8'), privateKey));
const token = `${input}.${signature}`;

console.log(
  JSON.stringify(
    {
      ok: true,
      kind: 'token',
      plan: 'pro',
      hwid,
      expIso: new Date(payload.exp * 1000).toISOString(),
      token,
    },
    null,
    2,
  ),
);
