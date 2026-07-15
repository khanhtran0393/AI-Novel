/**
 * If Next server is up, attempt real TTS (Edge) + skip image if no key.
 * Always writes a report. Exit 0 if server down (skipped) or regen ok.
 * Run: node scripts/smoke-regen-if-server.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const base = process.env.AINOVEL_BASE || 'http://127.0.0.1:3000';
const outDir = path.join(root, 'exports', 'regen-smoke');
fs.mkdirSync(outDir, { recursive: true });

const log = [];
const line = (m) => {
  log.push(m);
  console.log(m);
};

let health;
try {
  health = await fetch(`${base}/api/system-info`, {
    signal: AbortSignal.timeout(20000),
  });
} catch (e) {
  line(`SKIP server down: ${e.message || e}`);
  fs.writeFileSync(
    path.join(outDir, 'report.json'),
    JSON.stringify({ at: new Date().toISOString(), skipped: true, log }, null, 2),
  );
  process.exit(0);
}

if (!health.ok) {
  line(`SKIP server status ${health.status}`);
  fs.writeFileSync(
    path.join(outDir, 'report.json'),
    JSON.stringify({ at: new Date().toISOString(), skipped: true, log }, null, 2),
  );
  process.exit(0);
}

line('server up — regen TTS edge');
const text =
  'Hàn Dực đặt tay lên tường đá ẩm. Vết nứt nở ra, ánh sáng lạnh tràn vào như lưỡi dao.';
const ttsRes = await fetch(`${base}/api/generate-tts`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    sceneText: text,
    chapterNum: 99,
    sceneIndex: 0,
    voiceName: 'vi-VN-HoaiMyNeural',
    ten_tac_pham: 'RegenSmoke',
    ttsConfig: {
      platform: 'edge_tts',
      voice: 'vi-VN-HoaiMyNeural',
      language: 'vi',
      speed: 1,
      pitch: 0,
    },
  }),
});
const ttsJson = await ttsRes.json().catch(() => ({}));
const ttsOk = ttsRes.ok && (ttsJson.path || ttsJson.audioPath || ttsJson.url);
line(`TTS: ${ttsOk ? 'OK' : 'FAIL'} status=${ttsRes.status} ${JSON.stringify(ttsJson).slice(0, 200)}`);

const report = {
  at: new Date().toISOString(),
  skipped: false,
  ttsOk: !!ttsOk,
  ttsStatus: ttsRes.status,
  tts: ttsJson,
  log,
};
fs.writeFileSync(path.join(outDir, 'report.json'), JSON.stringify(report, null, 2));
if (!ttsOk) process.exit(2);
line('REGEN SMOKE PASS');
process.exit(0);
