'use strict';

const fs = require('fs');
const http = require('http');
const path = require('path');
const { spawn } = require('child_process');
const { CdpClient } = require('./smoke-cdp');
const { runMcpChecks } = require('./smoke-mcp');
const {
  closeServer, descendants, findPackagedExe, forceKill, httpJson, isPortOpen,
  listen, processTable, redact, sleep, waitForJson, waitForPort,
} = require('./smoke-runtime');

const ROOT = path.resolve(__dirname, '..', '..');
const FIXED_PORTS = [8793, 8794, 8795, 8796];
const MOCK_KEY = 'smoke-secret-loopback-only';
const OUTPUT_MARKER = 'NOVA_SMOKE_UI_OUTPUT_2026';
const MOCK_CONTENT = '```text\n' + OUTPUT_MARKER + ' confirms that the packaged renderer reached the loopback OpenAI-compatible API through Electron IPC.\n\nThe response was parsed, cleaned, and written into the real script output control.\n```';

function stamp() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function deepRedact(value) {
  if (typeof value === 'string') return redact(value);
  if (Array.isArray(value)) return value.map(deepRedact);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, deepRedact(item)]));
  return value;
}

function startMock() {
  const requests = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.setEncoding('utf8');
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      let parsed = null;
      try { parsed = JSON.parse(body || '{}'); } catch (_) {}
      const authOkay = req.headers.authorization === 'Bearer ' + MOCK_KEY;
      requests.push({
        method: req.method,
        path: req.url,
        authOkay,
        model: parsed?.model || null,
        messageCount: Array.isArray(parsed?.messages) ? parsed.messages.length : 0,
        maxTokens: parsed?.max_tokens || parsed?.max_completion_tokens || null,
      });
      if (req.method !== 'POST' || req.url !== '/v1/chat/completions') {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: { message: 'not found' } }));
      }
      if (!parsed || !authOkay) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: { message: 'smoke authentication failed' } }));
      }
      const response = {
        id: 'smoke-loopback', object: 'chat.completion', created: 0, model: parsed.model,
        choices: [{ index: 0, message: { role: 'assistant', content: MOCK_CONTENT }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 25, completion_tokens: 35, total_tokens: 60 },
      };
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(response));
    });
  });
  return { server, requests };
}

async function closeApp(cdp, child) {
  if (cdp) {
    try { await cdp.send('Browser.close', {}, 5000); } catch (_) {}
  }
  const deadline = Date.now() + 15000;
  while (child && child.exitCode === null && Date.now() < deadline) await sleep(200);
}

async function main() {
  const startedAt = new Date();
  const runDir = path.join(ROOT, 'smoke-results', stamp());
  const profileRoot = path.join(runDir, 'profile');
  fs.mkdirSync(profileRoot, { recursive: true });
  for (const name of ['appdata', 'localappdata', 'temp']) fs.mkdirSync(path.join(profileRoot, name), { recursive: true });

  const report = {
    schemaVersion: 1,
    startedAt: startedAt.toISOString(),
    root: ROOT,
    runDir,
    status: 'running',
    checks: {},
    diagnostics: { rendererConsole: [], rendererExceptions: [], appStdout: '', appStderr: '' },
  };
  let child = null;
  let cdp = null;
  let mock = null;
  let appPids = [];

  try {
    report.executable = findPackagedExe(ROOT, process.env.NOVA_SMOKE_EXE || process.argv[2]);
    const occupied = [];
    for (const port of FIXED_PORTS) if (await isPortOpen(port)) occupied.push(port);
    if (occupied.length) throw new Error(`Smoke preflight refused to disturb occupied Nova ports: ${occupied.join(', ')}.`);
    report.checks.preflightPorts = { ok: true, closed: FIXED_PORTS };

    mock = startMock();
    const mockPort = await listen(mock.server, 0);
    const discoveryServer = http.createServer();
    const cdpPort = await listen(discoveryServer, 0);
    await closeServer(discoveryServer);
    report.mock = { baseUrl: `http://127.0.0.1:${mockPort}`, port: mockPort };
    report.cdpPort = cdpPort;

    const env = {
      ...process.env,
      APPDATA: path.join(profileRoot, 'appdata'),
      LOCALAPPDATA: path.join(profileRoot, 'localappdata'),
      TEMP: path.join(profileRoot, 'temp'),
      TMP: path.join(profileRoot, 'temp'),
      AI_VIDEO_STUDIO_ENABLE_UPDATES: '0',
      ELECTRON_ENABLE_LOGGING: '1',
    };
    child = spawn(report.executable, [`--remote-debugging-port=${cdpPort}`, '--no-first-run'], {
      cwd: path.dirname(report.executable), env, windowsHide: false, stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stdout?.on('data', (chunk) => { report.diagnostics.appStdout = (report.diagnostics.appStdout + redact(chunk)).slice(-16000); });
    child.stderr?.on('data', (chunk) => { report.diagnostics.appStderr = (report.diagnostics.appStderr + redact(chunk)).slice(-16000); });
    child.once('error', (error) => { report.diagnostics.spawnError = error.message; });
    report.app = { rootPid: child.pid };
    for (const port of FIXED_PORTS) await waitForPort(port, true, 30000);
    const health = await waitForJson('http://127.0.0.1:8794/health', (value) => value?.ok === true, 10000);
    report.checks.bridgeStartup = { ok: true, ports: FIXED_PORTS, mcpHealth: health };

    const target = await waitForJson(`http://127.0.0.1:${cdpPort}/json/list`, (targets) =>
      Array.isArray(targets) && targets.find((item) => item.type === 'page' && /\/index\.html(?:$|[?#])/.test(item.url || '')), 45000);
    const page = target.find((item) => item.type === 'page' && /\/index\.html(?:$|[?#])/.test(item.url || ''));
    cdp = new CdpClient(page.webSocketDebuggerUrl);
    await cdp.connect();
    cdp.on('Runtime.consoleAPICalled', (event) => {
      const line = (event.args || []).map((arg) => arg.value ?? arg.description ?? '').join(' ');
      report.diagnostics.rendererConsole.push(redact(`${event.type}: ${line}`).slice(0, 1000));
      report.diagnostics.rendererConsole = report.diagnostics.rendererConsole.slice(-80);
    });
    cdp.on('Runtime.exceptionThrown', (event) => {
      report.diagnostics.rendererExceptions.push(redact(event.exceptionDetails?.exception?.description || event.exceptionDetails?.text || 'renderer exception').slice(0, 2000));
    });
    await cdp.send('Runtime.enable');
    await cdp.send('Page.enable');
    await cdp.waitFor(`document.readyState === 'complete' && !!document.querySelector('[data-tool="toolsettings"]')`, 'Nova UI readiness', 30000);
    report.checks.uiReady = { ok: true, url: page.url, title: page.title };

    await cdp.click('[data-tool="toolsettings"]');
    await cdp.waitFor(`getComputedStyle(document.querySelector('#apiSection')).display !== 'none'`, 'API settings visibility', 10000);
    await cdp.setValue('#apiProvider', 'openai-compatible');
    await cdp.setValue('#apiModel', 'custom');
    await cdp.setValue('#apiModelCustom', 'nova-smoke-model');
    await cdp.setValue('#apiKeyList .api-key-field', MOCK_KEY);
    await cdp.setValue('#apiBaseUrl', `http://127.0.0.1:${mockPort}`);
    await cdp.click('#apiSection button[onclick="saveApiSettings()"]');
    const settingsState = await cdp.waitFor(`(() => {
      const text = document.querySelector('#apiStatus')?.textContent || '';
      return text.includes('Đã lưu') ? {
        provider: document.querySelector('#apiProvider')?.value,
        model: document.querySelector('#apiModelCustom')?.value,
        baseUrl: document.querySelector('#apiBaseUrl')?.value,
        keyCount: document.querySelectorAll('#apiKeyList .api-key-field').length,
      } : null;
    })()`, 'saved API settings', 10000);
    if (settingsState.provider !== 'openai-compatible' || settingsState.model !== 'nova-smoke-model') throw new Error('API controls did not retain the selected provider/model.');
    report.checks.apiConfiguration = { ok: true, ...settingsState };
    await cdp.click('[data-tool="toolscript"]');
    await cdp.waitFor(`document.querySelector('#tool-toolscript')?.classList.contains('active')`, 'script tool activation', 10000);
    await cdp.setValue('#tsTopic', 'Packaged Nova Studio clean-room smoke test');
    await cdp.setValue('#tsWords', '300');
    await cdp.click('#tsGenBtn');
    const uiResult = await cdp.waitFor(`(() => {
      const output = document.querySelector('#tsOutput')?.value || '';
      const status = document.querySelector('#statusScript')?.textContent || '';
      return output.includes(${JSON.stringify(OUTPUT_MARKER)}) && status.includes('Đã viết xong')
        ? { output, status, meta: document.querySelector('#tsOutMeta')?.textContent || '' } : null;
    })()`, 'generated script output', 30000);
    if (uiResult.output.includes('The script is complete') || uiResult.output.includes('```')) throw new Error('Script cleaner left mock preamble or code fences in the UI output.');
    const request = mock.requests.find((item) => item.path === '/v1/chat/completions');
    if (!request?.authOkay || request.model !== 'nova-smoke-model') throw new Error('Loopback mock did not receive the expected authenticated model request.');
    report.checks.scriptGeneration = { ok: true, output: uiResult.output, status: uiResult.status, meta: uiResult.meta, request };

    const screenshot = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }, 15000);
    const screenshotPath = path.join(runDir, 'script-output.png');
    fs.writeFileSync(screenshotPath, Buffer.from(screenshot.data, 'base64'));
    report.checks.screenshot = { ok: true, path: screenshotPath, bytes: fs.statSync(screenshotPath).size };

    report.checks.mcp = { ok: true, ...(await runMcpChecks(report.executable, env)) };
    const table = await processTable();
    appPids = descendants(table, child.pid);
    report.app.pidsDuringRun = appPids;

    await closeApp(cdp, child);
    cdp.close(); cdp = null;
    if (child.exitCode === null) throw new Error('Packaged app did not exit after Browser.close.');
    report.app.exitCode = child.exitCode;
    report.app.signalCode = child.signalCode;

    for (const port of FIXED_PORTS) await waitForPort(port, false, 15000);
    const after = await processTable();
    const alive = new Set(after.map((row) => Number(row.ProcessId)));
    const leakedPids = appPids.filter((pid) => alive.has(pid));
    if (leakedPids.length) throw new Error(`Packaged process leak detected: ${leakedPids.join(', ')}.`);
    report.checks.shutdown = { ok: true, portsClosed: FIXED_PORTS, leakedPids: [] };
    report.status = 'passed';
  } catch (error) {
    report.status = 'failed';
    report.error = { name: error.name, message: redact(error.message), stack: redact(error.stack || '') };
    process.exitCode = 1;
  } finally {
    try { if (cdp) await closeApp(cdp, child); } catch (_) {}
    try { cdp?.close(); } catch (_) {}
    if (child && child.exitCode === null) await forceKill(child.pid);
    if (mock) await closeServer(mock.server);
    report.finishedAt = new Date().toISOString();
    report.durationMs = Date.now() - startedAt.getTime();
    const safeReport = deepRedact(report);
    fs.writeFileSync(path.join(runDir, 'report.json'), JSON.stringify(safeReport, null, 2) + '\n');
    console.log(JSON.stringify({ status: safeReport.status, report: path.join(runDir, 'report.json'), screenshot: safeReport.checks.screenshot?.path || null }, null, 2));
  }
}

main().catch((error) => { console.error(redact(error.stack || error)); process.exitCode = 1; });