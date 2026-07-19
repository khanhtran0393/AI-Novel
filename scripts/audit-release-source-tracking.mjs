/** Fail when a local-only file would make a clean CI checkout incomplete. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const required = [
  '.github/workflows/release-desktop.yml',
  'build/icon.ico',
  'build/icon.png',
  'resources/commercial/public.env',
  'resources/license/public-keys/3ac9c18a6691a09e.pem',
  'docs/NPM_DEPENDENCY_NOTICE.json',
  'docs/COMMERCIAL_GO_LIVE.md',
  'docs/THIRD_PARTY_MANIFEST.md',
  'python_core/ainovel_host_guard.py',
  'python_core/api_nav_subtitle.py',
  'python_core/cli_bg_remove.py',
  'python_core/cli_upscale.py',
  'python_core/gpu_check.py',
  'python_core/install_gpu_worker.js',
  'python_core/install_pytorch_cuda.py',
  'python_core/tai_ytdlp.py',
  'python_core/isolate_vocals.py',
  'python_core/diarize_audio.py',
  'python_core/cat_nho.py',
  'python_core/yt_goi_y.py',
  'python_core/watermark_audio.py',
  'python_core/extract_hardsub.py',
  'python_core/xu_ly_video.py',
  'python_core/gateway/__init__.py',
  'python_core/gateway/host_binding.py',
  'python_core/gateway/nav_gateway.py',
  'python_core/services/__init__.py',
  'python_core/services/gemini_with_fallback.py',
  'python_core/services/local_media_tools.py',
  'python_core/services/nav_scheduler_store.py',
  'python_core/services/script_analyzer.py',
  'python_core/services/storyboard_analyzer.py',
  'python_core/services/veo3_utils.py',
  'python_core/services/youtube_analyzer_v1.py',
  'src/app/api/generate-tts/capcut_api/capcut_windows/build.bat',
  'src/app/api/generate-tts/capcut_api/LICENSE',
  'src/app/api/generate-tts/capcut_api/NOTICE.md',
  'src/app/api/generate-tts/capcut_api/capcut_provenance.json',
  'src/app/api/generate-tts/capcut_api/capcut_windows/capcut_tts_ctypes.py',
  'src/app/api/generate-tts/capcut_api/capcut_windows/config.py',
  'src/app/api/generate-tts/capcut_api/capcut_windows/cronet_client.py',
  'src/app/api/generate-tts/capcut_api/capcut_windows/cronet_helper_dll.cpp',
  'scripts/commercial-go-live-status.mjs',
  'scripts/cleanup-release-qa-pro.mjs',
  'scripts/smoke-capcut-live.mts',
  'vendor/FableCut/LICENSE',
  'vendor/FableCut/library/fonts/OFL.txt',
  'vendor/FableCut/library/fonts/SHA256SUMS.txt',
];

function indexEntry(relative) {
  try {
    return execFileSync('git', ['ls-files', '--stage', '--', relative], {
      cwd: root,
      encoding: 'utf8',
      windowsHide: true,
    }).trim();
  } catch {
    return '';
  }
}

const missing = [];
const untracked = [];
const gitlinks = [];
for (const relative of required) {
  if (!fs.existsSync(path.join(root, relative))) missing.push(relative);
  const entry = indexEntry(relative);
  if (!entry) untracked.push(relative);
  else if (entry.startsWith('160000 ')) gitlinks.push(relative);
}

assert.deepEqual(missing, [], `Release source files are missing: ${missing.join(', ')}`);
assert.deepEqual(
  untracked,
  [],
  `Release source files are not tracked/staged: ${untracked.join(', ')}`,
);
assert.deepEqual(
  gitlinks,
  [],
  `Release runtime must be vendored, not unresolved gitlinks: ${gitlinks.join(', ')}`,
);

const capcutPath = 'src/app/api/generate-tts/capcut_api';
const provenance = JSON.parse(
  fs.readFileSync(path.join(root, capcutPath, 'capcut_provenance.json'), 'utf8'),
);
const history = execFileSync(
  'git',
  ['log', '--all', '--format=%H', '--', capcutPath],
  { cwd: root, encoding: 'utf8', windowsHide: true },
)
  .trim()
  .split(/\r?\n/)
  .filter(Boolean);
const historicalGitlinks = new Set();
for (const commit of history) {
  const treeEntry = execFileSync('git', ['ls-tree', commit, '--', capcutPath], {
    cwd: root,
    encoding: 'utf8',
    windowsHide: true,
  }).trim();
  const match = treeEntry.match(/^160000 commit ([a-f0-9]{40})\t/);
  if (match) historicalGitlinks.add(match[1]);
}
assert.ok(
  historicalGitlinks.has(provenance.importedCommit),
  `CapCut importedCommit ${provenance.importedCommit} is not a gitlink in root Git history`,
);

console.log(JSON.stringify({ ok: true, checked: required.length }));
console.log('PASS audit-release-source-tracking');
