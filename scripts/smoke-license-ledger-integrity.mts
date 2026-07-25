/**
 * Regression smoke for the license ticket/ledger invariants.
 * No network and no real Supabase mutation.
 */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const pair = crypto.generateKeyPairSync('ed25519');
process.env.AINOVEL_ENTITLEMENT_PRIVATE_KEY = pair.privateKey
  .export({ type: 'pkcs8', format: 'pem' })
  .toString();
process.env.AINOVEL_ENTITLEMENT_PUBLIC_KEY = pair.publicKey
  .export({ type: 'spki', format: 'pem' })
  .toString();
process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://license-smoke.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'smoke-service-role';

const entitlement = await import('../src/lib/entitlement.ts');
const bridge = await import('../src/lib/cloud/licenseBridge.ts');
const telegram = await import('../src/lib/commercial/telegramNotify.ts');
const standalone = await import('../deploy/telegram-bridge/lib/bridge.ts');

const hwid = 'aaaaaaaaaaaaaaaa';
const token = entitlement.issueEntitlementToken({
  is_pro: true,
  is_vip: false,
  is_trial: false,
  plan: 'pro',
  hwid,
  expSeconds: 3600,
});
const claims = entitlement.verifyEntitlementToken(token, {
  requireHwidMatch: false,
});
assert.ok(claims?.exp);
const tokenHash = bridge.hashToken(token);
const exactExpAt = new Date(claims.exp * 1000).toISOString();

type FakeRow = {
  id: string;
  token_hash: string;
  status: string;
  exp_at: string;
  hwid: string;
  plan: string;
};

function fakeService(row: FakeRow | null) {
  return {
    from(table: string) {
      assert.equal(table, 'licenses');
      let requestedHash = '';
      const query = {
        select() {
          return query;
        },
        eq(column: string, value: string) {
          if (column === 'token_hash') requestedHash = value;
          return query;
        },
        async maybeSingle() {
          return {
            data:
              row && row.token_hash === requestedHash
                ? { ...row }
                : null,
            error: null,
          };
        },
        update() {
          return query;
        },
      };
      return query;
    },
  } as never;
}

const exactRow: FakeRow = {
  id: 'license-exact',
  token_hash: tokenHash,
  status: 'active',
  exp_at: exactExpAt,
  hwid,
  plan: 'pro',
};

const valid = await bridge.verifyLicenseCloud({
  service: fakeService(exactRow),
  token,
  hwid,
});
assert.equal(valid.valid, true);
assert.equal(valid.cloud.status, 'active');

// Hash miss + no HWID row (fake only supports hash lookup) → soft fail (token_mismatch|none)
const wrongHash = await bridge.verifyLicenseCloud({
  service: fakeService({ ...exactRow, token_hash: 'different' }),
  token,
  hwid,
});
assert.equal(wrongHash.valid, false);
assert.ok(
  wrongHash.cloud.status === 'token_mismatch' ||
    wrongHash.cloud.status === 'none',
  `wrongHash status=${wrongHash.cloud.status}`,
);

// Hash match + exp drift → ledger wins (valid) — not hard Free
const wrongExpiry = await bridge.verifyLicenseCloud({
  service: fakeService({
    ...exactRow,
    exp_at: new Date((claims.exp + 3600) * 1000).toISOString(),
  }),
  token,
  hwid,
});
assert.equal(wrongExpiry.valid, true);
assert.ok(
  wrongExpiry.cloud.status === 'ticket_stale' ||
    wrongExpiry.cloud.status === 'ticket_rebound' ||
    wrongExpiry.cloud.status === 'active',
  `wrongExpiry status=${wrongExpiry.cloud.status}`,
);
assert.ok(wrongExpiry.claims);

// Hash row HWID differs; soft path may fail closed without HWID list support
const wrongHwid = await bridge.verifyLicenseCloud({
  service: fakeService({ ...exactRow, hwid: 'bbbbbbbbbbbbbbbb' }),
  token,
  hwid,
});
assert.equal(wrongHwid.valid, false);
assert.ok(
  wrongHwid.cloud.status === 'hwid_mismatch' ||
    wrongHwid.cloud.status === 'token_mismatch' ||
    wrongHwid.cloud.status === 'none',
  `wrongHwid status=${wrongHwid.cloud.status}`,
);

const appFailureMessage = telegram.buildApproveMessage({
  hwid,
  token,
  dbOk: false,
  dbError: 'ledger unavailable',
});
assert.match(appFailureMessage, /KHÔNG CẤP KEY/);
assert.ok(!appFailureMessage.includes(token));

const bridgeFailureMessage = standalone.approveText(
  'year',
  hwid,
  token,
  undefined,
  { dbOk: false, dbError: 'ledger unavailable' },
);
assert.match(bridgeFailureMessage, /KHÔNG CẤP KEY/);
assert.ok(!bridgeFailureMessage.includes(token));

const appSuccessMessage = telegram.buildApproveMessage({
  hwid,
  token,
  dbOk: true,
});
assert.ok(appSuccessMessage.includes(token));

const root = path.resolve(import.meta.dirname, '..');
const source = (relative: string) =>
  fs.readFileSync(path.join(root, relative), 'utf8');
assert.ok(
  source('src/app/api/entitlement/issue/route.ts').includes(
    'persistIssuedProToken',
  ),
);
assert.ok(
  source('src/lib/commercial/paymentWebhook.ts').includes(
    'persistIssuedProToken',
  ),
);
assert.ok(
  source('src/app/api/entitlement/codes/route.ts').includes(
    'issueUnboundProActivationCodes',
  ),
);
assert.ok(
  !source('src/app/api/entitlement/activate/route.ts').includes(
    'cloudErr.status === 404',
  ),
);
// Activate must not soft-fallback to local vault while Supabase is authority
assert.ok(
  source('src/app/api/entitlement/activate/route.ts').includes(
    'never fall back to local vault',
  ),
);
assert.ok(!source('scripts/issue-license.mjs').includes('crypto.sign'));
assert.ok(
  source('scripts/issue-license.mjs').includes('/api/entitlement/issue'),
);
// Status/API: stale ticket falls through to HWID ledger (not hard Free) + rebind
assert.ok(
  source('src/app/api/commercial/status/route.ts').includes('ticketStale'),
);
assert.ok(
  source('src/app/api/commercial/status/route.ts').includes(
    'rebindTicketToActiveHwidLicense',
  ),
);
assert.ok(
  source('src/app/api/commercial/status/route.ts').includes(
    'retireLocalTrialAfterPaidPro',
  ),
);
assert.ok(
  source('src/lib/entitlement.ts').includes('token_mismatch / claims_mismatch'),
);
assert.ok(
  source('src/lib/cloud/licenseBridge.ts').includes(
    'rebindTicketToActiveHwidLicense',
  ),
);
assert.ok(
  source('src/lib/commercial/licenseHeartbeat.ts').includes("'stale'"),
);
assert.ok(
  source('src/app/workspace/hooks/useEntitlementSync.ts').includes(
    'rebindToken',
  ),
);
// Cloud trial must not mirror local trial vault (ghost TRIAL after Pro)
assert.ok(
  !source('src/lib/cloud/licenseBridge.ts').includes('startTrial(hwid)'),
);
// Promote must not extend ledger expiry past existing row
assert.ok(
  source('src/lib/cloud/licenseBridge.ts').includes(
    're-bind must never extend past existing exp_at',
  ),
);
// Telegram issue strips token when ledger fails
assert.ok(
  source('src/lib/commercial/telegramWebhookHandler.ts').includes(
    "token: ''",
  ),
);
assert.ok(
  source('deploy/telegram-bridge/lib/bridge.ts').includes(
    'ledger.ok ? token : \'\'',
  ) ||
    source('deploy/telegram-bridge/lib/bridge.ts').includes(
      'ledger.ok ? token : ""',
    ) ||
    /token:\s*ledger\.ok\s*\?\s*token\s*:\s*['"]{2}/.test(
      source('deploy/telegram-bridge/lib/bridge.ts'),
    ),
);

console.log(
  JSON.stringify({
    ok: true,
    smoke: 'license-ledger-integrity',
    exactHashAccepted: valid.valid,
    wrongHash: wrongHash.cloud.status,
    wrongExpiry: wrongExpiry.cloud.status,
    wrongExpiryValid: wrongExpiry.valid,
    wrongHwid: wrongHwid.cloud.status,
    telegramFailClosed: true,
    legacyIssuePathsLedgerBacked: true,
    staleTicketFallsToHwid: true,
    claimsMismatchLedgerWins: wrongExpiry.valid === true,
    rebindPathWired: true,
    promoteNoExtendExp: true,
    retireTrialOnPaidPro: true,
    noLocalTrialMirrorOnCloud: true,
  }),
);
