import fetch from 'node-fetch';
import fs from 'fs';
import path from 'path';

async function main() {
  console.log('=== TESTING DIRECT FLOW T2V GENERATION VIA RUN-ONE ===');
  
  const payload = {
    kind: 'video',
    prompt: 'cinematic aerial shot of misty pine forest at sunrise, soft morning light, 4k',
    chapterNum: 9,
    sceneIndex: 95,
    promptIndex: 0,
    aspectRatio: '16:9',
    durationSec: 4,
    quality: 'hd',
    videoModel: 'veo_3_1_t2v_fast',
    videoMode: 't2v',
  };

  console.log('Sending payload to http://127.0.0.1:8101/api/generate-one...');
  console.log(JSON.stringify(payload, null, 2));

  const startMs = Date.now();
  const res = await fetch('http://127.0.0.1:8101/api/generate-one', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  const elapsed = ((Date.now() - startMs) / 1000).toFixed(1);
  console.log(`\nHTTP Response Status: ${res.status} (took ${elapsed}s)`);
  const json = await res.json();
  console.log('Response JSON:', JSON.stringify(json, null, 2));

  const targetFile = path.join(process.cwd(), 'public', 'video', 'c9_s95_p0.mp4');
  console.log('\nChecking output video file:', targetFile);
  if (fs.existsSync(targetFile)) {
    const stat = fs.statSync(targetFile);
    console.log(`[SUCCESS] File created! Size: ${(stat.size / 1024 / 1024).toFixed(2)} MB`);
  } else if (json.resultPaths && json.resultPaths[0] && fs.existsSync(json.resultPaths[0])) {
    const stat = fs.statSync(json.resultPaths[0]);
    console.log(`[SUCCESS] Result path file created! Size: ${(stat.size / 1024 / 1024).toFixed(2)} MB at ${json.resultPaths[0]}`);
  }
}

main().catch(console.error);
