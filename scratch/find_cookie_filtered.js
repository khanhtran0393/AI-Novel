// eslint-disable-next-line @typescript-eslint/no-require-imports
const fs = require('fs');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const path = require('path');

const storePath = path.join(process.cwd(), 'scratch', 'saved_novel_store.json');

function filter() {
  if (!fs.existsSync(storePath)) {
    console.error('saved_novel_store.json not found');
    return;
  }

  const store = JSON.parse(fs.readFileSync(storePath, 'utf8'));
  const cookies = store.state?.googleStudioCookies || [];
  console.log(`Total candidates: ${cookies.length}`);

  let matchIndex = 0;
  for (let i = 0; i < cookies.length; i++) {
    const c = cookies[i];
    if (typeof c !== 'string') continue;
    
    // Check if it is a real cookie candidate
    // A real cookie usually has multiple key-value pairs separated by semicolons
    // and doesn't contain standard code strings like "Created At:", "replace_file_content", "const fs", "import", "public", etc.
    const isCode = c.includes('Created At:') || c.includes('Completed At:') || c.includes('File Path:') || 
                   c.includes('const ') || c.includes('import ') || c.includes('replace_file_content') || 
                   c.includes('useNovelStore') || c.includes('public') || c.includes('class') || 
                   c.includes('function') || c.includes('=>') || c.includes('React') || c.includes('state') ||
                   c.includes('**') || c.includes('```');

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const hasSemicolon = c.includes(';');
    const isLong = c.length > 100;

    if (!isCode && isLong) {
      matchIndex++;
      console.log(`\n[+] Candidate #${matchIndex} (Original index ${i + 1}, length ${c.length}):`);
      console.log('Snippet (150 chars):', c.substring(0, 150));
      console.log('Contains __Secure-1PSID?', c.includes('__Secure-1PSID'));
      console.log('Contains __Secure-3PSID?', c.includes('__Secure-3PSID'));
      console.log('Contains SID?', c.includes('SID='));
      
      // Let's write the best one to a separate file or save it
      if (c.includes('__Secure-1PSID') || c.includes('__Secure-3PSID')) {
        console.log('🎉 THIS LOOKS LIKE AN ACTUAL BROWSER COOKIE!');
        
        // Save it!
        store.state.googleStudioCookie = c;
        store.state.googleStudioCookies = [c];
        fs.writeFileSync(storePath, JSON.stringify(store, null, 2), 'utf8');
        console.log('💾 Successfully saved best candidate to saved_novel_store.json!');
        return;
      }
    }
  }
  console.log('\nDone scanning candidate list.');
}

filter();
