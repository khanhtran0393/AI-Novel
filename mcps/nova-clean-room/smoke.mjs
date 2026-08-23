/** Smoke MCP qua stdio: initialize → tools/list → teardown. */
import { spawn } from 'node:child_process';

const proc = spawn('node', ['index.mjs'], { stdio: ['pipe', 'pipe', 'inherit'] });
const send = (obj) => proc.stdin.write(JSON.stringify(obj) + '\n');
let buf = '';

const waitMsg = (id, timeoutMs = 15000) => new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error('timeout waiting id ' + id)), timeoutMs);
  const onData = (d) => {
    buf += d.toString();
    let idx;
    while ((idx = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, idx).trim();
      buf = buf.slice(idx + 1);
      if (!line) continue;
      try {
        const msg = JSON.parse(line);
        if (msg.id === id) { clearTimeout(timer); proc.stdout.off('data', onData); resolve(msg); }
      } catch {}
    }
  };
  proc.stdout.on('data', onData);
});

send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'smoke', version: '0' } } });
const init = await waitMsg(1);
console.log('INIT:', JSON.stringify(init.result.serverInfo));
send({ jsonrpc: '2.0', method: 'notifications/initialized' });

send({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
const tools = await waitMsg(2);
console.log('TOOLS:', tools.result.tools.map((t) => t.name).join(', '));

// teardown: khôi phục userData thật sau test
send({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'teardown', arguments: {} } });
const td = await waitMsg(3, 20000);
console.log('TEARDOWN:', td.result.content[0].text);

proc.kill();
process.exit(0);
