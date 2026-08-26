// Đọc key từ localStorage của cửa sổ Nova chính (pexels-key, pixabay-key, api_key...).
const { BrowserWindow } = require('electron');
async function novaLocalStorage(key) {
  for (const w of BrowserWindow.getAllWindows()) {
    try {
      const url = w.webContents.getURL();
      if (/index\.html|127\.0\.0\.1|localhost/i.test(url)) {
        const v = await w.webContents.executeJavaScript(`localStorage.getItem(${JSON.stringify(key)})`);
        if (v) return String(v).trim();
      }
    } catch (_) {}
  }
  return null;
}
module.exports = { novaLocalStorage };
