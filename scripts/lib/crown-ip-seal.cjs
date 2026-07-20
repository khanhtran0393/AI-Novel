/**
 * Seal crown IP modules for customer packs:
 *  1) Phantom-X bypass formulas (TS → CJS → AES seal)
 *  2) Dịch SRT rules + prompt kernel
 *  3) Python analyzers (.py → .py.seal + thin stub)
 *
 * Output:
 *  - resources/crown/*.seal  (shipped via extraResources)
 *  - python sealed in-place only when --python-dir is set (pack afterPack)
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { sealBuffer, sealBufferV2, unsealBuffer } = require('./crown-ip-crypto.cjs');

const ROOT = path.resolve(__dirname, '..', '..');
const CROWN_OUT = path.join(ROOT, 'resources', 'crown');
const MANIFEST = path.join(CROWN_OUT, 'manifest.json');

/** Python modules whose plain source must not ship in install folder. */
const PYTHON_CROWN_REL = [
  'services/script_analyzer.py',
  'services/storyboard_analyzer.py',
  'services/youtube_analyzer_v1.py',
  'services/youtube_analyzer.py',
  'services/veo3_utils.py',
  'yt_goi_y.py',
  'bili_goi_y.py',
];

const JS_CROWNS = [
  {
    id: 'bypass-formulas',
    entry: path.join(ROOT, 'scripts', 'crown-entries', 'bypass-formulas.entry.ts'),
    outfile: path.join(CROWN_OUT, 'bypass-formulas.seal'),
  },
  {
    id: 'translate-crown',
    entry: path.join(ROOT, 'scripts', 'crown-entries', 'translate-crown.entry.ts'),
    outfile: path.join(CROWN_OUT, 'translate-crown.seal'),
  },
];

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function resolveEsbuild() {
  try {
    return require('esbuild');
  } catch {
    return null;
  }
}

/**
 * Optional light obfuscation of identifiers (esbuild minify already mangles locals).
 * @param {string} code
 * @param {string} id
 */
async function minifyCrownBundle(code, id) {
  const esbuild = resolveEsbuild();
  if (!esbuild) return code;
  const result = await esbuild.transform(code, {
    loader: 'js',
    minify: true,
    minifyIdentifiers: true,
    minifySyntax: true,
    minifyWhitespace: true,
    target: ['node20'],
    legalComments: 'none',
    format: 'cjs',
  });
  return `/* ainovel-crown ${id} */\n${result.code}`;
}

/**
 * Bundle TS crown entry → CJS string.
 * @param {{ id: string, entry: string }} crown
 */
async function bundleCrownEntry(crown) {
  const esbuild = resolveEsbuild();
  if (!esbuild) {
    throw new Error('esbuild required for crown:seal (devDependency)');
  }
  if (!fs.existsSync(crown.entry)) {
    throw new Error(`Crown entry missing: ${crown.entry}`);
  }
  const result = await esbuild.build({
    entryPoints: [crown.entry],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    write: false,
    target: ['node20'],
    legalComments: 'none',
    logLevel: 'silent',
    // Pure formula surface — no Next path alias needed (relative imports)
    absWorkingDir: ROOT,
  });
  const text = result.outputFiles[0].text;
  return minifyCrownBundle(text, crown.id);
}

/**
 * Seal JS/TS crown modules into resources/crown/*.seal
 */
async function sealJsCrowns() {
  ensureDir(CROWN_OUT);
  const sealed = [];
  for (const crown of JS_CROWNS) {
    const code = await bundleCrownEntry(crown);
    const buf = sealBuffer(code, crown.id);
    fs.writeFileSync(crown.outfile, buf);
    // Round-trip check
    const round = unsealBuffer(fs.readFileSync(crown.outfile), crown.id).toString('utf8');
    if (!round.includes('ainovel-crown') && !round.includes('module.exports') && !round.includes('exports.')) {
      // esbuild may use different export style; still require non-empty
      if (round.length < 100) {
        throw new Error(`Crown seal empty/short for ${crown.id}`);
      }
    }
    sealed.push({
      id: crown.id,
      path: path.relative(ROOT, crown.outfile).replace(/\\/g, '/'),
      bytes: buf.length,
      plainBytes: Buffer.byteLength(code, 'utf8'),
    });
    console.log(
      JSON.stringify({
        ok: true,
        step: 'crown-seal-js',
        id: crown.id,
        sealBytes: buf.length,
        plainBytes: Buffer.byteLength(code, 'utf8'),
      }),
    );
  }
  fs.writeFileSync(
    MANIFEST,
    JSON.stringify(
      {
        at: new Date().toISOString(),
        version: 1,
        js: sealed,
        note: 'Crown IP seals — AES-256-GCM; key = app pepper (not license token)',
      },
      null,
      2,
    ),
    'utf8',
  );
  return sealed;
}

/**
 * Python loader stub — no algorithm, only hydrate from .py.seal
 */
function pythonStubSource(relPosix) {
  const base = path.posix.basename(relPosix);
  return `# -*- coding: utf-8 -*-
"""AINOVEL CROWN STUB — plain source not shipped. Logic in ${base}.seal"""
from __future__ import annotations
import sys
from pathlib import Path

# ip_seal_loader lives at python_core root
_ROOT = Path(__file__).resolve().parents[${relPosix.split('/').length - 1}]
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))
from ip_seal_loader import hydrate_sealed_module  # noqa: E402

hydrate_sealed_module(__name__, __file__)
`;
}

/**
 * Seal Python crown files under pythonCoreDir (workspace or packed resources).
 * @param {string} pythonCoreDir
 * @param {{ writeStubs?: boolean }} [opts]
 */
function sealPythonCrowns(pythonCoreDir, opts = {}) {
  const writeStubs = opts.writeStubs !== false;
  const sealed = [];
  const loaderSrc = path.join(ROOT, 'python_core', 'ip_seal_loader.py');
  const loaderDst = path.join(pythonCoreDir, 'ip_seal_loader.py');
  if (fs.existsSync(loaderSrc)) {
    ensureDir(path.dirname(loaderDst));
    fs.copyFileSync(loaderSrc, loaderDst);
  } else {
    throw new Error('python_core/ip_seal_loader.py missing');
  }

  for (const rel of PYTHON_CROWN_REL) {
    const abs = path.join(pythonCoreDir, rel);
    if (!fs.existsSync(abs)) {
      console.log(JSON.stringify({ ok: true, step: 'crown-seal-py-skip', rel, reason: 'missing' }));
      continue;
    }
    const plain = fs.readFileSync(abs, 'utf8');
    // Skip if already a stub
    if (plain.includes('AINOVEL CROWN STUB') || plain.includes('hydrate_sealed_module')) {
      console.log(JSON.stringify({ ok: true, step: 'crown-seal-py-skip', rel, reason: 'already-stub' }));
      continue;
    }
    const moduleId = `py:${rel.replace(/\\/g, '/')}`;
    const sealPath = abs + '.seal';
    // v2 = stdlib Python unseal (no cryptography pip dep)
    const buf = sealBufferV2(plain, moduleId);
    fs.writeFileSync(sealPath, buf);
    // Round-trip
    const round = unsealBuffer(buf, moduleId).toString('utf8');
    if (round !== plain) {
      throw new Error(`Python crown seal round-trip fail: ${rel}`);
    }
    if (writeStubs) {
      const depth = rel.split(/[/\\]/).length - 1;
      // Fix stub root walk: parents[depth] from file → python_core root
      const stub = `# -*- coding: utf-8 -*-
"""AINOVEL CROWN STUB — plain source not shipped. Logic in ${path.basename(rel)}.seal"""
from __future__ import annotations
import sys
from pathlib import Path

_ROOT = Path(__file__).resolve().parents[${depth}]
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))
from ip_seal_loader import hydrate_sealed_module  # noqa: E402

hydrate_sealed_module(__name__, __file__)
`;
      fs.writeFileSync(abs, stub, 'utf8');
    }
    sealed.push({
      rel: rel.replace(/\\/g, '/'),
      sealBytes: buf.length,
      plainBytes: Buffer.byteLength(plain, 'utf8'),
    });
    console.log(
      JSON.stringify({
        ok: true,
        step: 'crown-seal-py',
        rel: rel.replace(/\\/g, '/'),
        sealBytes: buf.length,
      }),
    );
  }
  return sealed;
}

/**
 * Full seal (JS always; Python workspace optional).
 * @param {{ python?: boolean, pythonDir?: string }} [opts]
 */
async function sealAll(opts = {}) {
  ensureDir(CROWN_OUT);
  const js = await sealJsCrowns();
  let py = [];
  if (opts.python) {
    const dir = opts.pythonDir || path.join(ROOT, 'python_core');
    py = sealPythonCrowns(dir, { writeStubs: opts.writePythonStubs === true });
  }
  const manifest = {
    at: new Date().toISOString(),
    version: 1,
    js,
    py,
    note: 'Crown IP seals — AES-256-GCM; key = app pepper (not license token)',
  };
  fs.writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2), 'utf8');
  return manifest;
}

async function main() {
  const args = process.argv.slice(2);
  const python = args.includes('--python');
  const writePythonStubs = args.includes('--python-stubs');
  // Default: seal JS crowns into resources/crown (safe for workspace)
  // --python seals workspace python only if --python-stubs (destructive stubs)
  // Pack afterPack calls sealPythonCrowns on resources copy with stubs.
  const manifest = await sealAll({
    python: python || writePythonStubs,
    writePythonStubs,
  });
  console.log(JSON.stringify({ ok: true, step: 'crown-seal-done', manifest }, null, 2));
}

if (require.main === module) {
  main().catch((err) => {
    console.error('[crown-seal]', err?.stack || err);
    process.exit(1);
  });
}

module.exports = {
  ROOT,
  CROWN_OUT,
  PYTHON_CROWN_REL,
  JS_CROWNS,
  sealJsCrowns,
  sealPythonCrowns,
  sealAll,
};
