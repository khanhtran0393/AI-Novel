# ⚔️ QUY LUẬT THÉP & SỰ THẬT HIỂN NHIÊN

> **Status: LOCKED (đã phê duyệt & thống nhất code)** — 2026-07-14  
> **Đọc trước khi build tiếp.** Tài liệu này là nguồn chân lý ngắn gọn cho agent/dev.  
> Chi tiết giải phẫu UI/logic: `AGENTS.md` · Domain map: `docs/DOMAIN_MAP.md` · Constitution: `specs/constitution.md`  
> Nguồn máy đọc được: `src/contracts/*` (`keys`, `apiMap`, `story`, `domainOwnership`, `GLOSSARY.md`)  
> **Làm Mới Dự Án (reset point):** [`docs/RESET_POINT.md`](RESET_POINT.md) · `MEMORY.md`

---

## A. SỰ THẬT HIỂN NHIÊN (đã đúng trong code — không “đoán lại”)

### A1. Engine AI Novel = native TypeScript in-process

| Sự thật | Bằng chứng / path |
|--------|-------------------|
| Tab AI Novel chạy **native-ts**, không proxy | `src/lib/novel-engine/*` + `src/app/api/ainovel/*` |
| **Không** phụ thuộc `ainovel-gui.exe` | `capabilities.ts` → `dependsOnAinovelGui: false` |
| **Không** phụ thuộc port `:8080` | `dependsOnPort8080: false` · `runner.ts` note rõ |
| Disk root engine | `.ainovel-app/` (checkpoints, progress, diag) |
| Sync 2 chiều | Zustand backup ↔ `.ainovel-app/` qua `storeBridge` / disk store |

**Hệ quả build:** Không wire lại Go GUI, không spawn `ainovel-gui`, không `fetch('http://localhost:8080')` cho luồng viết truyện.

### A2. NAV = `python_core` gateway (standalone)

| Sự thật | Bằng chứng / path |
|--------|-------------------|
| Mọi NAV action qua `callNavGateway` | `src/lib/nav/navPythonBridge.ts` |
| Script gateway | `python_core/gateway/nav_gateway.py` |
| **Không** dùng `NAVTools.exe` | Comment + error message trong bridge |

**Hệ quả build:** Thêm tool NAV = thêm action trong gateway Python + type `NavGatewayAction`, không mang binary NAVTools bên ngoài.

### A3. State = Zustand + persist + hydration gate

| Sự thật | Bằng chứng / path |
|--------|-------------------|
| Store trung tâm | `src/store/useNovelStore.ts` (+ slices actions) |
| `isHydrated` mặc định `false` | `novelInitialState.ts` |
| Workspace chặn render khi chưa hydrate | `workspace/page.tsx` |

**Hệ quả build:** Component đọc store **phải** đợi `isHydrated` (hoặc selector tương đương). Cấm render data persist trước mount.

### A3a. Làm Mới Dự Án = blank canvas + giữ cài đặt (LOCKED)

| Sau reset | Giá trị |
|-----------|---------|
| Tên tác phẩm | `''` |
| Lorebook | `''` → UI «Chưa có Lorebook.» |
| Danh sách chương | `[]` |
| API keys / Settings / TTS / media / paths | **Giữ nguyên** |

Spec: `docs/RESET_POINT.md` · code: `PROJECT_RESET_POINT` + `resetStore()` + `allowIntentionalStoreReset()`.

**CẤM** nhồi lại lore mặc định, «Dự án mới», hoặc Ch.1/Ch.2 sau Làm Mới.

### A3b. Contracts = từ điển hàm / key / API (đã thống nhất)

| Hạng mục | Nguồn |
|----------|--------|
| Asset key store | `sceneAssetKey` / `imageAssetKey` / `videoAssetKey` / `characterImageKey` trong `src/contracts/keys.ts` |
| File đĩa | `localAudioFilename` / `localImageFilename` / `localVideoFilename` / `driveMediaFilename` |
| HTTP path | `API.*` trong `src/contracts/apiMap.ts` |
| Chapter DTO | `contracts/story.ts` (store VN ↔ wire EN) |
| Glossary | `src/contracts/GLOSSARY.md` |

**CẤM** invent key/URL song song. Chi tiết: GLOSSARY + DOMAIN_MAP.

### A4. Domain ownership (cây logic — không mass-move folder)

```
script | tts | media-image | media-video | youtube | channels
toolbox-labs | ainovel-engine | credentials | export
```

- Map đầy đủ: `docs/DOMAIN_MAP.md` + `src/contracts/domainOwnership.ts`
- Cross-domain **chỉ** qua `@/contracts` hoặc HTTP API
- `features/A` **không** import sâu `features/B`

### A5. Tích hợp = logic ngầm (không nút 1-click gộp pipeline)

User vẫn bấm từng bước: **Gen Prompt → Gen ảnh → Gen Video → TTS → Ship/CapCut**.  
Logic ngầm (FableCut rebuild, Seedance, psych SEO…) chạy **sau** từng bước — không có panel “Repo Hub / 1-click all”.

Chi tiết: `docs/integrations-hub.md`

### A6. Entitlement Pro

| Mode | Ý nghĩa |
|------|---------|
| `AINOVEL_ENTITLEMENT_MODE=open` (default) | Desktop/dev: mở Pro |
| `=enforce` | Server `assertProAccess` bắt token HMAC |

Export CapCut / một số video path gọi `assertProAccess` server-side.

### A7. Media binaries trong repo

| Binary | Path kỳ vọng |
|--------|----------------|
| FFmpeg | `bin/ffmpeg.exe` (và/hoặc `python_core/ffmpeg/`) |
| Piper TTS | `bin/piper/piper.exe` |
| Edge TTS | chỉ khi user **chọn** platform `edge_tts` — **không** là fallback ngầm |
| CapCut desktop | optional — detect `LOCALAPPDATA/CapCut/Apps`; thiếu → **báo lỗi**, không nhảy Edge |

### A8. Vietnamese text

Mọi chuỗi hiển thị / so khớp tên nhân vật: **`.normalize('NFC')`** — tránh rớt dấu khi typing effect / key.

---

## B. QUY LUẬT THÉP (cấm vi phạm khi build tiếp)

### B1. AI Novel engine

1. **CẤM** gắn lại `ainovel-gui.exe` / proxy `:8080` cho tab AI Novel.
2. API engine chỉ nằm dưới `/api/ainovel/*`; logic dưới `lib/novel-engine/*`.
3. Diag engine = read-only export; không “sửa truyện” qua diag.

### B2. NAV / Python

1. **CẤM** phụ thuộc `NAVTools.exe` ngoài project.
2. Gateway thiếu → fail rõ ràng, không silent fallback sang tool lạ.
3. Puppeteer packages **phải** trong `serverExternalPackages` (`next.config.ts`).

### B3. Domain & module

1. Không mass-move cây folder “cho đẹp” — ownership là logical.
2. Logic UI hooks: `src/app/workspace/use[X]Actions.ts` / modules; UI: `components/` / `features/`.
3. Feature mới lớn: ghi `specs/*/spec.md` + `plan.md` trước khi code (constitution).

### B4. Zustand / SSR

1. Đọc store → check `isHydrated`.
2. Persist partialization: không nhét blob khổng lồ / secret thô nếu contract hiện tại đã tách credentials.

### B5. TTS multi-voice cast (normative)

Nguồn: `src/lib/voiceCast.ts` + `docs/design-multi-character-voice-cast.md`

1. Gate `shouldUseCastMulti`: global **chỉ** `ttsConfig` (voice/speed/pitch) — **CẤM** nhét `sceneEmotion` vào gate.
2. Multi path: pitch base = role/seg; **CẤM** cộng `emotionPitchOffset(sceneEmotion)` global.
3. `sceneEmotion` chỉ dùng single-voice path (legacy).
4. Post-FX speed/pitch: **theo từng segment** — CẤM dùng flag “last segment” cho cả scene.
5. Text override segment: mặc định **tắt**; bật thì phải cảnh báo lệch manuscript.

### B6. Gen ảnh / storyboard

1. Cảnh dài >100 ký tự → split theo `,` / `，` / `-`, accumulator không vế <40 ký tự.
2. Character consistency: tên trong script → lấy mô tả EN từ store sidebar nhét Subject Reference.
3. Timestamp storyboard: nếu đã TTS → tổng duration từ audio thật (`generatedAudioPaths`), không bịa giây.
4. Worker Chrome: profile tạm theo scene id → **`fs.rmSync` trong `finally`** (bắt buộc).

### B7. UI workspace

1. Layout **3:7** (sidebar : content).
2. Premium gen buttons: emerald/amber nổi — không nút chìm.
3. Lightbox ảnh: `z-[100]`, backdrop blur, click đóng.
4. Không modal che navigation cốt lõi; dùng accordion.

### B8. Tích hợp / ship

1. Không tạo nút “chạy cả pipeline một phát” thay flow từng bước.
2. Ship/CapCut resolve path đĩa thật; artifact FableCut im lặng sau gen.
3. YouTube SEO: `youtubePsych55` + anti-motif kênh — không hardcode 1 template chết.

### B9. Zero-Trust khi sửa code

1. **Không** phá module đang chạy tốt; feature mới modular.
2. Trước khi báo xong: chạy lệnh thật (`npm run smoke:core`, `typecheck`, script verify liên quan) — có log terminal.
3. Output media (mp3/mp4/png) phải **tồn tại trên đĩa** nếu task là gen media.

### B10. CẤM FALLBACK NỘI DUNG / LOGIC (chỉ ngoại lệ API)

**Nguyên tắc:** User (CISO) muốn **lỗi hiện thẳng** để sửa — không “cứu” bằng đường vòng che hỏng.

| Được phép | Cấm tuyệt đối |
|-----------|----------------|
| **Xoay API key** cùng provider (Gemini key1→key2, OpenAI keys pool) khi 429/401 | Đổi **platform/engine/provider** khi fail (CapCut→Edge, Flow→Gemini, Vina→Edge, Omni→Piper…) |
| Retry **cùng** endpoint / cùng model / cùng voice đã chọn | Gen “mẫu”, “demo”, “giả”, heuristic nội dung thay API |
| Báo lỗi rõ: thiếu key, thiếu browser, thiếu file, engine offline | Soft-success / toast mơ hồ / log ignore rồi trả audio/ảnh giả |
| Hard-fail + message hành động (cài browser, chọn platform, thêm key) | Stock Chrome “tạm dùng” khi `engine=auto` cần Chromium sạch |
| | Self-heal **đổi** TTS platform / image provider / voice ngầm |
| | SEO/hook/script fallback template khi extract fail (log + fail, không bịa) |

**Áp dụng mọi domain:** script, TTS, gen ảnh/video, Flow bridge, NAV, export, ship-pack, cast, preview.

**Checklist agent khi sửa code:**

1. `catch` → **rethrow / return error JSON** có `error` message thật — không `return ok + fake`.
2. Không `generateEdgeTTS` / `edge_tts` trừ khi `platform === 'edge_tts'`.
3. Không `imageProvider` swap trong route khi provider user chọn fail.
4. Browser `auto`: chỉ Chromium sạch; **không** fallback Google Chrome (user phải chọn `engine=chrome` tường minh hoặc bấm «Cài browser gen ảnh»).
5. Comment code kiểu `// fallback to X` cho **nội dung** = vi phạm — xóa hoặc hard-fail.

---

## C. BẢNG CHỐNG NHẦM (hay tái phạm)

| Nhầm lẫn phổ biến | Sự thật |
|-------------------|---------|
| “Phải bật ainovel-gui rồi gọi :8080” | Engine đã native; GUI Go chỉ còn legacy folder `ainovel-cli-main/`, **không** là runtime app |
| “NAVTools.exe là dependency” | Chỉ `python_core/gateway/nav_gateway.py` |
| “Gộp Gen Prompt+Ảnh+Video+TTS 1 nút” | Cấm theo integrations-hub |
| “sceneEmotion điều khiển multi-gate” | Cấm — chỉ ttsConfig defaults |
| “Import chéo features cho nhanh” | Chỉ contracts/API |
| “Render store ngay trên SSR” | Phải `isHydrated` |
| “CapCut fail thì Edge thế” | **Cấm** — báo lỗi CapCut; user tự chọn platform |
| “Auto browser = Chrome nếu không có Ungoogled” | **Cấm** — hard-fail + nút cài browser |
| “Đổi cấu trúc folder domain hàng loạt” | Ownership logical — không mass-move |

---

## D. CHECKLIST 30 GIÂY TRƯỚC KHI MERGE / BÁO XONG

- [ ] Có chạm `ainovel-gui` / `:8080`? → **rollback ngay**
- [ ] Có import cross-domain lậu? → chuyển sang contract/API
- [ ] Component store có `isHydrated`?
- [ ] TTS: gate multi có dính `sceneEmotion` không?
- [ ] Worker/temp: có `finally` cleanup?
- [ ] `normalize('NFC')` cho chuỗi tiếng Việt user-facing?
- [ ] Đã chạy ít nhất một lệnh verify/smoke liên quan domain vừa sửa?

---

## E. CON TRỎ CHI TIẾT

| Chủ đề | File |
|--------|------|
| Giải phẫu UI + agent mandate | `AGENTS.md` |
| Constitution SDD | `specs/constitution.md` |
| Domain ownership | `docs/DOMAIN_MAP.md`, `src/contracts/domainOwnership.ts` |
| Native engine | `src/lib/novel-engine/` |
| NAV bridge | `src/lib/nav/navPythonBridge.ts` |
| Voice cast multi | `docs/design-multi-character-voice-cast.md`, `src/lib/voiceCast.ts` |
| Integrations ngầm | `docs/integrations-hub.md` |
| Multi-channel ship | `docs/design-multi-channel-ship.md` |
| Capabilities runtime | `GET /api/ainovel/capabilities` |

---

*Cập nhật khi (và chỉ khi) code thật đã đổi sự thật trên — không “ước mơ kiến trúc” trong file này.*
