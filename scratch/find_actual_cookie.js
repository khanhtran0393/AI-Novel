// eslint-disable-next-line @typescript-eslint/no-require-imports
const fs = require('fs');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const path = require('path');

const storePath = path.join(process.cwd(), 'scratch', 'saved_novel_store.json');

function find() {
  if (!fs.existsSync(storePath)) {
    console.error('saved_novel_store.json not found');
    return;
  }

  const store = JSON.parse(fs.readFileSync(storePath, 'utf8'));
  const cookies = store.state?.googleStudioCookies || [];
  console.log(`Total entries in saved_novel_store.json: ${cookies.length}`);

  let found = false;
  let index = 0;
  for (const c of cookies) {
    index++;
    // A real cookie list is a string with no newlines, containing '__Secure-1PSID=' and starts with or contains '__Secure-' or 'SID='
    if (typeof c === 'string' && 
        !c.includes('\n') && 
        !c.includes('\r') && 
        !c.includes('{') && 
        !c.includes('File') &&
        !c.includes('\\') &&
        c.includes('__Secure-1PSID=') && 
        c.length > 500) {
      
      console.log(`\n[+] Found REAL Browser Cookie at index ${index}! Length: ${c.length}`);
      console.log('Snippet:', c.substring(0, 150));
      
      // Save this real cookie as the main googleStudioCookie and googleStudioCookies
      store.state.googleStudioCookie = c;
      store.state.googleStudioCookies = [c];
      fs.writeFileSync(storePath, JSON.stringify(store, null, 2), 'utf8');
      console.log('💾 SUCCESSFULLY SAVED THE ACTUAL REAL BROWSER COOKIE!');
      found = true;
      break;
    }
  }
  
  if (!found) {
    console.log('\n[-] No real Google session cookie was found under strict criteria.');
    // Let's print the length and a snippet of some candidate strings that don't have newlines
    console.log('\nCandidates with no newlines and length > 100:');
    let candidateCount = 0;
    for (const c of cookies) {
      if (typeof c === 'string' && !c.includes('\n') && c.length > 100) {
        candidateCount++;
        console.log(`Candidate #${candidateCount}: length=${c.length}, snippet="${c.substring(0, 100)}..."`);
      }
    }
  }
}

find();
