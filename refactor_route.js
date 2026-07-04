const fs = require('fs');
const path = require('path');

const filePath = path.join('src', 'app', 'api', 'generate-tts', 'route.ts');
let code = fs.readFileSync(filePath, 'utf8');

// 1. Remove vieneu_tts block from TTS_PROVIDERS
const vieneuStart = code.indexOf('  vieneu_tts: {');
if (vieneuStart !== -1) {
  const nextProviderStart = code.indexOf('  capcut_tts: {', vieneuStart); // capcut is the next one or omnivoice
  if (nextProviderStart !== -1) {
    code = code.substring(0, vieneuStart) + code.substring(nextProviderStart);
  } else {
    // maybe it's the last one or before something else. Let's just find the next '  [a-z_]+: {'
    const regex = /\n  [a-z_]+: \{/g;
    regex.lastIndex = vieneuStart + 10;
    const match = regex.exec(code);
    if (match) {
      code = code.substring(0, vieneuStart) + code.substring(match.index + 1); // +1 for the \n
    }
  }
}

// 2. Remove || platform === 'vieneu_tts'
code = code.replace(/ \|\| platform === 'vieneu_tts'/g, '');

fs.writeFileSync(filePath, code);
console.log('Successfully updated route.ts');
