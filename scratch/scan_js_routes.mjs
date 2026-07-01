// Dùng Puppeteer scan JS runtime để tìm tRPC routes
import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import fs from 'fs';
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import path from 'path';

puppeteer.use(StealthPlugin());

const HEADERS_PATH = 'C:\\Users\\Khanh\\Downloads\\tool sua\\CREATE VIDEO PRO 12052026\\CREATE VIDEO PRO 12052026\\headers_veo.txt';

(async () => {
  const hdrs = fs.readFileSync(HEADERS_PATH, 'utf8');
  const tokenMatch = hdrs.match(/__Secure-next-auth\.session-token=([^;]+)/);
  const sessionToken = tokenMatch ? tokenMatch[1].trim() : '';

  const browser = await puppeteer.launch({
    headless: 'new',
    defaultViewport: { width: 1200, height: 900 },
    executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    args: ['--no-sandbox', '--disable-blink-features=AutomationControlled']
  });

  const page = await browser.newPage();
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36');

  await page.setCookie({
    name: '__Secure-next-auth.session-token',
    value: sessionToken,
    domain: '.labs.google',
    path: '/',
    secure: true,
    httpOnly: true
  });

  // Bắt tất cả JS files loaded
  const jsContents = [];
  page.on('response', async (response) => {
    const url = response.url();
    if (url.endsWith('.js') && url.includes('labs.google')) {
      try {
        const text = await response.text();
        jsContents.push({ url, text });
      } catch {}
    }
  });

  await page.goto('https://labs.google/fx/vi/tools/flow/project/a49860c6-fabc-4d08-b618-34c8066_backfill', { waitUntil: 'networkidle2', timeout: 30000 });
  await new Promise(r => setTimeout(r, 3000));

  console.log(`Loaded ${jsContents.length} JS files`);

  // Scan tất cả JS cho tRPC route names
  const routes = new Set();
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  for (const { url, text } of jsContents) {
    // Tìm pattern: "routeName.procedureName"
    const patterns = [
      /["']((?:flow|videoFx|media|agent|general|auth|character|workflow|scene|project)\.\w+)["']/g,
      /trpc[/.](\w+\.\w+)/g,
      /mutation[^}]*?["'](\w+\.\w+)["']/gi
    ];
    
    for (const pat of patterns) {
      let m;
      while ((m = pat.exec(text)) !== null) {
        routes.add(m[1]);
      }
    }
  }

  const sorted = [...routes].sort();
  console.log(`\nTìm thấy ${sorted.length} tRPC routes:`);
  for (const r of sorted) {
    console.log(`  ${r}`);
  }

  // Filter chỉ mutations (khả năng generate)
  const mutations = sorted.filter(r => 
    !r.includes('get') && !r.includes('fetch') && !r.includes('Get') && !r.includes('Fetch')
  );
  console.log(`\nPotential mutations (${mutations.length}):`);
  for (const r of mutations) {
    console.log(`  → ${r}`);
  }

  await browser.close();
  console.log('\nDone!');
})();
