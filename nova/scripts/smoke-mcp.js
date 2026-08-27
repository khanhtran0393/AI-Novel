'use strict';

const path = require('path');
const { spawn } = require('child_process');

async function runMcpChecks(exePath, env, timeoutMs = 20000) {
  const script = path.join(path.dirname(exePath), 'resources', 'app.asar', 'nova', 'mcp-server', 'index.js');
  const child = spawn(exePath, [script], {
    env: { ...env, ELECTRON_RUN_AS_NODE: '1', NOVA_MCP_BRIDGE: 'http://127.0.0.1:8794' },
    windowsHide: true,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const pending = new Map();
  const stderr = [];
  let stdoutBuffer = '';
  let nextId = 1;

  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk) => stderr.push(String(chunk).slice(0, 2000)));
  child.stdout.on('data', (chunk) => {
    stdoutBuffer += chunk;
    let newline;
    while ((newline = stdoutBuffer.indexOf('\n')) >= 0) {
      const line = stdoutBuffer.slice(0, newline).trim();
      stdoutBuffer = stdoutBuffer.slice(newline + 1);
      if (!line) continue;
      let message;
      try { message = JSON.parse(line); } catch (_) { continue; }
      const waiter = pending.get(message.id);
      if (!waiter) continue;
      pending.delete(message.id);
      clearTimeout(waiter.timer);
      if (message.error) waiter.reject(new Error(message.error.message || 'MCP JSON-RPC error'));
      else waiter.resolve(message.result);
    }
  });

  const request = (method, params = {}) => {
    const id = nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { pending.delete(id); reject(new Error(`MCP request timed out: ${method}`)); }, timeoutMs);
      pending.set(id, { resolve, reject, timer });
      child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    });
  };
  const notify = (method, params = {}) => child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n');

  try {
    const initialized = await request('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'nova-packaged-smoke', version: '1.0.0' },
    });
    notify('notifications/initialized');
    const listed = await request('tools/list');
    const names = (listed.tools || []).map((tool) => tool.name);
    if (!names.includes('ffmpeg_info')) throw new Error('MCP tools/list did not expose ffmpeg_info.');
    const called = await request('tools/call', { name: 'ffmpeg_info', arguments: {} });
    if (called.isError) throw new Error(`MCP ffmpeg_info failed: ${called.content?.[0]?.text || 'unknown error'}`);
    return {
      pid: child.pid,
      protocolVersion: initialized.protocolVersion,
      serverInfo: initialized.serverInfo,
      toolCount: names.length,
      tools: names,
      ffmpegInfo: called.content?.[0]?.text || '',
      stderr: stderr.join('').slice(0, 4000),
    };
  } finally {
    for (const waiter of pending.values()) { clearTimeout(waiter.timer); waiter.reject(new Error('MCP client is shutting down.')); }
    pending.clear();
    try { child.stdin.end(); } catch (_) {}
    await new Promise((resolve) => {
      if (child.exitCode !== null) return resolve();
      const timer = setTimeout(() => { try { child.kill(); } catch (_) {} resolve(); }, 5000);
      child.once('exit', () => { clearTimeout(timer); resolve(); });
    });
  }
}

module.exports = { runMcpChecks };
