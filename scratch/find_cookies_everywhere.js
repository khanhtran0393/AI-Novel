// eslint-disable-next-line @typescript-eslint/no-require-imports
const fs = require('fs');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const path = require('path');

const GOOGLE_CHROME_DIR = 'C:\\Users\\Khanh\\AppData\\Local\\Google\\Chrome\\User Data';

function scanDir(dir, foundStores = []) {
  if (!fs.existsSync(dir)) return foundStores;

  let files;
  try {
    files = fs.readdirSync(dir);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  } catch (e) {
    return foundStores;
  }

  for (const file of files) {
    const fullPath = path.join(dir, file);
    let stat;
    try {
      stat = fs.statSync(fullPath);
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    } catch (e) {
      continue;
    }

    if (stat.isDirectory()) {
      // Exclude giant folders we don't care about, like Cache, Code Cache, etc.
      if (file === 'Cache' || file === 'Code Cache' || file === 'System Volume Information' || file === 'node_modules') {
        continue;
      }
      scanDir(fullPath, foundStores);
    } else if (stat.isFile()) {
      // We only care about LevelDB files (.log, .ldb) or other DBs
      if (file.endsWith('.log') || file.endsWith('.ldb') || file === 'CURRENT' || file.startsWith('MANIFEST')) {
        try {
          const content = fs.readFileSync(fullPath);
          let idx = -1;
          // Search for 'novel_generator_v2_store' as raw ASCII/UTF8
          while ((idx = content.indexOf('novel_generator_v2_store', idx + 1)) !== -1) {
            console.log(`[+] Found 'novel_generator_v2_store' at ASCII idx ${idx} in file: ${fullPath}`);
            extractStore(content, idx, fullPath, foundStores);
          }

          // Search for 'n\x00o\x00v\x00e\x00l\x00' (UTF-16LE version of key)
          const utf16Key = Buffer.from('novel_generator_v2_store', 'utf16le');
          let idx16 = -1;
          while ((idx16 = content.indexOf(utf16Key, idx16 + 1)) !== -1) {
            console.log(`[+] Found 'novel_generator_v2_store' at UTF-16LE idx ${idx16} in file: ${fullPath}`);
            extractStoreUTF16(content, idx16, fullPath, foundStores);
          }
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        } catch (e) {
          // ignore read errors
        }
      }
    }
  }
  return foundStores;
}

function extractStore(content, idx, filePath, foundStores) {
  const start = idx + 'novel_generator_v2_store'.length;
  // Look for '{' in both UTF-8 and UTF-16LE
  let jsonStart = -1;
  for (let i = start; i < start + 100; i++) {
    if (content[i] === 0x7B && content[i+1] === 0x00) {
      jsonStart = i;
      break;
    }
  }
  
  if (jsonStart !== -1) {
    // UTF-16LE
    const sliced = content.slice(jsonStart);
    const decodedStr = sliced.toString('utf16le');
    parseAndSave(decodedStr, filePath, 'UTF-16LE', foundStores);
  } else {
    // UTF-8
    for (let i = start; i < start + 100; i++) {
      if (content[i] === 0x7B) {
        jsonStart = i;
        break;
      }
    }
    if (jsonStart !== -1) {
      const sliced = content.slice(jsonStart);
      const decodedStr = sliced.toString('utf8');
      parseAndSave(decodedStr, filePath, 'UTF-8', foundStores);
    }
  }
}

function extractStoreUTF16(content, idx, filePath, foundStores) {
  const utf16Key = Buffer.from('novel_generator_v2_store', 'utf16le');
  const start = idx + utf16Key.length;
  let jsonStart = -1;
  for (let i = start; i < start + 100; i++) {
    if (content[i] === 0x7B && content[i+1] === 0x00) {
      jsonStart = i;
      break;
    }
  }
  if (jsonStart !== -1) {
    const sliced = content.slice(jsonStart);
    const decodedStr = sliced.toString('utf16le');
    parseAndSave(decodedStr, filePath, 'UTF-16LE (Key UTF-16)', foundStores);
  }
}

function parseAndSave(decodedStr, filePath, encoding, foundStores) {
  let braceCount = 0;
  let jsonEnd = -1;
  for (let i = 0; i < decodedStr.length; i++) {
    if (decodedStr[i] === '{') braceCount++;
    else if (decodedStr[i] === '}') {
      braceCount--;
      if (braceCount === 0) {
        jsonEnd = i + 1;
        break;
      }
    }
  }
  
  if (jsonEnd !== -1) {
    const rawJson = decodedStr.substring(0, jsonEnd);
    try {
      const parsed = JSON.parse(rawJson);
      const state = parsed.state || {};
      const cookie = state.googleStudioCookie || '';
      const cookies = state.googleStudioCookies || [];
      const keys = state.apiKeys || [];
      
      console.log(`  -> Successfully parsed store (${encoding})!`);
      console.log(`     useMock: ${state.useMock}`);
      console.log(`     apiKey count: ${keys.length}`);
      console.log(`     googleStudioCookie length: ${cookie.length}`);
      console.log(`     googleStudioCookies count: ${cookies.length}`);
      
      foundStores.push({
        file: filePath,
        encoding,
        state,
        cookieLength: cookie.length,
        cookiesCount: cookies.length,
        keysCount: keys.length
      });
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    } catch (e) {
      // JSON parse error
    }
  }
}

async function main() {
  console.log('================================================================');
  console.log('🔍 SCANNINIG FOR NOVEL STORE EVERYWHERE IN CHROME AND WORKSPACE...');
  console.log('================================================================\n');

  const foundStores = [];
  
  console.log('[*] Scanning workspace (including chrome-profile-secure)...');
  scanDir(path.join(process.cwd(), 'scratch'), foundStores);
  
  console.log('\n[*] Scanning system Google Chrome directory...');
  scanDir(GOOGLE_CHROME_DIR, foundStores);

  console.log('\n================================================================');
  console.log(`📊 SCANNING COMPLETE. FOUND ${foundStores.length} STORE ENTRIES`);
  console.log('================================================================\n');

  // Filter entries with cookies
  const entriesWithCookies = foundStores.filter(e => e.cookieLength > 0 || e.cookiesCount > 0);
  console.log(`[!] Entries containing cookies: ${entriesWithCookies.length}`);
  
  if (entriesWithCookies.length > 0) {
    // Sort by cookie length descending
    entriesWithCookies.sort((a, b) => Math.max(b.cookieLength, b.cookiesCount) - Math.max(a.cookieLength, a.cookiesCount));
    const bestEntry = entriesWithCookies[0];
    console.log(`\n🎉 BEST ENTRY FOUND:`);
    console.log(`- File: ${bestEntry.file}`);
    console.log(`- Encoding: ${bestEntry.encoding}`);
    console.log(`- Cookie Length: ${bestEntry.cookieLength}`);
    console.log(`- Cookies Count: ${bestEntry.cookiesCount}`);
    
    // Save to scratch/saved_novel_store.json
    fs.writeFileSync(
      path.join(process.cwd(), 'scratch', 'saved_novel_store.json'),
      JSON.stringify({ state: bestEntry.state, version: 0 }, null, 2)
    );
    console.log(`\n💾 Saved best store state to scratch/saved_novel_store.json`);
  } else {
    console.log('\n[-] NO COOKIES FOUND IN CHROME OR WORKSPACE STORE ENTRIES!');
  }
}

main();
