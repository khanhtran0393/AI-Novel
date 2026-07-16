# Môi trường RPA ký sinh trình duyệt (AI Novel ↔ FlowAgent)

Áp dụng đúng mô hình FlowAgent: **trình duyệt thật** + **extension unpacked** + **bridge local**.  
Stack AI Novel = **Node/Next** (không Python), cổng offset **9223 / 8101** (FlowAgent gốc 9222 / 8100).

**Bản chi tiết (guide đầy đủ):** [`environment_setup_guide_detailed.md`](./environment_setup_guide_detailed.md)

---

## 1. OS & Browser (bắt buộc)

### Không dùng

- Headless Puppeteer / Selenium cho `labs.google` (Google chặn)
- CDP / `--remote-debugging-port` (fingerprint bot)

### Trình duyệt thật (ưu tiên) — **không fallback Google Chrome**

| Ưu tiên | Engine | Ghi chú |
|--------|--------|--------|
| 1 | **Portable Chromium** | `tools/browsers/ungoogled-chromium/chrome.exe` |
| 2 | Brave / Chromium / Playwright sạch | Auto-detect |
| 3 | Mullvad / Firefox | Load Temporary Add-on tay |
| ✗ | Google Chrome gốc | **Cấm** khi `engine=auto` (chặn `--load-extension`) |

**Thiếu portable (thư mục `tools/browsers` trống):**  
`POST /api/flow/bootstrap` **tự tải** Chrome for Testing (~150MB) vào portable, hoặc nút app **«Cài browser gen ảnh»** / `POST /api/flow/install-browser`.

### CLI flags cốt lõi (mỗi profile)

```text
chrome.exe
  --user-data-dir="<ROOT>\scratch\flow-profiles\<accountId>\user-data"
  --load-extension="<ROOT>\scratch\flow-profiles\<accountId>\extension"
  --disable-extensions-except="<...>\extension"
  --no-first-run
  --no-default-browser-check
  https://labs.google/fx/tools/flow
```

| Flag | Ý nghĩa |
|------|---------|
| `--user-data-dir` | Hồ sơ **cô lập** (cookies Google) — 1 account = 1 dir |
| `--load-extension` | Nạp extension **unpacked** (không qua Web Store) |

App gọi qua `src/lib/flow-bridge/chromeSession.ts` (spawn, không shell).

---

## 2. Backend (AI Novel = Node, map Python FlowAgent)

| FlowAgent (Python) | AI Novel (Node) |
|--------------------|-----------------|
| Python 3.10–3.13 + venv | **Node 18+** (Next.js / Electron) |
| `websockets` **:9222** | `ws` **:9223** (`bridgeServer.ts`) |
| HTTP callback | HTTP **:8101** |
| PySide6 GUI | Next/Electron UI |
| aiohttp download | `fetch` + `fs` trong `queueEngine.ts` |

```bash
# Dev
npm run dev
# Desktop
npm run dev:desktop
```

Bridge tự bật khi gọi `/api/flow/*` hoặc bootstrap.

---

## 3. Cấu trúc thư mục (3 phân khu)

```text
AI Novel/
│
├── src/lib/flow-bridge/           # Phân khu 1: Orchestrator (Node)
│   ├── bridgeServer.ts            # WS :9223 + HTTP :8101
│   ├── chromeSession.ts           # Spawn browser + profile cô lập
│   ├── bootstrap.ts               # Thứ tự: WS → browser → chờ session
│   ├── queueEngine.ts             # Hàng đợi / round-robin profile
│   └── accountStore.ts            # accounts.json
│
├── extensions/ainovel-flow/       # Phân khu 2: Extension nguồn
│   ├── manifest.json
│   ├── background.js              # WS client, cướp Bearer, poll session
│   ├── content.js                 # Cầu nối + FETCH_SESSION (cookies tab)
│   └── injected.js                # MAIN world captcha / TRPC
│
├── scratch/flow-profiles/         # Phân khu 3: = accounts_data/
│   └── <accountId>/               # Profile_1, Profile_2, ...
│       ├── user-data/             # --user-data-dir (cookies)
│       ├── extension/             # copy unpacked --load-extension
│       └── ACCOUNT_META.json
│
├── data/flow-bridge/accounts.json # Metadata UI (email, credits, status)
├── public/images/  public/video/  # output
└── tools/browsers/                # Ungoogled portable (khuyến nghị)
```

| Guide FlowAgent | AI Novel |
|-----------------|----------|
| `core_backend/` | `src/lib/flow-bridge/` + `/api/flow/*` |
| `extension/` | `extensions/ainovel-flow/` (+ copy per profile) |
| `accounts_data/Profile_N` | `scratch/flow-profiles/<accountId>/` |
| `output/` | `public/images`, `public/video` |

---

## 4. Thứ tự khởi động (nghiêm ngặt)

### Bước 1 — Bật trạm WebSocket (trước browser)

```text
HTTP 127.0.0.1:8101
WS   127.0.0.1:9223
```

Tự động khi app/`ensureBridgeStarted()`. Kiểm tra:

```bash
curl http://127.0.0.1:8101/api/status
curl http://127.0.0.1:3000/api/flow/status
```

### Bước 2 — Python/Node ra lệnh gọi trình duyệt

UI: **Đăng nhập** trên card profile → `POST /api/flow/bootstrap` `{ accountId, forceChrome: true }`.

Tương đương CMD:

```bat
"<chrome.exe>" ^
  --user-data-dir="D:\My app\AI Novel\scratch\flow-profiles\acc_XXX\user-data" ^
  --load-extension="D:\My app\AI Novel\scratch\flow-profiles\acc_XXX\extension" ^
  --disable-extensions-except="D:\My app\AI Novel\scratch\flow-profiles\acc_XXX\extension" ^
  --no-first-run ^
  https://labs.google/fx/tools/flow
```

### Bước 3 — Extension nối ngược bridge

`background.js`:

```js
const ws = new WebSocket("ws://127.0.0.1:9223");
// hello / extension_ready / token_captured / session_poll
```

### Bước 4 — Sau Google login

1. `content.js` fetch `/fx/api/auth/session` **trong tab** (cookies thật)  
2. `webRequest` bắt `Authorization: Bearer …`  
3. Bridge nhận token → **đóng cửa sổ login** → Chrome nền (gen/captcha)  
4. Card hiện **Token OK** / **Hoạt động** + email/credits nếu đọc được  

### Bước 5 — Debug

| Vùng | Cách |
|------|------|
| Bridge | Terminal app: `[FlowBridge] Extension connected`, `token captured` |
| Extension | Browser app → `chrome://extensions` → Developer mode → **Inspect service worker** |
| Tab Flow | F12 → Network / Console (`content.js`) |

**Phải thấy** extension **AI Novel Flow Bridge** trong `chrome://extensions` của **đúng** cửa sổ app mở.  
Không thấy = `--load-extension` fail (đổi Ungoogled portable).

---

## 5. Checklist nhanh

| # | Hạng mục | OK khi |
|---|----------|--------|
| 1 | App/Node chạy | `:3000` |
| 2 | Bridge | `:8101/api/status` → `running:true` |
| 3 | WS | Extension connected |
| 4 | Profile dir | `scratch/flow-profiles/<id>/user-data` + `extension` |
| 5 | Login Google | Trên browser **app mở**, không Chrome cá nhân |
| 6 | Token | Bridge log `Bearer token captured` |
| 7 | UI | Card **Token OK** / **Hoạt động**, browser login đóng |
| 8 | Email/credits | Sau **Check** (best-effort từ session tab) |

---

## 6. Lệnh một phát

```bat
npx tsx scripts/check-flow-env.mts
npx tsx scripts/emp-flow-live.mts
```

Hoặc `KHOI_DONG_FLOW.bat` nếu có.

---

## 7. Sự cố thường gặp

| Hiện tượng | Nguyên nhân | Xử lý |
|------------|-------------|--------|
| Mở browser mãi, app không nhận | Extension không load / không nối WS | `chrome://extensions` trong **cửa sổ app** |
| Đã login Google, không đóng browser | Token không về bridge | Inspect service worker → log token/session |
| Token OK nhưng không email | Session cookie chỉ có ở tab | **Check**; content.js harvest tab |
| User tắt browser, app mở lại | Retry bootstrap | Đã chặn relaunch khi browser đóng |
| Profile dùng chung cookies | Sai user-data-dir | Mỗi card: `…/flow-profiles/<id>` khác nhau |
