// eslint-disable-next-line @typescript-eslint/no-require-imports
const fs = require('fs');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const path = require('path');

const storePath = path.join(process.cwd(), 'scratch', 'saved_novel_store.json');

function dump() {
  if (!fs.existsSync(storePath)) {
    console.error('File not found');
    return;
  }

  const store = JSON.parse(fs.readFileSync(storePath, 'utf8'));
  const cookies = store.state?.googleStudioCookies || [];
  console.log(`Total: ${cookies.length}`);

  let index = 0;
  for (const c of cookies) {
    index++;
    if (typeof c !== 'string') continue;
    const hasNewline = c.includes('\n') || c.includes('\r');
    console.log(`[${index}] hasNewline=${hasNewline}, length=${c.length}, snippet="${c.substring(0, 100).replace(/\n/g, '\\n')}"`);
  }
}

dump();
