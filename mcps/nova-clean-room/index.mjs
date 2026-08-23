#!/usr/bin/env node
/**
 * Nova Studio Clean-Room MCP — lái app ĐÓNG GÓI như user thật trên máy trắng.
 * Tools: setup_clean_room / launch_app / app_status / ui_eval / ui_click /
 *        ui_fill / ui_press_escape / teardown
 */
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema, ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn, execSync } from 'node:child_process';
import { chromium } from 'playwright';

const ROOT = path.resolve(import.meta.dirname, '..', '..');
const EXE = path.join(ROOT, 'dist-nova2', 'win-unpacked', 'Nova Studio.exe');
const APPDATA = path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'chukienmedia-app');
const BACKUP = APPDATA + '.real-bak';
const CDP_PORT = 9333;

let appProc = null;
let pwBrowser = null;
let pwPage = null;

function taskkill(name) {
  try { execSync(`taskkill /F /IM "${name}" /T`, { stdio: 'ignore' }); } catch {}
}

async function getPage() {
  if (!pwPage) {
    pwBrowser = await chromium.connectOverCDP(`http://127.0.0.1:${CDP_PORT}`);
    pwPage = pwBrowser.contexts()[0].pages()[0];
  }
  return pwPage;
}

const server = new Server(
  { name: 'nova-clean-room-mcp', version: '1.0.0' },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    { name: 'setup_clean_room', description: 'Backup userData thật + wipe → mô phỏng máy trắng (PC user mới cài).', inputSchema: { type: 'object', properties: {} } },
    { name: 'launch_app', description: 'Chạy Nova Studio.exe đóng gói với CDP. Tự clear ELECTRON_RUN_AS_NODE.', inputSchema: { type: 'object', properties: { wipeUserData: { type: 'boolean', default: true } } } },
    { name: 'app_status', description: 'Process + CDP + GUI HTTP nội bộ sống?', inputSchema: { type: 'object', properties: {} } },
    { name: 'ui_eval', description: 'Evaluate JS trong GUI (đọc state/DOM thật).', inputSchema: { type: 'object', properties: { js: { type: 'string' } }, required: ['js'] } },
    { name: 'ui_click', description: 'Click selector (tự scrollIntoView + đóng modal đang mở trước).', inputSchema: { type: 'object', properties: { selector: { type: 'string' } }, required: ['selector'] } },
    { name: 'ui_fill', description: 'Điền giá trị vào input.', inputSchema: { type: 'object', properties: { selector: { type: 'string' }, value: { type: 'string' } }, required: ['selector', 'value'] } },
    { name: 'ui_press_escape', description: 'Nhấn Esc (đóng modal).', inputSchema: { type: 'object', properties: {} } },
    { name: 'teardown', description: 'Kill app + khôi phục userData thật từ backup.', inputSchema: { type: 'object', properties: {} } },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: args } = req.params;
  try {
    switch (name) {
      case 'setup_clean_room': {
        taskkill('Nova Studio.exe');
        await new Promise((r) => setTimeout(r, 1500));
        if (fs.existsSync(APPDATA) && !fs.existsSync(BACKUP)) fs.renameSync(APPDATA, BACKUP);
        else if (fs.existsSync(APPDATA)) fs.rmSync(APPDATA, { recursive: true, force: true });
        return { content: [{ type: 'text', text: JSON.stringify({ ok: true, backedUp: fs.existsSync(BACKUP), clean: !fs.existsSync(APPDATA) }) }] };
      }
      case 'launch_app': {
        const wipe = args?.wipeUserData !== false;
        if (wipe && fs.existsSync(APPDATA)) fs.rmSync(APPDATA, { recursive: true, force: true });
        pwBrowser = null; pwPage = null;
        const env = { ...process.env };
        delete env.ELECTRON_RUN_AS_NODE; delete env.ELECTRON_NO_ATTACH_CONSOLE;
        appProc = spawn(EXE, [`--remote-debugging-port=${CDP_PORT}`], { env, stdio: 'ignore' });
        let cdpOk = false;
        for (let i = 0; i < 20 && !cdpOk; i++) {
          await new Promise((r) => setTimeout(r, 1000));
          try { const res = await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`); cdpOk = res.ok; } catch {}
        }
        return { content: [{ type: 'text', text: JSON.stringify({ ok: cdpOk, pid: appProc.pid, cdp: `http://127.0.0.1:${CDP_PORT}`, wipedUserData: wipe }) }] };
      }
      case 'app_status': {
        let cdp = false, gui = 0;
        try { const r = await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`); cdp = r.ok; } catch {}
        try { const r = await fetch('http://127.0.0.1:47280/', { signal: AbortSignal.timeout(3000) }); gui = r.status; } catch {}
        return { content: [{ type: 'text', text: JSON.stringify({ processAlive: appProc ? appProc.exitCode === null : null, cdp, guiHttp: gui }) }] };
      }
      case 'ui_eval': {
        const page = await getPage();
        const r = await page.evaluate(args.js);
        return { content: [{ type: 'text', text: JSON.stringify(r) }] };
      }
      case 'ui_click': {
        const page = await getPage();
        await page.evaluate((sel) => {
          const bg = document.querySelector('.modal-bg.show');
          if (bg) { const b = bg.querySelector('.modal-close'); if (b) b.click(); else bg.classList.remove('show'); }
          const el = document.querySelector(sel);
          if (el) el.scrollIntoView({ block: 'center' });
          const root = document.getElementById('appRoot');
          if (root && root.classList.contains('sb-collapsed') && window.toggleSidebar) window.toggleSidebar();
        }, args.selector);
        await new Promise((r) => setTimeout(r, 300));
        await page.click(args.selector, { timeout: 5000 });
        return { content: [{ type: 'text', text: JSON.stringify({ clicked: args.selector }) }] };
      }
      case 'ui_fill': {
        const page = await getPage();
        await page.fill(args.selector, args.value, { timeout: 5000 });
        return { content: [{ type: 'text', text: JSON.stringify({ filled: args.selector }) }] };
      }
      case 'ui_press_escape': {
        const page = await getPage();
        await page.keyboard.press('Escape');
        await new Promise((r) => setTimeout(r, 400));
        return { content: [{ type: 'text', text: JSON.stringify({ modalOpen: await page.evaluate(() => !!document.querySelector('.modal-bg.show')) }) }] };
      }
      case 'teardown': {
        taskkill('Nova Studio.exe');
        await new Promise((r) => setTimeout(r, 1500));
        let restored = false;
        if (fs.existsSync(BACKUP)) {
          if (fs.existsSync(APPDATA)) fs.rmSync(APPDATA, { recursive: true, force: true });
          fs.renameSync(BACKUP, APPDATA);
          restored = true;
        }
        return { content: [{ type: 'text', text: JSON.stringify({ ok: true, restoredRealUserData: restored }) }] };
      }
      default:
        throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
    }
  } catch (e) {
    return { content: [{ type: 'text', text: JSON.stringify({ error: String((e && e.message) || e) }) }], isError: true };
  }
});

process.on('SIGINT', async () => { try { taskkill('Nova Studio.exe'); } catch {} process.exit(0); });
const transport = new StdioServerTransport();
await server.connect(transport);
console.error('nova-clean-room MCP running (stdio)');


