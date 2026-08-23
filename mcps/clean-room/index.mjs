#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from "@modelcontextprotocol/sdk/types.js";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawn, execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// --- State ---
let activeAppProcess = null;
let cleanRoomBase = "";

function getCleanRoomBase() {
  return path.join(os.tmpdir(), "ainovel-clean-room");
}

function getWinUnpackedPath() {
  return path.resolve(__dirname, "..", "..", "dist-qa-unsigned", "win-unpacked");
}

function setupCleanEnvironment() {
  const base = getCleanRoomBase();
  const appData = path.join(base, "AppData", "Roaming", "ai-novel-script-generator");
  fs.mkdirSync(appData, { recursive: true });
  fs.mkdirSync(path.join(base, "AppData", "Local"), { recursive: true });
  fs.mkdirSync(path.join(base, "output"), { recursive: true });
  return { base, appData };
}

function getLimitedPath() {
  return [
    "C:\\Windows",
    "C:\\Windows\\System32",
    "C:\\Windows\\System32\\Wbem",
    "C:\\Windows\\System32\\WindowsPowerShell\\v1.0",
    "C:\\Program Files\\node-v24.15.0-win-x64",
    path.resolve(getWinUnpackedPath(), "..", "..", "bin"),
  ].join(";");
}

// --- Server ---
const server = new Server(
  { name: "ainovel-clean-room-mcp", version: "1.0.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "setup_clean_room",
      description: "Create a clean-room environment: isolated AppData, restricted PATH. Returns base + AppData paths.",
      inputSchema: {
        type: "object",
        properties: { force: { type: "boolean", description: "Delete existing clean-room first", default: false } },
      },
    },
    {
      name: "launch_app",
      description: "Launch the packaged AI Novel app inside the clean-room environment.",
      inputSchema: {
        type: "object",
        properties: {
          timeoutMs: { type: "number", description: "Max wait (ms)", default: 60000 },
          port: { type: "number", description: "Port", default: 3000 },
        },
      },
    },
    {
      name: "teardown_clean_room",
      description: "Kill app process and remove clean-room.",
      inputSchema: {
        type: "object",
        properties: { keepOutput: { type: "boolean", description: "Preserve output dir", default: false } },
      },
    },
    {
      name: "get_app_status",
      description: "Check if app is running and responsive.",
      inputSchema: {
        type: "object",
        properties: { port: { type: "number", description: "Port", default: 3000 } },
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  switch (name) {
    case "setup_clean_room": {
      const force = args?.force ?? false;
      const base = getCleanRoomBase();
      if (force && fs.existsSync(base)) fs.rmSync(base, { recursive: true, force: true });
      const { base: cleanBase, appData } = setupCleanEnvironment();
      cleanRoomBase = cleanBase;
      return { content: [{ type: "text", text: JSON.stringify({ status: "ready", cleanRoomBase: cleanBase, appDataPath: appData, message: "Clean-room created." }, null, 2) }] };
    }

    case "launch_app": {
      const port = args?.port ?? 3000;
      const timeoutMs = args?.timeoutMs ?? 60000;

      if (!cleanRoomBase) {
        const { base: cleanBase } = setupCleanEnvironment();
        cleanRoomBase = cleanBase;
      }

      const winUnpacked = getWinUnpackedPath();
      const appExe = path.join(winUnpacked, "Ai Novel.exe");
      if (!fs.existsSync(appExe)) {
        return { content: [{ type: "text", text: JSON.stringify({ status: "error", error: `Not found: ${appExe}`, hint: "Run pack:unsigned:qa first" }) }], isError: true };
      }

      // Kill existing on port
      try { execSync(`for /f "tokens=5" %a in ('netstat -ano ^| findstr :${port}') do taskkill /F /PID %a 2>nul`, { shell: "cmd.exe", timeout: 5000 }); } catch {}

      const appDataRoaming = path.join(cleanRoomBase, "AppData", "Roaming");
      const appDataLocal = path.join(cleanRoomBase, "AppData", "Local");
      const userData = path.join(appDataRoaming, "ai-novel-script-generator");
      const tempDir = path.join(cleanRoomBase, "Temp");
      fs.mkdirSync(tempDir, { recursive: true });

      const env = {
        PATH: getLimitedPath(),
        APPDATA: appDataRoaming,
        LOCALAPPDATA: appDataLocal,
        USERPROFILE: cleanRoomBase,
        AI_NOVEL_PORT: String(port),
        AINOVEL_ENTITLEMENT_MODE: "open",
        NODE_ENV: "production",
        SYSTEMROOT: process.env.SYSTEMROOT ?? "C:\\Windows",
        TEMP: tempDir,
        TMP: tempDir,
      };
      // Copy safe system vars
      for (const k of ["SystemRoot", "SYSTEMDRIVE", "COMPUTERNAME", "USERNAME", "USERDOMAIN", "windir", "HOMEDRIVE", "NUMBER_OF_PROCESSORS", "PROCESSOR_ARCHITECTURE"]) {
        if (process.env[k]) env[k] = process.env[k];
      }

      activeAppProcess = spawn(appExe, [], { env, cwd: winUnpacked, stdio: ["ignore", "pipe", "pipe"], windowsHide: false });

      const startTime = Date.now();
      let appReady = false;
      let appUrl = "";
      while (Date.now() - startTime < timeoutMs) {
        try {
          const res = await fetch(`http://127.0.0.1:${port}/api/commercial/status`, { signal: AbortSignal.timeout(3000) });
          if (res.ok) { appReady = true; appUrl = `http://127.0.0.1:${port}`; break; }
        } catch {}
        await new Promise((r) => setTimeout(r, 1500));
      }

      if (!appReady) {
        if (activeAppProcess && activeAppProcess.exitCode !== null) {
          const stderr = activeAppProcess.stderr?.read()?.toString() ?? "";
          return { content: [{ type: "text", text: JSON.stringify({ status: "crashed", exitCode: activeAppProcess.exitCode, stderr: stderr.slice(0, 2000) }) }], isError: true };
        }
        return { content: [{ type: "text", text: JSON.stringify({ status: "timeout", elapsedMs: Date.now() - startTime, pid: activeAppProcess?.pid, message: `App did not respond on port ${port} within ${timeoutMs}ms` }) }], isError: true };
      }

      return { content: [{ type: "text", text: JSON.stringify({ status: "running", appUrl, pid: activeAppProcess?.pid, userDataPath: userData, cleanRoomBase, limitedPath: true, message: "App launched in clean-room mode." }, null, 2) }] };
    }

    case "teardown_clean_room": {
      const keepOutput = args?.keepOutput ?? false;
      if (activeAppProcess?.pid) {
        try { process.kill(activeAppProcess.pid, "SIGTERM"); } catch {
          try { execSync(`taskkill /F /PID ${activeAppProcess.pid}`, { timeout: 5000 }); } catch {}
        }
      }
      try { execSync('for /f "tokens=5" %a in (\'netstat -ano ^| findstr :3000\') do taskkill /F /PID %a 2>nul', { shell: "cmd.exe", timeout: 5000 }); } catch {}
      activeAppProcess = null;
      const base = getCleanRoomBase();
      if (!keepOutput && fs.existsSync(base)) fs.rmSync(base, { recursive: true, force: true });
      cleanRoomBase = "";
      return { content: [{ type: "text", text: JSON.stringify({ status: "torn_down", cleanRoomBase: base, keptOutput: keepOutput }) }] };
    }

    case "get_app_status": {
      const port = args?.port ?? 3000;
      try {
        const res = await fetch(`http://127.0.0.1:${port}/api/commercial/status`, { signal: AbortSignal.timeout(5000) });
        const data = await res.json();
        return { content: [{ type: "text", text: JSON.stringify({ status: "responsive", httpCode: res.status, commercialStatus: data }, null, 2) }] };
      } catch (err) {
        return { content: [{ type: "text", text: JSON.stringify({ status: "unreachable", error: err.message, pid: activeAppProcess?.pid ?? null, pidAlive: activeAppProcess ? activeAppProcess.exitCode === null : false }) }], isError: true };
      }
    }

    default:
      throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
  }
});

server.onerror = (error) => console.error("[MCP Error]", error);
process.on("SIGINT", async () => { await server.close(); process.exit(0); });

const transport = new StdioServerTransport();
await server.connect(transport);
console.error("Clean-room MCP server running on stdio");