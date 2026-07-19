# ⚔️ QUY LUẬT THÉP & SỰ THẬT HIỂN NHIÊN

> **Status: LOCKED** — cập nhật theo code runtime **2026-07-19**  
> **Đọc trước khi build tiếp.** Nguồn chân lý ngắn gọn cho agent/dev.  
> Giải phẫu đầy đủ: [`AGENTS.md`](../AGENTS.md) · Domain: [`DOMAIN_MAP.md`](./DOMAIN_MAP.md) · Commercial: [`COMMERCIAL.md`](./COMMERCIAL.md)  
> Máy đọc được: `src/contracts/*` · Reset: [`RESET_POINT.md`](./RESET_POINT.md) · `MEMORY.md`

---

## A. SỰ THẬT HIỂN NHIÊN (đã đúng trong code — không “đoán lại”)

### A1. Engine AI Novel = native TypeScript in-process

| Sự thật | Bằng chứng / path |
|--------|-------------------|
| Tab AI Novel chạy **native-ts**, không proxy | `src/lib/novel-engine/*` + `src/app/api/ainovel/*` |
| **Không** phụ thuộc `ainovel-gui.exe` | `capabilities.ts` → `dependsOnAinovelGui: false` |
| **Không** phụ thuộc port `:8080` | `dependsOnPort8080: false` · `runner.ts` |
| Disk root engine | `.ainovel-app/` (checkpoints, progress, diag) |
| Sync 2 chiều | Zustand durable ↔ disk qua `storeBridge` / `diskStore` |
| Routes | start, stop, resume, status, stream, config, chapters, diag, capabilities, download-all |

**Hệ quả:** Không wire lại Go GUI, không spawn `ainovel-gui`, không `fetch('http://localhost:8080')` cho viết truyện.  
Folder `ainovel-cli-main/` chỉ là di sản — **không** là runtime app.

### A2. NAV = `python_core` gateway + host-binding

| Sự thật | Bằng chứng / path |
|--------|-------------------|
| Mọi NAV action qua `callNavGateway` | `src/lib/nav/navPythonBridge.ts` |
| Script gateway | `python_core/gateway/nav_gateway.py` |
| Host-binding | `src/lib/nav/hostBinding.ts` + `python_core/ainovel_host_guard.py` |
| Mặc định | `AINOVEL_HOST_BINDING=enforce` — CLI standalone từ chối |
| **Không** dùng `NAVTools.exe` | `dependsOnNavToolsExe: false` |
| HTTP | `/api/navtools/*` |

**Hệ quả:** Thêm tool NAV = action trong gateway Python + type `NavGatewayAction`. Không mang binary NAVTools ngoài repo. Không bẻ host-guard production.

### A3. State = Zustand + persist (hydration thực tế)

| Sự thật | Bằng chứng / path |
|--------|-------------------|
| Store trung tâm | `src/store/useNovelStore.ts` + slices |
| `isHydrated` **mặc định `true`** | `novelInitialState.ts` — tránh kẹt màn «Đang nạp…» |
| Rehydrate | Chạy nền (localStorage + durable Electron); failsafe force-hydrate nếu cần |
| Selectors plan | `selectIsPro` / `selectIsVip` / `selectIsTrial` |

**Hệ quả:**

- **Không** re-introduce spinner chặn cả workspace vì `isHydrated === false`.
- Vẫn partialization credentials; không nhét blob secret thô.
- Plan commercial sync qua `useEntitlementSync` (boot + focus).

### A3a. Làm Mới Dự Án = blank canvas + giữ cài đặt (LOCKED)

| Sau reset | Giá trị |
|-----------|---------|
| Tên tác phẩm | `''` |
| Lorebook | `''` → UI «Chưa có Lorebook.» |
| Danh sách chương | `[]` |
| Media maps | `{}` |
| API keys / Settings / TTS / media / paths / entitlement | **Giữ nguyên** |

Spec: [`RESET_POINT.md`](./RESET_POINT.md) · `PROJECT_RESET_POINT` + `resetStore()` + `projectResetEpoch`.

**CẤM** nhồi lại lore mặc định, «Dự án mới», hoặc Ch.1/Ch.2 sau Làm Mới.

### A3b. Boot ban đầu (chưa Làm Mới) ≠ sau reset

| Field | Boot `INITIAL_STATE` | Sau Làm Mới |
|-------|----------------------|-------------|
| `giai_doan` | `2` (workspace) | `1` setup-ready canvas |
| `ten_tac_pham` | `'Dự án mới'` | `''` |
| `danh_sach_chuong` | Ch.1 + Ch.2 empty | `[]` |
| `lorebook` | `INITIAL_LOREBOOK` trung tính | `''` |
| `setup.chu_de` / `phong_cach` | `''` / `''` | vẫn trống nếu chưa chọn |

### A3c. Contracts = từ điển hàm / key / API

| Hạng mục | Nguồn |
|----------|--------|
| Asset key store | `sceneAssetKey` / `imageAssetKey` / `videoAssetKey` / `characterImageKey` |
| File đĩa | `localAudioFilename` / `localImageFilename` / `localVideoFilename` / … |
| HTTP path | `API.*` trong `apiMap.ts` |
| requestType | `GENERATE_REQUEST_OWNERS` |
| Chapter DTO | `contracts/story.ts` |
| Glossary | `src/contracts/GLOSSARY.md` |

**CẤM** invent key/URL song song.

### A4. Domain ownership (logical — không mass-move folder)

```
script | tts | media-image | media-video | youtube | channels
toolbox-labs | ainovel-engine | credentials | export
```

- Map: [`DOMAIN_MAP.md`](./DOMAIN_MAP.md) + `src/contracts/domainOwnership.ts`
- Cross-domain **chỉ** `@/contracts` hoặc HTTP
- `features/A` **không** import sâu `features/B`

### A5. Tích hợp = logic ngầm (không nút 1-click gộp pipeline)

User bấm từng bước: **Gen Prompt → Gen ảnh → Gen Video → TTS → Ship/CapCut**.  
Logic ngầm (FableCut, Seedance, psych SEO, pipeline quality…) chạy **sau** từng bước.

Chi tiết: [`integrations-hub.md`](./integrations-hub.md) · code pipeline: `src/lib/pipeline/*`.

### A6. Commercial / entitlement (Free · Trial · Pro · VIP)

| Mode | Ý nghĩa |
|------|---------|
| `AINOVEL_ENTITLEMENT_MODE=open` | **Dev/web mặc định** — Pro routes cho phép |
| `=enforce` | Token HMAC + HWID **hoặc** trial active; fail-closed secret yếu |
| Electron **packaged** | Nếu env chưa set → **`enforce`** (`main.js`) |

| Store | Ý nghĩa |
|-------|---------|
| `is_vip` | VIP / unlimited |
| `is_pro` | Mở quyền Pro-equivalent (kể cả trial set true) |
| `is_trial` | Đang trial — **badge UI = TRIAL**, không gộp PRO trả phí |
| `credits` | Free hữu hạn; trial ~50k; paid unlimited |

**Badge Header** (ưu tiên): **VIP → TRIAL → PRO → FREE**.

Server `assertProAccess` trên: `generate-video`, `export-capcut`, `ship-pack`, `integrations/pipeline`.

Ma trận: `src/lib/commercial/featureMatrix.ts` · docs: [`COMMERCIAL.md`](./COMMERCIAL.md).

### A7. Media binaries trong repo

| Binary | Path kỳ vọng |
|--------|----------------|
| FFmpeg | `bin/ffmpeg.exe` (và/hoặc `python_core/ffmpeg/`) |
| Piper TTS | `bin/piper/piper.exe` |
| Edge TTS | chỉ khi user **chọn** `platform === 'edge_tts'` |
| CapCut desktop | optional — thiếu → **báo lỗi**, không nhảy Edge |
| Chromium (Flow) | portable / install-browser — **không** auto Chrome hệ thống |

### A8. Defaults media / TTS (store)

| Field | Default |
|-------|---------|
| `imageProvider` / `videoProvider` | `flow` / `flow` |
| `imageModel` | `GEM_PIX_2` |
| `videoModel` | `veo_3_1_t2v_fast` |
| `videoDuration` | `8` (4 \| 6 \| 8) |
| `wpm` / `secondsPerBeat` | `140` / `6` |
| `ttsConfig.platform` | `vina_voice` |
| Flow WS / HTTP | **9223** / **8101** |

### A9. Setup genre bắt buộc

- `setup.chu_de` + `setup.phong_cach` bắt buộc cho write / gen prompt / engine.
- Thiếu → **400 / throw** — **không** default mạt thế.
- Helpers: `src/lib/storyWriting.ts` · engine: `projectContext.setupGenrePayload()`.

### A10. Vietnamese text

Mọi chuỗi hiển thị / so khớp tên NV: **`.normalize('NFC')`**.

---

## B. QUY LUẬT THÉP (cấm vi phạm khi build tiếp)

### B1. AI Novel engine

1. **CẤM** gắn lại `ainovel-gui.exe` / proxy `:8080`.
2. API engine chỉ `/api/ainovel/*`; logic `lib/novel-engine/*`.
3. Diag = read-only; không “sửa truyện” qua diag.

### B2. NAV / Python

1. **CẤM** phụ thuộc `NAVTools.exe` ngoài project.
2. Gateway thiếu → fail rõ, không silent fallback.
3. Host-binding enforce: không bẻ guard để chạy CLI toolbox standalone trên máy khách.
4. Puppeteer (+ `music-metadata`) **phải** trong `serverExternalPackages` (`next.config.ts`).

### B3. Domain & module

1. Không mass-move cây folder “cho đẹp”.
2. UI: `features/*` · hooks: `hooks/*` · business: `modules/*` · shared logic: `lib/*`.
3. Feature lớn: `specs/*/spec.md` + `plan.md` (constitution).

### B4. Zustand / persist

1. Không chặn workspace bằng `isHydrated === false` giả.
2. Persist partialization: credentials tách; Làm Mới dùng `projectResetEpoch`.
3. Plan: `setVipStatus(vip, pro, trial?)` — trial path `(false, true, true)`.

### B5. TTS multi-voice cast

Nguồn: `src/lib/voiceCast.ts` + `docs/design-multi-character-voice-cast.md`

1. Gate `shouldUseCastMulti`: global **chỉ** `ttsConfig` (voice/speed/pitch) — **CẤM** `sceneEmotion` trong gate.
2. Multi path: pitch base = role/seg; **CẤM** cộng `emotionPitchOffset(sceneEmotion)` global.
3. `sceneEmotion` chỉ single-voice legacy.
4. Post-FX speed/pitch **theo segment**.
5. Text override segment: mặc định **tắt**.

### B6. Gen ảnh / storyboard

1. Cảnh >100 ký tự → split `,` / `，` / `-`, vế không <40 ký tự.
2. Character consistency: tên → identity EN từ roster + face_ref/ingredients.
3. Timestamp: TTS thật nếu có (`generatedAudioPaths`), không bịa giây.
4. Worker browser profile tạm → **`fs.rmSync` trong `finally`**.
5. Seedance sequence fail → **502**, không skip im lặng.
6. **CẤM** `duration || 5` / `beat || 6` im lặng.

### B7. UI workspace

1. Layout **3:7** (sidebar : content).
2. Premium gen: emerald/amber nổi.
3. Lightbox: `z-[100]`, blur, click đóng.
4. Không modal che nav cốt lõi.
5. Badge gói: VIP → TRIAL → PRO → FREE (đúng `is_trial`).

### B8. Tích hợp / ship

1. Không nút “chạy cả pipeline một phát”.
2. Ship/CapCut resolve path đĩa thật.
3. YouTube SEO: `youtubePsych55` — không hardcode 1 template chết.

### B9. Zero-Trust khi sửa code

1. Không phá module đang chạy tốt; feature mới modular.
2. Trước báo xong: lệnh thật (`typecheck`, `smoke:*`, verify domain) + log terminal.
3. Output media (mp3/mp4/png) phải **tồn tại trên đĩa** nếu task gen media.

### B10. CẤM FALLBACK NỘI DUNG / LOGIC

**Nguyên tắc:** Lỗi hiện thẳng — không “cứu” bằng đường vòng che hỏng.

| Được phép | Cấm tuyệt đối |
|-----------|----------------|
| **Xoay API key** cùng provider | Đổi platform/engine/provider khi fail |
| Retry cùng endpoint / model / voice | Gen mẫu / demo / heuristic thay API |
| Hard-fail + message hành động | Soft-success / fake media |
| | CapCut → Edge; Flow → Gemini ngầm |
| | Local director fill khi AI fail |
| | Genre mạt thế default; `|| 5` duration |
| | Auto browser → Google Chrome khi cần Chromium sạch |
| | Trial badge gộp thành PRO trả phí |

**Checklist sửa code:**

1. `catch` → rethrow / error JSON thật — không `ok + fake`.
2. Không `edge_tts` trừ khi `platform === 'edge_tts'`.
3. Không swap `imageProvider` khi provider user chọn fail.
4. Browser `auto`: chỉ Chromium sạch.
5. Comment `// fallback to X` cho **nội dung** = vi phạm.

---

## C. BẢNG CHỐNG NHẦM

| Nhầm lẫn phổ biến | Sự thật |
|-------------------|---------|
| “Phải bật ainovel-gui :8080” | Engine native; GUI Go không phải runtime |
| “NAVTools.exe là dependency” | Chỉ `nav_gateway.py` + host-binding |
| “isHydrated mặc định false, chặn UI” | Mặc định **true**; rehydrate nền |
| “Trial trên header hiện PRO” | Badge **TRIAL** khi `is_trial` |
| “Gộp Prompt+Ảnh+Video+TTS 1 nút” | Cấm |
| “sceneEmotion multi-gate” | Cấm — chỉ ttsConfig |
| “Import chéo features” | Chỉ contracts/API |
| “CapCut fail → Edge” | Cấm |
| “Packaged vẫn open Pro” | Packaged mặc định **enforce** |
| “Mass-move folder domain” | Ownership logical |

---

## D. CHECKLIST 30 GIÂY

- [ ] Có chạm `ainovel-gui` / `:8080`? → rollback
- [ ] Cross-domain lậu? → contracts/API
- [ ] Hardcode mạt thế / local prompt fill?
- [ ] Setup genre có truyền write/gen/engine?
- [ ] TTS multi dính `sceneEmotion`?
- [ ] Duration/beat hard-fail (không `|| 5`)?
- [ ] Trial badge = TRIAL khi trial?
- [ ] NFC chuỗi VN?
- [ ] Worker `finally` cleanup?
- [ ] Đã chạy smoke/typecheck/verify domain?

---

## E. CON TRỎ CHI TIẾT

| Chủ đề | File |
|--------|------|
| Giải phẫu đầy đủ | `AGENTS.md` |
| Domain ownership | `docs/DOMAIN_MAP.md`, `src/contracts/domainOwnership.ts` |
| Commercial | `docs/COMMERCIAL.md`, `src/lib/commercial/*`, `src/lib/entitlement.ts`, `src/lib/cloud/*` |
| Reset | `docs/RESET_POINT.md` |
| Native engine | `src/lib/novel-engine/` |
| NAV bridge | `src/lib/nav/navPythonBridge.ts` |
| Voice cast | `docs/design-multi-character-voice-cast.md`, `src/lib/voiceCast.ts` |
| Integrations | `docs/integrations-hub.md`, `src/lib/pipeline/*` |
| Workspace | `src/app/workspace/ARCHITECTURE.md` |
| Capabilities | `GET /api/ainovel/capabilities` |
| Memory phiên | `MEMORY.md` |

---

*Cập nhật khi (và chỉ khi) code thật đã đổi sự thật trên — không “ước mơ kiến trúc” trong file này.*
