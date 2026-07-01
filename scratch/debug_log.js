// eslint-disable-next-line @typescript-eslint/no-require-imports
const fs = require('fs');
// eslint-disable-next-line @typescript-eslint/no-require-imports
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const path = require('path');

const logFilePath = 'd:\\chuyen gia mac the app\\scratch\\chrome-profile-secure\\Default\\Local Storage\\leveldb\\000003.log';

function debug() {
  if (!fs.existsSync(logFilePath)) {
    console.error('File does not exist');
    return;
  }

  const content = fs.readFileSync(logFilePath);
  console.log('File size:', content.length, 'bytes');

  let idx = -1;
  while ((idx = content.indexOf('novel_generator_v2_store', idx + 1)) !== -1) {
    console.log(`\nFound occurrence at index ${idx}:`);
    
    // Get substring of 2000 bytes around the index
    const start = Math.max(0, idx - 100);
    const end = Math.min(content.length, idx + 4000);
    const sliced = content.slice(start, end);
    
    // Print first 500 characters of slice as UTF8
    console.log('--- Raw string context (first 500 chars) ---');
    console.log(sliced.toString('utf8', 0, 500));
    console.log('--------------------------------------------');
    
    // Check if it has a json-like structure
    const slicedStr = sliced.toString('utf8');
    const jsonStartIdx = slicedStr.indexOf('{');
    console.log('Has "{"?', jsonStartIdx !== -1, 'at sub-index', jsonStartIdx);
    
    if (jsonStartIdx !== -1) {
      // Find braces matching
      let braceCount = 0;
      let jsonEndIdx = -1;
      for (let i = jsonStartIdx; i < slicedStr.length; i++) {
        if (slicedStr[i] === '{') braceCount++;
        else if (slicedStr[i] === '}') {
          braceCount--;
          if (braceCount === 0) {
            jsonEndIdx = i + 1;
            break;
          }
        }
      }
      console.log('Matching brace found?', jsonEndIdx !== -1, 'at sub-index', jsonEndIdx);
      if (jsonEndIdx !== -1) {
        const rawJson = slicedStr.substring(jsonStartIdx, jsonEndIdx);
        console.log('Length of extracted raw JSON:', rawJson.length);
        try {
          const parsed = JSON.parse(rawJson);
          console.log('Successfully parsed JSON!');
          console.log('Keys in parsed:', Object.keys(parsed));
          if (parsed.state) {
            console.log('Keys in state:', Object.keys(parsed.state));
            console.log('useMock:', parsed.state.useMock);
            console.log('apiKey:', parsed.state.apiKey ? 'present' : 'absent');
            console.log('apiKeys count:', parsed.state.apiKeys?.length);
            console.log('googleStudioCookie length:', parsed.state.googleStudioCookie?.length);
            console.log('googleStudioCookies count:', parsed.state.googleStudioCookies?.length);
          }
        } catch (e) {
          console.error('Failed to parse extracted JSON:', e.message);
          console.log('Extracted raw JSON first 200 chars:', rawJson.substring(0, 200));
          console.log('Extracted raw JSON last 200 chars:', rawJson.substring(rawJson.length - 200));
        }
      }
    }
  }
}

debug();
