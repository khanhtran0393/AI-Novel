/**
 * Smoke: Telegram admin command parse + callback parse (no network).
 * Run: npx tsx scripts/smoke-telegram-admin.mts
 */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  DAY_KEY_PRESETS,
  buildGencodeDeliveryMessages,
  buildGencodePlanKeyboard,
  buildPickCallbackData,
  buildPlanPickerKeyboard,
  normalizeHwid,
  parseAdminCommand,
  parseGencodeArgs,
  resolveGencodeExpKey,
  tryParseBareHwid,
} from '../src/lib/commercial/telegramAdminCommands.ts';
import {
  buildApproveMessage,
  parseTelegramCallbackData,
} from '../src/lib/commercial/telegramNotify.ts';
import {
  createActivationCodes,
  redeemActivationCode,
} from '../src/lib/commercial/activationVault.ts';
import {
  extractActivationCode,
  isActivationCodeFormat,
} from '../src/lib/commercial/activationCodeSecurity.ts';
import {
  isUnboundLicenseHwid,
  unboundHwidForCode,
} from '../src/lib/cloud/licenseBridge.ts';

function ok(label: string) {
  console.log(`  OK  ${label}`);
}

// normalizeHwid
assert.equal(normalizeHwid('ab-cd-ef-12-34-56-78-90'), 'ABCDEF1234567890');
assert.equal(normalizeHwid('short'), null);
assert.equal(normalizeHwid('12345678'), '12345678');
ok('normalizeHwid');

// bare HWID
assert.equal(tryParseBareHwid('ABCDEF1234567890'), 'ABCDEF1234567890');
assert.equal(tryParseBareHwid('ab:cd:ef:12:34:56:78:90'), 'ABCDEF1234567890');
assert.equal(tryParseBareHwid('/gen foo'), null);
assert.equal(tryParseBareHwid('not a hwid at all'), null);
ok('tryParseBareHwid');

// commands
const help = parseAdminCommand('/help');
assert.equal(help?.kind, 'help');
const act = parseAdminCommand('/activate ABCDEF1234567890 year');
assert.equal(act?.kind, 'activate');
if (act?.kind === 'activate') {
  assert.equal(act.hwid, 'ABCDEF1234567890');
  assert.equal(act.planId, 'year');
}
const gen = parseAdminCommand('/gen ABCDEF1234567890');
assert.equal(gen?.kind, 'activate');
if (gen?.kind === 'activate') assert.equal(gen.planId, undefined);
const bare = parseAdminCommand('  abcd-ef12-3456-7890  ');
assert.equal(bare?.kind, 'bare_hwid');
const list = parseAdminCommand('/list revoked 5');
assert.equal(list?.kind, 'list');
if (list?.kind === 'list') {
  assert.equal(list.status, 'revoked');
  assert.equal(list.limit, 5);
}
const lookup = parseAdminCommand('/lookup abcd');
assert.equal(lookup?.kind, 'lookup');
const rev = parseAdminCommand('/revoke abcdef12-3456-7890-abcd-ef1234567890');
assert.equal(rev?.kind, 'revoke');
// Reply keyboard labels (no slash)
assert.equal(parseAdminCommand('🔑 Cấp key')?.kind, 'prompt_activate');
assert.equal(parseAdminCommand('🎟 Tạo mã')?.kind, 'prompt_gencode');
assert.equal(parseAdminCommand('🔎 Tra cứu')?.kind, 'prompt_lookup');
assert.equal(parseAdminCommand('📋 List active')?.kind, 'list');
assert.equal(parseAdminCommand('❓ Menu')?.kind, 'menu');
assert.equal(parseAdminCommand('/activate')?.kind, 'prompt_activate');
assert.equal(parseAdminCommand('/gencode')?.kind, 'prompt_gencode');
const gc = parseAdminCommand('/gencode 5 year');
assert.equal(gc?.kind, 'gencode');
if (gc?.kind === 'gencode') {
  assert.equal(gc.count, 5);
  assert.equal(gc.planId, 'year');
  assert.equal(gc.expSeconds, 60 * 60 * 24 * 365);
}
const gc2 = parseAdminCommand('/gencode 3 90d');
assert.equal(gc2?.kind, 'gencode');
if (gc2?.kind === 'gencode') {
  assert.equal(gc2.count, 3);
  assert.equal(gc2.expSeconds, 90 * 86400);
}
const gc3 = parseGencodeArgs(['year', '10']);
assert.equal(gc3.count, 10);
assert.equal(gc3.planId, 'year');
assert.equal(parseAdminCommand('/listcodes 20')?.kind, 'listcodes');
ok('parseAdminCommand + gencode');

// callbacks
const pickData = buildPickCallbackData('month', 'ABCDEF1234567890');
assert.ok(pickData.startsWith('pick:month:'));
const pick = parseTelegramCallbackData(pickData);
assert.equal(pick?.action, 'pick');
if (pick?.action === 'pick') {
  assert.equal(pick.planId, 'month');
  assert.equal(pick.expKey, 'month');
  assert.equal(pick.hwid, 'ABCDEF1234567890');
}
const pick3 = parseTelegramCallbackData(
  buildPickCallbackData('3d', 'ABCDEF1234567890'),
);
assert.equal(pick3?.action, 'pick');
if (pick3?.action === 'pick') {
  assert.equal(pick3.expKey, '3d');
  assert.equal(pick3.hwid, 'ABCDEF1234567890');
}
const issue = parseTelegramCallbackData('issue:lifetime:ABCDEF1234567890');
assert.equal(issue?.action, 'issue');
if (issue?.action === 'issue') assert.equal(issue.expKey, 'lifetime');
const issue7 = parseTelegramCallbackData('issue:7d:ABCDEF1234567890');
assert.equal(issue7?.action, 'issue');
if (issue7?.action === 'issue') assert.equal(issue7.expKey, '7d');
const rc = parseTelegramCallbackData(
  'revoke_confirm:aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
);
assert.equal(rc?.action, 'revoke_confirm');
assert.equal(parseTelegramCallbackData('pick_cancel')?.action, 'pick_cancel');
assert.equal(parseTelegramCallbackData('revoke_cancel')?.action, 'revoke_cancel');
const menuAct = parseTelegramCallbackData('menu:activate');
assert.equal(menuAct?.action, 'menu');
if (menuAct?.action === 'menu') assert.equal(menuAct.item, 'activate');
const menuGc = parseTelegramCallbackData('menu:gencode');
assert.equal(menuGc?.action, 'menu');
if (menuGc?.action === 'menu') assert.equal(menuGc.item, 'gencode');
const gp = parseTelegramCallbackData('gencode_plan:year');
assert.equal(gp?.action, 'gencode_plan');
if (gp?.action === 'gencode_plan') assert.equal(gp.expKey, 'year');
const gd = parseTelegramCallbackData('gencode_do:5:month');
assert.equal(gd?.action, 'gencode_do');
if (gd?.action === 'gencode_do') {
  assert.equal(gd.count, 5);
  assert.equal(gd.expKey, 'month');
}
assert.equal(parseTelegramCallbackData('gencode_cancel')?.action, 'gencode_cancel');
ok('parseTelegramCallbackData + gencode');

// Fail closed: a ledger failure must never expose the signed token.
{
  const secretToken = 'AINOVEL2.kid.payload.signature';
  const failed = buildApproveMessage({
    hwid: 'ABCDEF1234567890',
    token: secretToken,
    dbOk: false,
    dbError: 'Supabase unavailable',
  });
  assert.match(failed, /KHÔNG CẤP KEY/);
  assert.ok(!failed.includes(secretToken));
  const success = buildApproveMessage({
    hwid: 'ABCDEF1234567890',
    token: secretToken,
    dbOk: true,
  });
  assert.ok(success.includes(secretToken));
  ok('Telegram delivery is fail-closed on ledger error');
}

// unbound HWID helpers
assert.equal(isUnboundLicenseHwid('unbound:abcdef'), true);
assert.equal(isUnboundLicenseHwid('pending'), true);
assert.equal(isUnboundLicenseHwid('f925b0ff900599a0'), false);
assert.ok(unboundHwidForCode('AINOVEL-AAAA-BBBB-CCCC').startsWith('unbound:'));
ok('unboundHwid helpers');

// Exact activation-code grammar: accept seller codes, reject guesses/noisy variants.
{
  const valid = 'AINOVEL-A1B2-C3D4-E5F6';
  assert.equal(isActivationCodeFormat(valid), true);
  assert.equal(extractActivationCode(`Mã của bạn:\n${valid}\nHết.`), valid);
  for (const invalid of [
    'AINOVEL-A1B2-C3D4',
    'AINOVEL-A1B2-C3D4-E5F6-FFFF',
    'AINOVEL-AAAA-BBBB-***!',
    'AINOVEL2.AAAA.BBBB.CCCC',
    'AINOVEL-1234-5678-90',
  ]) {
    assert.equal(isActivationCodeFormat(invalid), false, invalid);
  }
  ok('strict activation code grammar');
}

// Day presets 1/3/7/15/30
assert.deepEqual([...DAY_KEY_PRESETS], [1, 3, 7, 15, 30]);
for (const d of DAY_KEY_PRESETS) {
  const r = resolveGencodeExpKey(`${d}d`);
  assert.equal(r.expSeconds, d * 86400, `${d}d seconds`);
  assert.match(r.label, /ngày/i);
}
const picker = buildPlanPickerKeyboard('ABCDEF1234567890');
const genKb = buildGencodePlanKeyboard();
const flatPick = picker.inline_keyboard.flat().map((b) => b.callback_data);
const flatGen = genKb.inline_keyboard.flat().map((b) => b.callback_data);
for (const d of DAY_KEY_PRESETS) {
  assert.ok(
    flatPick.some((c) => c.startsWith(`pick:${d}d:`)),
    `plan picker missing ${d}d`,
  );
  assert.ok(
    flatGen.includes(`gencode_plan:${d}d`),
    `gencode keyboard missing ${d}d`,
  );
}
ok('day presets 3/7/15/30 on pick + gencode keyboards');

// Delivery format: each code is its own plain message (copy-friendly)
{
  const msgs = buildGencodeDeliveryMessages({
    expLabel: '3 ngày',
    ledgerConfigured: true,
    codes: [
      {
        code: 'AINOVEL-C7D6-40D9-66AE',
        expSeconds: 3 * 86400,
        expLabel: '3 ngày',
        ledgerOk: true,
        licenseId: 'ee830b6c-xxxx',
      },
      {
        code: 'AINOVEL-2744-01DF-C667',
        expSeconds: 3 * 86400,
        expLabel: '3 ngày',
        ledgerOk: true,
      },
    ],
  });
  assert.ok(msgs.length >= 4, `expected header+2codes+bulk+footer, got ${msgs.length}`);
  assert.equal(msgs[1], 'AINOVEL-C7D6-40D9-66AE');
  assert.equal(msgs[2], 'AINOVEL-2744-01DF-C667');
  // Code-only messages must not embed ledger id noise
  assert.ok(!msgs[1]!.includes('id '));
  assert.ok(!msgs[1]!.includes('·'));
  const bulk = msgs.find((m) => m.includes('Copy cả lô'));
  assert.ok(bulk && bulk.includes('AINOVEL-C7D6-40D9-66AE\nAINOVEL-2744-01DF-C667'));
  ok('gencode delivery: one code per message + bulk block');
}

// 1-HWID bind + already-used message (local vault)
const smokeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ainovel-gencode-'));
const prevRoot = process.env.AI_NOVEL_ROOT;
const prevPriv = process.env.AINOVEL_ENTITLEMENT_PRIVATE_KEY;
const prevPub = process.env.AINOVEL_ENTITLEMENT_PUBLIC_KEY;
const keys = crypto.generateKeyPairSync('ed25519');
process.env.AI_NOVEL_ROOT = smokeRoot;
process.env.AINOVEL_ENTITLEMENT_PRIVATE_KEY = keys.privateKey
  .export({ type: 'pkcs8', format: 'pem' })
  .toString();
process.env.AINOVEL_ENTITLEMENT_PUBLIC_KEY = keys.publicKey
  .export({ type: 'spki', format: 'pem' })
  .toString();
try {
  const [rec] = createActivationCodes({
    count: 1,
    plan: 'pro',
    expSeconds: 86400 * 30,
    maxSeats: 1,
  });
  assert.ok(rec.code.startsWith('AINOVEL-'));
  const a = redeemActivationCode(rec.code, 'aaaaaaaaaaaaaaaa');
  assert.equal(a.ok, true, a.error || 'redeem a failed');
  const b = redeemActivationCode(rec.code, 'bbbbbbbbbbbbbbbb');
  assert.equal(b.ok, false);
  assert.ok(
    b.error && /đã được nhập|gắn máy/i.test(b.error),
    `expected already-used message, got: ${b.error}`,
  );
  assert.ok(b.alreadyBoundHwid);
  const same = redeemActivationCode(rec.code, 'aaaaaaaaaaaaaaaa');
  assert.equal(same.ok, true, same.error || 're-redeem same failed');
  assert.equal(same.alreadyRedeemedSameMachine, true);
  ok('1-HWID bind + already-used notice');
} finally {
  if (prevRoot === undefined) delete process.env.AI_NOVEL_ROOT;
  else process.env.AI_NOVEL_ROOT = prevRoot;
  if (prevPriv === undefined) delete process.env.AINOVEL_ENTITLEMENT_PRIVATE_KEY;
  else process.env.AINOVEL_ENTITLEMENT_PRIVATE_KEY = prevPriv;
  if (prevPub === undefined) delete process.env.AINOVEL_ENTITLEMENT_PUBLIC_KEY;
  else process.env.AINOVEL_ENTITLEMENT_PUBLIC_KEY = prevPub;
  fs.rmSync(smokeRoot, { recursive: true, force: true });
}

console.log('\n[smoke-telegram-admin] PASS');
