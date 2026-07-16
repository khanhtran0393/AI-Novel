/**
 * Audit Cấu Hình Giọng Đọc Toàn Cục (no TS path resolution issues).
 *
 * node scripts/audit-global-tts-voices.mjs
 * node scripts/audit-global-tts-voices.mjs --probe-edge --edge-lang=vi
 * node scripts/audit-global-tts-voices.mjs --probe-edge --limit=20
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const cwd = path.resolve(__dirname, '..');
const require = createRequire(import.meta.url);

const EDGE_LIST_URL =
  'https://speech.platform.bing.com/consumer/speech/synthesize/readaloud/voices/list?trustedclienttoken=6A5AA1D4EAFF4E9FB37E23D68491D6F4';

const args = process.argv.slice(2);
const probeEdge = args.includes('--probe-edge');
const edgeLangFilter = (args.find((a) => a.startsWith('--edge-lang=')) || '').split('=')[1] || '';
const probeLimit = (() => {
  const a = args.find((x) => x.startsWith('--limit='));
  return a ? Math.max(1, Number(a.split('=')[1]) || 50) : 0;
})();

const issues = [];
const push = (i) => issues.push(i);

// ─── Parse voiceCatalog.ts for v('id', 'name'...) entries ──
const catalogPath = path.join(cwd, 'src', 'lib', 'voiceCatalog.ts');
const catalogSrc = fs.readFileSync(catalogPath, 'utf8');

/** Extract section between `const EDGE_VI` etc and next const/export — crude but effective */
function extractVoiceCalls(src) {
  // v('id', 'name', 'gender'?, 'locale'?)
  const re =
    /\bv\(\s*'([^']+)'\s*,\s*'((?:\\'|[^'])*)'\s*(?:,\s*'([^']*)')?\s*(?:,\s*'([^']*)')?\s*\)/g;
  const out = [];
  let m;
  while ((m = re.exec(src))) {
    out.push({
      id: m[1],
      name: m[2].replace(/\\'/g, "'"),
      gender: m[3] || '',
      locale: m[4] || '',
      index: m.index,
    });
  }
  return out;
}

/** Map each voice to platform by locating STATIC_VOICE_CATALOG structure keys in source order */
function assignPlatforms(src, voices) {
  // Find platform block starts: edge_tts: {  openai_tts: { etc.
  const platRe = /^\s{2}([a-z0-9_]+):\s*\{/gm;
  const plats = [];
  let m;
  while ((m = platRe.exec(src))) {
    // Only inside STATIC_VOICE_CATALOG roughly — filter known platforms
    const id = m[1];
    if (
      [
        'edge_tts',
        'openai_tts',
        'gemini_tts',
        'tiktok_tts',
        'capcut_tts',
        'hotai_tts',
        'piper',
        'vieneu_tts',
        'vina_voice',
        'omnivoice_local',
        'vbee',
        'google',
        'elevenlabs',
      ].includes(id)
    ) {
      plats.push({ id, index: m.index });
    }
  }
  plats.sort((a, b) => a.index - b.index);

  function platformAt(idx) {
    let cur = 'unknown';
    for (const p of plats) {
      if (p.index <= idx) cur = p.id;
      else break;
    }
    return cur;
  }

  return voices.map((v) => ({ ...v, platform: platformAt(v.index) }));
}

const rawVoices = extractVoiceCalls(catalogSrc);
// Filter out helper calls outside catalog if any — keep all from file
const allVoices = assignPlatforms(catalogSrc, rawVoices);

// Also OPENAI / GEMINI arrays defined before STATIC
console.log('=== 1. Catalog parse (voiceCatalog.ts) ===\n');
const byPlat = {};
for (const v of allVoices) {
  byPlat[v.platform] = byPlat[v.platform] || [];
  byPlat[v.platform].push(v);
}
let total = 0;
for (const [p, list] of Object.entries(byPlat).sort((a, b) => b[1].length - a[1].length)) {
  // dedupe by id
  const ids = new Set(list.map((x) => x.id));
  total += ids.size;
  console.log(`  ${p.padEnd(18)} raw=${String(list.length).padStart(4)} unique=${String(ids.size).padStart(4)}`);
}
console.log(`  ${'TOTAL unique'.padEnd(18)} ${String(total).padStart(4)}\n`);

// Integrity
for (const [plat, list] of Object.entries(byPlat)) {
  const seen = new Map();
  for (const v of list) {
    if (!v.id?.trim()) {
      push({ severity: 'error', platform: plat, message: 'Empty id' });
      continue;
    }
    if (!v.name?.trim()) {
      push({ severity: 'warn', platform: plat, id: v.id, message: 'Empty name' });
    }
    seen.set(v.id, (seen.get(v.id) || 0) + 1);
  }
}

// CapCut from JSON
const capcutJson = path.join(cwd, 'src', 'lib', 'data', 'capcut_voices.json');
let capcutN = 0;
if (fs.existsSync(capcutJson)) {
  try {
    const raw = JSON.parse(fs.readFileSync(capcutJson, 'utf8'));
    capcutN = Array.isArray(raw) ? raw.length : Object.keys(raw || {}).length;
    console.log(`  CapCut JSON entries: ${capcutN}`);
  } catch (e) {
    push({ severity: 'error', platform: 'capcut_tts', message: String(e) });
  }
}

// ─── Piper ───
console.log('\n=== 2. Local Piper / Vina ===\n');
const piperDir = path.join(cwd, 'bin', 'piper_vn');
if (fs.existsSync(piperDir)) {
  const onnx = fs.readdirSync(piperDir).filter((f) => f.endsWith('.onnx'));
  console.log(`  Piper onnx: ${onnx.length}`);
  const piperCat = byPlat.piper || [];
  for (const v of piperCat) {
    const ok =
      onnx.includes(v.id) ||
      onnx.some((f) => f.replace(/\.onnx$/i, '') === v.id.replace(/\.onnx$/i, ''));
    if (!ok) {
      push({
        severity: 'warn',
        platform: 'piper',
        id: v.id,
        message: 'Not found in bin/piper_vn',
      });
    }
  }
} else {
  console.log('  Piper: bin/piper_vn missing');
}

// Vina profiles
const vinaDir = path.join(cwd, 'data', 'vina-voices');
function loadProfilesFile(file) {
  if (!fs.existsSync(file)) return [];
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    return Object.entries(raw).map(([name, v]) => ({ name, ...v }));
  } catch {
    return [];
  }
}
const goc = loadProfilesFile(path.join(vinaDir, 'profiles_goc.json'));
const user = loadProfilesFile(path.join(vinaDir, 'profiles_user.json'));
const profiles = [...goc, ...user];
console.log(`  Vina profiles: goc=${goc.length} user=${user.length}`);
let vinaOk = 0;
let vinaMiss = 0;
for (const p of profiles) {
  const candidates = [
    p.filename && path.join(vinaDir, 'samples', p.filename),
    p.filename && path.join(vinaDir, 'user-clones', p.filename),
    p.filename && path.join(vinaDir, p.filename),
    p._dir && p.filename && path.join(p._dir, p.filename),
  ].filter(Boolean);
  const found = candidates.find((c) => fs.existsSync(c));
  if (found) vinaOk++;
  else {
    vinaMiss++;
    push({
      severity: 'error',
      platform: 'vina_voice',
      id: p.name,
      message: `Missing sample: ${p.filename || '?'}`,
    });
  }
}
console.log(`  Vina samples OK=${vinaOk} missing=${vinaMiss}`);

// ─── Edge MS list ───
console.log('\n=== 3. Edge TTS vs Microsoft list ===\n');
let msVoices = [];
try {
  const res = await fetch(EDGE_LIST_URL, {
    signal: AbortSignal.timeout(30_000),
    headers: { 'User-Agent': 'Mozilla/5.0 AI-Novel-voice-audit' },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  msVoices = await res.json();
  console.log(`  Microsoft online voices: ${msVoices.length}`);
} catch (e) {
  console.log(`  FAIL fetch: ${e.message || e}`);
  push({ severity: 'error', platform: 'edge_tts', message: `MS list fetch: ${e.message || e}` });
}

const msSet = new Set(msVoices.map((v) => v.ShortName));
// Edge catalog unique ids
const edgeIds = [...new Set((byPlat.edge_tts || []).map((v) => v.id))];
// Also from EDGE_* const names — edge_tts platform assignment should catch v() in EDGE_VI before STATIC
// Actually EDGE_VI is BEFORE static - platformAt might assign wrong platform for those!
// Re-parse: all v() that look like edge ShortNames (contain Neural or locale pattern)
const edgeLike = [
  ...new Set(
    rawVoices
      .filter((v) => /Neural|neural/.test(v.id) || /^[a-z]{2}-[A-Z]{2}-/.test(v.id))
      .map((v) => v.id),
  ),
];
// Prefer edgeLike for MS check (complete edge set)
const edgeCheck = edgeLike.length >= edgeIds.length ? edgeLike : edgeIds;

let edgeOk = 0;
const unknown = [];
if (msSet.size) {
  for (const id of edgeCheck) {
    if (msSet.has(id)) edgeOk++;
    else {
      unknown.push(id);
      push({
        severity: 'error',
        platform: 'edge_tts',
        id,
        message: 'Not in Microsoft Edge voice list',
      });
    }
  }
  console.log(
    `  Catalog edge-like IDs: ${edgeCheck.length} · match=${edgeOk} · unknown=${unknown.length}`,
  );
  if (unknown.length) {
    console.log('  UNKNOWN (remove or replace):');
    for (const id of unknown) console.log(`    - ${id}`);
  }

  // Useful VN + EN voices present in MS but not catalog (optional info)
  const catSet = new Set(edgeCheck);
  const msVi = msVoices.filter((v) => v.Locale?.startsWith('vi-'));
  const missingVi = msVi.filter((v) => !catSet.has(v.ShortName));
  if (missingVi.length) {
    console.log(`\n  MS has ${msVi.length} vi voices; catalog missing ${missingVi.length}:`);
    for (const v of missingVi) {
      console.log(`    + ${v.ShortName} (${v.Gender || '?'})`);
    }
  }
}

// ─── Live probe ───
if (probeEdge) {
  console.log('\n=== 4. Live Edge probe ===\n');
  let EdgeTTS;
  try {
    ({ EdgeTTS } = require('node-edge-tts'));
  } catch (e) {
    console.log('  node-edge-tts not loadable:', e.message);
    process.exit(1);
  }
  const outDir = path.join(cwd, 'scratch', 'voice-audit');
  fs.mkdirSync(outDir, { recursive: true });

  let toProbe = edgeCheck.map((id) => ({ id }));
  if (edgeLangFilter) {
    const p = edgeLangFilter.toLowerCase();
    toProbe = toProbe.filter((v) =>
      v.id.toLowerCase().startsWith(p.includes('-') ? p : `${p}-`),
    );
  }
  if (probeLimit > 0) toProbe = toProbe.slice(0, probeLimit);

  let pass = 0;
  let fail = 0;
  for (let i = 0; i < toProbe.length; i++) {
    const id = toProbe[i].id;
    const safe = id.replace(/[^a-zA-Z0-9_-]/g, '_');
    const audioPath = path.join(outDir, `${safe}.mp3`);
    try {
      if (fs.existsSync(audioPath)) fs.unlinkSync(audioPath);
      const parts = id.split('-');
      const lang = parts.length >= 2 ? `${parts[0]}-${parts[1]}` : 'en-US';
      const tts = new EdgeTTS({
        voice: id,
        lang,
        outputFormat: 'audio-24khz-48kbitrate-mono-mp3',
        timeout: 25000,
      });
      await tts.ttsPromise('Xin chao. Hello test.', audioPath);
      const sz = fs.existsSync(audioPath) ? fs.statSync(audioPath).size : 0;
      if (sz < 200) throw new Error(`small ${sz}B`);
      pass++;
      console.log(`  OK  [${i + 1}/${toProbe.length}] ${id} (${sz}B)`);
    } catch (e) {
      fail++;
      const msg = (e && e.message) || String(e);
      console.log(`  FAIL [${i + 1}/${toProbe.length}] ${id}: ${msg.slice(0, 100)}`);
      push({
        severity: 'error',
        platform: 'edge_tts',
        id,
        message: `probe: ${msg.slice(0, 200)}`,
      });
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  console.log(`\n  Probe PASS=${pass} FAIL=${fail}/${toProbe.length}`);
}

// ─── Summary ───
console.log('\n=== ISSUES ===\n');
const errors = issues.filter((i) => i.severity === 'error');
const warns = issues.filter((i) => i.severity === 'warn');
console.log(`  errors=${errors.length} warnings=${warns.length}`);
for (const i of issues) {
  console.log(
    `  [${i.severity}] ${i.platform}${i.id ? ' ' + i.id : ''}: ${i.message}`,
  );
}

const reportPath = path.join(cwd, 'scratch', 'voice-audit-report.json');
fs.mkdirSync(path.dirname(reportPath), { recursive: true });
fs.writeFileSync(
  reportPath,
  JSON.stringify(
    {
      at: new Date().toISOString(),
      totalUniqueApprox: total,
      capcutN,
      edge: { check: edgeCheck.length, match: edgeOk, unknown },
      vina: { ok: vinaOk, missing: vinaMiss },
      issues,
    },
    null,
    2,
  ),
  'utf8',
);
console.log(`\nReport → ${reportPath}`);
process.exit(errors.length ? 1 : 0);
