/**
 * Generate the seller-only Ed25519 key pair and non-secret packaged public key.
 * Private material is written outside the repository by default.
 *
 *   node scripts/gen-commercial-secrets.mjs
 *   node scripts/gen-commercial-secrets.mjs --force
 *   node scripts/gen-commercial-secrets.mjs --seller-dir D:\\secure\\ainovel-seller
 */
import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(scriptDir, '..');

function arg(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] || '' : '';
}

function hasFlag(name) {
  return process.argv.includes(`--${name}`);
}

function randomHex(bytes) {
  return crypto.randomBytes(bytes).toString('hex');
}

const localAppData =
  process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
const sellerDir = path.resolve(
  arg('seller-dir') || path.join(localAppData, 'AI Novel Seller'),
);
const publicDir = path.join(root, 'resources', 'license', 'public-keys');
const privatePath = path.join(sellerDir, 'entitlement-private.pem');
const sellerPublicPath = path.join(sellerDir, 'entitlement-public.pem');
const sellerEnvPath = path.join(sellerDir, '.env.seller');

if (
  !hasFlag('force') &&
  (fs.existsSync(privatePath) || fs.existsSync(sellerEnvPath))
) {
  console.error(`Seller key already exists: ${sellerDir}`);
  console.error('Use --force only for an intentional key rotation.');
  process.exit(2);
}

const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
const publicPem = publicKey.export({ type: 'spki', format: 'pem' });
const privatePem = privateKey.export({ type: 'pkcs8', format: 'pem' });
const publicDer = publicKey.export({ type: 'spki', format: 'der' });
const kid = crypto.createHash('sha256').update(publicDer).digest('hex').slice(0, 16);
const packagedPublicPath = path.join(publicDir, `${kid}.pem`);

fs.mkdirSync(sellerDir, { recursive: true });
fs.mkdirSync(publicDir, { recursive: true });
fs.writeFileSync(privatePath, privatePem, { encoding: 'utf8', mode: 0o600 });
fs.writeFileSync(sellerPublicPath, publicPem, 'utf8');
fs.writeFileSync(packagedPublicPath, publicPem, 'utf8');

const sellerEnv = `# AI Novel seller/backend only — generated ${new Date().toISOString()}
AINOVEL_ENTITLEMENT_MODE=enforce
AINOVEL_ENTITLEMENT_PRIVATE_KEY_FILE=${privatePath.replace(/\\/g, '/')}
AINOVEL_ENTITLEMENT_PUBLIC_KEY_FILE=${sellerPublicPath.replace(/\\/g, '/')}
AINOVEL_ENTITLEMENT_ADMIN_KEY=${randomHex(24)}
AINOVEL_PAYMENT_WEBHOOK_SECRET=${randomHex(24)}
AINOVEL_TELEGRAM_WEBHOOK_SECRET=${randomHex(16)}
`;
fs.writeFileSync(sellerEnvPath, sellerEnv, { encoding: 'utf8', mode: 0o600 });

console.log(
  JSON.stringify(
    {
      ok: true,
      algorithm: 'Ed25519',
      kid,
      sellerDir,
      sellerEnv: sellerEnvPath,
      privateKey: privatePath,
      packagedPublicKey: packagedPublicPath,
    },
    null,
    2,
  ),
);
console.error('Back up the seller directory offline. Never copy it to customer machines.');
