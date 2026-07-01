// eslint-disable-next-line @typescript-eslint/no-require-imports
const fs = require('fs');

const filePath = 'd:\\chuyen gia mac the app\\scratch\\recovered_compiled.js';
if (!fs.existsSync(filePath)) {
  console.log('recovered_compiled.js does not exist!');
  process.exit(1);
}

const buffer = fs.readFileSync(filePath);
console.log(`Successfully loaded recovered_compiled.js! Buffer size: ${buffer.length} bytes.`);

// Tìm parseScenes trong buffer
const term = Buffer.from('parseScenes');
let idx = buffer.indexOf(term);

if (idx === -1) {
  console.log('Term parseScenes not found in buffer!');
  process.exit(1);
}

console.log(`FOUND 'parseScenes' in compiled cache at byte offset ${idx}!`);

// Trích xuất 80,000 bytes xung quanh
const start = Math.max(0, idx - 5000);
const end = Math.min(buffer.length, idx + 75000);

const slice = buffer.slice(start, end);

// Làm sạch slice: loại bỏ các ký tự điều khiển phi tiêu chuẩn (chỉ giữ lại ký tự ASCII in được và tiếng Việt Unicode)
let cleaned = '';
for (let i = 0; i < slice.length; i++) {
  const code = slice[i];
  // Cho phép ký tự in được (32 - 126), tab (9), newline (10), carriage return (13)
  // và các ký tự Unicode UTF-8 hợp lệ (byte > 127)
  if ((code >= 32 && code <= 126) || code === 9 || code === 10 || code === 13 || code > 127) {
    cleaned += String.fromCharCode(code);
  } else {
    cleaned += ' '; // thay thế ký tự nhị phân bằng khoảng trắng
  }
}

// Ghi ra file text sạch để chúng ta có thể dễ dàng đọc mọi logic
fs.writeFileSync('d:\\chuyen gia mac the app\\scratch\\cleaned_compiled_extract.txt', cleaned);
console.log('Saved cleaned source code extract to: scratch/cleaned_compiled_extract.txt');

// Quét các hàm quan trọng trong đoạn text sạch này
const searchTerms = ['parseScenes', 'cleanVoiceScript', 'handleExpandScene', 'handlePlayTTS', 'getWordCount', 'copyToClipboard'];
for (const st of searchTerms) {
  const fIdx = cleaned.indexOf(st);
  if (fIdx !== -1) {
    console.log(`\n  >> Found '${st}' at clean index ${fIdx}`);
    console.log(cleaned.substring(fIdx - 200, fIdx + 1200));
  }
}
