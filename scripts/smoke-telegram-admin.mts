/**
 * Smoke: Telegram admin command parse + callback parse (no network).
 * Run: npx tsx scripts/smoke-telegram-admin.mts
 */
import assert from 'node:assert/strict';
import {
  buildPickCallbackData,
  normalizeHwid,
  parseAdminCommand,
  tryParseBareHwid,
} from '../src/lib/commercial/telegramAdminCommands.ts';
import { parseTelegramCallbackData } from '../src/lib/commercial/telegramNotify.ts';

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
assert.equal(parseAdminCommand('🔎 Tra cứu')?.kind, 'prompt_lookup');
assert.equal(parseAdminCommand('📋 List active')?.kind, 'list');
assert.equal(parseAdminCommand('❓ Menu')?.kind, 'menu');
assert.equal(parseAdminCommand('/activate')?.kind, 'prompt_activate');
ok('parseAdminCommand');

// callbacks
const pickData = buildPickCallbackData('month', 'ABCDEF1234567890');
assert.ok(pickData.startsWith('pick:month:'));
const pick = parseTelegramCallbackData(pickData);
assert.equal(pick?.action, 'pick');
if (pick?.action === 'pick') {
  assert.equal(pick.planId, 'month');
  assert.equal(pick.hwid, 'ABCDEF1234567890');
}
const issue = parseTelegramCallbackData('issue:lifetime:ABCDEF1234567890');
assert.equal(issue?.action, 'issue');
const rc = parseTelegramCallbackData(
  'revoke_confirm:aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
);
assert.equal(rc?.action, 'revoke_confirm');
assert.equal(parseTelegramCallbackData('pick_cancel')?.action, 'pick_cancel');
assert.equal(parseTelegramCallbackData('revoke_cancel')?.action, 'revoke_cancel');
const menuAct = parseTelegramCallbackData('menu:activate');
assert.equal(menuAct?.action, 'menu');
if (menuAct?.action === 'menu') assert.equal(menuAct.item, 'activate');
ok('parseTelegramCallbackData');

console.log('\n[smoke-telegram-admin] PASS');
