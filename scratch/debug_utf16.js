// eslint-disable-next-line @typescript-eslint/no-require-imports
const fs = require('fs');

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
    
    // The value starts after the key 'novel_generator_v2_store'
    // In Chromium Local Storage LevelDB, the format is usually:
    // [Key] [some separator bytes] [Value]
    // The key 'novel_generator_v2_store' is stored in UTF-8 or UTF-16.
    // The value is stored in UTF-16LE.
    // Let's try slicing from the end of the key 'novel_generator_v2_store'
    const start = idx + 'novel_generator_v2_store'.length;
    
    // Let's find where the JSON starts. In UTF-16LE, '{' is 0x7B 0x00.
    // So we search for '{' in UTF-16LE (0x7B 0x00) or just check starting from start up to 20 bytes
    let jsonStart = -1;
    for (let i = start; i < start + 50; i++) {
      if (content[i] === 0x7B && content[i+1] === 0x00) {
        jsonStart = i;
        break;
      }
    }
    
    if (jsonStart === -1) {
      // Try searching for normal '{' (0x7B) just in case
      for (let i = start; i < start + 50; i++) {
        if (content[i] === 0x7B) {
          jsonStart = i;
          break;
        }
      }
    }

    console.log('Detected jsonStart at:', jsonStart);
    if (jsonStart !== -1) {
      // Let's slice a large chunk, e.g. 100KB or to the end of the file
      const sliced = content.slice(jsonStart);
      
      // Let's decode as UTF-16LE
      const decodedStr = sliced.toString('utf16le');
      console.log('Decoded context (first 200 chars):');
      console.log(decodedStr.substring(0, 200));
      
      // Now find matching braces in the decoded UTF-16LE string!
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
      
      console.log('Matching brace in UTF-16LE string found?', jsonEnd !== -1, 'at length', jsonEnd);
      if (jsonEnd !== -1) {
        const rawJson = decodedStr.substring(0, jsonEnd);
        try {
          const parsed = JSON.parse(rawJson);
          console.log('🎉 SUCCESSFULLY PARSED DECODED UTF-16LE JSON!');
          console.log('Keys in parsed:', Object.keys(parsed));
          if (parsed.state) {
            console.log('useMock:', parsed.state.useMock);
            console.log('apiKey:', parsed.state.apiKey ? 'present' : 'absent');
            console.log('apiKeys count:', parsed.state.apiKeys?.length);
            console.log('googleStudioCookie length:', parsed.state.googleStudioCookie?.length);
            console.log('googleStudioCookies count:', parsed.state.googleStudioCookies?.length);
            if (parsed.state.googleStudioCookies && parsed.state.googleStudioCookies.length > 0) {
              console.log('First cookie snippet:', parsed.state.googleStudioCookies[0].substring(0, 50));
            }
          }
        } catch (e) {
          console.error('Failed to parse decoded JSON:', e.message);
        }
      }
    }
  }
}

debug();
