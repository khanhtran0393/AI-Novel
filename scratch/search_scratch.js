// eslint-disable-next-line @typescript-eslint/no-require-imports
const fs = require('fs');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const path = require('path');

const targetDir = 'd:\\chuyen gia mac the app\\scratch';
const files = fs.readdirSync(targetDir);

console.log('Searching for lorebook and memories in scratch files...');

for (const file of files) {
  if (file.endsWith('.js') || file.endsWith('.txt') || file.endsWith('.json') || file.endsWith('.py')) {
    const filePath = path.join(targetDir, file);
    try {
      // If file is too large (like recovered_compiled.js which is 12MB), we should search efficiently
      const stat = fs.statSync(filePath);
      if (stat.size > 20 * 1024 * 1024) continue; // Skip huge files

      const content = fs.readFileSync(filePath, 'utf8');
      
      const keywords = ['lorebook', 'Empathic Net', 'Neo-Veridia', 'Khải Đăng', 'Mạng Lưới Thấu Cảm', 'Mạng lưới hư vô'];
      for (const kw of keywords) {
        let idx = content.toLowerCase().indexOf(kw.toLowerCase());
        if (idx !== -1 && file !== 'search_scratch.js' && file !== 'search_all.js' && file !== 'search_lorebook.js') {
          console.log(`\n==================================================`);
          console.log(`FOUND '${kw}' in ${file} at index ${idx} (size: ${stat.size} bytes)`);
          console.log(`==================================================`);
          // Print surrounding text
          console.log(content.substring(Math.max(0, idx - 100), Math.min(content.length, idx + 1000)));
        }
      }
    } catch (e) {
      console.log(`Error reading ${file}:`, e.message);
    }
  }
}
