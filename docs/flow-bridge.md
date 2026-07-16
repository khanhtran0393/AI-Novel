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
| Mở app desktop | `main.js` → **chỉ** `GET /api/flow/status` (bật bridge, **không** mở Chrome) |
| Vào Workspace | `FlowAutoBootstrap` warm-up bridge only (1 lần / session) |
| Media Config | nút **Đăng nhập Google** / **Mở Chrome login** (user chủ động) |
| File bat | `KHOI_DONG_FLOW.bat` (nếu có force bootstrap) |

API: `POST /api/flow/bootstrap` body `{ forceChrome?: boolean }` — **chỉ gọi khi user bấm đăng nhập**.

### Project dropdown

Khi Bridge + Extension + Token xanh: UI cho **chọn project** hoặc **tạo project mới** (`POST /api/flow/projects` → tRPC `project.createProject`). Project id lưu `data/flow-bridge/`.

### Cookie vs Token

| | Vai trò |
|--|---------|
| **Cookie** Google session | Nằm trong profile browser; giúp trang Flow / reCAPTCHA / reload tab. **Không** phải đèn Token. |
| **Token** Bearer `ya29…` | Bắt từ header API; **dùng thật** khi gen ảnh/video qua bridge. |

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

- `imageProvider: 'flow'`, `imageModel: 'GEM_PIX_2'` (alias Nano Banana Pro; `NARWHAL` = Nano Banana 2)
- `videoProvider: 'flow'`, `videoModel: 'veo_3_1_t2v_fast'` (TIER_ONE-safe; ultra optional)
- **Duration Flow Veo:** `4 | 6 | 8` giây (default **8**). Không dùng 10s.
- **Scale:** native **720p**; HD/4K = `veo_3_1_upsampler_1080p` / `_4k` sau gen.
- **Credits (Pro @8s):** Lite≈10, Fast≈20, Quality≈100; Ultra Lite≈5 Fast≈10; `*_low_priority` / `*_relaxed` = 0 (tier-gated).
- **Families:** T2V · I2V (+ `_fl` first+last) · R2V/ingredients (`veo_3_1_r2v_*`) · Extend · Upsample. Matrix: `src/lib/flow-bridge/modelCatalog.ts` · `GET /api/flow/models`.
- Legacy: OpenAI / Grok / Gemini banana+whisk / API-key Veo vẫn chọn được trong dropdown.

## Lưu ý an toàn tài khoản

- Delay giữa task (mặc định 3–8s)
- Không spam multi-thread không proxy
- Token Bearer hết hạn ~1h → refresh tab Flow

## P0–P3 (Flow parity layer)

| Tier | Nội dung | Module / API |
|------|----------|--------------|
| **P0** | Model matrix + credit estimate; Ingredients-to-video (1–3 ref); Extend clip; quality default HD | `modelCatalog.ts`, `payloadBuilder` ingredients/extend, queue `videoMode` |
| **P1** | Auto upscale theo quality; light edit (base+prompt); camera structured | `cameraPrompt.ts`, quality presets, `buildImageEditBody` |
| **P2** | In-app Flow Agent chat → plan shots → enqueue queue; Agent Instructions | `flowAgent.ts`, `opsStore`, `/api/flow/agent`, `FlowAgentPanel` |
| **P3** | Health score, proxy, credit budget, auto-relogin on 401 | `accountStore` health/budget, queue pick + bootstrap re-login |

API: `GET/POST /api/flow/models` · `GET/POST /api/flow/ops` · `POST /api/flow/agent` · `GET/POST /api/flow/media-id`  
UI: Media Config → Flow Agent panel + model/quality/farm policy; account row HP · budget · proxy.

### Chuẩn B (creative UX) — đã wire

| Tính năng | Cách dùng |
|-----------|-----------|
| **Auto cast ingredients** | Gen ảnh/video: quét tên cast trong prompt → `face_ref` + concept `char_Name` (max 3) |
| **Extend trên shot** | Nút **⏩ Extend** cạnh Gen Video (khi đã có clip + mediaId) |
| **Agent → Studio** | Flow Agent: **Áp Studio** ghi prompt vào scene · **Enqueue Flow** + ingredients cast |
| **mediaId index** | `data/flow-bridge/media-index.json` + localStorage — Extend sau reload |

## File chính

- `extensions/ainovel-flow/*`
- `src/lib/flow-bridge/*`
- `src/app/api/flow/*`
- `src/app/api/generate-image/providers/flow.ts`
- `src/app/workspace/features/media/FlowAccountsPanel.tsx`
- `src/app/workspace/features/media/FlowAgentPanel.tsx`
