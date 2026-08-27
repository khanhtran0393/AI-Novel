'use strict';

const fs = require('fs');
const net = require('net');
const http = require('http');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');
const { setTimeout: sleep } = require('timers/promises');
const execFileAsync = promisify(execFile);

function redact(value) {
  let text = String(value == null ? '' : value);
  text = text.replace(/(authorization\s*[:=]\s*(?:bearer\s+)?)[^\s,;"']+/gi, '$1[REDACTED]');
  text = text.replace(/(api[_ -]?key\s*[:=]\s*)[^\s,;"']+/gi, '$1[REDACTED]');
  text = text.replace(/smoke-secret-[\w.-]*/gi, '[REDACTED]');
  return text;
}

function listen(server, port = 0) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolve(server.address().port));
  });
}

function closeServer(server) {
  return new Promise((resolve) => {
    if (!server || !server.listening) return resolve();
    server.close(() => resolve());
    try { server.closeAllConnections?.(); } catch (_) {}
  });
}

function isPortOpen(port, host = '127.0.0.1', timeoutMs = 500) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ port, host });
    const done = (open) => { socket.removeAllListeners(); socket.destroy(); resolve(open); };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => done(true));
    socket.once('timeout', () => done(false));
    socket.once('error', () => done(false));
  });
}

async function waitForPort(port, open, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if ((await isPortOpen(port)) === open) return;
    await sleep(200);
  }
  throw new Error(`Port ${port} did not become ${open ? 'open' : 'closed'} within ${timeoutMs}ms.`);
}

function httpJson(url, timeoutMs = 3000) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        if (res.statusCode < 200 || res.statusCode >= 300) return reject(new Error(`HTTP ${res.statusCode}: ${body.slice(0, 200)}`));
        try { resolve(JSON.parse(body)); } catch (error) { reject(new Error(`Invalid JSON from ${url}: ${error.message}`)); }
      });
    });
    req.setTimeout(timeoutMs, () => req.destroy(new Error(`HTTP timeout: ${url}`)));
    req.on('error', reject);
  });
}

async function waitForJson(url, predicate, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const value = await httpJson(url);
      if (!predicate || predicate(value)) return value;
    } catch (error) { lastError = error; }
    await sleep(250);
  }
  throw new Error(`Timed out waiting for ${url}${lastError ? `: ${lastError.message}` : ''}`);
}

function findPackagedExe(root, explicit) {
  if (explicit) {
    const resolved = path.resolve(explicit);
    if (!fs.existsSync(resolved)) throw new Error(`Packaged executable does not exist: ${resolved}`);
    return resolved;
  }
  const preferred = path.join(root, 'dist', 'win-unpacked', 'Nova Studio.exe');
  if (fs.existsSync(preferred)) return preferred;
  const dist = path.join(root, 'dist');
  if (!fs.existsSync(dist)) throw new Error(`Packaged artifacts are missing: ${dist}. Run npm run build:win first.`);
  const candidates = fs.readdirSync(dist, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /Nova-Studio.*\.exe$/i.test(entry.name))
    .map((entry) => path.join(dist, entry.name));
  if (!candidates.length) throw new Error('No runnable packaged Nova Studio executable found in dist.');
  return candidates.sort((a, b) => fs.statSync(b).size - fs.statSync(a).size)[0];
}

async function processTable() {
  const command = 'Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name | ConvertTo-Json -Compress';
  const { stdout } = await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], { windowsHide: true, maxBuffer: 4 * 1024 * 1024 });
  const parsed = JSON.parse(stdout || '[]');
  return Array.isArray(parsed) ? parsed : [parsed];
}

function descendants(table, rootPid) {
  const found = new Set([Number(rootPid)]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const row of table) {
      if (found.has(Number(row.ParentProcessId)) && !found.has(Number(row.ProcessId))) {
        found.add(Number(row.ProcessId)); changed = true;
      }
    }
  }
  return [...found];
}

async function forceKill(pid) {
  try { await execFileAsync('taskkill.exe', ['/PID', String(pid), '/T', '/F'], { windowsHide: true }); } catch (_) {}
}

module.exports = { closeServer, descendants, findPackagedExe, forceKill, httpJson, isPortOpen, listen, processTable, redact, sleep, waitForJson, waitForPort };
