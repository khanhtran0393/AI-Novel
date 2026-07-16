const fs = require("fs");
const path = require("path");

async function main() {
  const status = await fetch("http://127.0.0.1:8101/api/status").then(r => r.json());
  console.log("ready", { ext: status.extensionConnected, key: status.flowKeyPresent });
  if (!status.extensionConnected || !status.flowKeyPresent) process.exit(2);

  // Use tiny image
  const imgPath = path.join(process.cwd(), "public/images/_tiny_test.png");
  const b64 = fs.readFileSync(imgPath).toString("base64");
  const projectId = status.projectId || "default";
  const key = "AIzaSyBtrm0o5ab1c-Ec8ZuLcGt3oJAA5VWt3pY";
  const base = "https://aisandbox-pa.googleapis.com";

  // We need to go through extension - use generate-one but only after we fix.
  // Instead call a raw path: POST /api/generate-one is the only public API.
  // So we'll use status after enqueue... better: use internal by posting generate and capturing.

  // Direct: use Node ws to extension? Too heavy.
  // Call generate-one and improve extract in parallel.
  console.log("Calling generate-one video...");
  const body = {
    kind: "video",
    prompt: "gentle camera push neon alley rain reflections",
    chapterNum: 3,
    sceneIndex: 98,
    promptIndex: 0,
    aspectRatio: "16:9",
    durationSec: 6,
    quality: "hd",
    startImagePath: imgPath,
  };
  const t0 = Date.now();
  const res = await fetch("http://127.0.0.1:8101/api/generate-one", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(420000),
  });
  const json = await res.json();
  console.log("result", Date.now()-t0, JSON.stringify(json).slice(0, 800));
  const out = path.join(process.cwd(), "public/video/c3_s98_p0.mp4");
  console.log("exists", fs.existsSync(out), fs.existsSync(out) ? fs.statSync(out).size : 0);
}
main().catch(e => { console.error("ERR", e); process.exit(1); });
