/**
 * Smoke: defense pack improvements (grace · ledger probe policy · deny log · seat window).
 * npx tsx scripts/smoke-defense-pack.mts
 */
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
process.chdir(root);

async function main() {
  // Isolated defaults (no env override)
  delete process.env.AINOVEL_HEARTBEAT_GRACE_SEC;
  delete process.env.AINOVEL_HEARTBEAT_FIRST_RUN_SEC;
  delete process.env.AINOVEL_STRICT_ONLINE_GRACE_SEC;
  delete process.env.AINOVEL_SEAT_PRESENCE_WINDOW_SEC;

  const hb = await import('../src/lib/commercial/licenseHeartbeat.ts');
  const online = await import('../src/lib/commercial/onlineRevalidate.ts');
  const seat = await import('../src/lib/commercial/seatPresence.ts');

  const g = hb.heartbeatGraceSec();
  const fr = hb.heartbeatFirstRunSec();
  const st = online.strictOnlineGraceSec();
  assert.equal(g, 24 * 3600, `grace default 24h got ${g}`);
  assert.equal(fr, 6 * 3600, `first-run default 6h got ${fr}`);
  assert.equal(st, 3 * 3600, `strict default 3h got ${st}`);
  console.log('PASS grace defaults', { graceH: g / 3600, firstRunH: fr / 3600, strictH: st / 3600 });

  // Deny event log (no PII token)
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ainovel-deny-'));
  process.env.AINOVEL_DATA_ROOT = dataRoot;
  process.env.AI_NOVEL_USER_DATA = dataRoot;
  hb.appendLicenseDenyEvent({ reason: 'smoke_test', detail: 'unit' });
  const logPath = path.join(dataRoot, 'deny-events.jsonl');
  assert.ok(fs.existsSync(logPath), 'deny-events.jsonl written');
  const line = fs.readFileSync(logPath, 'utf8').trim().split('\n').pop() || '';
  const row = JSON.parse(line) as { reason?: string; hwid8?: string };
  assert.equal(row.reason, 'smoke_test');
  assert.ok(row.hwid8 && row.hwid8.length <= 8);
  assert.ok(!line.includes('AINOVEL2'), 'no token in deny log');
  console.log('PASS deny-events.jsonl', { hwid8: row.hwid8 });

  // Seat public window
  const seatSt = seat.getSeatPresencePublicStatus();
  assert.equal(seatSt.windowSec, 10 * 60, `seat window 10m got ${seatSt.windowSec}`);
  console.log('PASS seat window 10m', seatSt);

  // Heartbeat source policy: valid:false → revoked (source string check)
  const hbSrc = fs.readFileSync(
    path.join(root, 'src/lib/commercial/licenseHeartbeat.ts'),
    'utf8',
  );
  assert.ok(hbSrc.includes("payload.valid === false"), 'probe treats valid:false');
  assert.ok(
    !/valid:false \+ not revoked[\s\S]{0,80}return 'valid'/.test(hbSrc),
    'old missing-row=valid removed',
  );
  console.log('PASS probeOnlineVerify ledger-deny policy in source');

  // Fuses: default integrity ON with fallback
  const fuseSrc = fs.readFileSync(path.join(root, 'scripts/electron-fuses.cjs'), 'utf8');
  assert.ok(fuseSrc.includes("AINOVEL_ASAR_INTEGRITY") && fuseSrc.includes("'1'"));
  assert.ok(fuseSrc.includes('integrity ON failed, retry OFF'));
  console.log('PASS fuses ASAR integrity default ON + fallback');

  // afterPack order comment
  const after = fs.readFileSync(path.join(root, 'scripts/electron-after-pack.cjs'), 'utf8');
  assert.ok(after.includes('fuses LAST') || after.includes('Fuses LAST'));
  console.log('PASS afterPack fuse-last order documented');

  console.log(JSON.stringify({ ok: true, smoke: 'defense-pack' }));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
