/**
 * Compile allowlisted gateway modules for anti-theft friction.
 *
 * Priority:
 *  1) Cython → .pyd (if cython + MSVC available)
 *  2) Nuitka --module (if nuitka available)
 *  3) Fallback: compileall .pyc + optional strip of .py in pack dir only
 *
 * Never mutates workspace plain sources permanently unless --inplace.
 * Pack pipeline uses --out <packaged python_core>.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');

/** Small pure modules safe to compile (no heavy C deps). */
const GATEWAY_MODULES = [
  'ainovel_host_guard.py',
  'gateway/host_binding.py',
];

function findPython() {
  const envPy = process.env.PYTHON || process.env.PYTHON_EXE;
  const candidates = [
    envPy,
    process.platform === 'win32' ? 'C:\\Python314\\python.exe' : null,
    process.platform === 'win32' ? 'C:\\Python313\\python.exe' : null,
    process.platform === 'win32' ? 'C:\\Python312\\python.exe' : null,
    process.platform === 'win32' ? 'C:\\Python311\\python.exe' : null,
    'python',
    'python3',
    process.platform === 'win32' ? 'py' : null,
  ].filter(Boolean);

  for (const cmd of candidates) {
    const args =
      cmd === 'py'
        ? ['-3', '-c', 'import sys; print(sys.executable)']
        : ['-c', 'import sys; print(sys.executable)'];
    const r = spawnSync(cmd, args, {
      encoding: 'utf8',
      windowsHide: true,
      shell: false,
    });
    if (r.status === 0 && String(r.stdout || '').trim()) {
      return String(r.stdout).trim().split(/\r?\n/).filter(Boolean).pop();
    }
  }
  // Last resort: PATH search via where/which
  const whereCmd = process.platform === 'win32' ? 'where' : 'which';
  const w = spawnSync(whereCmd, ['python'], {
    encoding: 'utf8',
    windowsHide: true,
    shell: false,
  });
  if (w.status === 0) {
    const first = String(w.stdout || '')
      .split(/\r?\n/)
      .map((s) => s.trim())
      .find(Boolean);
    if (first && fs.existsSync(first)) return first;
  }
  return null;
}

function hasModule(python, mod) {
  const r = spawnSync(python, ['-c', `import ${mod}`], {
    encoding: 'utf8',
    windowsHide: true,
  });
  return r.status === 0;
}

/**
 * @param {string} pythonCoreDir
 * @param {{ inplace?: boolean }} [opts]
 */
function compileGateway(pythonCoreDir, opts = {}) {
  const python = findPython();
  if (!python) {
    console.log(JSON.stringify({ ok: false, step: 'compile-gateway', error: 'no-python' }));
    return { ok: false, engine: 'none', compiled: [] };
  }

  const compiled = [];
  const cythonOk = hasModule(python, 'Cython');
  const nuitkaOk = hasModule(python, 'nuitka');

  for (const rel of GATEWAY_MODULES) {
    const src = path.join(pythonCoreDir, rel);
    if (!fs.existsSync(src)) {
      console.log(JSON.stringify({ ok: true, step: 'compile-skip', rel, reason: 'missing' }));
      continue;
    }

    // Prefer Cython
    if (cythonOk) {
      const setupPy = `
from setuptools import setup
from Cython.Build import cythonize
import sys
setup(ext_modules=cythonize([r"""${src.replace(/\\/g, '/')}"""], compiler_directives={'language_level': '3'}))
`;
      const tmpDir = path.join(ROOT, 'build', 'cython-gateway');
      fs.mkdirSync(tmpDir, { recursive: true });
      const setupPath = path.join(tmpDir, `setup_${rel.replace(/[\\/]/g, '_')}.py`);
      fs.writeFileSync(setupPath, setupPy, 'utf8');
      const build = spawnSync(
        python,
        [setupPath, 'build_ext', '--inplace', `--build-lib=${path.dirname(src)}`],
        {
          cwd: path.dirname(src),
          encoding: 'utf8',
          windowsHide: true,
          shell: true,
          timeout: 120_000,
        },
      );
      if (build.status === 0) {
        // Find .pyd next to source
        const dir = path.dirname(src);
        const base = path.basename(src, '.py');
        const pyd = fs
          .readdirSync(dir)
          .find((n) => n.startsWith(base) && (n.endsWith('.pyd') || n.endsWith('.so')));
        if (pyd) {
          compiled.push({ rel, engine: 'cython', artifact: path.join(dir, pyd) });
          // Optionally remove .py when packing (not workspace)
          if (!opts.inplace) {
            try {
              // Keep thin re-export stub so imports of .py path still work if needed
              fs.writeFileSync(
                src,
                `# Compiled module — logic in ${pyd}\nfrom ${base} import *  # type: ignore\n`,
                'utf8',
              );
            } catch {
              /* ignore */
            }
          }
          console.log(JSON.stringify({ ok: true, step: 'cython', rel, pyd }));
          continue;
        }
      } else {
        console.log(
          JSON.stringify({
            ok: false,
            step: 'cython-fail',
            rel,
            stderr: (build.stderr || '').slice(0, 400),
          }),
        );
      }
    }

    // Nuitka module (shell:false — paths with spaces)
    if (nuitkaOk) {
      const outDir = path.dirname(src);
      const n = spawnSync(
        python,
        [
          '-m',
          'nuitka',
          '--module',
          '--assume-yes-for-downloads',
          '--remove-output',
          `--output-dir=${outDir}`,
          path.basename(src),
        ],
        {
          cwd: outDir,
          encoding: 'utf8',
          windowsHide: true,
          shell: false,
          timeout: 600_000,
        },
      );
      if (n.status === 0) {
        const base = path.basename(src, '.py');
        const artifact = fs
          .readdirSync(outDir)
          .find(
            (name) =>
              name.startsWith(base) &&
              (name.endsWith('.pyd') || name.endsWith('.so') || name.endsWith('.pyi')),
          );
        compiled.push({
          rel,
          engine: 'nuitka',
          artifact: artifact ? path.join(outDir, artifact) : undefined,
        });
        console.log(JSON.stringify({ ok: true, step: 'nuitka', rel, artifact }));
        continue;
      }
      console.log(
        JSON.stringify({
          ok: false,
          step: 'nuitka-fail',
          rel,
          stderr: String(n.stderr || n.stdout || '').slice(0, 500),
        }),
      );
    }

    // Fallback: optimized bytecode (pack friction)
    const r = spawnSync(python, ['-m', 'compileall', '-q', '-b', src], {
      encoding: 'utf8',
      windowsHide: true,
      shell: false,
    });
    if (r.status === 0) {
      compiled.push({ rel, engine: 'pyc', note: 'bytecode-fallback' });
      console.log(JSON.stringify({ ok: true, step: 'pyc-fallback', rel }));
    } else {
      console.log(
        JSON.stringify({
          ok: false,
          step: 'pyc-fail',
          rel,
          stderr: String(r.stderr || '').slice(0, 200),
        }),
      );
    }
  }

  const engine = compiled[0]?.engine || 'none';
  console.log(
    JSON.stringify({
      ok: true,
      step: 'compile-gateway-done',
      engine,
      count: compiled.length,
      modules: compiled,
      cythonAvailable: cythonOk,
      nuitkaAvailable: nuitkaOk,
    }),
  );
  return { ok: true, engine, compiled, cythonOk, nuitkaOk };
}

function main() {
  const args = process.argv.slice(2);
  let outDir = path.join(ROOT, 'python_core');
  let inplace = true;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--out' && args[i + 1]) {
      outDir = path.resolve(args[++i]);
      inplace = false;
    }
    if (args[i] === '--pack-dir' && args[i + 1]) {
      outDir = path.resolve(args[++i]);
      inplace = false;
    }
  }
  if (!fs.existsSync(outDir)) {
    console.error('python core dir missing:', outDir);
    process.exit(1);
  }
  const result = compileGateway(outDir, { inplace });
  // Non-zero only if nothing worked and user demanded compile — keep soft for CI
  if (!result.compiled.length && process.env.AINOVEL_REQUIRE_GATEWAY_COMPILE === '1') {
    process.exit(2);
  }
}

if (require.main === module) main();

module.exports = { compileGateway, GATEWAY_MODULES, findPython };
