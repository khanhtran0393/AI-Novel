const { app, BrowserWindow } = require('electron');
const { createServer } = require('http');
const { parse } = require('url');
const next = require('next');
const path = require('path');
const { execSync } = require('child_process');

function killProcessOnPort(port) {
  if (process.platform !== 'win32') return;
  try {
    const output = execSync(`netstat -ano | findstr :${port}`, { encoding: 'utf8' });
    const lines = output.split('\n');
    for (const line of lines) {
      if (line.includes('LISTENING')) {
        const parts = line.trim().split(/\s+/);
        const pid = parts[parts.length - 1];
        if (pid && parseInt(pid) > 0 && parseInt(pid) !== process.pid) {
          console.log(`[Startup Cleanup] Phát hiện tiến trình chiếm cổng ${port} (PID: ${pid}). Đang giải phóng...`);
          execSync(`taskkill /F /PID ${pid}`);
          console.log(`[Startup Cleanup] Đã giải phóng cổng ${port} thành công.`);
        }
      }
    }
  } catch (err) {
    // Không có tiến trình nào chiếm cổng
  }
}

// Tự động giải phóng cổng 3000 (cổng Next.js dev mặc định) để tránh xung đột cache biên dịch
killProcessOnPort(3000);

const dev = !app.isPackaged;
// The directory containing the Next.js app.
// In dev, it's the current directory. In prod, it's the app.getAppPath() 
// which is where the unpacked files are (asar is false).
const appDir = app.getAppPath();

// Khởi tạo Next.js App
const nextApp = next({ dev, dir: appDir });
const handle = nextApp.getRequestHandler();

let mainWindow;

app.whenReady().then(() => {
  // Chuẩn bị Next.js server
  nextApp.prepare().then(() => {
    // Tạo server HTTP nội bộ để serve giao diện Next.js
    const server = createServer((req, res) => {
      const parsedUrl = parse(req.url, true);
      handle(req, res, parsedUrl);
    });

    // Lắng nghe trên port ngẫu nhiên trống
    server.listen(0, () => {
      const port = server.address().port;
      console.log(`Next.js local server listening on http://localhost:${port}`);
      
      mainWindow = new BrowserWindow({
        width: 1400,
        height: 900,
        minWidth: 1024,
        minHeight: 768,
        title: "AI Novel & Script Generator",
        autoHideMenuBar: true, // Ẩn menu bar mặc định của Windows
        webPreferences: {
          nodeIntegration: false,
          contextIsolation: true
        }
      });

      // Mở trình duyệt trỏ vào server Next.js nội bộ
      mainWindow.loadURL(`http://localhost:${port}`);

      // Nếu đang trong môi trường dev, mở DevTools
      if (dev) {
        // mainWindow.webContents.openDevTools();
      }
    });
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    // Re-create window if necessary on macOS
  }
});
