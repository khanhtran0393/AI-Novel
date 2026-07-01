// Scan JS bundle của Google Flow để tìm tRPC route names
import fs from 'fs';

const HEADERS_PATH = 'C:\\Users\\Khanh\\Downloads\\tool sua\\CREATE VIDEO PRO 12052026\\CREATE VIDEO PRO 12052026\\headers_veo.txt';

(async () => {
  const hdrs = fs.readFileSync(HEADERS_PATH, 'utf8');
  const cookieMatch = hdrs.match(/cookie\n(.+)/);
  const cookie = cookieMatch ? cookieMatch[1].trim() : '';

  const headers = {
    'cookie': cookie,
    'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36'
  };

  // Lấy HTML chính để tìm JS bundle URLs
  console.log('1. Lấy HTML chính...');
  const html = await (await fetch('https://labs.google/fx/tools/flow', { headers })).text();
  
  // Tìm tất cả JS bundle URLs
  const jsUrls = [];
  const regex = /src="(\/_next\/static\/[^"]+\.js)"/g;
  let match;
  while ((match = regex.exec(html)) !== null) {
    jsUrls.push(`https://labs.google${match[1]}`);
  }
  console.log(`Tìm thấy ${jsUrls.length} JS bundles`);

  // Tải và scan từng bundle
  const allRoutes = new Set();
  for (let i = 0; i < Math.min(jsUrls.length, 15); i++) {
    const url = jsUrls[i];
    try {
      const js = await (await fetch(url, { headers })).text();
      
      // Tìm tRPC route patterns
      const patterns = [
        /["'](\w+\.(?:generate|create|submit|produce|render|make)\w*)["']/gi,
        /["'](\w+Fx\.\w+)["']/gi,
        /["']flow\.(\w+)["']/gi,
        /["']agent\.(\w+)["']/gi,
        /["']media\.(\w+)["']/gi,
        /["']videoFx\.(\w+)["']/gi,
        /mutation.*?["'](\w+\.\w+)["']/gi,
        /useMutation.*?["'](\w+\.\w+)["']/gi,
      ];
      
      for (const pat of patterns) {
        let m;
        while ((m = pat.exec(js)) !== null) {
          allRoutes.add(m[1] || m[0]);
        }
      }
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    } catch (e) {
      // skip
    }
    if (i % 3 === 0) console.log(`  Scanned ${i+1}/${Math.min(jsUrls.length, 15)} bundles...`);
  }

  console.log(`\nTìm thấy ${allRoutes.size} potential routes:`);
  const sorted = [...allRoutes].sort();
  for (const r of sorted) {
    console.log(`  ${r}`);
  }

  // Thử các routes có khả năng cao nhất
  console.log('\n\n--- Thử gọi các mutation routes ---');
  const candidates = sorted.filter(r => 
    r.includes('generate') || r.includes('create') || r.includes('submit') || 
    r.includes('produce') || r.includes('render') || r.includes('prompt') ||
    r.includes('workflow') || r.includes('scene')
  );
  
  for (const endpoint of candidates.slice(0, 20)) {
    try {
      const body = {json: {
        prompt: 'A cute cat',
        projectId: 'a49860c6-fabc-4d08-b618-34c8066_backfill',
      }};
      const r = await fetch(`https://labs.google/fx/api/trpc/${endpoint}`, {
        method: 'POST',
        headers: { ...headers, 'content-type': 'application/json', 'origin': 'https://labs.google' },
        body: JSON.stringify(body)
      });
      const text = await r.text();
      const status = r.status;
      if (status !== 404) {
        console.log(`  ✅ ${endpoint}: ${status} → ${text.substring(0, 200)}`);
      } else {
        console.log(`  ❌ ${endpoint}: 404`);
      }
    } catch {}
  }

  console.log('\nDone!');
})();
