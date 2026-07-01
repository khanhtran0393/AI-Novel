// Mở AI Studio bằng Chrome profile mặc định (đã đăng nhập sẵn)
import { exec } from 'child_process';

// Mở AI Studio API key page bằng Chrome của user
const chromeCmd = '"C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" "https://aistudio.google.com/apikey"';
console.log('Mở AI Studio trong Chrome mặc định...');
exec(chromeCmd, (err) => {
  if (err) console.log(`Lỗi: ${err.message}`);
});

console.log(`
╔══════════════════════════════════════════════════════╗
║  🔑 TẠO API KEY MỚI                                 ║
║                                                      ║
║  1. Chrome sẽ mở trang AI Studio API Keys            ║
║  2. Bấm "Create API Key"                             ║
║  3. Copy key (AIzaSy...)                              ║
║  4. Mình sẽ tự động lưu key vào file!                ║
║                                                      ║
╚══════════════════════════════════════════════════════╝
`);

// Chờ 30s rồi thoát
setTimeout(() => {
  console.log('Done! Hãy copy API key vào clipboard.');
  process.exit(0);
}, 3000);
