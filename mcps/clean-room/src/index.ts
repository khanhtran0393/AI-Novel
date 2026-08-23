#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio";
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from "@modelcontextprotocol/sdk/types";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { spawn, execSync, ChildProcess } from "node:child_process";

// --- State ---
let activeAppProcess: ChildProcess | null = null;
let cleanRoomBase = "";

// --- Helpers ---
function getCleanRoomBase(): string {
  return path.join(os.tmpdir(), "ainovel-clean-room");
}

function getAppDataPath(): string {
  return path.join(getCleanRoomBase(), "AppData");
}

function getWinUnpackedPath(): string {
  // Resolve relative to this project root (mcps/clean-room -> project root)
  const mcpDir = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Z]:)/, "$1"));
  // mcpDir is .../mcps/clean-room/build, so go up 3 levels
  return path.resolve(mcpDir, "..", "..", "..", "dist-qa-unsigned", "win-unpacked");
}

function setupCleanEnvironment(): { base: string; appData: string } {
  const base = getCleanRoomBase();
  const appData = path.join(base, "AppData", "Roaming", "ai-novel-script-generator");

  // Create clean directory structure
  fs.mkdirSync(appData, { recursive: true });
  fs.mkdirSync(path.join(base, "LocalAppData"), { recursive: true });
  fs.mkdirSync(path.join(base, "output"), { recursive: true });

  return { base, appData };
}

function getLimitedPath(): string {
  // Restrict PATH to essential system + node runtime
  const essentialPaths = [
    "C:\\Windows\\System32",
    "C:\\Windows\\System32\\Wbem",
    "C:\\Windows\\System32\\WindowsPowerShell\\v1.0",
    "C:\\Program Files\\node-v24.15.0-win-x64",
    // Include ffmpeg from project bin
    path.resolve(getWinUnpackedPath(), "..", "..", "bin"),
  ];
  return essentialPaths.join(";");
}

// --- Server ---
const server = new Server(
  {
    name: "ainovel-clean-room-mcp",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "setup_clean_room",
      description:
        "Create a clean-room environment: isolated AppData, restricted PATH, no dev cache. Returns the clean room base path and AppData path.",
      inputSchema: {
        type: "object",
        properties: {
          force: {
            type: "boolean",
            description: "If true, delete any existing clean-room first",
            default: false,
          },
        },
      },
    },
    {
      name: "launch_app",
      description:
        "Launch the packaged AI Novel app (win-unpacked/Ai Novel.exe) inside the clean-room environment with isolated AppData and restricted PATH.",
      inputSchema: {
        type: "object",
        properties: {
          timeoutMs: {
            type: "number",
            description: "Max wait for app to respond on HTTP (ms). Default 30000.",
            default: 30000,
          },
          port: {
            type: "number",
            description: "Port the app will listen on. Default 3000.",
            default: 3000,
          },
        },
      },
    },
    {
      name: "teardown_clean_room",
      description:
        "Kill the app process and remove the clean-room AppData directory.",
      inputSchema: {
        type: "object",
        properties: {
          keepOutput: {
            type: "boolean",
            description: "If true, preserve the output directory. Default false.",
            default: false,
          },
        },
      },
    },
    {
      name: "get_app_status",
      description:
        "Check if the app is running and responsive. Returns HTTP status, uptime, and any errors.",
      inputSchema: {
        type: "object",
        properties: {
          port: {
            type: "number",
            description: "Port to check. Default 3000.",
            default: 3000,
          },
        },
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request: { params: { name: string; arguments?: Record<string, unknown> } }) => {
  const { name, arguments: args } = request.params;

  switch (name) {
    case "setup_clean_room": {
      const force = (args as any)?.force ?? false;
      const base = getCleanRoomBase();

      if (force && fs.existsSync(base)) {
        fs.rmSync(base, { recursive: true, force: true });
      }

      const { base: cleanBase, appData } = setupCleanEnvironment();
      cleanRoomBase = cleanBase;

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                status: "ready",
                cleanRoomBase: cleanBase,
                appDataPath: appData,
                message: "Clean-room environment created. No prior app data exists.",
              },
              null,
              2
            ),
          },
        ],
      };
    }

    case "launch_app": {
      const port = (args as any)?.port ?? 3000;
      const timeoutMs = (args as any)?.timeoutMs ?? 30000;

      if (!cleanRoomBase) {
        // Auto-setup
        const { base: cleanBase, appData } = setupCleanEnvironment();
        cleanRoomBase = cleanBase;
      }

      const winUnpacked = getWinUnpackedPath();
      const appExe = path.join(winUnpacked, "Ai Novel.exe");

      if (!fs.existsSync(appExe)) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                status: "error",
                error: `App executable not found: ${appExe}`,
                hint: "Run `npm run pack:unsigned:qa` first to build the packaged app.",
              }),
            },
          ],
          isError: true,
        };
      }

      // Kill any existing process on the port
      try {
        execSync(`for /f "tokens=5" %a in ('netstat -ano ^| findstr :${port}') do taskkill /F /PID %a 2>nul`, {
          shell: "cmd.exe",
          timeout: 5000,
        });
      } catch {
        // ignore
      }

      const limitedPath = getLimitedPath();
      const appDataRoaming = path.join(cleanRoomBase, "AppData", "Roaming");
      const appDataLocal = path.join(cleanRoomBase, "AppData", "Local");
      const userData = path.join(appDataRoaming, "ai-novel-script-generator");

      // Build env cleanly — no dev secrets
      const env: Record<string, string> = {
        PATH: limitedPath,
        APPDATA: appDataRoaming,
        LOCALAPPDATA: appDataLocal,
        USERPROFILE: cleanRoomBase,
        AI_NOVEL_PORT: String(port),
        AINOVEL_ENTITLEMENT_MODE: "open",
        SYSTEMROOT: process.env.SYSTEMROOT ?? "C:\\Windows",
        TEMP: path.join(cleanRoomBase, "Temp"),
        TMP: path.join(cleanRoomBase, "Temp"),
      };

      // Copy only safe system env vars
      for (const key of ["SystemRoot", "SYSTEMDRIVE", "COMPUTERNAME", "USERNAME", "USERDOMAIN", "windir", "HOMEDRIVE", "NUMBER_OF_PROCESSORS", "PROCESSOR_ARCHITECTURE"]) {
        if (process.env[key]) env[key] = process.env[key]!;
      }

      fs.mkdirSync(env.TEMP, { recursive: true });

      activeAppProcess = spawn(appExe, [], {
        env: { ...env, NODE_ENV: "production" } as NodeJS.ProcessEnv,
        cwd: winUnpacked,
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: false,
      });

      // Wait for app to be ready (poll HTTP)
      const startTime = Date.now();
      let appReady = false;
      let appUrl = "";

      while (Date.now() - startTime < timeoutMs) {
        try {
          const res = await fetch(`http://127.0.0.1:${port}/api/commercial/status`, {
            signal: AbortSignal.timeout(3000),
          });
          if (res.ok) {
            appReady = true;
            appUrl = `http://127.0.0.1:${port}`;
            break;
          }
        } catch {
          // Not ready yet
        }
        await new Promise((r) => setTimeout(r, 1000));
      }

      if (!appReady) {
        // Check if process died
        if (activeAppProcess && activeAppProcess.exitCode !== null) {
          const stderr = activeAppProcess.stderr?.read()?.toString() ?? "";
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  status: "crashed",
                  exitCode: activeAppProcess.exitCode,
                  stderr: stderr.slice(0, 2000),
                  message: "App process exited unexpectedly.",
                }),
              },
            ],
            isError: true,
          };
        }

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                status: "timeout",
                elapsedMs: Date.now() - startTime,
                message: `App did not respond on port ${port} within ${timeoutMs}ms. It may still be starting.`,
                pid: activeAppProcess?.pid,
              }),
            },
          ],
          isError: true,
        };
      }

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                status: "running",
                appUrl,
                pid: activeAppProcess?.pid,
                userDataPath: userData,
                cleanRoomBase,
                limitedPath: true,
                message: "App launched successfully in clean-room mode.",
              },
              null,
              2
            ),
          },
        ],
      };
    }

    case "teardown_clean_room": {
      const keepOutput = (args as any)?.keepOutput ?? false;

      // Kill app process
      if (activeAppProcess?.pid) {
        try {
          process.kill(activeAppProcess.pid, "SIGTERM");
        } catch {
          // Try taskkill
          try {
            execSync(`taskkill /F /PID ${activeAppProcess.pid}`, { timeout: 5000 });
          } catch {
            // ignore
          }
        }
      }

      // Also kill any remaining on port 3000
      try {
        execSync('for /f "tokens=5" %a in (\'netstat -ano ^| findstr :3000\') do taskkill /F /PID %a 2>nul', {
          shell: "cmd.exe",
          timeout: 5000,
        });
      } catch {
        // ignore
      }

      activeAppProcess = null;

      // Clean up
      const base = getCleanRoomBase();
      if (!keepOutput && fs.existsSync(base)) {
        fs.rmSync(base, { recursive: true, force: true });
      }

      cleanRoomBase = "";

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              status: "torn_down",
              cleanRoomBase: base,
              keptOutput: keepOutput,
              message: "Clean-room environment has been destroyed.",
            }),
          },
        ],
      };
    }

    case "get_app_status": {
      const port = (args as any)?.port ?? 3000;

      try {
        const res = await fetch(`http://127.0.0.1:${port}/api/commercial/status`, {
          signal: AbortSignal.timeout(5000),
        });
        const data = await res.json();

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  status: "responsive",
                  httpCode: res.status,
                  commercialStatus: data,
                  message: "App is running and responding.",
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (err: any) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                status: "unreachable",
                error: err.message,
                pid: activeAppProcess?.pid ?? null,
                pidAlive: activeAppProcess
                  ? activeAppProcess.exitCode === null
                  : false,
                message: `App is not reachable on port ${port}.`,
              }),
            },
          ],
          isError: true,
        };
      }
    }

    default:
      throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
  }
});

server.onerror = (error: Error) => console.error("[MCP Error]", error);
process.on("SIGINT", async () => {
  await server.close();
  process.exit(0);
});

// Run
const transport = new StdioServerTransport();
server.connect(transport).catch(console.error);
console.error("Clean-room MCP server running on stdio");