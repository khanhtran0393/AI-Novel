/**
 * Seller: release one HWID seat from an AINOVEL activation code.
 *
 *   node scripts/transfer-license-seat.mjs --code AINOVEL-XXXX-XXXX-XXXX --hwid abcdef0123456789
 *   node scripts/transfer-license-seat.mjs --code AINOVEL-... --expand 3
 *   node scripts/transfer-license-seat.mjs --code AINOVEL-... --summary
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

function arg(name, fallback = '') {
  const i = process.argv.indexOf(`--${name}`);
  if (i >= 0 && process.argv[i + 1]) return process.argv[i + 1];
  return fallback;
}

function hasFlag(name) {
  return process.argv.includes(`--${name}`);
}

function normalizeCode(c) {
  return String(c || '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '');
}

const dataRoot = process.env.AINOVEL_DATA_ROOT || root;
const vaultPath = path.join(dataRoot, 'data', 'licenses', 'activation-codes.json');

if (!fs.existsSync(vaultPath)) {
  console.error('Vault missing:', vaultPath);
  process.exit(1);
}

const vault = JSON.parse(fs.readFileSync(vaultPath, 'utf8'));
if (!vault.codes) vault.codes = {};

const code = normalizeCode(arg('code'));
if (!code) {
  console.error('Need --code AINOVEL-…');
  process.exit(1);
}

const rec = vault.codes[code];
if (!rec) {
  console.error('Code not found:', code);
  process.exit(1);
}

function seatsOf(r) {
  if (Array.isArray(r.seats) && r.seats.length) {
    return r.seats.map((s) => String(s).toLowerCase());
  }
  if (r.redeemedHwid) return [String(r.redeemedHwid).toLowerCase()];
  return [];
}

if (hasFlag('summary') || (!arg('hwid') && !arg('expand'))) {
  const seats = seatsOf(rec);
  console.log(
    JSON.stringify(
      {
        ok: true,
        code,
        maxSeats: rec.maxSeats ?? 1,
        seats,
        used: seats.length,
        free: Math.max(0, (rec.maxSeats ?? 1) - seats.length),
      },
      null,
      2,
    ),
  );
  process.exit(0);
}

const expand = arg('expand');
if (expand) {
  const n = Math.max(1, Math.min(20, Number(expand) || 1));
  const seats = seatsOf(rec);
  if (n < seats.length) {
    console.error(`Cannot set maxSeats=${n} while ${seats.length} seats used`);
    process.exit(1);
  }
  rec.maxSeats = n;
  vault.codes[code] = rec;
  fs.writeFileSync(vaultPath, JSON.stringify(vault, null, 2), 'utf8');
  console.log(JSON.stringify({ ok: true, code, maxSeats: n, seats }, null, 2));
  process.exit(0);
}

const hwid = String(arg('hwid') || '')
  .trim()
  .toLowerCase();
if (!hwid) {
  console.error('Need --hwid to release');
  process.exit(1);
}

let seats = seatsOf(rec);
if (!seats.includes(hwid)) {
  console.error('HWID not on this code. Current seats:', seats);
  process.exit(1);
}
seats = seats.filter((s) => s !== hwid);
rec.seats = seats;
if (seats.length) {
  rec.redeemedHwid = seats[0];
} else {
  delete rec.redeemedHwid;
  delete rec.redeemedAt;
}
vault.codes[code] = rec;
fs.writeFileSync(vaultPath, JSON.stringify(vault, null, 2), 'utf8');

// seller log
try {
  const logPath = path.join(dataRoot, 'data', 'licenses', 'seller-orders.jsonl');
  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  fs.appendFileSync(
    logPath,
    JSON.stringify({
      at: new Date().toISOString(),
      kind: 'transfer',
      code,
      hwid,
      note: `cli release; remaining=${seats.length}`,
    }) + '\n',
    'utf8',
  );
} catch {
  /* ignore */
}

console.log(
  JSON.stringify(
    {
      ok: true,
      code,
      releasedHwid: hwid,
      remainingSeats: seats,
      maxSeats: rec.maxSeats ?? 1,
    },
    null,
    2,
  ),
);
