# 🦖 BÁCH KHOA TOÀN THƯ & GIẢI PHẪU HỆ THỐNG: AI NOVEL & SCRIPT GENERATOR

*(Mệnh lệnh cấu hình & kỷ luật tuyệt đối cho mọi AI Agent / Subagent — cập nhật theo code runtime hiện tại)*

Tài liệu này là **giải phẫu hệ thống** của app: kiến trúc, UI, luồng nghiệp vụ, domain, B10, Setup genre, Gen Prompt, TTS, Flow, engine native.  
**Mọi agent chỉ được nhận định và thực thi theo đúng thiết kế dưới đây** — không “đoán” lại kiến trúc cũ (ainovel-gui, mạt thế hardcode, CapCut→Edge fallback, v.v.).

---

> ## ⚔️ BẮT BUỘC ĐỌC TRƯỚC KHI BUILD TIẾP
>
> | Tài liệu | Vai trò |
> |----------|---------|
> | [`docs/IRON_LAWS.md`](docs/IRON_LAWS.md) | **Quy luật thép + sự thật hiển nhiên (LOCKED)** |
> | [`docs/DOMAIN_MAP.md`](docs/DOMAIN_MAP.md) | Ownership domain logic |
> | [`specs/constitution.md`](specs/constitution.md) | Hiến pháp module |
> | [`src/contracts/`](src/contracts/) | `keys`, `apiMap`, `story`, `domainOwnership`, `GLOSSARY.md` |
> | [`docs/RESET_POINT.md`](docs/RESET_POINT.md) | Làm Mới Dự Án (blank canvas + giữ settings) |
> | [`docs/integrations-hub.md`](docs/integrations-hub.md) | Tích hợp ngầm (không nút 1-click) |
> | [`docs/flow-bridge.md`](docs/flow-bridge.md) | Google Flow gen ảnh/video |
> | [`src/app/workspace/ARCHITECTURE.md`](src/app/workspace/ARCHITECTURE.md) | Phân tầng workspace |
>
> ### Tóm tắt 10 giây (chống nhầm lẫn)
>
> 1. **Engine AI Novel** = **native TypeScript in-process** (`src/lib/novel-engine/*` + `/api/ainovel/*`).  
>    **CẤM** `ainovel-gui.exe`, **CẤM** proxy `:8080`, **CẤM** `fetch('http://localhost:8080')` cho viết truyện.
> 2. **NAV** = chỉ `python_core/gateway/nav_gateway.py` qua `callNavGateway`. **CẤM** `NAVTools.exe`.
> 3. **State** = Zustand + persist; UI **bắt buộc** `isHydrated` trước khi render data persist.
> 4. **Cross-domain** chỉ qua `@/contracts` hoặc HTTP API — **không** import chéo sâu `features/A` → `features/B`.
> 5. **B10 — CẤM FALLBACK nội dung/logic**: không đổi platform/engine/voice/provider ngầm, không gen mẫu, không soft-success.  
>    **Chỉ** được **xoay API key cùng provider**. Lỗi → **báo thẳng** để CISO sửa.
> 6. **Setup genre** (`setup.chu_de` + `setup.phong_cach`) **bắt buộc** cho write / gen prompt / engine.  
>    **CẤM** hardcode genre/style **mạt thế** khi user chọn thể loại khác.
> 7. **Nhân vật**: **khuyết điểm** (điểm yếu) bắt buộc — **không** ép “khuyết tật mạt thế”.
> 8. **Tích hợp**: user bấm từng bước Gen Prompt → Ảnh → Video → TTS → Ship. **Không** nút gộp pipeline 1-click.
> 9. **TTS multi-voice**: gate chỉ `ttsConfig` — **CẤM** nhét `sceneEmotion` vào multi-gate.
> 10. **CapCut fail** → báo lỗi CapCut; **CẤM** nhảy Edge TTS / Edge audio ngầm.

---

## 1. HỆ THẦN KINH TRUNG ƯƠNG (KIẾN TRÚC LÕI)

### 1.1 Stack

| Lớp | Công nghệ / path |
|-----|------------------|
| Framework | **Next.js App Router** + TypeScript + **Tailwind CSS v4** |
| Desktop shell | Electron (`main.js`, `preload.js`) khi chạy app desktop |
| State | **Zustand** + middleware `persist` (localStorage + durable backup) |
| Contracts | `src/contracts/*` — key, API map, story DTO, ownership |
| LLM generate | `/api/generate` → dispatch theo `GENERATE_REQUEST_OWNERS` → `handlers/*` |
| Ảnh | `/api/generate-image` + providers (flow, gemini, whisk, openai, grok…) |
| Video | `/api/generate-video` + Seedance formula + Flow/Veo/legacy |
| TTS | `/api/generate-tts` + `engines/*` registry |
| Flow bridge | `src/lib/flow-bridge/*` + extension `extensions/ainovel-flow` |
| NAV tools | `python_core/gateway/nav_gateway.py` |
| Novel engine | `src/lib/novel-engine/*` + `/api/ainovel/*` + disk `.ainovel-app/` |

### 1.2 Engine AI Novel (native — độc lập 100%)

| Hạng mục | Sự thật |
|----------|---------|
| Runtime | **native-ts in-process** — không spawn GUI Go |
| Code | `src/lib/novel-engine/*` |
| API | `/api/ainovel/*` only |
| Disk | `.ainovel-app/` (checkpoints, progress, chapters, diag) |
| Sync | Zustand durable backup ↔ disk qua `storeBridge` / `diskStore` |
| Capabilities | `capabilities.ts` → `dependsOnAinovelGui: false`, `dependsOnPort8080: false` |
| Tools | `writerTools` (plan/draft/commit/review), `editorTools` (arc/volume/expand) |
| Setup genre | Engine đọc `setup.chu_de` / `phong_cach` từ store backup qua `projectContext.setupGenrePayload()` — **thiếu → throw**, không ép mạt thế |

**CẤM:** wire lại `ainovel-gui.exe`, proxy `:8080`, hoặc “CapCut TTS thiếu → auto Edge” (vi phạm B10).

### 1.3 NAV / Python

- Mọi NAV action: `src/lib/nav/navPythonBridge.ts` → `python_core/gateway/nav_gateway.py`.
- **CẤM** phụ thuộc `NAVTools.exe` ngoài repo.
- Gateway thiếu / fail → hard-fail message rõ.

### 1.4 State (Zustand)

| Hạng mục | Path / quy tắc |
|----------|----------------|
| Store | `src/store/useNovelStore.ts` + slices (`*Actions.ts`) |
| Initial | `novelInitialState.ts` |
| Types | `novelTypes.ts` |
| Hydration | `isHydrated === false` mặc định; workspace **không** render data persist trước hydrate |
| Persist keys | `persistStorage.ts` — partialization; credentials tách |
| Reset dự án | `PROJECT_RESET_POINT` + `resetStore()` — **xóa canvas**, **giữ** keys/settings/TTS/media paths |

**Initial Setup (blank):**

- `setup.chu_de` = `''`, `setup.phong_cach` = `''` → user **phải chọn** trước write/gen.
- `INITIAL_LOREBOOK` = khung **sản xuất trung tính** (không nhồi world mạt thế).
- Sau **Làm Mới Dự Án**: lorebook `''`, chapters `[]`, media maps `{}` — xem `docs/RESET_POINT.md`.

### 1.5 Webpack / Next

Trong `next.config.ts` **bắt buộc**:

```ts
serverExternalPackages: [
  "puppeteer",
  "puppeteer-core",
  "puppeteer-extra",
  "puppeteer-extra-plugin-stealth",
]
```

Tránh Turbopack/Webpack phá module automation.

### 1.6 Cấu trúc code workspace (đúng path hiện tại)

```
src/app/workspace/
├── page.tsx                 # Shell workspace + hydrate gate
├── ARCHITECTURE.md
├── chrome/Header.tsx        # Header kính mờ, cookie, import, paths
├── layouts/                 # AppShell, WindowControls
├── features/                # UI theo domain
│   ├── script/              # Setup, Sidebar, SceneCard, Editor…
│   ├── media/               # Media Config, Flow accounts, DNA banner
│   ├── tts/                 # TTS modal, RoleCast, catalog
│   ├── youtube/             # SEO, thumb, safe checklist
│   ├── ainovel/             # AI Novel dashboard + engine toolbar
│   ├── project/             # Import, Ship, CapCut export
│   ├── channels/            # Channel switcher, job queue
│   ├── toolbox/             # Labs (ẩn mặc định), video editor
│   └── settings/            # Credentials, settings panel
├── hooks/                   # useWriteChapter, useImagePromptActions, useTTS…
├── modules/                 # Business: writeModule, imageModule, ttsModule…
└── shared/                  # Toast, CustomSelect, FloatingMenu
```

| Lớp | Trách nhiệm |
|-----|-------------|
| `features/*` | UI only — gọi hooks |
| `hooks/*` | Orchestrate UI state + modules + store |
| `modules/*` | Gọi API (`postGenerate`, `API.*`), pure client business |
| `lib/*` | Shared server/client logic (storyWriting, seedance, flow-bridge…) |
| `app/api/*` | HTTP handlers |
| `contracts/*` | Key, URL, DTO, ownership |

**CẤM** invent asset key tay — luôn `sceneAssetKey` / `imageAssetKey` / `videoAssetKey` / `characterImageKey` từ `@/contracts`.

---

## 2. LỚP DA & XÚC GIÁC (UI)

### 2.1 Thẩm mỹ & layout

- Phong cách: **Cyberpunk / Sci-Fi glass**, tối (`zinc`), accent **emerald** (gen) / **cam neon** (media incomplete).
- **Tỷ lệ 3:7**: Sidebar trái : vùng content phải.
- **CẤM** modal che navigation cốt lõi; ưu tiên accordion / panel trong khung.
- Nút gen premium: `bg-emerald-500 hover:bg-emerald-400 text-black shadow-md` — **không** nút chìm.
- Lightbox ảnh: `z-[100]`, `bg-black/90 backdrop-blur-md`, click đóng, `cursor-zoom-out`.
- Mọi chuỗi VN hiển thị / so khớp tên: **`.normalize('NFC')`**.

### 2.2 Header (`chrome/Header.tsx`)

- Glassmorphism, viền `zinc-900/60`.
- Cookie Google / Studio, API keys (persist).
- **Kế thừa di sản** → `ImportModal` (`IMPORT_FOUNDATION` + style/Setup nếu có).
- Mở thư mục lưu (OS explorer); path Drive nếu cấu hình.
- Seedance sequence panel / resource monitor (khi bật).
- Media / TTS toolbar buttons → modal config.

### 2.3 Sidebar (`features/script/Sidebar.tsx` — cột ~3)

- Tên tác phẩm, dàn ý tổng thể, lorebook (accordion).
- **Roster nhân vật** + form co-giãn (`CharacterProfileForm`):
  - Giới, tuổi, dáng, vai, trang phục, thói quen, động cơ, giọng thoại, face lock, đặc điểm nhận dạng.
  - **Khuyết điểm** (bắt buộc khi setup đủ hồ sơ): điểm yếu tính cách / thói xấu / nỗi sợ — **không** label “khuyết tật mạt thế”.
  - Giọng TTS per character, face_ref / concept.
  - **Sáng tạo Prompt AI** → `GENERATE_CHARACTER_PROMPT` (+ director sheet formulas).
  - **Vẽ Concept** → 1 sheet identity; key `char_${name}`.
- **Làm Mới Dự Án** → wipe canvas, giữ settings (RESET_POINT).
- Chapter list / outline accordions.

### 2.4 Content panel (cột ~7)

- **Setup phase** (`SetupPhase` / `YoutubeSetupPhase`): chủ đề + phong cách + mô tả + số chương/từ + WPM scale.
- Sticky chapter nav + word-gate bar (mục tiêu `so_tu_chuong`, default scale 4250).
- **Editor / SceneCard**:
  - Tag cảnh `[CẢNH N: …]` / hook cold-open.
  - Typing effect + NFC.
  - **Gen Prompt Studio** (emerald) — chỉ sinh prompt, **không** gộp ảnh/video.
  - Thời lượng: ưu tiên **TTS duration** thật; không thì ước **WPM**; thiếu → báo lỗi (không hardcode words/2.5).
  - Prompt rows: `image_prompt` / `video_prompt`, Copy, Regen, Gen ảnh, Gen video.
  - Gen tất cả ảnh / video batch + progress slot (`mediaGenSlotStore`).
- YouTube SEO / thumb / safe checklist (psych 55).
- Tab AI Novel: engine dashboard + start flow native.

---

## 3. SETUP GENRE & BỐI CẢNH (BẮT BUỘC)

### 3.1 Nguồn chân lý thể loại

| Field store | Ý nghĩa |
|-------------|---------|
| `setup.chu_de` | Chủ đề (Setup UI — 30 theme) |
| `setup.phong_cach` | Phong cách (30 style) |
| `genre` (payload) | Thường = `"${chu_de} / ${phong_cach}"` |
| `visualDnaPrompt` | Visual DNA (Media Config) — ưu tiên style ảnh |
| `mediaStylePreset` | Style fallback cinematic generic (không mạt thế) |
| `lorebook` | Luật thế giới user/AI sinh — **không** auto-bịa “luật mạt thế cực lạnh” |
| `wpm` / `secondsPerBeat` | Media timeline — cap số shot, duration |

Helper chuẩn: `src/lib/storyWriting.ts`

- `requireGenreLabelFromSetup` / `buildGenreLabelFromSetup`
- `lorebookForPrompt` — trống → hướng dẫn không bịa world default
- `writeEngineRoleLine` — role LLM theo genre Setup

### 3.2 API / client bắt buộc Setup

| Luồng | Thiếu Setup → |
|-------|----------------|
| GENERATE_IDEAS | 400 |
| GENERATE_OUTLINE (classic) | 400 |
| WRITE / REVISE / EVALUATE_CHAPTER | 400 |
| EXPAND / REWRITE_SCENE | 400 |
| GENERATE_IMAGE_PROMPT / REGENERATE_PROMPT | 400 |
| GENERATE_CHARACTER_PROMPT* | 400 (cần style **hoặc** genre) |
| COMMIT_MEMORY / PLAN_ARC / CHAPTER_OUTLINE | 400 |
| Novel-engine draft/plan/commit | throw `setupGenrePayload` |
| Gen video client | throw nếu thiếu style+genre |

**CẤM** default string: `"dark survival / mạt thế"`, `"Luật thế giới mạt thế cực lạnh"`, `"Cinematic Dark Post-Apocalyptic…"`.

### 3.3 Genre packs (optional UX)

`src/lib/genrePacks.ts` — pack **tùy chọn** (gồm `mat_the` nếu user **chọn**). Không phải default engine.

---

## 4. LUỒNG NGHIỆP VỤ CHI TIẾT

### 4.1 Pipeline sản xuất media (user từng bước)

```
Setup (chu_de + phong_cach + mo_ta)
  → Outline / Kế thừa di sản
  → Viết chương (WRITE_CHAPTER + word-gate + evaluate/revise)
  → (Optional) TTS scene  → duration thật
  → Gen Prompt Studio     → image_prompt + video_prompt + timestamps
  → Gen ảnh               → identity lock + Flow/cast ingredients
  → Gen Video             → Seedance I2V + start image
  → Ship pack / CapCut    → path đĩa + FableCut timeline
```

Logic **ngầm** sau bước (không nút 1-click): FableCut rebuild, Seedance sequence bake, YouTube psych SEO — xem `integrations-hub.md`.

### 4.2 Zero-Legacy viết văn học

1. **Tên:** Hán Việt sắc sảo; cấm tên mòn (Lâm Khuyết…).
2. **Khuyết điểm:** mỗi NV phải có điểm yếu rõ — **không** ép khuyết tật mạt thế.
3. **Pacing:** cấm time-skip tuần/tháng; ưu tiên real-time, đa giác quan có chọn lọc, thoại đời.
4. **Phân cảnh:** tối thiểu `MIN_SCENE_COUNT` (3) tag `[CẢNH N: NỘI/NGOẠI…]`.
5. **Word-gate:** mục tiêu `so_tu_chuong` (~0.92 floor); continue nếu thiếu.
6. **Humanize:** câu đùa người-nói-với-người (youtubeSafe) khi bật.
7. **NFC** trên mọi output script.

Handlers: `handlers/chapter.ts`, `scene.ts`, `outline.ts`, `ideas.ts`, `foundation.ts`.  
Client: `modules/writeModule.ts`, `sceneModule.ts`, `setupModule.ts` + hooks tương ứng.

### 4.3 Gen Prompt Studio (storyboard)

**Owner API:** `handlers/imagePrompt.ts` (`GENERATE_IMAGE_PROMPT`, `REGENERATE_PROMPT`).  
**Client:** `hooks/useImagePromptActions.ts` → `modules/imageModule.ts`.

#### Điều kiện đầu vào (hard-fail)

- `style` = Visual DNA hoặc Media Style (client `resolveMediaStyle`).
- `chu_de` / `phong_cach` / `genre` từ Setup.
- `wpm`, `secondsPerBeat` > 0.
- `voiceDuration` / duration scene > 0 (TTS hoặc WPM estimate hoặc nhập tay).

#### Pipeline server

1. Split kịch bản: câu theo `.!?` / newline; cảnh >100 ký tự → split `,` / `，` / `-`, accumulator **không vế < 40 ký tự** (IRON B6).
2. Cap số shot: `maxShots ≈ totalDuration / secondsPerBeat` (ceiling an toàn 80) — **không** default cứng 16.
3. LLM JSON: `script_prompt` (VI gốc), `image_prompt` + `video_prompt` (EN).
4. Repair AI cho slot thiếu — **không** local heuristic fill (B10).
5. Timestamp **thống nhất** `start-end`s (vd. `0-8.5s`) — khớp TTS resync (`timestampSync.ts`).
6. Shot graph server: `enforceShotGraphOnPrompts` (wide→medium→close→insert→OTS) — **không** double-apply client.
7. Director formulas: `applyDirectorFormulasToPromptPair` với **styleHint + genre Setup** (seedance.ts — `requireDirectorStyle`).
8. Seedance sequence auto: `applySequenceToVideoPrompts` — fail → **502**, không skip im lặng.

#### Regen một prompt

- `REGENERATE_PROMPT` + still formula + client gọi Seedance video_prompt — thiếu → throw.

### 4.4 Gen ảnh

**Client:** `imageModule.generateImageAction`  
**API:** `/api/generate-image`

- Dùng `image_prompt` đã có; inject **identity lock** EN từ `nhan_vat_prompts` khi tên xuất hiện trong prompt/sentence.
- `face_ref` / concept sheet / cast ingredients (Flow, max 3).
- Provider mặc định **flow**; legacy: whisk, gemini/banana, openai, grok.
- **CẤM** swap provider khi fail (B10); chỉ xoay key cùng provider.
- Browser `engine=auto`: chỉ Chromium sạch — **CẤM** fallback Google Chrome ngầm.
- Sau batch: FableCut rebuild im lặng (`integrationsModule`).

### 4.5 Gen video

- Ưu tiên `video_prompt` đã Seedance; I2V từ ảnh scene.
- Client gửi `styleHint` + `genre` Setup + `secondsPerBeat`.
- Server `/api/generate-video` — **không** default genre mạt thế.
- Duration per shot: **bắt buộc** số hợp lệ — **CẤM** `|| 5` / `|| 6` im lặng trong Seedance compile.

### 4.6 TTS

- Platforms: vina_voice, edge_tts, piper, omnivoice, gemini… qua registry engines.
- Multi-voice cast: `lib/voiceCast.ts` + design doc multi-character.
- **Gate multi** chỉ `ttsConfig` (voice/speed/pitch) — **CẤM** `sceneEmotion` trong gate multi.
- `sceneEmotion` chỉ single-voice legacy path.
- Post-FX speed/pitch **theo segment**.
- Cache preview (browser Cache Storage / preview client cache).
- File audio key: `sceneAssetKey` → store `generatedAudioPaths` + duration thật.
- Sau TTS: resync timestamps prompt nếu drift >15%.

### 4.7 YouTube / SEO

- `youtubePsych55` + anti-motif kênh.
- Thumb prompt EN gen như scene; checklist safe.
- **CẤM** hardcode 1 template SEO chết khi extract fail (B10: log + fail).

### 4.8 Ship / CapCut / FableCut

- Ship pack resolve **path đĩa thật**.
- CapCut export: Pro gate `assertProAccess` khi `AINOVEL_ENTITLEMENT_MODE=enforce`.
- CapCut thiếu binary → **báo lỗi**, không nhảy Edge.
- Artifact: `exports/integrations/fablecut/...`

### 4.9 Google Flow Bridge

| Thành phần | Path / port |
|------------|-------------|
| Extension | `extensions/ainovel-flow` |
| Bridge | `src/lib/flow-bridge` (WS ~9223, HTTP ~8101) |
| API app | `/api/flow/*` |
| Default | `imageProvider=flow`, `videoProvider=flow` |
| Multi-account | Media Config panel + isolated profiles `accounts_data/` |

Docs: `docs/flow-bridge.md`, `docs/flow-environment-setup.md`.

---

## 5. HỒ SƠ NHÂN VẬT (CHI TIẾT)

### 5.1 Schema (`lib/characterProfile.ts`)

| Field | Bắt buộc (setup đủ) | Ghi chú |
|-------|---------------------|---------|
| gioi_tinh, tuoi, dang_nguoi, vai_tro | Có | |
| quan_ao, so_thich, thoi_quen, dong_co | Có | |
| giong_thoai, tts_voice | Có | TTS per role |
| ngoai_hinh | Có | Face lock |
| dac_diem_nhan_dang | Có | Marks nhìn thấy được |
| **khuet_tat** | **Có** | **Khuyết điểm** (điểm yếu) — **không** = “khuyết tật mạt thế bắt buộc” |
| prompt | Có | Master EN identity |
| angle_prompts / expression_prompts | Sheet | 4 góc + 8 biểu cảm |
| face_ref | Sau gen concept | Path local |

Validate: `getCharacterProfileSetupStatus` + `CHAR_PROFILE_REQUIRED_FIELDS`.

### 5.2 Gen prompt NV

- `GENERATE_CHARACTER_PROMPT` → full sheet + `applyCharacterSheetFormulas(styleHint, genre)`.
- `GENERATE_CHARACTER_PROMPT_ONLY` → master only + formula.
- Style/genre từ Visual DNA + Setup — **không** hardcode dark survival.

### 5.3 Consistency khi gen ảnh scene

Quét tên trong `prompt`/`sentence` → `buildIdentityLockEnglish` + face_ref/concept → `characterPrompt` + ingredients Flow.

---

## 6. DOMAIN OWNERSHIP (LOGIC TREE)

```
script | tts | media-image | media-video | youtube | channels
toolbox-labs | ainovel-engine | credentials | export
```

Map: `docs/DOMAIN_MAP.md` + `src/contracts/domainOwnership.ts`.

| Domain | Owner chính |
|--------|-------------|
| script | features/script, write/scene/setup modules, generate handlers chapter/scene/outline/ideas |
| tts | features/tts, ttsModule, generate-tts/engines |
| media-image | imageModule, generate-image/providers |
| media-video | videoModule, generate-video, seedance* |
| youtube | features/youtube, lib/youtube-safe |
| channels | features/channels, ship-pack |
| ainovel-engine | features/ainovel, lib/novel-engine, api/ainovel |
| credentials | settings, entitlement |
| export | CapCut, ship-pack |
| toolbox-labs | toolbox (ẩn mặc định), navtools |

Cross-domain **chỉ** `@/contracts` hoặc HTTP.

---

## 7. API GENERATE — BẢNG HANDLER

`POST /api/generate` body: `{ requestType, apiKeys, model, payload }`.  
Route chỉ dispatch — logic trong `src/app/api/generate/handlers/`.

| Handler | requestTypes chính |
|---------|-------------------|
| `ideas.ts` | GENERATE_IDEA(S), ANALYZE_YOUTUBE_PLOT |
| `outline.ts` | GENERATE_OUTLINE, GENERATE_CHAPTER_OUTLINE, PLAN_ARC |
| `chapter.ts` | WRITE_CHAPTER, REVISE_CHAPTER, EVALUATE_CHAPTER, COMMIT_MEMORY |
| `scene.ts` | EXPAND_SCENE, REWRITE_SCENE |
| `imagePrompt.ts` | GENERATE_IMAGE_PROMPT, REGENERATE_PROMPT |
| `character.ts` | EXTRACT_CHARACTERS, GENERATE_CHARACTER_PROMPT, GENERATE_CHARACTER_PROMPT_ONLY |
| `foundation.ts` | COMPRESS_CONTEXT, IMPORT_FOUNDATION, SUMMARIZE_SCRIPT_OUTLINE |
| `visualDna.ts` | ANALYZE_VISUAL_DNA |

Client **bắt buộc** `postGenerate(requestType, payload)` từ `modules/apiClient.ts` — không copy-paste fetch keys.

---

## 8. ASSET KEY & FILE ĐĨA

Từ `@/contracts` / `keys.ts` / `GLOSSARY.md`:

| Asset | Hàm | Ví dụ |
|-------|-----|--------|
| Audio / prompts scene | `sceneAssetKey(ch, sc)` | `3_2` |
| Ảnh prompt | `imageAssetKey(ch, sc, pi)` | `3_2_0` |
| Video prompt | `videoAssetKey(ch, sc, pi)` | `3_2_0_video` |
| Ảnh NV | `characterImageKey(name)` | `char_Hàn Dực` |
| File audio | `localAudioFilename` | `chapter_3_scene_2.mp3` |
| File ảnh | `localImageFilename` | `chapter_3_scene_2_prompt_0.png` |

**CẤM** ghép key string ad-hoc.

Timestamps prompt: **`start-end`s** (vd. `12-18.5s`).  
Legacy duration-start chỉ parse tương thích; code mới **không** sinh format cũ.

---

## 9. BINARIES & ENTITLEMENT

| Binary | Path |
|--------|------|
| FFmpeg | `bin/ffmpeg.exe` và/hoặc `python_core/ffmpeg/` |
| Piper | `bin/piper/piper.exe` |
| Edge TTS | **chỉ** khi `platform === 'edge_tts'` |
| CapCut | detect `LOCALAPPDATA/CapCut/Apps` — thiếu → lỗi, không fallback |

| Mode | Ý nghĩa |
|------|---------|
| `AINOVEL_ENTITLEMENT_MODE=open` (default) | Desktop/dev mở Pro |
| `=enforce` | Server `assertProAccess` HMAC |

---

## 10. B10 — CẤM FALLBACK (CHECKLIST AGENT)

| Được phép | Cấm tuyệt đối |
|-----------|----------------|
| Xoay API key **cùng** provider | Đổi platform/engine/provider khi fail |
| Retry cùng endpoint/model/voice | Gen mẫu / demo / heuristic thay API |
| Hard-fail + message hành động | Soft-success, toast mơ hồ, fake media |
| | CapCut fail → Edge; Flow fail → Gemini ngầm |
| | Local director fill prompt khi AI fail |
| | `duration \|\| 5` / `beat \|\| 6` / genre mạt thế default |
| | Auto browser → Google Chrome khi cần Chromium sạch |

**Show, don't tell:** trước khi báo xong media — file `.mp3`/`.mp4`/`.png` **tồn tại trên đĩa** + log terminal thật.

---

## 11. ĐỊNH CHẾ CHO MỌI AGENT (CISO / RUNTIME)

1. **Thực thi theo IRON_LAWS + AGENTS này** — không “đoán” kiến trúc legacy.
2. **Empirical Validation Loop:** sửa code → chạy lệnh thật → đọc log → auto-debug đến pass; **cấm** hallucinate test.
3. **Zero-Trust Logic Preservation:** không phá module đang chạy; feature mới modular; quét code cũ trước khi sửa.
4. **Setup / genre / style:** luôn wire từ store; hard-fail khi thiếu — **không** hardcode mạt thế.
5. **Khuyết điểm NV:** bắt buộc điểm yếu; **không** ép khuyết tật mạt thế.
6. **Contracts:** key/API/DTO từ `@/contracts`; không invent.
7. **Hydration:** component store phải `isHydrated`.
8. **TTS multi:** không nhét `sceneEmotion` vào gate multi.
9. **Không 1-click gộp** Prompt+Ảnh+Video+TTS.
10. **Next.js:** đọc `node_modules/next/dist/docs/` khi API framework khác training data.

---

## 12. CHECKLIST 30 GIÂY TRƯỚC KHI BÁO XONG / MERGE

- [ ] Có chạm `ainovel-gui` / `:8080`? → rollback
- [ ] Có import cross-domain lậu? → contracts/API
- [ ] Component store có `isHydrated`?
- [ ] Setup `chu_de`+`phong_cach` có được truyền vào write/gen/engine?
- [ ] Có hardcode mạt thế / dark survival / local prompt fill?
- [ ] TTS multi-gate có dính `sceneEmotion`?
- [ ] Duration/beat thiếu có hard-fail (không `|| 5`)?
- [ ] NFC cho chuỗi VN user-facing?
- [ ] Worker/temp: `finally` cleanup?
- [ ] Đã chạy smoke/typecheck/verify liên quan domain vừa sửa?

---

## 13. CON TRỎ FILE NHANH

| Nhu cầu | Path |
|---------|------|
| Quy luật thép | `docs/IRON_LAWS.md` |
| Domain map | `docs/DOMAIN_MAP.md` |
| Reset dự án | `docs/RESET_POINT.md` |
| Integrations | `docs/integrations-hub.md` |
| Flow | `docs/flow-bridge.md` |
| Glossary / keys | `src/contracts/GLOSSARY.md`, `keys.ts`, `apiMap.ts` |
| Genre Setup helpers | `src/lib/storyWriting.ts` |
| Seedance / still formula | `src/lib/integrations/seedance.ts` |
| Gen prompt handler | `src/app/api/generate/handlers/imagePrompt.ts` |
| Write chapter handler | `src/app/api/generate/handlers/chapter.ts` |
| Character profile | `src/lib/characterProfile.ts` |
| Novel engine context | `src/lib/novel-engine/projectContext.ts` |
| Workspace arch | `src/app/workspace/ARCHITECTURE.md` |
| Memory agent | `MEMORY.md` |

---

<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know
This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->
