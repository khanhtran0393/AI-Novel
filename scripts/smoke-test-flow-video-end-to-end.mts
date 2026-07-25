import fetch from 'node-fetch';
import fs from 'fs';
import path from 'path';

const BASE = 'http://127.0.0.1:3000';

async function main() {
  console.log('=== END-TO-END GOOGLE FLOW VIDEO GENERATION TEST ===');
  
  const payload = {
    chapterNum: 9,
    sceneIndex: 99,
    promptIndex: 0,
    prompt: 'cinematic drone shot over misty mountains at sunrise, 4k, realistic, soft clouds',
    duration: 4,
    secondsPerBeat: 6,
    videoProvider: 'flow',
    videoAspectRatio: '16:9',
    quality: 'hd',
    styleHint: 'Cinematic',
    genre: 'Fantasy / Epic',
    ten_tac_pham: 'Test Flow Video',
  };

  console.log('Sending request to /api/generate-video...');
  console.log(JSON.stringify(payload, null, 2));

  const startMs = Date.now();
  const res = await fetch(`${BASE}/api/generate-video`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  const elapsed = ((Date.now() - startMs) / 1000).toFixed(1);
  console.log(`\nHTTP Response Code: ${res.status} (took ${elapsed}s)`);
  const json = await res.json();
  console.log('Response JSON:', JSON.stringify(json, null, 2));

  const targetFile = path.join(process.cwd(), 'public', 'video', 'c9_s99_p0.mp4');
  console.log('\nChecking target video file on disk:', targetFile);
  if (fs.existsSync(targetFile)) {
    const stat = fs.statSync(targetFile);
    console.log(`[SUCCESS] File exists! Size: ${(stat.size / 1024 / 1024).toFixed(2)} MB`);
  } else {
    console.log(`[INFO] Video task queued/processing in background queue.`);
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
