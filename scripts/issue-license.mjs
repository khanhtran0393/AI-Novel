/**
 * Seller CLI: issue a HWID-bound Pro token through the canonical license API.
 * The API signs and persists the token to Supabase before returning it.
 *
 *   node scripts/issue-license.mjs --hwid abc12345 --expDays 365
 *   node scripts/issue-license.mjs --hwid abc12345 --expDays 36500
 */
function arg(name, fallback = '') {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] || fallback : fallback;
}

const hwid = arg('hwid').trim().toLowerCase();
const expDays = Math.max(1, Number(arg('expDays', '365')) || 365);
const apiBase = (
  arg('api') ||
  process.env.AINOVEL_LICENSE_API_URL ||
  'http://127.0.0.1:3000'
).replace(/\/+$/, '');
const adminKey = (
  arg('admin-key') ||
  process.env.AINOVEL_ENTITLEMENT_ADMIN_KEY ||
  ''
).trim();

if (hwid.length < 8) {
  console.error('--hwid must contain at least 8 characters.');
  process.exit(1);
}
if (!adminKey) {
  console.error(
    'Missing AINOVEL_ENTITLEMENT_ADMIN_KEY (or --admin-key). Token was not issued.',
  );
  process.exit(1);
}

const response = await fetch(`${apiBase}/api/entitlement/issue`, {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    'x-ainovel-admin-key': adminKey,
  },
  body: JSON.stringify({
    adminKey,
    hwid,
    expSeconds: Math.floor(expDays * 86400),
  }),
});
const payload = await response.json().catch(() => ({}));
if (!response.ok || payload?.ok !== true || !payload?.licenseId) {
  console.error(
    JSON.stringify(
      {
        ok: false,
        status: response.status,
        error:
          payload?.error ||
          payload?.message ||
          'License API did not confirm Supabase ledger.',
      },
      null,
      2,
    ),
  );
  process.exit(1);
}
console.log(JSON.stringify(payload, null, 2));
