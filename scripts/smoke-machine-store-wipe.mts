/**
 * Prove free/trial vaults survive portable wipe + trial heals from Windows reg.
 * Run: npx tsx scripts/smoke-machine-store-wipe.mts
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ainovel-machine-store-'));
// Simulate Electron userData so machine store nests + HKCU secondary enables
process.env.AI_NOVEL_USER_DATA = root;
process.env.AINOVEL_MACHINE_REG = '1';
process.env.AINOVEL_TRIAL_ENABLED = '1';
delete process.env.AINOVEL_DATA_ROOT;
delete process.env.AI_NOVEL_PACKAGED;
delete process.env.AINOVEL_ALLOW_LOCAL_TRIAL;

const { startTrial, getTrialStatus } = await import(
  '../src/lib/commercial/trial.ts'
);
const { licenseMachineStoreFile } = await import(
  '../src/lib/commercial/licenseMachineStore.ts'
);

// Unique HWID each run (avoid leftover HKCU from prior smokes)
const hwid = `ab${Date.now().toString(16).slice(-14)}`.slice(0, 16);
const r1 = startTrial(hwid);
assert.equal(r1.ok, true);
assert.equal(r1.created, true, `first trial must create (hwid=${hwid})`);
assert.equal(r1.status.used, true);

const durable = licenseMachineStoreFile('trials.json');
assert.ok(fs.existsSync(durable), 'trials.json in machine store');
assert.ok(
  durable.includes('.ainovel-license') || durable.startsWith(root),
  `under userData machine store: ${durable}`,
);
assert.ok(!durable.includes(`${path.sep}data${path.sep}licenses${path.sep}`));

const r2 = startTrial(hwid);
assert.equal(r2.created, false, 'cannot re-trial same HWID');
assert.equal(r2.status.used, true);

// Wipe durable file only — Windows reg secondary should heal
fs.unlinkSync(durable);
const st = getTrialStatus(hwid);
if (process.platform === 'win32') {
  assert.equal(st.used, true, 'trial recovered after file wipe via HKCU');
  assert.ok(st.record, 'healed record present');
  assert.ok(fs.existsSync(durable), 'file re-written from reg heal');
  console.log('trial reg heal OK', st.record);
} else {
  // Non-Windows: only durable file (no reg) — after unlink, used may be false
  console.log('non-win: after unlink used=', st.used, '(reg secondary N/A)');
}

// free-usage durable path check
const freePath = licenseMachineStoreFile('free-usage.json');
assert.ok(freePath.startsWith(root));
console.log(JSON.stringify({ ok: true, durable, freePath, platform: process.platform }));
console.log('PASS smoke-machine-store-wipe');

fs.rmSync(root, { recursive: true, force: true });
