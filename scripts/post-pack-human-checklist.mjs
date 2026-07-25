/**
 * Human post-pack checklist (prints; does not auto-test HWID live without secrets).
 * node scripts/post-pack-human-checklist.mjs [dist-qa-unsigned|dist]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = process.argv[2] || 'dist-qa-unsigned';
const unpacked = path.join(root, out, 'win-unpacked');

const checks = [];
function ok(label, pass, detail = '') {
  checks.push({ label, pass: !!pass, detail });
  console.log(`${pass ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`);
}

console.log('');
console.log('══════════════════════════════════════════════════════════');
console.log(' POST-PACK HUMAN CHECKLIST — Ai Novel');
console.log('══════════════════════════════════════════════════════════');
console.log(` artifact root: ${out}`);
console.log(' Pre-pack notes: docs/PACK_NOTES.md §2 (4 bước) · §3 (phiếu tick)');
console.log(' pack:ship → dist-qa-unsigned · pack:commercial → dist (signed)');
console.log(' Sau checklist máy: Bước 4A mở gói MỚI kiểm đúng chỗ vừa sửa + 4B 5 gate');
console.log('');

const unpackedOk = fs.existsSync(unpacked);
ok('win-unpacked exists', unpackedOk, unpacked);
let exeOk = false;
if (unpackedOk) {
  exeOk =
    fs.existsSync(path.join(unpacked, 'Ai Novel.exe')) ||
    fs.readdirSync(unpacked).some((n) => n.toLowerCase().endsWith('.exe'));
}
ok('main .exe present', exeOk);

const publicEnv = path.join(unpacked, 'resources', 'commercial', 'public.env');
let envText = '';
if (fs.existsSync(publicEnv)) {
  envText = fs.readFileSync(publicEnv, 'utf8');
  ok('public.env enforce', /AINOVEL_ENTITLEMENT_MODE=enforce/.test(envText));
  ok('no SERVICE_ROLE in public.env', !/SERVICE_ROLE/.test(envText));
  ok('no PRIVATE key in public.env', !/PRIVATE_KEY/.test(envText));
  ok('ALLOW_LOCAL_TRIAL=0', /AINOVEL_ALLOW_LOCAL_TRIAL=0/.test(envText));
  ok('LICENSE_API URL set', /AINOVEL_LICENSE_API_URL=https:\/\//.test(envText));
} else {
  ok('public.env present', false, publicEnv);
}

const kokoro = path.join(
  unpacked,
  'resources',
  'bin',
  'la-studio-kokoro',
  'bin',
  'kokoro-vi-cli.exe',
);
ok('Kokoro CLI shipped', fs.existsSync(kokoro));

const piperExe = path.join(unpacked, 'resources', 'bin', 'piper', 'piper.exe');
ok('Piper exe shipped', fs.existsSync(piperExe));
const piperVnDir = path.join(unpacked, 'resources', 'bin', 'piper_vn');
const piperOnnxCount = fs.existsSync(piperVnDir)
  ? fs.readdirSync(piperVnDir).filter((n) => n.toLowerCase().endsWith('.onnx'))
      .length
  : 0;
ok('Piper VN ONNX shipped', piperOnnxCount >= 1, `onnx=${piperOnnxCount}`);

const xinchaoRoot = path.join(unpacked, 'resources', 'tools', 'xinchao-cut');
const xinchaoExe = path.join(xinchaoRoot, 'XinChao-Cut.exe');
ok(
  'XinChao-Cut native runtime shipped',
  fs.existsSync(xinchaoExe) && fs.statSync(xinchaoExe).size > 1_000_000,
  xinchaoExe,
);
ok(
  'XinChao-Cut frontend shipped',
  fs.existsSync(path.join(xinchaoRoot, 'dist', 'index.html')),
);
ok(
  'XinChao-Cut backend shipped',
  fs.existsSync(path.join(xinchaoRoot, 'backend', 'run-backend.bat')),
);
ok(
  'XinChao-Cut runtime has no external node_modules',
  !fs.existsSync(path.join(xinchaoRoot, 'node_modules')),
);

const keys = path.join(unpacked, 'resources', 'license', 'public-keys');
ok(
  'public-keys dir',
  fs.existsSync(keys) && fs.readdirSync(keys).some((n) => n.endsWith('.pem')),
);

console.log('');
console.log(' Manual (must run on real machine + network):');
console.log('  1. Install/run portable .exe');
console.log('  2. Free: gen video / LA Studio Pro → blocked');
console.log('  3. Activate Pro (row active on Supabase for HWID)');
console.log('  4. DELETE/revoke that licenses row on Supabase');
console.log('  5. Restart/focus app → badge FREE + Pro API 403');
console.log('  6. Check %USERPROFILE%\\.ainovel-license\\deny-events.jsonl (optional)');
console.log('  7. Wide retail: Authenticode pack:commercial + SmartScreen check');
console.log('');

const failed = checks.filter((c) => !c.pass);
console.log(
  JSON.stringify({
    ok: failed.length === 0,
    gate: 'post-pack-human-checklist',
    out,
    failed: failed.map((f) => f.label),
  }),
);
process.exit(failed.length ? 1 : 0);
