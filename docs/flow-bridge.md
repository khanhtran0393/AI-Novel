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

> **CẤM** dùng browser ký sinh Flow để lấy phụ đề YouTube / Setup «viết lại tương tự».  
> Captions: `src/lib/youtubeSource.ts` (python → timedtext → yt-dlp). Flow browser chỉ cho Google Labs gen media.

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

1. App mở browser **hiển thị** (Brave / portable / Chromium sạch — **không** fallback Chrome ngầm) + 1 tab Flow  
2. User đăng nhập Google trên **cùng cửa sổ**  
3. Extension bắt Bearer `ya29.*` (và session labs) → gửi bridge  
4. Bridge gọi `close_login_session` → minimize → **kill login window**  
5. Relaunch **1 lần** browser nền (off-screen, cùng profile) — **single owner** `closeLoginSessionAfterCapture`  

**CẤM double-window:** extension chậm **không** kill+mở browser thứ 2; login **không** dùng `--new-window` (tránh cửa sổ trống); token capture **không** spawn nền lần 2 sau close.

Không cần để cửa sổ browser hiện trên màn hình sau khi login xong.

### Đóng app → tắt browser Flow

Chrome Flow spawn **detached** (gen không chết theo window). Khi **đóng Ai Novel**:

1. `main.js` `before-quit` / `quitAppFully` → `killFlowBrowsersOnAppQuit`  
2. Next process exit hooks → `killAllFlowBrowsers`  
3. Chỉ kill process có `--user-data-dir` dưới `accounts_data` / `scratch/flow-profiles` / `browser-profiles` (không đụng Chrome cá nhân)

Smoke: `npx tsx scripts/smoke-flow-browser-quit.mts`

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

## Google `/sorry/` (checkbox “Tôi không phải là người máy”)

Khác với **reCAPTCHA Enterprise invisible** (token API gen khi đã vào Labs):

| | Enterprise (API gen) | Trang `/sorry/` (chặn bot) |
|--|--|--|
| Khi nào | Tab Flow sạch, `grecaptcha.enterprise.execute` | Google risk → redirect `google.com/sorry` |
| App tự làm | Có (extension inject token) | **Có một phần:** đưa cửa sổ ra màn hình + auto-click checkbox + chờ tới 180s |
| Còn cần user | Không (khi session sạch) | Captcha **ảnh** / risk cao → tick tay trên cửa sổ Chromium |

Luồng: `queueEngine` → `resolve_google_challenge` + `open_flow_tab` → extension `resolveGoogleChallenge` (focus window, click `#recaptcha-anchor`, poll hết `/sorry/`) → rồi mới `solveCaptcha` Enterprise.

**Lưu ý:** Chrome for Testing / gen dày / IP risk dễ dính `/sorry/`. Giảm parallel, proxy per account, không minimize cửa sổ lúc đang chờ tick.

## Lưu ý an toàn tài khoản

- Delay giữa task (mặc định 3–8s)
- Không spam multi-thread không proxy
- Token Bearer hết hạn ~1h → refresh tab Flow

## Google Flow runtime standards (chuẩn app)

Áp dụng mặc định cho queue gen Google Labs (không clone Phoma; không UrbanVPN hard-depend; **B10** giữ cứng).

| Chuẩn | Hành vi | Module |
|-------|---------|--------|
| **Error taxonomy** | Map quota / 401 / captcha / rate / policy → message VN + gợi ý (không auto-đổi model) | `flowRuntimeErrors.ts` |
| **1 gen / account** | Parallel = nhiều account; không xếp 2 captcha cùng profile | `queueEngine` + `flowRuntimeRecycle` busy set |
| **Captcha serialize** | `extApiChain` + `captchaExtraGapMs` khi có `captchaAction` | `bridgeServer.requestViaExtension` |
| **Progress steps** | `queued→account→captcha→submit→poll→download→done` | `flowRuntimeSteps.ts` · task.`step` / `progressMessage` |
| **Jitter delay** | `delayMsMin..Max` + `runOneGapMs*` giữa shot | `config.FLOW_DEFAULTS` |
| **Recycle after success** | Soft: `refresh_flow_tab`; hard kill Chrome: ảnh mỗi N success; **video hard recycle default OFF** (tránh treo Electron mid-gen) | `flowRuntimeRecycle.ts` · ops |
| **Async video app path** | `POST /api/generate-video` Flow → **202** + `taskId`; client poll `GET /api/flow/task?id=&finalize=1`; recover `GET /api/video-artifact` | `videoModule` · `flowVideoFinalize` · queue `enqueueAndStart` |
| **Health** | Bridge `GET /api/health` (instant); Media Config Health strip (token age / cr / queue) | `bridgeServer` · `FlowAccountsPanel` |
| **Proxy** | **UI trên từng card** Media Config → Flow profile: ô «Proxy · profile này» → Lưu → **Mở lại browser**. Format `host:port` / `http://user:pass@host:port` / `socks5://…`. Fallback `ops.globalProxy`. **Không** Urban free / auto-xoay | `FlowAccountsPanel` · `resolveAccountProxy` · `launchChrome --proxy-server` |

Ops file `data/flow-bridge/ops.json`:

- `recycleAfterSuccess` (default **true**)
- `recycleEveryNSuccess` (default **3**, ảnh)
- `recycleEveryVideoSuccess` (default **false** — chỉ bật explicit `true`)

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
