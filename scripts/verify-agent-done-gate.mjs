/**
 * verify:agent-done — machine gate against completion hallucination.
 *
 * Detects domains from git status (or --domains=a,b) and runs minimum smokes.
 * Writes scratch/agent-done-gate-report.json
 *
 * Usage:
 *   node scripts/verify-agent-done-gate.mjs
 *   node scripts/verify-agent-done-gate.mjs --domains=tts,core
 *   node scripts/verify-agent-done-gate.mjs --skip-typecheck
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const cwd = path.resolve(__dirname, '..');
const reportPath = path.join(cwd, 'scratch', 'agent-done-gate-report.json');

const args = process.argv.slice(2);
const skipTypecheck = args.includes('--skip-typecheck');
const domainsArg = args.find((a) => a.startsWith('--domains='));
const forcedDomains = domainsArg
  ? domainsArg
      .slice(10)
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
  : null;

function run(cmd, cmdArgs, label) {
  const t0 = Date.now();
  const r = spawnSync(cmd, cmdArgs, {
    cwd,
    encoding: 'utf8',
    shell: process.platform === 'win32',
    env: process.env,
    maxBuffer: 20 * 1024 * 1024,
  });
  const ms = Date.now() - t0;
  const stdout = (r.stdout || '').slice(-4000);
  const stderr = (r.stderr || '').slice(-4000);
  return {
    label,
    cmd: [cmd, ...cmdArgs].join(' '),
    exitCode: r.status ?? 1,
    ms,
    ok: (r.status ?? 1) === 0,
    tail: (stdout + '\n' + stderr).trim().split(/\r?\n/).slice(-12).join('\n'),
  };
}

function gitPaths() {
  const r = spawnSync('git', ['status', '--porcelain'], {
    cwd,
    encoding: 'utf8',
    shell: process.platform === 'win32',
  });
  if (r.status !== 0) return [];
  return (r.stdout || '')
    .split(/\r?\n/)
    .map((line) => line.slice(3).trim().replace(/^"|"$/g, ''))
    .filter(Boolean);
}

function detectDomains(paths) {
  const d = new Set();
  let hasCode = false;
  for (const p of paths) {
    const s = p.replace(/\\/g, '/').toLowerCase();
    if (/\.(ts|tsx|js|mjs|cjs)$/i.test(p)) hasCode = true;

    // TTS / Vina / voice catalog / preview
    if (
      /(^|\/)(tts|vina|voice|omnivoice)(\/|$)/.test(s) ||
      s.includes('generate-tts') ||
      s.includes('vina-voice') ||
      s.includes('vina_voice') ||
      s.includes('vinavoice') ||
      s.includes('previewcache') ||
      s.includes('previewdefaults') ||
      s.includes('previewtimeout') ||
      s.includes('previewpreflight') ||
      s.includes('voicecatalog') ||
      s.includes('voice-catalog') ||
      s.includes('verify-tts') ||
      s.includes('smoke-vina') ||
      s.includes('data/vina-voices')
    ) {
      d.add('tts');
    }

    // Content pipeline (not chapter “pipeline” metaphor alone)
    if (
      s.includes('/lib/pipeline/') ||
      s.includes('smoke-pipeline') ||
      s.includes('qualitygate') ||
      s.includes('longformarc') ||
      s.includes('scenestagequeue') ||
      s.includes('mediaaftercommit') ||
      s.includes('memoryaftercommit')
    ) {
      d.add('pipeline');
    }

    // Commercial / license
    if (
      s.includes('entitlement') ||
      s.includes('/commercial/') ||
      s.includes('licenseonepath') ||
      s.includes('license-one-path') ||
      s.includes('/features/license/') ||
      s.includes('labyrinth') ||
      s.includes('anti-tamper') ||
      s.includes('antitamper') ||
      s.includes('smoke-commercial') ||
      s.includes('smoke-license')
    ) {
      d.add('commercial');
    }

    // Core contracts / smoke-core only (not every workspace UI path)
    if (
      s.includes('/contracts/') ||
      s.includes('smoke-core') ||
      s.includes('domainownership') ||
      s.endsWith('agents.md') ||
      s.includes('agent_done_gate') ||
      s.includes('verify-agent-done')
    ) {
      d.add('core');
    }

    // Ship / packaging / electron shell — NOT package.json alone (false "packag")
    if (
      s.includes('ship-check') ||
      s.includes('ship_check') ||
      s.includes('/electron/') ||
      s.startsWith('electron/') ||
      s === 'main.js' ||
      s === 'preload.js' ||
      s.includes('packaging_standard') ||
      s.includes('brand-splash') ||
      s.includes('generate-brand') ||
      s.includes('before-pack') ||
      s.includes('after-pack') ||
      s.includes('electron-builder') ||
      s.includes('dist-qa') ||
      s.includes('extraresources') ||
      s.includes('assert-commercial-package') ||
      s.includes('audit-packaged')
    ) {
      d.add('ship');
    }
  }
  if (hasCode) d.add('code');
  if (d.size === 0 && paths.length) d.add('code');
  return [...d];
}

const paths = gitPaths();
const domains = forcedDomains?.length ? forcedDomains : detectDomains(paths);

const results = [];
const statusLadder = {
  IMPLEMENTED: paths.length > 0,
  TYPECHECK_OK: null,
  SMOKE_OK: null,
  domains,
  pathsSample: paths.slice(0, 40),
};

console.log('AGENT_DONE_GATE domains=', domains.join(',') || '(none)');
console.log('changed_paths=', paths.length);

if (!skipTypecheck && (domains.includes('code') || domains.includes('tts') || paths.some((p) => /\.(ts|tsx)$/i.test(p)))) {
  const r = run('npm', ['run', 'typecheck'], 'typecheck');
  results.push(r);
  statusLadder.TYPECHECK_OK = r.ok;
  console.log(r.ok ? 'TYPECHECK_OK' : 'TYPECHECK_FAIL', `exit=${r.exitCode}`, `${r.ms}ms`);
  if (!r.ok) console.log(r.tail);
} else if (skipTypecheck) {
  statusLadder.TYPECHECK_OK = 'skipped';
}

if (domains.includes('tts')) {
  results.push(run('npm', ['run', 'smoke:vina'], 'smoke:vina'));
  results.push(run('npm', ['run', 'verify:tts-integrity'], 'verify:tts-integrity'));
}

if (domains.includes('pipeline')) {
  results.push(run('npm', ['run', 'smoke:pipeline'], 'smoke:pipeline'));
}

if (domains.includes('commercial')) {
  results.push(run('npm', ['run', 'smoke:license-one-path'], 'smoke:license-one-path'));
}

if (domains.includes('core')) {
  results.push(run('npm', ['run', 'smoke:core'], 'smoke:core'));
}

if (domains.includes('ship')) {
  results.push(run('npm', ['run', 'ship:check'], 'ship:check'));
}

// Always run vina catalog when data/vina-voices is in diff even if domain miss
if (
  !domains.includes('tts') &&
  paths.some((p) => p.replace(/\\/g, '/').includes('data/vina-voices'))
) {
  results.push(run('npm', ['run', 'smoke:vina'], 'smoke:vina'));
}

const smokeResults = results.filter((r) => r.label !== 'typecheck');
const allOk = results.every((r) => r.ok);
statusLadder.SMOKE_OK = smokeResults.length ? smokeResults.every((r) => r.ok) : null;

const report = {
  at: new Date().toISOString(),
  domains,
  pathCount: paths.length,
  statusLadder,
  results: results.map((r) => ({
    label: r.label,
    cmd: r.cmd,
    exitCode: r.exitCode,
    ok: r.ok,
    ms: r.ms,
    tail: r.tail,
  })),
  verdict: allOk ? 'PASS' : 'REJECT',
  doneAllowed: allOk && statusLadder.TYPECHECK_OK !== false,
  note:
    allOk
      ? 'Machine gate PASS — agent still must attach log tails + empirical-qa VERDICT before user DONE.'
      : 'Machine gate REJECT — fix failing commands; do not claim DONE.',
};

fs.mkdirSync(path.dirname(reportPath), { recursive: true });
fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf8');

console.log('---');
console.log('VERDICT:', report.verdict);
console.log('report:', reportPath);
for (const r of results) {
  console.log(`${r.ok ? 'OK' : 'FAIL'} ${r.label} exit=${r.exitCode}`);
}

process.exit(allOk ? 0 : 1);
