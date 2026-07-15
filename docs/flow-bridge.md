# Google Flow Bridge (AI Novel)

Cấu trúc gen ảnh/video mặc định theo mô hình **Google Flow Agent**: multi-account, queue, Chrome extension + local bridge.

Deep-dive map: [`flow-agent-architecture.md`](./flow-agent-architecture.md)  
**Environment setup (RPA ký sinh browser):** [`flow-environment-setup.md`](./flow-environment-setup.md)

## Kiến trúc

```
UI (Media Config / SceneCard)
  → POST /api/generate-image|video (provider=flow)
  → /api/flow/* (status, accounts, queue, connect)
  → src/lib/flow-bridge (HTTP :8101 + WS :9223)
  → extensions/ainovel-flow (Chrome MV3)
  → labs.google / aisandbox-pa.googleapis.com
```

| Cổng | Vai trò |
|------|---------|
| **9223** | WebSocket — extension kết nối bridge |
| **8101** | HTTP — API nội bộ + callback từ extension |

(Offset so với Flow Agent gốc 9222/8100 để tránh xung đột.)

## Chiến thuật trình duyệt (FlowAgent — không CDP)

Google Chrome mới **chặn `--load-extension`**. FlowAgent **không** dùng CDP / remote-debugging (labs.google fingerprint bot).

| Engine | Cách |
|--------|------|
| **Ungoogled / Chromium / Brave** (khuyến nghị) | CLI `--load-extension` ổn định |
| **Portable** | `tools/browsers/ungoogled-chromium/chrome.exe` |
| **Google Chrome** | Thường FAIL — chỉ fallback |
| **Mullvad/Firefox** | `--no-remote` + Load Temporary Add-on (path clipboard) |

Xem: [`tools/browsers/README.md`](../tools/browsers/README.md)

## Tự cấu hình

1. Bật bridge WS `:9223` + HTTP `:8101`
2. Resolve browser (**auto = Chromium sạch trước, Chrome sau**)
3. Mở browser + extension (hoặc hướng dẫn Mullvad)
4. User đăng nhập Google → token → **tự đóng** cửa sổ login

### Đăng nhập → nhận cookie/token → tự đóng phiên

1. App mở Chrome **hiển thị** (profile `scratch/flow-profiles/...`) + tab Flow  
2. User đăng nhập Google  
3. Extension bắt Bearer `ya29.*` (và session labs) → gửi bridge  
4. Bridge gọi `close_login_session` → minimize → **kill Chrome login**  
5. Relaunch Chrome **nền** (off-screen, cùng profile) để captcha/API vẫn chạy  

Không cần để cửa sổ Chrome hiện trên màn hình sau khi login xong.

### Cách kích hoạt

| Cách | Hành động |
|------|-----------|
| Mở app desktop | `main.js` → `POST /api/flow/bootstrap` sau 2.5s |
| Vào Workspace | `FlowAutoBootstrap` (1 lần / session) |
| Media Config | nút **Tự cấu hình tất cả** (force mở Chrome) |
| File bat | `KHOI_DONG_FLOW.bat` |

API: `POST /api/flow/bootstrap` body `{ forceChrome?: boolean }`

Profile Chrome riêng: `scratch/flow-profiles/<accountId>/` — login một lần, lần sau tái dùng.

## API nội bộ

| Method | Path | Mô tả |
|--------|------|--------|
| GET | `/api/flow/status` | Snapshot bridge + accounts |
| POST | `/api/flow/accounts` | `{ action: create\|delete\|patch, ... }` |
| POST | `/api/flow/connect` | `{ action: open_tab\|refresh, accountId? }` |
| POST | `/api/flow/queue` | `{ action: enqueue\|start\|stop\|clear, ... }` |
| POST | `/api/flow/generate-one` | Single image/video task |

## Provider mặc định

- `imageProvider: 'flow'`, `imageModel: 'GEM_PIX_2'`
- `videoProvider: 'flow'`, `videoModel: 'veo_3_1_t2v_fast_ultra'`
- Legacy: OpenAI / Grok / Gemini banana+whisk / API-key Veo vẫn chọn được trong dropdown.

## Lưu ý an toàn tài khoản

- Delay giữa task (mặc định 3–8s)
- Không spam multi-thread không proxy
- Token Bearer hết hạn ~1h → refresh tab Flow

## File chính

- `extensions/ainovel-flow/*`
- `src/lib/flow-bridge/*`
- `src/app/api/flow/*`
- `src/app/api/generate-image/providers/flow.ts`
- `src/app/workspace/features/media/FlowAccountsPanel.tsx`
