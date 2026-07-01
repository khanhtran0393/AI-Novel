// Gọi trực tiếp tRPC API của Google Flow - không cần Puppeteer
import fs from 'fs';

const HEADERS_PATH = 'C:\\Users\\Khanh\\Downloads\\tool sua\\CREATE VIDEO PRO 12052026\\CREATE VIDEO PRO 12052026\\headers_veo.txt';
const PROMPT = 'A cute orange cat walking slowly in a beautiful japanese garden, cinematic 4K';
const PROJECT_ID = 'a49860c6-fabc-4d08-b618-34c8066_backfill';

(async () => {
  // Đọc cookie từ file
  const hdrs = fs.readFileSync(HEADERS_PATH, 'utf8');
  const cookieMatch = hdrs.match(/cookie\n(.+)/);
  const cookie = cookieMatch ? cookieMatch[1].trim() : '';
  
  if (!cookie) {
    console.log('❌ Không tìm thấy cookie!');
    process.exit(1);
  }
  console.log(`Cookie: ${cookie.substring(0, 80)}...`);

  const baseUrl = 'https://labs.google/fx/api/trpc';
  const headers = {
    'accept': '*/*',
    'accept-language': 'vi',
    'content-type': 'application/json',
    'cookie': cookie,
    'origin': 'https://labs.google',
    'referer': `https://labs.google/fx/vi/tools/flow/project/${PROJECT_ID}`,
    'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36'
  };

  // 1. Lấy session info
  console.log('\n--- 1. Kiểm tra session ---');
  try {
    const r = await fetch('https://labs.google/fx/api/auth/session', { headers });
    const data = await r.json();
    console.log(`Session: ${JSON.stringify(data).substring(0, 200)}`);
  } catch (e) { console.log(`Lỗi: ${e.message}`); }

  // 2. Lấy config app
  console.log('\n--- 2. App Config ---');
  try {
    const r = await fetch(`${baseUrl}/videoFx.getFlowAppConfig?input=${encodeURIComponent(JSON.stringify({json:null,meta:{values:["undefined"]}}))}`, { headers });
    const data = await r.json();
    console.log(`Config: ${JSON.stringify(data).substring(0, 500)}`);
  } catch (e) { console.log(`Lỗi: ${e.message}`); }

  // 3. Lấy project data
  console.log('\n--- 3. Project Data ---');
  try {
    const r = await fetch(`${baseUrl}/flow.projectInitialData?input=${encodeURIComponent(JSON.stringify({json:{projectId:PROJECT_ID}}))}`, { headers });
    const data = await r.json();
    console.log(`Project: ${JSON.stringify(data).substring(0, 500)}`);
  } catch (e) { console.log(`Lỗi: ${e.message}`); }

  // 4. Thử các endpoint generate phổ biến
  const generateEndpoints = [
    'flow.generate',
    'flow.createMedia',
    'flow.submitPrompt',
    'videoFx.generate',
    'videoFx.generateVideo',
    'videoFx.createVideo',
    'videoFx.submitPrompt',
    'media.generate',
    'media.createMedia',
    'agent.generate',
    'agent.submitPrompt',
  ];

  console.log('\n--- 4. Thử tìm endpoint generate ---');
  for (const endpoint of generateEndpoints) {
    try {
      const body = {json: {
        prompt: PROMPT,
        projectId: PROJECT_ID,
        modelId: 'nano-banana-2',
        mediaType: 'VIDEO',
        duration: 5,
        aspectRatio: '16:9',
        count: 2
      }};
      
      const r = await fetch(`${baseUrl}/${endpoint}`, { 
        method: 'POST', 
        headers,
        body: JSON.stringify(body)
      });
      const text = await r.text();
      console.log(`  ${endpoint}: ${r.status} → ${text.substring(0, 200)}`);
      
      if (r.status === 200) {
        console.log(`  ✅ FOUND! Full response: ${text.substring(0, 500)}`);
      }
    } catch (e) {
      console.log(`  ${endpoint}: ERR ${e.message}`);
    }
  }

  // 5. Thử batch mutation 
  console.log('\n--- 5. Batch mutation ---');
  try {
    const batchBody = {
      "0": {
        json: {
          prompt: PROMPT,
          projectId: PROJECT_ID,
        }
      }
    };
    const endpoints2 = ['flow.generate', 'videoFx.generate', 'agent.generate', 'flow.submitPrompt'];
    for (const ep of endpoints2) {
      const r = await fetch(`${baseUrl}/${ep}?batch=1`, {
        method: 'POST',
        headers,
        body: JSON.stringify(batchBody)
      });
      console.log(`  ${ep}?batch=1: ${r.status} → ${(await r.text()).substring(0, 200)}`);
    }
  } catch (e) { console.log(`Lỗi: ${e.message}`); }

  console.log('\nDone!');
})();
