// eslint-disable-next-line @typescript-eslint/no-require-imports
const fs = require('fs');

const filePath = 'd:\\chuyen gia mac the app\\scratch\\recovered_compiled.js';
console.log('Searching in recovered_compiled.js...');

try {
  const content = fs.readFileSync(filePath, 'utf8');
  
  // Find INITIAL_LOREBOOK
  let idx = content.indexOf('INITIAL_LOREBOOK');
  while (idx !== -1) {
    console.log(`\nFound INITIAL_LOREBOOK at index ${idx}:`);
    console.log(content.substring(idx, idx + 1000));
    idx = content.indexOf('INITIAL_LOREBOOK', idx + 1);
  }

  // Find INITIAL_STATE
  let idxState = content.indexOf('INITIAL_STATE');
  while (idxState !== -1) {
    console.log(`\nFound INITIAL_STATE at index ${idxState}:`);
    console.log(content.substring(idxState, idxState + 1000));
    idxState = content.indexOf('INITIAL_STATE', idxState + 1);
  }
} catch (e) {
  console.error(e);
}
