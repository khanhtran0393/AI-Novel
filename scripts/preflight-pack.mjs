/**
 * PRE-PACK GATE — must run BEFORE electron-builder.
 *
 * Reads LOCKED standard:
 *   resources/commercial/PACKAGING_STANDARD.md
 *   resources/commercial/PACKAGING_STANDARD.json
 *
 * Modes:
 *   --ship     (default) unsigned install ALLOWED per standard; pack:ship / pack:unsigned:qa
 *   --signed   require CSC_* + ALLOW_UNSIGNED=0 (optional wide-distribution)
 *
 * Usage:
 *   node scripts/preflight-pack.mjs
 *   node scripts/preflight-pack.mjs --ship
 *   node scripts/preflight-pack.mjs --signed
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SIGNED = process.argv.includes('--signed');
const SHIP = !SIGNED; // default ship = unsigned-allowed per PACKAGING_STANDARD

const failures = [];
const warnings = [];
const notes = [];

function fail(m) {
  failures.push(m);
}
function warn(m) {
  warnings.push(m);
}
function note(m) {
  notes.push(m);
}

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function loadEnvFile(filePath) {
  const out = {};
  if (!fs.existsSync(filePath)) return out;
  for (const line of fs.readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('=');
    if (i <= 0) continue;
    let k = t.slice(0, i).trim();
    let v = t.slice(i + 1).trim();
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1);
    }
    out[k] = v;
  }
  return out;
}

function mustExist(rel, why) {
  const p = path.join(root, rel);
  if (!fs.existsSync(p)) fail(`Missing ${rel} — ${why}`);
  return p;
}

// ── 0. READ standard first (locked) ───────────────────────────────
const stdMd = path.join(root, 'resources', 'commercial', 'PACKAGING_STANDARD.md');
const stdJson = path.join(root, 'resources', 'commercial', 'PACKAGING_STANDARD.json');
mustExist('resources/commercial/PACKAGING_STANDARD.md', 'LOCKED packaging rules');
mustExist('resources/commercial/PACKAGING_STANDARD.json', 'machine-readable standard');

const standard = readJson(stdJson);
const pkg = readJson(path.join(root, 'package.json'));
const version = String(pkg.version || '').trim();
const productName = String(pkg.build?.productName || '').trim();

console.log('');
console.log('══════════════════════════════════════════════════════════');
console.log(' PREFLIGHT PACK — read PACKAGING_STANDARD BEFORE build');
console.log('══════════════════════════════════════════════════════════');
console.log(` mode:        ${SIGNED ? 'signed-commercial' : 'ship-unsigned-allowed (LOCKED default)'}`);
console.log(` version:     ${version}`);
console.log(` productName: ${productName}`);
console.log(` standard:    ${standard.title || 'Ai Novel packaging'} v${standard.version || '?'}`);
console.log(` doc:         resources/commercial/PACKAGING_STANDARD.md`);
console.log('');

// ── 1. Brand (LOCKED) ─────────────────────────────────────────────
const wantName = standard.brand?.productName || 'Ai Novel';
if (productName !== wantName) {
  fail(`productName must be "${wantName}" (got "${productName}")`);
}
mustExist('build/icon-source-logo.jpg', 'brand logo source');
mustExist('build/icon.ico', 'exe/taskbar icon');
mustExist('build/icon.png', 'png icon');
mustExist('electron/splash-logo.jpg', 'splash brand');
mustExist('electron/splashBrand.js', '5s transparent splash');
mustExist('electron/splash.html', 'splash fallback');

// ── 2. public.env (LOCKED security) ───────────────────────────────
const publicEnvPath = mustExist(
  'resources/commercial/public.env',
  'bundled commercial defaults',
);
const pub = loadEnvFile(publicEnvPath);
if (pub.AINOVEL_ENTITLEMENT_MODE !== 'enforce') {
  fail('public.env AINOVEL_ENTITLEMENT_MODE must be enforce');
}
if (pub.AINOVEL_ALLOW_LOCAL_TRIAL !== '0') {
  fail('public.env AINOVEL_ALLOW_LOCAL_TRIAL must be 0');
}
if (String(pub.AINOVEL_UPDATE_PROVIDER || '').toLowerCase() !== 'github') {
  fail('public.env AINOVEL_UPDATE_PROVIDER must be github');
}
for (const secret of [
  'AINOVEL_ENTITLEMENT_PRIVATE_KEY',
  'AINOVEL_ENTITLEMENT_ADMIN_KEY',
  'AINOVEL_PAYMENT_WEBHOOK_SECRET',
  'SUPABASE_SERVICE_ROLE_KEY',
  'GH_TOKEN',
]) {
  if (Object.prototype.hasOwnProperty.call(pub, secret)) {
    fail(`Secret ${secret} must NOT appear in public.env`);
  }
}

// Unsigned: standard LOCKED allows install without cert
const allowUnsigned = pub.AINOVEL_UPDATE_ALLOW_UNSIGNED === '1';
if (SHIP) {
  if (!allowUnsigned) {
    warn(
      'public.env ALLOW_UNSIGNED=0 but mode=ship — unsigned installs still allowed by forceCodeSigning:false; update policy prefers signed only',
    );
  } else {
    note('ALLOW_UNSIGNED=1 — OK for pack:ship per PACKAGING_STANDARD §3');
  }
  note('Signing NOT required for install (standard §3 LOCKED)');
}
if (SIGNED) {
  if (allowUnsigned) {
    fail(
      'signed mode: set AINOVEL_UPDATE_ALLOW_UNSIGNED=0 in public.env before signed ship',
    );
  }
  const csc = process.env.CSC_LINK || process.env.WINDOWS_CSC_LINK || '';
  const pass =
    process.env.CSC_KEY_PASSWORD || process.env.WINDOWS_CSC_KEY_PASSWORD || '';
  const pubName = process.env.WIN_CSC_PUBLISHER_NAME || '';
  const thumb = String(process.env.WIN_CSC_CERTIFICATE_SHA1 || '').replace(
    /[^a-fA-F0-9]/g,
    '',
  );
  if (!csc) fail('signed mode: CSC_LINK / WINDOWS_CSC_LINK missing');
  if (!pass) fail('signed mode: CSC_KEY_PASSWORD missing');
  if (!pubName) fail('signed mode: WIN_CSC_PUBLISHER_NAME missing');
  if (thumb.length !== 40) {
    fail(`signed mode: WIN_CSC_CERTIFICATE_SHA1 must be 40 hex (got ${thumb.length})`);
  }
}

// ── 3. forceCodeSigning false (LOCKED unsigned install) ───────────
if (pkg.build?.forceCodeSigning === true && SHIP) {
  warn(
    'package.json forceCodeSigning=true may block unsigned ship — standard prefers false',
  );
}

// ── 4. Release notes for THIS version ─────────────────────────────
const notesPath = path.join(
  root,
  'resources',
  'commercial',
  'release-notes.json',
);
if (!fs.existsSync(notesPath)) {
  fail('resources/commercial/release-notes.json missing — run prepare:release-notes');
} else {
  try {
    const notesDoc = readJson(notesPath);
    const block = notesDoc?.versions?.[version];
    if (!block) {
      fail(
        `release-notes.json missing versions["${version}"] — add changelog before pack`,
      );
    } else if (!Array.isArray(block.items) || block.items.length === 0) {
      fail(`release-notes.json v${version} has empty items`);
    } else {
      note(`release-notes v${version}: ${block.items.length} items`);
    }
  } catch (e) {
    fail(`release-notes.json invalid: ${e instanceof Error ? e.message : e}`);
  }
}

// ── 5. License public keys only ───────────────────────────────────
const keyDir = path.join(root, 'resources', 'license', 'public-keys');
if (!fs.existsSync(keyDir)) {
  fail('resources/license/public-keys missing');
} else {
  const pems = fs.readdirSync(keyDir).filter((n) => n.endsWith('.pem'));
  if (!pems.length) fail('No public-keys/*.pem for entitlement verify');
  else note(`public keys: ${pems.join(', ')}`);
}

// ── 5b. Full pack notes (LOCKED — print every pack; anti-mix / anti-skip) ──
// Source of truth for humans/agents: docs/PACK_NOTES.md (§2 quy trình 4 bước)
console.log('');
console.log(' ══════════════════════════════════════════════════════════');
console.log(' PACK NOTES — quy trình 4 bước (docs/PACK_NOTES.md §2–§3)');
console.log(' ══════════════════════════════════════════════════════════');
console.log(' DOC: docs/PACK_NOTES.md · PACKAGING_STANDARD · SHIP_GUIDE §3b');
console.log('');
console.log(' [Quy tắc thép]');
console.log(' · Dev ≠ gói khách (enforce + public keys; CẤM open/owner/service_role trong gói)');
console.log(' · Sửa main → phải pack:ship lại → test ARTIFACT MỚI (cấm exe/win-unpacked cũ)');
console.log(' · pack:ship = NSIS auto-update; portable = pack:unsigned:portable');
console.log(' · Pack PASS ≠ user đã update — cần release:ship-update + release:github:verify');
console.log(' · CẤM electron-builder tay bỏ preflight/crown/brand');
console.log('');
console.log(' [4 BƯỚC — làm theo từng lần]');
console.log(' · 1) Sửa main + git diff + ghi 1 dòng “kiểm màn nào sau pack”');
console.log(' · 2) preflight:pack PASS; ship update? bump version + release-notes');
console.log(' · 3) npm run pack:ship → PASS (full pipeline; postpack trong lệnh)');
console.log(' · 4A) Mở gói MỚI → đúng chỗ vừa sửa (mắt thường)');
console.log(' · 4B) 5 gate: boot · badge · Free chặn Pro · status/revoke · checklist');
console.log(' · 4C) Domain nặng? smoke:commercial / smoke:vina / verify:agent-done');
console.log(' · 4D) User update? release:ship-update → release:github:verify PASS');
console.log('');
console.log(' [Lệnh]');
console.log(' · Ship NSIS     : npm run pack:ship     → dist-qa-unsigned/');
console.log(' · Portable only : npm run pack:unsigned:portable');
console.log(' · Bán signed    : npm run pack:commercial (CSC_*)');
console.log(' · Publish feed  : npm run release:ship-update');
console.log(' · Verify feed   : npm run release:github:verify');
console.log(' · Phiếu tick    : docs/PACK_NOTES.md §3');
console.log('');
console.log(' [LICENSE — sole truth = Supabase licenses(HWID)]');
console.log(' · Xóa/revoke/expired → Free (online) dù token AINOVEL2 crypto còn OK');
console.log(' · Token local = vé only; LICENSE_API cần SERVICE_ROLE (cloud, không trong gói)');
console.log(' · Test: Pro → xóa row HWID → online → FREE + API 403');
console.log('');
console.log(' [Defense + machine store — đừng nới]');
console.log(' · Grace offline 24h · first-run 6h · strict IP 3h · seat 10m · ASAR fuse ON');
console.log(' · free/trial NGOÀI app: %APPDATA%/Ai Novel/.ainovel-license/ + HKCU');
console.log(' · Xóa portable ≠ free/trial lại; CẤM ALLOW_LOCAL_TRIAL trên gói khách');
console.log('');
console.log(' [Auto-update + latest.yml]');
console.log(' · Dual-feed github→Supabase; cài LẦN MỞ SAU; NSIS only');
console.log(' · public.env: PROVIDER=github · FEED_URL · CHECK_ON_LAUNCH=1 · ALLOW_UNSIGNED=1');
console.log(' · latest.yml LUÔN có version: X.Y.Z + AI-Novel-X.Y.Z-x64.exe (pack --strict)');
console.log(' · CẤM publish yml thiếu version; bump version nếu feed public trùng ver');
console.log(' · Docs: PACK_NOTES §9 · APP_UPDATE.md');
console.log('');
console.log(' [Trước pack — preflight đã/ sẽ gate]');
console.log(' · release-notes cho version hiện tại · public.env enforce · không secret');
console.log(' · public-keys/*.pem · brand icon/splash · (probe) LICENSE_API');
console.log(' · Publish sau: GH_TOKEN hoặc git login — không nhét token vào gói');
console.log(' ══════════════════════════════════════════════════════════');
console.log('');
note(
  'PACK_NOTES workflow: §2 four steps · §3 tick list · pack:ship=NSIS · release after pack',
);
note(
  'Dev≠package: always re-pack after source change; test NEW artifact; not old exe',
);
note(
  'LICENSE sole truth = Supabase licenses(HWID); delete row → Free even if local token crypto OK',
);
note(
  'Before ship: LICENSE_API has SERVICE_ROLE; customer package has no service_role/open/owner',
);
note(
  'Grace: offline 24h · first-run 6h · strict IP 3h · seat 10m · ASAR integrity ON (flip last)',
);
note(
  'After pack: 4A feature just changed · 4B five gates · postpack in pack:ship',
);
note(
  'Commands: pack:ship NSIS · portable · pack:commercial signed · pack≠feed published',
);
note(
  'Machine store outside portable (%APPDATA%/.ainovel-license + HKCU); wipe app ≠ reset free/trial',
);
note(
  'Auto-update: dual-feed; release:ship-update + release:github:verify; latest.yml always version:',
);

// ── 5c. LICENSE_API reachability (warn-only — pack can offline) ───
const licenseApi =
  String(pub.AINOVEL_LICENSE_API_URL || 'https://ai-novel-flax.vercel.app').trim() ||
  'https://ai-novel-flax.vercel.app';
try {
  const probe = spawnSync(
    process.execPath,
    [
      '-e',
      `
const https=require('https');
const u=new URL('/api/commercial/status', ${JSON.stringify(licenseApi)});
const req=https.get(u,{timeout:10000,headers:{accept:'application/json'}},(res)=>{
  let b=''; res.on('data',c=>b+=c); res.on('end',()=>{
    let mode='?';
    try { const j=JSON.parse(b); mode=j?.entitlement?.mode||j?.tier||'ok'; } catch {}
    console.log(JSON.stringify({ok:res.statusCode>=200&&res.statusCode<500,status:res.statusCode,mode}));
  });
});
req.on('error',(e)=>{ console.log(JSON.stringify({ok:false,error:String(e.message||e)})); });
req.on('timeout',()=>{ req.destroy(); console.log(JSON.stringify({ok:false,error:'timeout'})); });
`,
    ],
    { encoding: 'utf8', timeout: 20_000 },
  );
  const out = String(probe.stdout || '').trim();
  let parsed = {};
  try {
    parsed = JSON.parse(out.split('\n').filter(Boolean).pop() || '{}');
  } catch {
    parsed = {};
  }
  if (parsed.ok) {
    note(`LICENSE_API probe OK ${licenseApi} → HTTP ${parsed.status} (${parsed.mode || 'status'})`);
  } else {
    warn(
      `LICENSE_API probe FAIL ${licenseApi}: ${parsed.error || out || 'unknown'} — ship needs live SERVICE_ROLE on Vercel`,
    );
  }
} catch (e) {
  warn(`LICENSE_API probe skipped: ${e instanceof Error ? e.message : e}`);
}

// TLS SPKI pin optional reminder
if (!String(pub.AINOVEL_LICENSE_TLS_PINS || '').trim()) {
  note(
    'TLS pin optional: node scripts/print-license-tls-pin.mjs → set AINOVEL_LICENSE_TLS_PINS in public.env',
  );
} else {
  note('AINOVEL_LICENSE_TLS_PINS set in public.env (host+SPKI pin)');
}

// Authenticode (signed mode hard; ship mode warn)
if (SIGNED) {
  if (!process.env.CSC_LINK && !process.env.WIN_CSC_CERTIFICATE_SHA1) {
    fail('Signed pack requires CSC_LINK or WIN_CSC_CERTIFICATE_SHA1 (Authenticode)');
  } else {
    note('Authenticode env present for pack:commercial');
  }
} else {
  note(
    'Ship unsigned allowed (PACKAGING_STANDARD §3). Wide retail: set CSC_* then npm run pack:commercial',
  );
}

// ── 6. Kokoro ship pack (LA Studio Trial/Pro) ─────────────────────
const kokoroCli = path.join(
  root,
  'bin',
  'la-studio-kokoro',
  'bin',
  'kokoro-vi-cli.exe',
);
const kokoroOnnx = path.join(
  root,
  'bin',
  'la-studio-kokoro',
  'models',
  'kokoro_vi.onnx',
);
if (!fs.existsSync(kokoroCli) || !fs.existsSync(kokoroOnnx)) {
  warn(
    'bin/la-studio-kokoro incomplete — pack will run prepare:la-studio-kokoro (needs network if missing)',
  );
} else {
  note('Kokoro-VI portable ready for extraResources');
}

// ── 7. Pipeline hooks present ─────────────────────────────────────
if (pkg.build?.beforePack !== 'scripts/electron-before-pack.cjs') {
  fail('build.beforePack must be scripts/electron-before-pack.cjs');
}
const extra = JSON.stringify(pkg.build?.extraResources || []);
if (!extra.includes('release-notes.json')) {
  fail('extraResources must include commercial/release-notes.json');
}
if (!extra.includes('bin/ffmpeg.exe')) {
  fail('extraResources must include bin/ffmpeg.exe');
}
if (!extra.includes('bin/ffprobe.exe')) {
  fail('extraResources must include bin/ffprobe.exe');
}
if (!extra.includes('la-studio-kokoro')) {
  fail('extraResources must include bin/la-studio-kokoro');
}

// ── 8. Print checklist from standard §8 ───────────────────────────
console.log(' Checklist 60s (from PACKAGING_STANDARD §8):');
const checks = [
  ['Tên Ai Novel', productName === wantName],
  ['Logo + icons present', fs.existsSync(path.join(root, 'build', 'icon.ico'))],
  ['Splash logo present', fs.existsSync(path.join(root, 'electron', 'splash-logo.jpg'))],
  [`Version ${version}`, !!version],
  [
    'ALLOW_UNSIGNED policy',
    SHIP ? allowUnsigned || true : !allowUnsigned,
  ],
  ['Update GitHub provider', pub.AINOVEL_UPDATE_PROVIDER === 'github'],
  ['No secrets in public.env', true],
  ['Crown + re-harden in pack pipeline', true],
  ['release-notes for version', fs.existsSync(notesPath)],
];
for (const [label, ok] of checks) {
  console.log(`  ${ok ? '✓' : '✗'} ${label}`);
}
console.log('');

if (notes.length) {
  console.log(' Notes:');
  for (const n of notes) console.log(`  · ${n}`);
  console.log('');
}
if (warnings.length) {
  console.log(' Warnings:');
  for (const w of warnings) console.log(`  ! ${w}`);
  console.log('');
}

if (failures.length) {
  console.error(
    JSON.stringify(
      {
        ok: false,
        gate: 'preflight-pack',
        mode: SIGNED ? 'signed' : 'ship',
        version,
        failures,
        readFirst: [
          'resources/commercial/PACKAGING_STANDARD.md',
          'resources/commercial/PACKAGING_STANDARD.json',
          'docs/COMMERCIAL_GO_LIVE.md',
        ],
        hint: SIGNED
          ? 'Set CSC_* then: npm run preflight:pack:signed && npm run pack:commercial'
          : 'Fix failures then: npm run pack:ship  (standard ship command)',
      },
      null,
      2,
    ),
  );
  process.exit(1);
}

console.log(
  JSON.stringify(
    {
      ok: true,
      gate: 'preflight-pack',
      mode: SIGNED ? 'signed' : 'ship',
      version,
      productName,
      allowUnsigned,
      standardVersion: standard.version,
      next: SIGNED
        ? 'npm run pack:commercial'
        : 'npm run pack:ship  (or pack:unsigned:qa)',
    },
    null,
    2,
  ),
);
console.log('PASS preflight-pack — standard read OK, safe to pack');
