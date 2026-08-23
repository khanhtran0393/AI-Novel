// Audit packaged app in clean-room via HTTP — writes sync to file
import http from "node:http";
import fs from "node:fs";
import path from "node:path";

const OUT = path.join(process.env.TEMP || "C:\\Temp", "ainovel-audit", "audit.json");
fs.mkdirSync(path.dirname(OUT), { recursive: true });

const log = [];

function writeLog() {
  fs.writeFileSync(OUT, JSON.stringify(log, null, 2), "utf-8");
}

function addEntry(entry) {
  log.push(entry);
  process.stderr.write(`${entry.label}: ${entry.status ?? entry.error}\n`);
  writeLog();
}

function fetchIt(method, url, label, body) {
  return new Promise((resolve) => {
    const u = new URL(url);
    const opts = {
      hostname: u.hostname,
      port: u.port,
      path: u.pathname + u.search,
      method,
      headers: body
        ? { "Content-Type": "application/json", "Content-Length": String(Buffer.byteLength(body)) }
        : {},
      timeout: 15000,
    };
    const req = http.request(opts, (res) => {
      let d = "";
      res.on("data", (c) => (d += c));
      res.on("end", () => {
        addEntry({ label, url, method, status: res.statusCode, size: d.length, preview: d.slice(0, 400) });
        resolve();
      });
    });
    req.on("error", (e) => {
      addEntry({ label, url, method, error: e.message });
      resolve();
    });
    req.on("timeout", () => {
      req.destroy();
      addEntry({ label, url, method, error: "timeout" });
      resolve();
    });
    if (body) req.write(body);
    req.end();
  });
}

async function run() {
  await fetchIt("GET", "http://127.0.0.1:3000/", "Homepage");
  await fetchIt("GET", "http://127.0.0.1:3000/workspace", "Workspace");
  await fetchIt("GET", "http://127.0.0.1:3000/api/commercial/status", "CommercialStatus");
  await fetchIt("GET", "http://127.0.0.1:3000/api/entitlement/hwid", "HWID");
  await fetchIt("GET", "http://127.0.0.1:3000/api/flow/status", "FlowStatus");
  await fetchIt("GET", "http://127.0.0.1:3000/api/navtools/gateway", "NavGateway");
  await fetchIt("GET", "http://127.0.0.1:3000/api/generate-image", "GenImage-GET");
  await fetchIt("GET", "http://127.0.0.1:3000/api/generate-video", "GenVideo-GET");
  await fetchIt("POST", "http://127.0.0.1:3000/api/generate", "Generate-POST", JSON.stringify({ requestType: "PING" }));
  await fetchIt("POST", "http://127.0.0.1:3000/api/generate-tts", "TTS-POST", JSON.stringify({}));

  // Try setup genre with valid-ish request
  await fetchIt("POST", "http://127.0.0.1:3000/api/generate", "Generate-IDEAS", JSON.stringify({
    requestType: "GENERATE_IDEAS",
    payload: { chu_de: "Kiếm hiệp", phong_cach: "Cổ trang", mo_ta: "Test clean room" },
  }));

  log.push({ done: true, total: log.length, outFile: OUT });
  writeLog();
  process.exit(0);
}

run();