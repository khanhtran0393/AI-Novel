/**
 * Smoke: crown IP seal round-trip + formula load + optional python seal.
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const {
  sealJsCrowns,
  sealPythonCrowns,
  CROWN_OUT,
  PYTHON_CROWN_REL,
} = require('./lib/crown-ip-seal.cjs');
const { unsealBuffer } = require('./lib/crown-ip-crypto.cjs');
const { restoreStubs } = require('./lib/crown-ip-stub.cjs');

const ROOT = path.resolve(__dirname, '..');

function main() {
  // Ensure workspace formula sources are plain (not leftover stubs)
  restoreStubs();

  return sealJsCrowns().then((js) => {
    assert.ok(js.length >= 2, 'expected js crowns');
    for (const item of js) {
      const abs = path.join(ROOT, item.path);
      assert.ok(fs.existsSync(abs), `missing seal ${item.path}`);
      const sealed = fs.readFileSync(abs);
      const code = unsealBuffer(sealed, item.id).toString('utf8');
      assert.ok(code.length > 200, `seal too small ${item.id}`);
      // Load as CJS in isolation
      const Module = require('module');
      const mod = new Module(abs);
      mod.filename = abs;
      mod.paths = Module._nodeModulePaths(path.dirname(abs));
      mod._compile(code, abs);
      const exp = mod.exports;
      if (item.id === 'bypass-formulas') {
        assert.ok(exp.BYPASS_DEFAULTS, 'BYPASS_DEFAULTS');
        assert.ok(typeof exp.buildBypassGraph === 'function', 'buildBypassGraph');
        assert.ok(typeof exp.resolveBypassParams === 'function', 'resolveBypassParams');
        const params = exp.resolveBypassParams(null);
        assert.ok(params && typeof params.gop === 'number', 'params.gop');
      }
      if (item.id === 'translate-crown') {
        assert.ok(Array.isArray(exp.TRANSLATE_RULE_OPTIONS), 'TRANSLATE_RULE_OPTIONS');
        assert.ok(exp.TRANSLATE_RULE_OPTIONS.length >= 10, 'rules count');
        assert.ok(typeof exp.buildTranslateBatchPrompt === 'function', 'prompt');
        const p = exp.buildTranslateBatchPrompt({
          langName: 'Tiếng Việt',
          ruleDesc: 'test',
          texts: ['hello', 'world'],
        });
        assert.ok(p.includes('hello') && p.includes('Tiếng Việt'), 'prompt content');
      }
      console.log(JSON.stringify({ ok: true, step: 'crown-js-load', id: item.id }));
    }

    // Python seal round-trip in temp dir (do not stub workspace)
    const os = require('os');
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ainovel-crown-py-'));
    const sampleRel = 'services/script_analyzer.py';
    const src = path.join(ROOT, 'python_core', sampleRel);
    assert.ok(fs.existsSync(src), 'script_analyzer.py');
    fs.mkdirSync(path.join(tmp, 'services'), { recursive: true });
    fs.copyFileSync(src, path.join(tmp, sampleRel));
    fs.copyFileSync(
      path.join(ROOT, 'python_core', 'ip_seal_loader.py'),
      path.join(tmp, 'ip_seal_loader.py'),
    );
    // Also need youtube etc optional — sealPythonCrowns skips missing
    const sealed = sealPythonCrowns(tmp, { writeStubs: true });
    assert.ok(sealed.length >= 1, 'python sealed');
    const stub = fs.readFileSync(path.join(tmp, sampleRel), 'utf8');
    assert.ok(stub.includes('AINOVEL CROWN STUB'), 'stub written');
    assert.ok(fs.existsSync(path.join(tmp, sampleRel + '.seal')), 'py.seal');

    // Unseal via Python stdlib loader (no full import graph — avoid missing deps in tmp)
    const sealFile = path.join(tmp, sampleRel + '.seal').replace(/\\/g, '\\\\');
    const tmpEsc = tmp.replace(/\\/g, '\\\\');
    const pyCode = [
      'import sys',
      `sys.path.insert(0, r"${tmpEsc}")`,
      'from ip_seal_loader import unseal_buffer',
      `raw = open(r"${sealFile}", "rb").read()`,
      'src = unseal_buffer(raw, "py:services/script_analyzer.py").decode("utf-8")',
      'assert "ScriptAnalyzer" in src and "AINOVEL CROWN STUB" not in src, src[:200]',
      'assert "gemini_with_fallback" in src',
      'print("PY_UNSEAL_OK", len(src))',
    ].join('\n');
    const py = spawnSync('python', ['-c', pyCode], {
      encoding: 'utf8',
      windowsHide: true,
    });
    if (py.status !== 0) {
      console.error(py.stdout, py.stderr);
      throw new Error(`python unseal failed: ${py.status}`);
    }
    assert.ok(String(py.stdout).includes('PY_UNSEAL_OK'), 'unseal ok');

    // package.json hooks
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
    assert.ok(pkg.scripts['crown:seal'], 'crown:seal script');
    assert.ok(pkg.scripts['smoke:crown-ip'], 'smoke:crown-ip script');
    const extra = JSON.stringify(pkg.build.extraResources || []);
    assert.ok(extra.includes('resources/crown') || extra.includes('crown'), 'extraResources crown');
    assert.ok(extra.includes('ip_seal_loader.py'), 'ip_seal_loader packaged');

    console.log(
      JSON.stringify({
        ok: true,
        step: 'smoke-crown-ip',
        jsSeals: js.map((j) => j.id),
        pySealed: sealed.map((s) => s.rel),
        crownOut: CROWN_OUT,
      }),
    );
  });
}

main().catch((err) => {
  console.error('[smoke-crown-ip]', err?.stack || err);
  process.exit(1);
});
