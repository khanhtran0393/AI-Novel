/**
 * Full pipeline via Next :3000 ONLY (never start local bridge — avoids stealing WS).
 * 1) status  2) bootstrap  3) gen image  4) gen video I2V from that image
 */
import fs from 'fs';
import path from 'path';

const BASE = process.env.AINOVEL_URL || 'http://127.0.0.1:3000';
const PW =
  process.env.AINOVEL_CHROME ||
  path.join(
    process.env.LOCALAPPDATA || '',
    'ms-playwright',
    'chromium-1228',
    'chrome-win64',
    'chrome.exe',
  );

const OUT = path.join(process.cwd(), 'scratch', 'emp-flow-full-report.json');

async function jfetch(url: string, init?: RequestInit) {
  const res = await fetch(url, init);
  const text = await res.text();
  let json: any = text;
  try {
    json = JSON.parse(text);
  } catch {
    /* keep */
  }
  return { status: res.status, json, text: text.slice(0, 1500) };
}

async function main() {
  const report: Record<string, unknown> = { at: new Date().toISOString(), base: BASE, steps: [] as any[] };
  const log = (name: string, ok: boolean, detail: unknown) => {
    (report.steps as any[]).push({ name, ok, detail });
    console.log(`\n[${ok ? 'OK' : 'FAIL'}] ${name}`);
    console.log(typeof detail === 'string' ? detail : JSON.stringify(detail, null, 2));
  };

  console.log('=== FULL FLOW PIPELINE (Next only) ===');
  console.log('PW exists', fs.existsSync(PW), PW);

  // 1 status
  let st = await jfetch(`${BASE}/api/flow/status`);
  log('status before', st.status === 200, {
    ext: st.json?.extensionConnected,
    token: st.json?.flowKeyPresent,
  });

  // 2 bootstrap if needed
  if (!st.json?.extensionConnected || !st.json?.flowKeyPresent) {
    console.log('\n… bootstrap …');
    const boot = await jfetch(`${BASE}/api/flow/bootstrap`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        forceChrome: true,
        engine: 'auto',
        browserExe: fs.existsSync(PW) ? PW : undefined,
        waitExtensionMs: 40000,
        waitLoginMs: 50000,
      }),
    });
    log('bootstrap', boot.json?.ok || boot.json?.flowKeyPresent, {
      ok: boot.json?.ok,
      ext: boot.json?.extensionConnected,
      token: boot.json?.flowKeyPresent,
      browser: boot.json?.browserLabel,
      message: boot.json?.message,
      steps: boot.json?.steps?.slice(-8),
    });
    await new Promise((r) => setTimeout(r, 8000));
    st = await jfetch(`${BASE}/api/flow/status`);
    log('status after boot', st.status === 200, {
      ext: st.json?.extensionConnected,
      token: st.json?.flowKeyPresent,
      age: st.json?.tokenAgeMs,
    });
  }

  if (!st.json?.flowKeyPresent) {
    report.verdict = 'NO_TOKEN — login Google on spawned browser';
    fs.mkdirSync(path.dirname(OUT), { recursive: true });
    fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
    console.log('\nReport', OUT);
    process.exit(2);
  }

  // 3 image
  console.log('\n… gen image …');
  const img = await jfetch(`${BASE}/api/generate-image`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      prompt: 'cinematic rainy neon alley, wet asphalt reflections, wide shot, night',
      chapterNum: 2,
      sceneIndex: 0,
      promptIndex: 0,
      imageProvider: 'flow',
      model: 'GEM_PIX_2',
      imageAspectRatio: '16:9',
      imageCount: 1,
      ten_tac_pham: 'Emp Full Pipeline',
    }),
  });
  log('generate-image flow', Boolean(img.json?.success || img.json?.imagePath), img.json);

  const imgFile = path.join(
    process.cwd(),
    'public',
    'images',
    'chapter_2_scene_0_prompt_0.png',
  );
  const c2 = path.join(process.cwd(), 'public', 'images', 'c2_s0_p0.png');
  const stillPath = fs.existsSync(imgFile)
    ? imgFile
    : fs.existsSync(c2)
      ? c2
      : '';
  log('image file on disk', Boolean(stillPath), {
    stillPath,
    size: stillPath ? fs.statSync(stillPath).size : 0,
  });

  // 4 video I2V (or auto-still→I2V if no file)
  console.log('\n… gen video (may take minutes) …');
  const vidBody: Record<string, unknown> = {
    prompt: 'slow cinematic push-in through neon rain alley, atmospheric fog, 4 seconds',
    chapterNum: 2,
    sceneIndex: 0,
    promptIndex: 0,
    videoProvider: 'flow',
    duration: 4,
    videoAspectRatio: '16:9',
    quality: 'hd',
  };
  if (stillPath) vidBody.startImage = stillPath;

  const vid = await jfetch(`${BASE}/api/generate-video`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(vidBody),
  });
  log('generate-video flow', Boolean(vid.json?.success || vid.json?.videoPath), vid.json);

  // find new video files
  const vdir = path.join(process.cwd(), 'public', 'video');
  let newest: { name: string; size: number; mtime: number } | null = null;
  if (fs.existsSync(vdir)) {
    for (const name of fs.readdirSync(vdir)) {
      if (!name.endsWith('.mp4')) continue;
      const stt = fs.statSync(path.join(vdir, name));
      if (!newest || stt.mtimeMs > newest.mtime) {
        newest = { name, size: stt.size, mtime: stt.mtimeMs };
      }
    }
  }
  const veoDir = path.join(process.cwd(), 'veo_output');
  let veoNewest: string | null = null;
  if (fs.existsSync(veoDir)) {
    const files = fs.readdirSync(veoDir).filter((f) => f.endsWith('.mp4'));
    if (files.length) veoNewest = files[files.length - 1];
  }
  log('video files', Boolean(vid.json?.success), { newest, veoNewest });

  const final = await jfetch(`${BASE}/api/flow/status`);
  const verdict = {
    ext: final.json?.extensionConnected,
    token: final.json?.flowKeyPresent,
    imageOk: Boolean(stillPath && fs.existsSync(stillPath)),
    videoOk: Boolean(vid.json?.success || vid.json?.videoPath),
  };
  report.verdict = verdict;
  report.finalStatus = final.json;
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(report, null, 2), 'utf8');
  console.log('\n=== VERDICT ===', JSON.stringify(verdict, null, 2));
  console.log('Report:', OUT);

  if (verdict.imageOk && verdict.videoOk) process.exit(0);
  if (verdict.imageOk) process.exit(3); // image pass, video fail
  process.exit(2);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
