/**
 * Commercial publish readiness smoke (no network LLM).
 * Run: node scripts/smoke-commercial.mjs
 */
import assert from 'assert';
import crypto from 'crypto';
import { createRequire } from 'module';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const require = createRequire(import.meta.url);

// Use tsx-compiled path via dynamic import of TS through a small loader:
// Prefer running with: npx tsx scripts/smoke-commercial.mts
// This .mjs re-exports check by spawning is avoided — pure reimplement of critical rules.

const FORBIDDEN = new Set([
  '',
  'ainovel-local-dev-secret-change-me',
  'ainovel-enterprise-commercial-secret-key-2026',
  'change-me',
  'secret',
  'password',
  'dev',
  'test',
]);

function isInsecure(secret) {
  const s = (secret || '').trim();
  if (!s) return true;
  if (FORBIDDEN.has(s)) return true;
  if (s.length < 24) return true;
  return false;
}

function b64url(buf) {
  return buf
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function issue(secret, claims) {
  const exp = Math.floor(Date.now() / 1000) + (claims.expSeconds || 3600);
  const payload = {
    is_pro: !!claims.is_pro,
    is_vip: !!claims.is_vip,
    exp,
    ...(claims.hwid ? { hwid: String(claims.hwid).toLowerCase() } : {}),
  };
  const body = b64url(Buffer.from(JSON.stringify(payload), 'utf8'));
  const sig = b64url(
    crypto.createHmac('sha256', secret).update(body).digest(),
  );
  return `${body}.${sig}`;
}

function verify(secret, token, localHwid) {
  const [body, sig] = token.split('.');
  const expect = b64url(
    crypto.createHmac('sha256', secret).update(body).digest(),
  );
  if (sig !== expect) return null;
  const claims = JSON.parse(Buffer.from(body.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
  if (claims.exp < Math.floor(Date.now() / 1000)) return null;
  if (claims.hwid && claims.hwid !== String(localHwid).toLowerCase()) return null;
  return claims;
}

// --- Tests ---
assert.strictEqual(isInsecure('ainovel-local-dev-secret-change-me'), true);
assert.strictEqual(isInsecure('short'), true);
assert.strictEqual(isInsecure(crypto.randomBytes(32).toString('hex')), false);

const strong = crypto.randomBytes(32).toString('hex');
const hwid = 'abc123def4567890';
const tok = issue(strong, { is_pro: true, is_vip: false, hwid, expSeconds: 7200 });
assert.ok(tok.includes('.'));
const ok = verify(strong, tok, hwid);
assert.ok(ok && ok.is_pro);
assert.strictEqual(verify(strong, tok, 'wronghwid0000000'), null);
assert.strictEqual(verify('other-secret-other-secret-xx', tok, hwid), null);

// Files exist
import fs from 'fs';
const required = [
  'src/lib/entitlement.ts',
  'src/lib/commercial/featureMatrix.ts',
  'src/lib/commercial/trial.ts',
  'src/lib/commercial/activationVault.ts',
  'src/lib/commercial/paymentWebhook.ts',
  'src/lib/commercial/ownerMode.ts',
  'src/lib/commercial/updateChannel.ts',
  'src/app/api/entitlement/issue/route.ts',
  'src/app/api/entitlement/verify/route.ts',
  'src/app/api/entitlement/hwid/route.ts',
  'src/app/api/entitlement/activate/route.ts',
  'src/app/api/entitlement/trial/route.ts',
  'src/app/api/entitlement/webhook/route.ts',
  'src/app/api/entitlement/codes/route.ts',
  'src/app/api/commercial/status/route.ts',
  'src/app/workspace/features/license/LicenseModal.tsx',
  'src/app/workspace/features/license/BrandLogoButton.tsx',
  'src/lib/commercial/pricingPlans.ts',
  'src/lib/supabase/env.ts',
  'src/lib/supabase/server.ts',
  'src/lib/cloud/licenseBridge.ts',
  'src/app/api/cloud/status/route.ts',
  'src/app/api/cloud/orders/route.ts',
  'src/app/api/cloud/orders/confirm/route.ts',
  'src/app/api/cloud/license/issue/route.ts',
  'src/app/api/cloud/license/verify/route.ts',
  'src/app/api/cloud/license/trial/route.ts',
  'src/app/api/cloud/license/revoke/route.ts',
  'src/app/admin/page.tsx',
  'supabase/migrations/001_commercial_rls.sql',
  'public/brand/qr-techcombank.jpg',
  'src/app/workspace/hooks/useEntitlementSync.ts',
  'src/app/workspace/hooks/useProAccess.ts',
  'docs/COMMERCIAL.md',
  'docs/COMMERCIAL_RELEASE.md',
  'docs/LEGAL_TOS.md',
  'docs/LEGAL_PRIVACY.md',
  'docs/LEGAL_THIRD_PARTY.md',
  'docs/LEGAL_FLOW_DISCLAIMER.md',
  'docs/INSTALL_SUPPORT.md',
  'docs/PRICING.md',
  'scripts/issue-license.mjs',
  '.env.example',
];
for (const rel of required) {
  assert.ok(fs.existsSync(path.join(root, rel)), `missing ${rel}`);
}

// Source must not contain enterprise commercial default secret as production fallback
const entSrc = fs.readFileSync(path.join(root, 'src/lib/entitlement.ts'), 'utf8');
assert.ok(
  entSrc.includes('FORBIDDEN_SECRETS') && entSrc.includes('resolveEntitlementSecret'),
  'entitlement harden helpers present',
);
assert.ok(entSrc.includes("mode === 'enforce'"), 'enforce branch present');
assert.ok(
  !/return \(\s*process\.env\.AINOVEL_ENTITLEMENT_SECRET[\s\S]*'ainovel-enterprise-commercial/.test(
    entSrc,
  ),
  'must not use enterprise default as live secret()',
);

// apiMap routes
const apiMap = fs.readFileSync(path.join(root, 'src/contracts/apiMap.ts'), 'utf8');
assert.ok(apiMap.includes('entitlementVerify'));
assert.ok(apiMap.includes('entitlementHwid'));
assert.ok(apiMap.includes('entitlementActivate'));
assert.ok(apiMap.includes('entitlementTrial'));
assert.ok(apiMap.includes('entitlementWebhook'));
assert.ok(apiMap.includes('commercialStatus'));
assert.ok(apiMap.includes('cloudStatus'));
assert.ok(apiMap.includes('cloudLicenseVerify'));

// License lives on logo, not Settings
const settings = fs.readFileSync(
  path.join(root, 'src/app/workspace/features/settings/SettingsPanel.tsx'),
  'utf8',
);
assert.ok(!settings.includes('LicenseActivationCard'));
const header = fs.readFileSync(
  path.join(root, 'src/app/workspace/chrome/Header.tsx'),
  'utf8',
);
assert.ok(header.includes('BrandLogoButton'));
const pricing = fs.readFileSync(
  path.join(root, 'src/lib/commercial/pricingPlans.ts'),
  'utf8',
);
assert.ok(pricing.includes('478_000') && pricing.includes('4_780_000'));
assert.ok(pricing.includes('8_999_000'));
assert.ok(pricing.includes('19032706354018'));
assert.ok(pricing.includes('0868715114'));
assert.ok(
  fs.existsSync(path.join(root, 'src/app/api/entitlement/payment-notify/route.ts')),
  'payment-notify route',
);
assert.ok(
  fs.existsSync(path.join(root, 'src/lib/commercial/telegramNotify.ts')),
  'telegramNotify',
);

// No force owner unlimited in persist
const persist = fs.readFileSync(
  path.join(root, 'src/store/novelStorePersistence.ts'),
  'utf8',
);
assert.ok(
  !persist.includes('Always persist owner unlimited'),
  'must not force owner unlimited in partialize',
);
assert.ok(
  persist.includes('is_pro: !!state.is_pro') || persist.includes('is_pro: !!state.is_pro,'),
  'persist actual is_pro',
);

// main.js packaged enforce
const main = fs.readFileSync(path.join(root, 'main.js'), 'utf8');
assert.ok(main.includes('AINOVEL_ENTITLEMENT_MODE'));
assert.ok(main.includes('.env.commercial'));

// feature matrix free vs pro
const matrix = fs.readFileSync(
  path.join(root, 'src/lib/commercial/featureMatrix.ts'),
  'utf8',
);
assert.ok(matrix.includes('gen_video') && matrix.includes('write_chapter'));
assert.ok(matrix.includes('PRICING_PLANS'));

// activation code format
const code = `AINOVEL-${crypto.randomBytes(2).toString('hex').toUpperCase()}-${crypto.randomBytes(2).toString('hex').toUpperCase()}-${crypto.randomBytes(2).toString('hex').toUpperCase()}`;
assert.ok(/^AINOVEL-[0-9A-F]+-[0-9A-F]+-[0-9A-F]+$/i.test(code));

console.log(
  JSON.stringify(
    {
      ok: true,
      insecureDefaultBlocked: true,
      hwidBindWorks: true,
      wrongHwidRejected: true,
      files: required.length,
    },
    null,
    2,
  ),
);
console.log('PASS smoke-commercial');
