/**
 * Launch the packaged desktop app like a clean customer PC and drive the GUI.
 *
 * This intentionally uses a fresh profile and a minimal PATH so packaged
 * resources cannot accidentally borrow ffmpeg/wmic/node from the dev machine.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function argValue(name, fallback = '') {
  const prefix = `--${name}=`;
  const hit = process.argv.find((arg) => arg.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : fallback;
}

function hasFlag(name) {
  return process.argv.includes(`--${name}`);
}

const unpackedArg = argValue('unpacked', 'dist-qa-unsigned/win-unpacked');
const unpackedDir = path.resolve(repoRoot, unpackedArg);
const appExeCandidates = [
  path.join(unpackedDir, 'Ai Novel.exe'),
  path.join(unpackedDir, 'AI Novel & Script Generator.exe'),
];
const appExe = appExeCandidates.find((candidate) => fs.existsSync(candidate));
if (!appExe) {
  throw new Error(`Missing unpacked app exe under ${unpackedDir}`);
}

const appPort = Number(argValue('port', '32430'));
const debugPort = Number(argValue('debug-port', '9340'));
const flowHttpPort = Number(argValue('flow-http-port', String(appPort + 1)));
const flowWsPort = Number(argValue('flow-ws-port', String(appPort + 2)));
const keepProfile = hasFlag('keep-profile');
const skipGuiTtsClick = hasFlag('skip-gui-tts-click');
const entitlementToken =
  argValue('entitlement-token', process.env.AINOVEL_QA_ENTITLEMENT_TOKEN || '').trim();

const runId = randomUUID().replace(/-/g, '');
const profileRoot = path.join(os.tmpdir(), `ainovel-white-machine-gui-${runId}`);
const reportDir = path.join(repoRoot, 'test-results');
fs.mkdirSync(reportDir, { recursive: true });
const screenshotPath = path.join(reportDir, `white-machine-gui-${runId}.png`);
const reportPath = path.join(reportDir, `white-machine-gui-${runId}.json`);

const stdoutLines = [];
const stderrLines = [];
const browserConsole = [];
const networkEvents = [];
const checks = [];

function pushLine(target, data) {
  const text = String(data || '');
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    target.push(line);
  }
  while (target.length > 160) target.shift();
}

function record(id, status, detail, extra = {}) {
  checks.push({ id, status, detail, ...extra });
}

function failCount() {
  return checks.filter((check) => check.status === 'fail').length;
}

function blockedCount() {
  return checks.filter((check) => check.status === 'blocked').length;
}

function minimalWindowsPath() {
  const win = process.env.SystemRoot || 'C:\\Windows';
  return [
    path.join(win, 'System32'),
    win,
    path.join(win, 'System32', 'WindowsPowerShell', 'v1.0'),
  ].join(path.delimiter);
}

function killPackagedProcesses() {
  const escaped = unpackedDir.replace(/'/g, "''");
  const ps = [
    `$u='${escaped}';`,
    'Get-Process |',
    'Where-Object { try { $_.Path -and $_.Path.StartsWith($u, [StringComparison]::OrdinalIgnoreCase) } catch { $false } } |',
    'Stop-Process -Force -EA SilentlyContinue',
  ].join(' ');
  try {
    execFileSync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', ps],
      { stdio: 'ignore', timeout: 15_000, windowsHide: true },
    );
  } catch {
    /* best-effort */
  }
}

function resourcePath(...parts) {
  return path.join(unpackedDir, 'resources', ...parts);
}

function assertFile(id, rel) {
  const abs = resourcePath(...rel.split(/[\\/]/));
  if (fs.existsSync(abs)) {
    record(id, 'pass', rel);
  } else {
    record(id, 'fail', `Missing packaged resource: resources/${rel}`);
  }
}

async function sleep(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchJson(base, endpoint, options = {}) {
  const timeoutMs = options.timeoutMs || 20_000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const headers = {
      ...(options.headers || {}),
    };
    if (entitlementToken && !headers['x-ainovel-entitlement']) {
      headers['x-ainovel-entitlement'] = entitlementToken;
    }
    const res = await fetch(`${base}${endpoint}`, {
      method: options.method || 'GET',
      headers,
      body: options.body ? JSON.stringify(options.body) : undefined,
      signal: controller.signal,
    });
    const text = await res.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = { raw: text.slice(0, 1000) };
    }
    return { res, json, text };
  } finally {
    clearTimeout(timer);
  }
}

async function waitForHealth(base) {
  let last = '';
  for (let i = 0; i < 120; i += 1) {
    try {
      const out = await fetchJson(base, '/api/health/runtime', { timeoutMs: 3000 });
      if (out.res.ok) return out.json;
      last = `HTTP ${out.res.status}`;
    } catch (error) {
      last = error instanceof Error ? error.message : String(error);
    }
    await sleep(1000);
  }
  throw new Error(`Health timeout: ${last}`);
}

async function connectGui() {
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${debugPort}`);
  const deadline = Date.now() + 90_000;
  let page = null;
  while (Date.now() < deadline) {
    const pages = browser.contexts().flatMap((context) => context.pages());
    page = pages.find((candidate) => /\/workspace\b/.test(candidate.url())) ||
      pages.find((candidate) => /127\.0\.0\.1/.test(candidate.url())) ||
      pages[0] ||
      null;
    if (page && /\/workspace\b/.test(page.url())) break;
    await sleep(1000);
  }
  if (!page) {
    await browser.close().catch(() => {});
    throw new Error('CDP connected but no app page was visible');
  }
  page.on('console', (msg) => {
    const row = `${msg.type()}: ${msg.text()}`.slice(0, 1000);
    browserConsole.push(row);
    while (browserConsole.length > 120) browserConsole.shift();
  });
  page.on('response', (response) => {
    const url = response.url();
    if (!/\/api\/(generate-tts|generate-video|export-capcut|flow\/health|la-studio\/status)/.test(url)) {
      return;
    }
    networkEvents.push({
      url,
      method: response.request().method(),
      status: response.status(),
    });
    while (networkEvents.length > 160) networkEvents.shift();
  });
  return { browser, page };
}

async function collectVisibleDiagnostics(page) {
  const text = await page.locator('body').innerText({ timeout: 10_000 }).catch((error) => {
    return `BODY_TEXT_ERROR: ${error instanceof Error ? error.message : String(error)}`;
  });
  const interesting = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) =>
      /lỗi|thất bại|failed|fail|ffmpeg|403|quota|profile|flow|tts|capcut|cảnh báo|warning/i.test(line),
    )
    .slice(-40);
  return { textLength: text.length, interesting };
}

async function clickGuiTts(page) {
  if (skipGuiTtsClick) {
    record('gui_tts_click', 'warn', 'Skipped by --skip-gui-tts-click');
    return;
  }
  const button = page.getByRole('button', { name: /Gen TTS cả chương/i }).first();
  const count = await button.count().catch(() => 0);
  if (!count) {
    record('gui_tts_click', 'blocked', 'Không thấy nút Gen TTS cả chương trong profile sạch');
    return;
  }
  const enabled = await button.isEnabled().catch(() => false);
  if (!enabled) {
    record('gui_tts_click', 'blocked', 'Nút Gen TTS cả chương đang disabled');
    return;
  }
  const networkStart = networkEvents.length;
  await button.click({ timeout: 10_000 });
  const confirm = page.getByRole('button', { name: /Tiếp tục TTS/i }).first();
  try {
    await confirm.waitFor({ state: 'visible', timeout: 4000 });
    await confirm.click({ timeout: 5000 });
  } catch {
    /* no confirmation */
  }
  await sleep(18_000);
  const diag = await collectVisibleDiagnostics(page);
  const ttsEvents = networkEvents
    .slice(networkStart)
    .filter((event) => event.url.includes('/api/generate-tts'));
  const serverErrors = ttsEvents.filter((event) => event.status >= 500);
  const authBlocks = ttsEvents.filter((event) => event.status === 403);
  if (serverErrors.length) {
    record(
      'gui_tts_click',
      'fail',
      `GUI TTS returned ${serverErrors.map((event) => event.status).join(',')}`,
      { diagnostics: diag, ttsEvents },
    );
    return;
  }
  if (authBlocks.length) {
    record(
      'gui_tts_click',
      'blocked',
      `GUI TTS bị license gate ${authBlocks.length} request HTTP 403 trên profile sạch`,
      { diagnostics: diag, ttsEvents },
    );
    return;
  }
  const bad = diag.interesting.filter((line) =>
    /lỗi|thất bại|ffmpeg|spawnSync|ENOENT|403/i.test(line),
  );
  if (bad.length) {
    record('gui_tts_click', 'fail', bad.slice(0, 6).join(' | '), { diagnostics: diag });
  } else {
    record('gui_tts_click', 'pass', 'GUI TTS click did not surface an error toast', {
      diagnostics: diag,
    });
  }
}

async function verifyTtsPreview(base, label, platform, voice) {
  const body = {
    sceneText: 'Xin chào, đây là bài kiểm tra giọng đọc trên máy trắng.',
    chapterNum: 0,
    sceneIndex: 99001,
    voiceName: voice,
    voice,
    ten_tac_pham: 'White Machine Smoke',
    isPreview: true,
    applyLoudnorm: true,
    ttsConfig: {
      platform,
      voice,
      language: 'vi',
      speed: 1,
      pitch: 0,
      syncMode: 'default',
      laStudioFamily: 'kokoro-vietnamese',
    },
  };
  const out = await fetchJson(base, '/api/generate-tts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
    timeoutMs: platform === 'piper' ? 120_000 : 180_000,
  });
  const json = out.json || {};
  if (out.res.status === 403) {
    record(`tts_${label}`, 'blocked', `HTTP 403: ${json.error || 'premium/license gate'}`, {
      httpStatus: out.res.status,
      body: json,
    });
    return;
  }
  if (!out.res.ok || json.success !== true) {
    record(`tts_${label}`, 'fail', `HTTP ${out.res.status}: ${json.error || out.text.slice(0, 300)}`, {
      httpStatus: out.res.status,
      body: json,
    });
    return;
  }
  const audioPath = String(json.audioPath || '');
  if (!audioPath.startsWith('/audio/')) {
    record(`tts_${label}`, 'fail', `TTS returned non-public audioPath: ${audioPath}`, {
      body: json,
    });
    return;
  }
  const audioRes = await fetch(`${base}${audioPath}`, {
    signal: AbortSignal.timeout(20_000),
  });
  const bytes = Buffer.from(await audioRes.arrayBuffer());
  if (!audioRes.ok || bytes.length < 800) {
    record(`tts_${label}`, 'fail', `Audio fetch ${audioRes.status}, bytes=${bytes.length}`, {
      audioPath,
    });
    return;
  }
  record(`tts_${label}`, 'pass', `${audioPath} bytes=${bytes.length}`, {
    audioPath,
    duration: json.duration,
    method: json.method,
  });
}

async function main() {
  const base = `http://127.0.0.1:${appPort}`;
  killPackagedProcesses();

  assertFile('resource_ffmpeg', 'bin/ffmpeg.exe');
  assertFile('resource_ffprobe', 'bin/ffprobe.exe');
  assertFile('resource_piper_exe', 'bin/piper/piper.exe');
  assertFile('resource_piper_voice', 'bin/piper_vn/ngochuyen.onnx');
  assertFile('resource_la_kokoro_cli', 'bin/la-studio-kokoro/bin/kokoro-vi-cli.exe');
  assertFile('resource_la_kokoro_model', 'bin/la-studio-kokoro/models/kokoro_vi.onnx');

  const env = {
    ...process.env,
    AI_NOVEL_PORT: String(appPort),
    AINOVEL_FLOW_HTTP_PORT: String(flowHttpPort),
    AINOVEL_FLOW_WS_PORT: String(flowWsPort),
    AINOVEL_UPDATE_CHECK_ON_LAUNCH: '0',
    AINOVEL_SPLASH_MS: '0',
    APPDATA: path.join(profileRoot, 'AppData', 'Roaming'),
    LOCALAPPDATA: path.join(profileRoot, 'AppData', 'Local'),
    TEMP: path.join(profileRoot, 'Temp'),
    TMP: path.join(profileRoot, 'Temp'),
    USERPROFILE: profileRoot,
    Path: minimalWindowsPath(),
    PATH: minimalWindowsPath(),
  };
  for (const dir of [env.APPDATA, env.LOCALAPPDATA, env.TEMP]) {
    fs.mkdirSync(dir, { recursive: true });
  }
  for (const key of [
    'AINOVEL_FFMPEG_PATH',
    'FFMPEG_PATH',
    'FFPROBE_PATH',
    'LA_STUDIO_EXE',
    'AINOVEL_LA_STUDIO_EXE',
    'ELECTRON_RUN_AS_NODE',
    'AI_NOVEL_ROOT',
  ]) {
    delete env[key];
  }

  let child = null;
  let browser = null;
  try {
    child = spawn(
      appExe,
      [`--user-data-dir=${profileRoot}`, `--remote-debugging-port=${debugPort}`],
      { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] },
    );
    child.stdout.on('data', (data) => pushLine(stdoutLines, data));
    child.stderr.on('data', (data) => pushLine(stderrLines, data));
    child.on('exit', (code, signal) => {
      pushLine(stderrLines, `[process-exit] code=${code} signal=${signal}`);
    });

    const health = await waitForHealth(base);
    record(
      'runtime_health',
      health.fail > 0 ? 'fail' : 'pass',
      `ok=${health.ok} warn=${health.warn} fail=${health.fail}`,
      { health },
    );

    const gui = await connectGui();
    browser = gui.browser;
    const { page } = gui;
    await page.waitForLoadState('domcontentloaded', { timeout: 30_000 }).catch(() => {});
    if (entitlementToken) {
      await page.evaluate((token) => {
        localStorage.setItem('ainovel.entitlementToken', token);
      }, entitlementToken);
    }
    await page.waitForTimeout(3000);
    await page.screenshot({ path: screenshotPath, fullPage: false });
    const titleText = await page.locator('body').innerText({ timeout: 20_000 });
    record(
      'gui_workspace',
      /AI Novel|TRỢ LÝ BIÊN KỊCH|KỊCH BẢN LÀM VIỆC/i.test(titleText) ? 'pass' : 'fail',
      `url=${page.url()} screenshot=${screenshotPath}`,
    );

    const commercial = await fetchJson(base, '/api/commercial/status', { timeoutMs: 20_000 });
    record(
      'commercial_status',
      commercial.res.ok ? 'pass' : 'fail',
      `HTTP ${commercial.res.status} tier=${commercial.json?.tier || '?'}`,
      { body: commercial.json },
    );

    const installStatus = await fetchJson(base, '/api/system-info/install-status', {
      timeoutMs: 20_000,
    });
    record(
      'gpu_install_status',
      installStatus.res.ok ? 'pass' : 'fail',
      `HTTP ${installStatus.res.status} status=${installStatus.json?.status || 'idle'}`,
      { body: installStatus.json },
    );

    const systemInfo = await fetchJson(base, '/api/system-info', { timeoutMs: 90_000 });
    record(
      'system_info',
      systemInfo.res.ok ? 'pass' : 'fail',
      `HTTP ${systemInfo.res.status} gpu=${systemInfo.json?.gpu?.name || 'unknown'}`,
      { body: systemInfo.json },
    );

    const laStatus = await fetchJson(base, '/api/la-studio/status', { timeoutMs: 45_000 });
    const laOk = laStatus.res.ok && (laStatus.json?.kokoroCliReady || laStatus.json?.online);
    record(
      'la_studio_status',
      laOk ? 'pass' : laStatus.res.status === 403 ? 'blocked' : 'warn',
      `HTTP ${laStatus.res.status} kokoroCliReady=${Boolean(laStatus.json?.kokoroCliReady)} online=${Boolean(laStatus.json?.online)}`,
      { body: laStatus.json },
    );

    const flowHealth = await fetchJson(base, '/api/flow/health', { timeoutMs: 30_000 });
    record(
      'flow_health',
      flowHealth.res.ok && flowHealth.json?.ok ? 'pass' : 'fail',
      `HTTP ${flowHealth.res.status} running=${Boolean(flowHealth.json?.running)} key=${Boolean(flowHealth.json?.flowKeyPresent)}`,
      { body: flowHealth.json },
    );

    const videoGate = await fetchJson(base, '/api/generate-video', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: {},
      timeoutMs: 30_000,
    });
    if (videoGate.res.status === 403 && !entitlementToken) {
      record(
        'video_google_flow_generate',
        'blocked',
        'HTTP 403 do Free gate trên profile sạch; chưa kiểm được 403 từ Google Flow khi chưa có Pro/Trial token + Flow session.',
        { body: videoGate.json },
      );
    } else if (videoGate.res.status === 403) {
      record('video_google_flow_generate', 'fail', `HTTP 403 dù đã có entitlement token`, {
        body: videoGate.json,
      });
    } else {
      record(
        'video_google_flow_generate',
        videoGate.res.ok ? 'pass' : 'fail',
        `HTTP ${videoGate.res.status}`,
        { body: videoGate.json },
      );
    }

    await clickGuiTts(page);
    await verifyTtsPreview(base, 'piper_ngochuyen', 'piper', 'ngochuyen.onnx');
    await verifyTtsPreview(base, 'edge_hoaimy', 'edge_tts', 'vi-VN-HoaiMyNeural');
    await verifyTtsPreview(base, 'la_diem_trinh', 'la_studio', 'diem_trinh');

    const capcut = await fetchJson(base, '/api/export-capcut', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: {
        chapterNum: 1,
        ten_tac_pham: 'White Machine Smoke',
        generatedAudioPaths: {},
        generatedPrompts: {},
        generatedImages: {},
        generatedVideos: {},
        imageAspectRatio: '16:9',
        videoAspectRatio: '16:9',
        videoDuration: 8,
        imageProvider: 'flow',
        videoProvider: 'flow',
        ttsConfig: { platform: 'edge_tts', voice: 'vi-VN-HoaiMyNeural', language: 'vi' },
        openEditor: false,
      },
      timeoutMs: 30_000,
    });
    if (capcut.res.status === 403 && !entitlementToken) {
      record(
        'capcut_export',
        'blocked',
        'HTTP 403 do Free gate trên profile sạch; CapCut pack cần Trial/Pro.',
        { body: capcut.json },
      );
    } else if (capcut.res.status === 400 && /không có media|khong co media/i.test(String(capcut.json?.error || ''))) {
      record('capcut_export', 'blocked', String(capcut.json?.error || 'Missing media'), {
        body: capcut.json,
      });
    } else {
      record(
        'capcut_export',
        capcut.res.ok ? 'pass' : 'fail',
        `HTTP ${capcut.res.status}: ${capcut.json?.error || capcut.text.slice(0, 300)}`,
        { body: capcut.json },
      );
    }

    const noisyStderr = stderrLines.filter((line) =>
      /wmic is not recognized|spawnSync ffmpeg ENOENT|FFmpeg kh|Unhandled|uncaught|ERR_(?!ABORTED)/i.test(line),
    );
    if (noisyStderr.length) {
      record('stderr_noise', 'fail', noisyStderr.slice(-8).join(' | '), {
        stderrTail: stderrLines.slice(-40),
      });
    } else {
      record('stderr_noise', 'pass', 'No WMIC/FFmpeg/uncaught stderr signatures', {
        stderrTail: stderrLines.slice(-40),
      });
    }
  } finally {
    if (browser) await browser.close().catch(() => {});
    if (child && !child.killed) {
      try {
        child.kill('SIGTERM');
      } catch {
        /* ignore */
      }
      await sleep(1500);
      try {
        child.kill('SIGKILL');
      } catch {
        /* ignore */
      }
    }
    killPackagedProcesses();
    if (!keepProfile) {
      fs.rmSync(profileRoot, { recursive: true, force: true });
    }
  }

  const report = {
    ok: failCount() === 0,
    fail: failCount(),
    blocked: blockedCount(),
    checks,
    unpackedDir,
    profileRoot: keepProfile ? profileRoot : null,
    screenshotPath: fs.existsSync(screenshotPath) ? screenshotPath : null,
    stdoutTail: stdoutLines.slice(-80),
    stderrTail: stderrLines.slice(-80),
    browserConsole: browserConsole.slice(-80),
    networkEvents: networkEvents.slice(-80),
  };
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf8');
  console.log(JSON.stringify({ ...report, reportPath }, null, 2));
  if (!report.ok) process.exit(1);
}

main().catch((error) => {
  record('smoke_exception', 'fail', error instanceof Error ? error.message : String(error));
  const report = {
    ok: false,
    fail: failCount(),
    blocked: blockedCount(),
    checks,
    unpackedDir,
    profileRoot: keepProfile ? profileRoot : null,
    screenshotPath: fs.existsSync(screenshotPath) ? screenshotPath : null,
    stdoutTail: stdoutLines.slice(-80),
    stderrTail: stderrLines.slice(-80),
    browserConsole: browserConsole.slice(-80),
    networkEvents: networkEvents.slice(-80),
  };
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf8');
  console.error(JSON.stringify({ ...report, reportPath }, null, 2));
  process.exit(1);
});
