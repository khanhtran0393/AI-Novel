/**
 * Install VieNeu SDK into the Python used by AI Novel (honest platform vieneu_tts).
 * Run: node scripts/install-vieneu.mjs
 */
import { execFileSync, spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function resolvePython() {
  const custom = 'D:\\SuperAudioTools\\omnivoice-python\\python.exe';
  if (fs.existsSync(custom)) return custom;
  const venv = path.join(root, '.venv', 'Scripts', 'python.exe');
  if (fs.existsSync(venv)) return venv;
  return 'python';
}

const py = resolvePython();
console.log('[install-vieneu] python =', py);

const indexUrl = 'https://pnnbao97.github.io/llama-cpp-python-v0.3.16/cpu/';
function pipInstall(extraArgs = []) {
  const args = [
    '-m',
    'pip',
    'install',
    'vieneu',
    '--extra-index-url',
    indexUrl,
    '--upgrade',
    ...extraArgs,
  ];
  console.log('[install-vieneu] running:', py, args.join(' '));
  return spawnSync(py, args, { stdio: 'inherit', windowsHide: true, cwd: root });
}

let r = pipInstall();
if (r.status !== 0) {
  console.warn('[install-vieneu] retry with --user (Access denied on system site-packages?)…');
  r = pipInstall(['--user']);
}
if (r.status !== 0) {
  console.error(
    '[install-vieneu] FAILED. Close apps using onnxruntime DLL, or use platform piper for TTS.',
  );
  process.exit(r.status || 1);
}

// Verify import + optional short synth (first run downloads HF models)
try {
  const core = path.join(root, 'python_core');
  const out = execFileSync(
    py,
    [
      '-c',
      [
        'import sys, tempfile, os',
        `sys.path.insert(0, r${JSON.stringify(core)})`,
        'from services import tts_vieneu as v',
        'import vieneu',
        'print("voices", v.list_voices())',
        'p = os.path.join(tempfile.gettempdir(), "vieneu_install_ok.wav")',
        'ok = v.synth_to_file("Xin chao.", p, voice="female")',
        'print("synth", ok, os.path.getsize(p) if ok and os.path.exists(p) else 0)',
        'raise SystemExit(0 if ok else 2)',
      ].join('; '),
    ],
    {
      encoding: 'utf8',
      cwd: core,
      env: { ...process.env, PYTHONPATH: core },
      windowsHide: true,
      timeout: 600_000,
    },
  );
  console.log('[install-vieneu] verify:\n' + out.trim());
} catch (e) {
  console.error(
    '[install-vieneu] package may be installed but synth verify failed:',
    e.message,
  );
  console.error(
    '  Tip: first run downloads VieNeu-TTS-v3-Turbo models from HuggingFace. Check network / HF_TOKEN.',
  );
  process.exit(1);
}

console.log('[install-vieneu] Done. Select TTS platform: VieNeu SDK (local clone). Mode=v3turbo (AINOVEL_VIENEU_MODE).');
