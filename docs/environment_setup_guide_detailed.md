# Hướng dẫn thiết lập môi trường RPA ký sinh trình duyệt (chi tiết)

Nguồn: guide FlowAgent + map sang **AI Novel** (Node/Next, không Python).

---

## 1. OS & Browser

### Không dùng
- Headless Puppeteer/Selenium cho `labs.google`
- CDP / `--remote-debugging-port`

### Trình duyệt thật
Google Chrome · Mullvad/Firefox · **Ungoogled Chromium** (khuyến nghị) · Brave

### CLI flags bắt buộc (mỗi profile)

```bat
"<chrome.exe>" ^
  --user-data-dir="D:\My app\AI Novel\accounts_data\<accountId>" ^
  --load-extension="D:\My app\AI Novel\extensions\ainovel-flow" ^
  --disable-extensions-except="D:\My app\AI Novel\extensions\ainovel-flow" ^
  --no-first-run ^
  https://labs.google/fx/tools/flow
```

| Flag | Vai trò |
|------|---------|
| `--user-data-dir` | Hồ sơ trống, tách Chrome cá nhân → cookies Google của **1 account** |
| `--load-extension` | Nạp extension **unpacked** (không Web Store) |

AI Novel: `src/lib/flow-bridge/chromeSession.ts` (spawn, ghi `accounts_data/<id>/LAST_LAUNCH.cmd.txt`).

---

## 2. Backend (FlowAgent Python → AI Novel Node)

| Guide Python | AI Novel |
|--------------|----------|
| Python 3.10–3.13, venv | Node 18+, `npm run dev` |
| `websockets` **:9222** | `ws` **:9223** |
| HTTP (nếu có) | **:8101** |
| PySide6 | Next.js / Electron |
| aiohttp | fetch + fs |

```bash
npm run dev
# hoặc
npm run dev:desktop
```

---

## 3. Cấu trúc 3 phân khu

```text
AI Novel/
│
├── src/lib/flow-bridge/          # = core_backend/
│   ├── bridgeServer.ts           # WS :9223 + HTTP :8101
│   ├── chromeSession.ts          # subprocess browser + flags
│   ├── bootstrap.ts              # thứ tự khởi động
│   └── queueEngine.ts            # hàng đợi / multi-profile
│
├── extensions/ainovel-flow/      # = extension/ (nguồn shared)
│   ├── manifest.json
│   ├── background.js             # WS client, cướp Bearer, session
│   ├── content.js                # session từ tab cookies
│   └── injected.js               # captcha / MAIN world
│
├── accounts_data/                # = accounts_data/ (cookies)
│   ├── acc_xxxxx/                # Profile 1
│   │   ├── Default/              # Chrome profile data
│   │   ├── ACCOUNT_META.json
│   │   └── LAST_LAUNCH.cmd.txt   # lệnh CMD đã chạy
│   └── acc_yyyyy/                # Profile 2
│
├── data/flow-bridge/accounts.json
└── public/images|video/          # = output/
```

*(Legacy: `scratch/flow-profiles/` vẫn được nhận nếu đã có session.)*

---

## 4. Thứ tự khởi động (nghiêm ngặt)

### Bước 1 — Bật trạm WebSocket (trước browser)

```text
WS   127.0.0.1:9223
HTTP 127.0.0.1:8101
```

Tự động khi gọi `/api/flow/bootstrap` hoặc `/api/flow/status`.

```bash
curl http://127.0.0.1:8101/api/status
```

### Bước 2 — Backend gọi browser

UI: card profile → **Đăng nhập**  
API: `POST /api/flow/bootstrap` `{ "accountId": "...", "forceChrome": true }`

### Bước 3 — Extension nối ngược

```js
// background.js
const ws = new WebSocket("ws://127.0.0.1:9223");
// extension_ready | token_captured | session_poll
```

### Bước 4 — Sau login Google trên **cửa sổ app**

1. Token Bearer → bridge  
2. Session email (tab cookies) → card  
3. Đóng cửa sổ login (giữ Chrome nền nếu cần gen)

### Bước 5 — Debug

| | |
|--|--|
| Bridge | Terminal: `[FlowBridge] Extension connected`, `token captured` |
| Extension | Browser app → `chrome://extensions` → Inspect **service worker** |
| Tab | F12 trên Flow |
| CMD | `accounts_data/<id>/LAST_LAUNCH.cmd.txt` |

**Bắt buộc:** thấy extension **AI Novel Flow Bridge** trong `chrome://extensions` của **đúng** cửa sổ do app mở.

---

## 5. Checklist

| # | OK khi |
|---|--------|
| 1 | Bridge `running:true` |
| 2 | `extensionConnected:true` |
| 3 | `accounts_data/<id>` tồn tại sau Đăng nhập |
| 4 | Card **Token OK** / **Hoạt động** |
| 5 | Browser login tự đóng sau token |

---

## 6. Sự cố

| Hiện tượng | Xử lý |
|------------|--------|
| Mở browser, không nhận | `chrome://extensions` — extension chưa load → Ungoogled portable |
| Đã login, không đóng | Service worker log token? Restart app, Đăng nhập lại |
| Profile dùng chung | Mỗi account 1 folder `accounts_data/<id>` khác nhau |
| User tắt browser, app mở lại | Đã chặn relaunch khi process chết |
