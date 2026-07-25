import fetch from 'node-fetch';

const BASE = 'http://127.0.0.1:3000';

async function step1_status() {
  console.log('[STEP 1] Checking Flow Status...');
  const res = await fetch(`${BASE}/api/flow/status`);
  const data = await res.json();
  console.log('[STEP 1 RESULT]', JSON.stringify(data, null, 2));
  return data;
}

async function step2_video_direct() {
  console.log('\n[STEP 2] Testing Direct Google Flow Video Generation...');
  const body = {
    prompt: 'cinematic drone shot over misty mountains at sunrise, 4k, realistic',
    chapterNum: 1,
    sceneIndex: 0,
    promptIndex: 0,
    videoProvider: 'flow',
    duration: 4,
    secondsPerBeat: 6,
    styleHint: 'Cinematic',
    genre: 'Fantasy / Epic',
    videoAspectRatio: '16:9',
    quality: 'hd',
  };
  
  console.log('Posting payload to /api/generate-video:', JSON.stringify(body, null, 2));
  const startTime = Date.now();
  const res = await fetch(`${BASE}/api/generate-video`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  
  const elapsedSec = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`[STEP 2 HTTP STATUS] ${res.status} (took ${elapsedSec}s)`);
  const text = await res.text();
  console.log('[STEP 2 RESPONSE TEXT]', text);
}

async function main() {
  await step1_status();
  await step2_video_direct();
}

main().catch(err => {
  console.error('Fatal error in test:', err);
  process.exit(1);
});
