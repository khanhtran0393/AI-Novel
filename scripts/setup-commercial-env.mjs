/**
 * Configure the installed customer app. This file intentionally accepts only
 * public/non-secret values; private signing/admin/webhook keys never belong here.
 *
 *   node scripts/setup-commercial-env.mjs --license-api https://license.example.com
 *     --update-feed https://updates.example.com/ai-novel --force
 */
import fs from 'fs';
import os from 'os';
import path from 'path';

function arg(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] || '' : '';
}

function hasFlag(name) {
  return process.argv.includes(`--${name}`);
}

function httpsUrl(name, value, required) {
  const normalized = String(value || '').trim().replace(/\/$/, '');
  if (!normalized && !required) return '';
  if (!/^https:\/\//i.test(normalized)) {
    console.error(`${name} must be an HTTPS URL.`);
    process.exit(1);
  }
  return normalized;
}

const licenseApi = httpsUrl(
  'AINOVEL_LICENSE_API_URL',
  arg('license-api') || process.env.AINOVEL_LICENSE_API_URL,
  true,
);
const updateFeed = httpsUrl(
  'AINOVEL_UPDATE_FEED_URL',
  arg('update-feed') || process.env.AINOVEL_UPDATE_FEED_URL,
  false,
);
const appData =
  process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
const target = path.join(appData, 'ai-novel-script-generator', '.env.commercial');

if (fs.existsSync(target) && !hasFlag('force')) {
  console.error(`Exists: ${target}`);
  console.error('Re-run with --force to overwrite.');
  process.exit(2);
}

fs.mkdirSync(path.dirname(target), { recursive: true });
const content = `# AI Novel customer config — no seller secrets
AINOVEL_ENTITLEMENT_MODE=enforce
AINOVEL_LICENSE_API_URL=${licenseApi}
AINOVEL_TRIAL_ENABLED=1
AINOVEL_ALLOW_LOCAL_TRIAL=0
AINOVEL_UPDATE_CHANNEL=stable
AINOVEL_UPDATE_FEED_URL=${updateFeed}
AINOVEL_UPDATE_CHECK_ON_LAUNCH=${updateFeed ? '1' : '0'}
AINOVEL_UPDATE_ALLOW_PRERELEASE=0
`;
fs.writeFileSync(target, content, 'utf8');
console.log(JSON.stringify({ ok: true, path: target, licenseApi, updateFeed }, null, 2));
