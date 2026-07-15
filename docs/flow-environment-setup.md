# Thiết lập môi trường RPA ký sinh trình duyệt (Flow / AI Novel)

Áp dụng từ `environment_setup_guide.md` (FlowAgent) vào stack **AI Novel**  
(Backend = **Node/Next**, không Python; cùng mô hình Extension + WebSocket + profile cô lập).

> **Không** dùng Headless Puppeteer/Selenium cho labs.google.  
> **Không** CDP / `--remote-debugging-port` (dễ bị fingerprint bot).  
> **Ưu tiên** Ungoogled Chromium / Brave portable — Chrome Google 120+ hay chặn `--load-extension`.

---

## 1. OS & Browser

### Trình duyệt thật

| Ưu tiên | Browser | Ghi chú |
|--------|---------|---------|
| 1 | **Ungoogled Chromium portable** | `tools/browsers/ungoogled-chromium/chrome.exe` |
| 2 | Brave / Chromium hệ thống | Auto-detect |
| 3 | Google Chrome | Thường **fail** load-extension |
| 4 | Mullvad / Firefox | Load Temporary Add-on tay |

### CLI flags bắt buộc (Chromium)

```text
--user-data-dir="<PROJECT>\scratch\flow-profiles\<accountId>"
--load-extension="<PROJECT>\extensions\ainovel-flow"
https://labs.google/fx/tools/flow
```

- `user-data-dir`: profile **cô lập** (cookies/cache account), không đụng Chrome cá nhân.
- `load-extension`: nạp extension unpacked (không qua Web Store).

App gọi sẵn qua `src/lib/flow-bridge/chromeSession.ts` + `browserResolver.ts`.

### Portable Ungoogled (khuyến nghị)

Xem [`tools/browsers/README.md`](../tools/browsers/README.md):

```text
tools/browsers/ungoogled-chromium/chrome.exe
```

---

## 2. Backend (AI Novel = Node, không Python)

| FlowAgent guide | AI Novel |
|-----------------|----------|
| Python 3.10–3.13 + venv | **Node 18+** (Next.js / Electron) |
| `websockets` port **9222** | `ws` port **9223** (`src/lib/flow-bridge/bridgeServer.ts`) |
| HTTP callback (nếu có) | HTTP **8101** |
| PySide6 GUI | Next/Electron UI |
| aiohttp download | `fetch` + `fs` trong `queueEngine.ts` |

Bridge **tự bật** khi gọi `/api/flow/*` hoặc bootstrap desktop (`main.js`).

---

## 3. Cấu trúc thư mục (map 3 phân khu)

```text
AI Novel/
│
├── src/lib/flow-bridge/          # Phân khu 1: Backend orchestrator (Node)
│   ├── bridgeServer.ts           # WS :9223 + HTTP :8101
│   ├── queueEngine.ts            # Hàng đợi, face-lock, retry/slide
│   ├── chromeSession.ts          # Spawn browser + profile
│   ├── browserResolver.ts        # Ungoogled / Brave / Chrome / Mullvad
│   └── bootstrap.ts              # Thứ tự khởi động
│
├── extensions/ainovel-flow/      # Phân khu 2: Extension (ký sinh)
│   ├── manifest.json
│   ├── background.js             # WS client, cướp Bearer ya29
│   ├── content.js
│   └── injected.js               # MAIN world captcha + TRPC sniff
│
├── scratch/flow-profiles/        # Phân khu 3: Profile cô lập (= accounts_data)
│   └── <accountId>/              # Cookies, cache từng account
│
├── data/flow-bridge/             # accounts.json metadata
├── public/images/  public/video/ # Output gen
├── image_output/   veo_output/   # Mirror kiểu FlowAgent
└── tools/browsers/               # Portable Ungoogled (khuyến nghị)
```

| Guide FlowAgent | AI Novel |
|-----------------|----------|
| `core_backend/` | `src/lib/flow-bridge/` + `/api/flow/*` |
| `extension/` | `extensions/ainovel-flow/` |
| `accounts_data/Profile_N` | `scratch/flow-profiles/<accountId>` |
| `output/` | `public/images`, `public/video`, `image_output`, `veo_output` |

---

## 4. Thứ tự khởi động (bắt buộc)

### Bước 1 — Bật bridge (trạm WebSocket)

Tự động khi:

```bash
# Dev
npm run dev
# hoặc desktop
npm run dev:desktop
# / Khoi_Dong_App.bat
```

Hoặc kiểm tra:

```bash
curl http://127.0.0.1:8101/api/status
curl http://127.0.0.1:3000/api/flow/status
```

Extension kết nối: `ws://127.0.0.1:9223` (trong `background.js`).

### Bước 2 — Mở browser + load extension + profile

```bash
# Qua API (app đang chạy)
curl -X POST http://127.0.0.1:3000/api/flow/bootstrap ^
  -H "Content-Type: application/json" ^
  -d "{\"forceChrome\":true,\"engine\":\"auto\"}"
```

Hoặc UI: **Ảnh / Video** → Engine **Auto / Ungoogled** → **Đăng nhập Google**.

CLI tương đương (Chromium sạch):

```bat
"<chrome.exe>" --user-data-dir="D:\My app\AI Novel\scratch\flow-profiles\Profile_1" --load-extension="D:\My app\AI Novel\extensions\ainovel-flow" https://labs.google/fx/tools/flow
```

### Bước 3 — Extension nối backend

`background.js` → `WebSocket("ws://127.0.0.1:9223")` → `extension_ready` / `token_captured`.

Sau login Google: bắt `Authorization: Bearer ya29...` → app **tự đóng** cửa sổ login, giữ browser nền.

### Bước 4 — Kiểm tra môi trường (script)

```bash
npx tsx scripts/check-flow-env.mts
npx tsx scripts/emp-flow-live.mts
```

### Bước 5 — Debug extension

1. Mở **đúng** cửa sổ browser do app spawn (profile `flow-profiles`).
2. Vào `chrome://extensions` → bật **Developer mode**.
3. Tìm **AI Novel Flow Bridge** → **Inspect views: service worker**.
4. Console: log `[AI Novel Flow] Connected to bridge` + token.
5. F12 trên tab Flow: log content/injected.

Nếu **không thấy** extension trong `chrome://extensions` → browser đang chặn load-extension (đổi sang Ungoogled portable).

---

## 5. Checklist nhanh

| # | Hạng mục | OK khi |
|---|----------|--------|
| 1 | Node app chạy | `:3000` response |
| 2 | Bridge | `:8101/api/status` → `running:true` |
| 3 | Extension files | `extensions/ainovel-flow/manifest.json` |
| 4 | Browser sạch | `tools/browsers/.../chrome.exe` hoặc Brave |
| 5 | Profile dir | `scratch/flow-profiles/<id>` |
| 6 | Extension connected | status `extensionConnected:true` |
| 7 | Token | `flowKeyPresent:true` |
| 8 | Gen | `/api/generate-image` provider `flow` |

---

## 6. Lệnh một phát

```bat
REM Kiểm tra + in báo cáo môi trường
npx tsx scripts/check-flow-env.mts

REM Bootstrap live (cần app :3000)
npx tsx scripts/emp-flow-live.mts
```

Hoặc double-click: `KHOI_DONG_FLOW.bat` (app + bootstrap).
