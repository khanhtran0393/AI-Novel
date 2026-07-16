/**
 * Audit Cấu Hình Giọng Đọc Toàn Cục — catalog tĩnh + Edge list Microsoft + local assets.
 *
 * Usage:
 *   node --experimental-strip-types scripts/audit-global-tts-voices.mts
 *   node --experimental-strip-types scripts/audit-global-tts-voices.mts --probe-edge
 *   node --experimental-strip-types scripts/audit-global-tts-voices.mts --probe-edge --edge-lang=vi
 */
import fs from 'fs';
import path from 'path';
import {
  STATIC_VOICE_CATALOG,
  countCatalogVoices,
  getAllVoicesForPlatform,
  type VoiceOption,
} from '../src/lib/voiceCatalog';
import { loadVinaProfiles, resolveSamplePath } from '../src/lib/vinaVoice/profiles';

const EDGE_LIST_URL =
  'https://speech.platform.bing.com/consumer/speech/synthesize/readaloud/voices/list?trustedclienttoken=6A5AA1D4EAFF4E9FB37E23D68491D6F4';

const args = process.argv.slice(2);
const probeEdge = args.includes('--probe-edge');
const edgeLangArg = args.find((a) => a.startsWith('--edge-lang='));
const edgeLangFilter = edgeLangArg ? edgeLangArg.split('=')[1] : '';
const probeLimit = (() => {
  const a = args.find((x) => x.startsWith('--limit='));
  return a ? Math.max(1, Number(a.split('=')[1]) || 50) : 0;
})();

type Issue = {
  severity: 'error' | 'warn';
  platform: string;
  lang?: string;
  id?: string;
  message: string;
};

const issues: Issue[] = [];

function push(i: Issue) {
  issues.push(i);
}

// ─── 1) Static catalog integrity ───────────────────────────
console.log('=== 1. STATIC_VOICE_CATALOG structure ===\n');
const counts = countCatalogVoices(STATIC_VOICE_CATALOG);
let totalVoices = 0;
for (const [plat, n] of Object.entries(counts).sort((a, b) => b[1] - a[1])) {
  totalVoices += n;
  console.log(`  ${plat.padEnd(18)} ${String(n).padStart(4)} voices`);
}
console.log(`  ${'TOTAL'.padEnd(18)} ${String(totalVoices).padStart(4)}\n`);

for (const [platform, langs] of Object.entries(STATIC_VOICE_CATALOG)) {
  for (const [lang, list] of Object.entries(langs || {})) {
    const seen = new Map<string, number>();
    for (const v of list || []) {
      if (!v?.id?.trim()) {
        push({
          severity: 'error',
          platform,
          lang,
          message: `Empty voice id (name=${v?.name || '?'})`,
        });
        continue;
      }
      if (!v.name?.trim()) {
        push({
          severity: 'warn',
          platform,
          lang,
          id: v.id,
          message: 'Empty display name',
        });
      }
      seen.set(v.id, (seen.get(v.id) || 0) + 1);
    }
    for (const [id, n] of seen) {
      if (n > 1) {
        push({
          severity: 'warn',
          platform,
          lang,
          id,
          message: `Duplicate id ×${n} in same language bucket`,
        });
      }
    }
    // Platforms that UI shows for vi should not be empty (except runtime-merged)
    if (
      lang === 'vi' &&
      (list || []).length === 0 &&
      platform !== 'vina_voice'
    ) {
      push({
        severity: 'warn',
        platform,
        lang,
        message: 'Empty vi list (UI shows 0 voices until runtime merge)',
      });
    }
  }
}

// ─── 2) Local assets: Piper / Vina ─────────────────────────
console.log('=== 2. Local assets (Piper + Vina) ===\n');
const cwd = process.cwd();
const piperDir = path.join(cwd, 'bin', 'piper_vn');
if (fs.existsSync(piperDir)) {
  const onnx = fs.readdirSync(piperDir).filter((f) => f.endsWith('.onnx'));
  console.log(`  Piper models: ${onnx.length} in bin/piper_vn`);
  const catalogPiper = getAllVoicesForPlatform(STATIC_VOICE_CATALOG, 'piper');
  for (const v of catalogPiper) {
    const onDisk = onnx.includes(v.id) || fs.existsSync(path.join(piperDir, v.id));
    if (!onDisk && !v.id.endsWith('.onnx')) {
      // static may use short ids
      const match = onnx.find((f) => f.replace(/\.onnx$/i, '') === v.id.replace(/\.onnx$/i, ''));
      if (!match) {
        push({
          severity: 'warn',
          platform: 'piper',
          id: v.id,
          message: `Catalog voice not found as .onnx under bin/piper_vn`,
        });
      }
    } else if (v.id.endsWith('.onnx') && !onnx.includes(v.id)) {
      push({
        severity: 'error',
        platform: 'piper',
        id: v.id,
        message: 'Missing onnx file',
      });
    }
  }
  for (const f of onnx) {
    const inCat = catalogPiper.some(
      (v) => v.id === f || v.id === f.replace(/\.onnx$/i, ''),
    );
    if (!inCat) {
      console.log(`  [info] piper disk model not in static catalog: ${f}`);
    }
  }
} else {
  console.log('  Piper: bin/piper_vn missing');
  push({
    severity: 'warn',
    platform: 'piper',
    message: 'bin/piper_vn not found',
  });
}

const vinaProfiles = loadVinaProfiles(cwd);
console.log(`  Vina profiles: ${vinaProfiles.length}`);
let vinaOk = 0;
let vinaMissing = 0;
for (const p of vinaProfiles) {
  const sample = resolveSamplePath(p, cwd);
  if (sample && fs.existsSync(sample)) {
    vinaOk++;
  } else {
    vinaMissing++;
    push({
      severity: 'error',
      platform: 'vina_voice',
      id: p.name,
      message: `Missing sample file (filename=${p.filename || '?'})`,
    });
  }
}
console.log(`  Vina samples OK=${vinaOk} missing=${vinaMissing}\n`);

// CapCut resource map
const capcutJson = path.join(cwd, 'src', 'lib', 'data', 'capcut_voices.json');
if (fs.existsSync(capcutJson)) {
  try {
    const raw = JSON.parse(fs.readFileSync(capcutJson, 'utf8'));
    const n = Array.isArray(raw) ? raw.length : Object.keys(raw || {}).length;
    console.log(`  CapCut data file entries: ${n}`);
  } catch {
    push({
      severity: 'error',
      platform: 'capcut_tts',
      message: 'capcut_voices.json parse failed',
    });
  }
}

// ─── 3) Edge official list cross-check ─────────────────────
console.log('=== 3. Edge TTS vs Microsoft voice list ===\n');
type MsVoice = { ShortName: string; Locale: string; FriendlyName?: string; Gender?: string };
let msVoices: MsVoice[] = [];
try {
  const res = await fetch(EDGE_LIST_URL, {
    signal: AbortSignal.timeout(25_000),
    headers: { 'User-Agent': 'Mozilla/5.0 AI-Novel-voice-audit' },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  msVoices = (await res.json()) as MsVoice[];
  console.log(`  Microsoft list: ${msVoices.length} voices`);
} catch (e) {
  console.log(
    `  FAIL fetch Microsoft list: ${e instanceof Error ? e.message : e}`,
  );
  push({
    severity: 'error',
    platform: 'edge_tts',
    message: `Cannot fetch MS voice list: ${e instanceof Error ? e.message : e}`,
  });
}

const msSet = new Set(msVoices.map((v) => v.ShortName));
const edgeCatalog = getAllVoicesForPlatform(STATIC_VOICE_CATALOG, 'edge_tts');
let edgeOk = 0;
let edgeUnknown = 0;
const unknownIds: string[] = [];
for (const v of edgeCatalog) {
  if (msSet.size === 0) break;
  if (msSet.has(v.id)) {
    edgeOk++;
  } else {
    edgeUnknown++;
    unknownIds.push(v.id);
    push({
      severity: 'error',
      platform: 'edge_tts',
      id: v.id,
      message: 'Not in Microsoft Edge online voice list (will fail TTS)',
    });
  }
}
if (msSet.size) {
  console.log(
    `  Catalog Edge: ${edgeCatalog.length} · match MS=${edgeOk} · UNKNOWN=${edgeUnknown}`,
  );
  if (unknownIds.length) {
    console.log('  Unknown IDs:');
    for (const id of unknownIds) console.log(`    - ${id}`);
  }
}

// ─── 4) Optional live Edge probe (synth 1 short phrase) ────
if (probeEdge) {
  console.log('\n=== 4. Live Edge TTS probe ===\n');
  const { EdgeTTS } = await import('node-edge-tts');
  const outDir = path.join(cwd, 'scratch', 'voice-audit');
  fs.mkdirSync(outDir, { recursive: true });

  let toProbe = edgeCatalog;
  if (edgeLangFilter) {
    const prefix = edgeLangFilter.toLowerCase();
    toProbe = edgeCatalog.filter((v) =>
      v.id.toLowerCase().startsWith(prefix.includes('-') ? prefix : `${prefix}-`),
    );
    // also match lang bucket
    if (!toProbe.length) {
      toProbe =
        STATIC_VOICE_CATALOG.edge_tts?.[edgeLangFilter] ||
        STATIC_VOICE_CATALOG.edge_tts?.[prefix] ||
        [];
    }
  }
  if (probeLimit > 0) toProbe = toProbe.slice(0, probeLimit);

  let pass = 0;
  let fail = 0;
  for (let i = 0; i < toProbe.length; i++) {
    const v = toProbe[i];
    const safe = v.id.replace(/[^a-zA-Z0-9_-]/g, '_');
    const audioPath = path.join(outDir, `${safe}.mp3`);
    try {
      if (fs.existsSync(audioPath)) fs.unlinkSync(audioPath);
      const tts = new EdgeTTS({
        voice: v.id,
        lang: v.locale || v.id.split('-').slice(0, 2).join('-') || 'en-US',
        outputFormat: 'audio-24khz-48kbitrate-mono-mp3',
        timeout: 25_000,
      });
      await tts.ttsPromise('Xin chào. Hello test.', audioPath);
      const sz = fs.existsSync(audioPath) ? fs.statSync(audioPath).size : 0;
      if (sz < 200) throw new Error(`empty/small file ${sz}B`);
      pass++;
      console.log(`  OK  [${i + 1}/${toProbe.length}] ${v.id} (${sz} B)`);
    } catch (e) {
      fail++;
      const msg = e instanceof Error ? e.message : String(e);
      console.log(`  FAIL [${i + 1}/${toProbe.length}] ${v.id}: ${msg.slice(0, 120)}`);
      push({
        severity: 'error',
        platform: 'edge_tts',
        id: v.id,
        message: `Live probe fail: ${msg.slice(0, 200)}`,
      });
    }
    // gentle delay vs rate limit
    await new Promise((r) => setTimeout(r, 350));
  }
  console.log(`\n  Probe result: PASS=${pass} FAIL=${fail} / ${toProbe.length}`);
}

// ─── Report ────────────────────────────────────────────────
console.log('\n=== ISSUES SUMMARY ===\n');
const errors = issues.filter((i) => i.severity === 'error');
const warns = issues.filter((i) => i.severity === 'warn');
console.log(`  errors=${errors.length}  warnings=${warns.length}`);
for (const i of issues) {
  console.log(
    `  [${i.severity}] ${i.platform}${i.lang ? '/' + i.lang : ''}${i.id ? ' ' + i.id : ''}: ${i.message}`,
  );
}

const reportPath = path.join(cwd, 'scratch', 'voice-audit-report.json');
fs.mkdirSync(path.dirname(reportPath), { recursive: true });
fs.writeFileSync(
  reportPath,
  JSON.stringify(
    {
      at: new Date().toISOString(),
      counts,
      totalVoices,
      edge: { catalog: edgeCatalog.length, matchMs: edgeOk, unknown: unknownIds },
      vina: { profiles: vinaProfiles.length, samplesOk: vinaOk, missing: vinaMissing },
      issues,
    },
    null,
    2,
  ),
  'utf8',
);
console.log(`\nReport: ${reportPath}`);

if (errors.length) {
  console.log('\nRESULT: FAIL (has errors)');
  process.exit(1);
}
console.log('\nRESULT: PASS');
