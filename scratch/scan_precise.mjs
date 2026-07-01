// Scan chính xác hơn: tìm tRPC procedure names trong JS bundles
import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import fs from 'fs';

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
    args: ['--no-sandbox']
  });

  const page = await browser.newPage();
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36');
  await page.setCookie({
    name: '__Secure-next-auth.session-token', value: sessionToken,
    domain: '.labs.google', path: '/', secure: true, httpOnly: true
  });

  const jsTexts = [];
  page.on('response', async (response) => {
    if (response.url().endsWith('.js') && response.url().includes('labs.google')) {
      try { jsTexts.push(await response.text()); } catch {}
    }
  });

  await page.goto('https://labs.google/fx/vi/tools/flow/project/a49860c6-fabc-4d08-b618-34c8066_backfill', { waitUntil: 'networkidle2', timeout: 30000 });
  await new Promise(r => setTimeout(r, 2000));

  console.log(`Loaded ${jsTexts.length} JS files, total ${jsTexts.reduce((a,b) => a + b.length, 0)} bytes`);

  // Hợp nhất tất cả JS
  const allJs = jsTexts.join('\n');
  
  // Tìm tất cả string chứa "videoFx." hoặc "flow." trong context tRPC
  const results = new Set();
  
  // Pattern 1: trpc procedure calls like e.videoFx.xxx or t.flow.xxx
  const p1 = /\b\w\.(videoFx|flow|media|general|agent|character|workflow|scene|auth)\.([\w]+)\b/g;
  let m;
  while ((m = p1.exec(allJs)) !== null) {
    results.add(`${m[1]}.${m[2]}`);
  }

  // Pattern 2: string literals with dots
  const p2 = /["'](videoFx|flow|media|general|agent|character|workflow|scene)\.([\w]+)["']/g;
  while ((m = p2.exec(allJs)) !== null) {
    results.add(`${m[1]}.${m[2]}`);
  }

  const sorted = [...results].sort();
  console.log(`\n=== Tìm thấy ${sorted.length} tRPC procedures ===`);
  for (const r of sorted) {
    console.log(`  ${r}`);
  }

  // Tìm cụ thể từ khóa liên quan đến generation
  console.log('\n=== Tìm từ khóa generate/create/submit ===');
  const genPatterns = /["']([a-zA-Z]+\.[a-zA-Z]*(?:generat|creat|submit|produc|render|mak|run|execut|invoke|start|initiat|queue|request|dispatch)[a-zA-Z]*)["']/gi;
  while ((m = genPatterns.exec(allJs)) !== null) {
    console.log(`  FOUND: "${m[1]}"`);
  }

  // Tìm mutation hooks
  console.log('\n=== Tìm useMutation patterns ===');
  const mutPat = /useMutation[^)]*?["']([^"']+)["']/g;
  while ((m = mutPat.exec(allJs)) !== null) {
    console.log(`  Mutation: "${m[1]}"`);
  }

  // Tìm trpc mutation
  console.log('\n=== Tìm .mutation( patterns ===');
  const mutPat2 = /\.mutation\s*\(\s*["']([^"']+)["']/g;
  while ((m = mutPat2.exec(allJs)) !== null) {
    console.log(`  Mutation: "${m[1]}"`);
  }

  await browser.close();
  console.log('\nDone!');
})();
