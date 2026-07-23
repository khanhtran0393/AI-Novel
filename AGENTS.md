# 🦖 BÁCH KHOA TOÀN THƯ & GIẢI PHẪU HỆ THỐNG: AI NOVEL & SCRIPT GENERATOR

*(Mệnh lệnh cấu hình cho mọi AI Agent / Subagent — **cập nhật theo code runtime thật**, không theo kiến trúc legacy)*

Tài liệu này là **giải phẫu hệ thống** của app: stack, UI, domain, commercial, B10, Setup genre, Gen Prompt, TTS, Flow, engine native, pipeline.

**Mọi agent chỉ được nhận định và thực thi theo đúng thiết kế dưới đây** — không “đoán” lại kiến trúc cũ (`ainovel-gui.exe`, proxy `:8080`, genre hardcode, CapCut→Edge fallback, v.v.).

---

> ## ⚔️ BẮT BUỘC ĐỌC TRƯỚC KHI BUILD TIẾP
>
> | Tài liệu | Vai trò |
> |----------|---------|
> | [`docs/AGENT_DONE_GATE.md`](docs/AGENT_DONE_GATE.md) | **Chống ảo giác khi báo xong** (Done Gate · status ladder · gatekeeper) |
> | [`docs/IRON_LAWS.md`](docs/IRON_LAWS.md) | **Quy luật thép + sự thật hiển nhiên (LOCKED)** |
> | [`docs/DOMAIN_MAP.md`](docs/DOMAIN_MAP.md) | Ownership domain logic |
> | [`docs/COMMERCIAL.md`](docs/COMMERCIAL.md) | Free / Trial / Pro + entitlement |
> | [`docs/LICENSE_ONE_PATH.md`](docs/LICENSE_ONE_PATH.md) | **One-path license** (ticket · ledger · crown IP) — cấm f(token) |
> | [`docs/PACK_NOTES.md`](docs/PACK_NOTES.md) | **Ghi chú pack** — quy trình 4 bước · phiếu tick · ledger · update · checklist |
> | [`docs/RESET_POINT.md`](docs/RESET_POINT.md) | Làm Mới Dự Án (blank canvas + giữ settings) |
> | [`docs/integrations-hub.md`](docs/integrations-hub.md) | Tích hợp ngầm (không nút 1-click) |
> | [`docs/flow-bridge.md`](docs/flow-bridge.md) | Google Flow gen ảnh/video |
> | [`src/contracts/`](src/contracts/) | `keys`, `apiMap`, `story`, `domainOwnership`, `GLOSSARY.md` |
> | [`src/app/workspace/ARCHITECTURE.md`](src/app/workspace/ARCHITECTURE.md) | Phân tầng workspace |
> | [`specs/constitution.md`](specs/constitution.md) | Hiến pháp module |
> | [`MEMORY.md`](MEMORY.md) | Ghi nhớ ngắn phiên / commercial / pipeline |
>
> ### Tóm tắt 15 giây (chống nhầm lẫn)
>
> 1. **Engine AI Novel** = **native TypeScript in-process** (`src/lib/novel-engine/*` + `/api/ainovel/*`).  
>    **CẤM** `ainovel-gui.exe`, **CẤM** proxy `:8080`, **CẤM** `fetch('http://localhost:8080')` cho viết truyện.
> 2. **NAV** = `python_core/gateway/nav_gateway.py` qua `callNavGateway` + **host-binding**. **CẤM** `NAVTools.exe`.
> 3. **State** = Zustand + persist (localStorage + durable Electron). `isHydrated` **mặc định `true`** (tránh kẹt màn nạp); rehydrate chạy nền — vẫn **không** ghi đè state trước khi rehydrate xong nếu logic phụ thuộc persist.
> 4. **Cross-domain** chỉ qua `@/contracts` hoặc HTTP API — **không** import chéo sâu `features/A` → `features/B`.
> 5. **B10 — CẤM FALLBACK nội dung/logic**: không đổi platform/engine/voice/provider ngầm, không gen mẫu, không soft-success.  
>    **Chỉ** được **xoay API key cùng provider**. Lỗi → **báo thẳng**.
> 6. **Setup genre** (`setup.chu_de` + `setup.phong_cach`) **bắt buộc** cho write / gen prompt / engine.  
>    **CẤM** hardcode genre/style ngoài Setup khi user chọn thể loại khác.
> 7. **Nhân vật**: **khuyết điểm** (điểm yếu) bắt buộc — **không** ép “trope khuyết tật cứng”.
> 8. **Tích hợp**: user bấm từng bước Gen Prompt → Ảnh → Video → TTS → Ship. **Không** nút gộp pipeline 1-click.
> 9. **TTS multi-voice**: gate chỉ `ttsConfig` — **CẤM** nhét `sceneEmotion` vào multi-gate.
> 10. **CapCut fail** → báo lỗi CapCut; **CẤM** nhảy Edge TTS / Edge audio ngầm.
> 11. **Commercial**: Free / Trial / Pro. Badge header: **TRIAL → PRO → FREE**. Trial = quyền Pro-equivalent tạm + cờ `is_trial` (không gộp nhầm PRO trả phí); `is_vip` chỉ để đọc dữ liệu legacy.
> 12. **Entitlement mode**: dev/web mặc định `open`; **Electron packaged** mặc định `enforce` nếu chưa set env.

---

## 1. HỆ THẦN KINH TRUNG ƯƠNG (KIẾN TRÚC LÕI)

### 1.1 Stack (runtime thật — `package.json`)

| Lớp | Công nghệ / path |
|-----|------------------|
| Framework | **Next.js 16** App Router + **React 19** + TypeScript + **Tailwind CSS v4** |
| Desktop shell | **Electron 43** — `main.js` + `preload.js` + `electron/durableStore.js` |
| State | **Zustand 5** + middleware `persist` (localStorage + durable backup Electron) |
| Contracts | `src/contracts/*` — key, API map, story DTO, ownership, Zod validate |
| LLM generate | `POST /api/generate` → `GENERATE_REQUEST_OWNERS` → `handlers/*` |
| Ảnh | `/api/generate-image` + providers: **flow**, gemini, whisk, openai, grok |
| Video | `/api/generate-video` + Seedance formula + Flow/Veo |
| TTS | `/api/generate-tts` + `platforms/*` registry + `engines/*` |
| Flow bridge | `src/lib/flow-bridge/*` + extension `extensions/ainovel-flow` |
| NAV tools | `python_core/gateway/nav_gateway.py` (+ host-binding) |
| Novel engine | `src/lib/novel-engine/*` + `/api/ainovel/*` + disk `.ainovel-app/` |
| Pipeline P0–P2 | `src/lib/pipeline/*` (quality gate, memory, preflight, stage queue, longform arc) |
| Commercial | `src/lib/commercial/*` + `src/lib/entitlement.ts` + `/api/entitlement/*` + `/api/commercial/status` |

### 1.2 Engine AI Novel (native — độc lập 100%)

| Hạng mục | Sự thật |
|----------|---------|
| Runtime | **native-ts in-process** — không spawn GUI Go |
| Code | `src/lib/novel-engine/*` |
| API | `/api/ainovel/*` only |
| Routes | `start`, `stop`, `resume`, `status`, `stream`, `config`, `chapters`, `chapters/[id]`, `diag`, `capabilities`, `download-all` |
| Disk | `.ainovel-app/` (checkpoints, progress, chapters, diag) |
| Sync | Zustand durable backup ↔ disk qua `storeBridge` / `diskStore` |
| Capabilities | `capabilities.ts` → `mode: 'native-ts'`, `dependsOnAinovelGui: false`, `dependsOnPort8080: false` |
| Tools | `writerTools` (plan/draft/commit/review), `editorTools` (arc/volume/expand) |
| Setup genre | `projectContext.setupGenrePayload()` — **thiếu chu_de & phong_cach → throw**, không ép thể loại ngoài Setup |
| Long-form | `runner` + `pipeline/longformArc` (`buildLayeredRouteExtras`) khi đủ số chương |

**CẤM:** wire lại `ainovel-gui.exe`, proxy `:8080`, hoặc “CapCut TTS thiếu → auto Edge” (vi phạm B10).

Folder legacy `ainovel-cli-main/` (Go GUI) **không** là runtime app — chỉ di sản/repo phụ.

### 1.3 NAV / Python

| Hạng mục | Sự thật |
|----------|---------|
| Bridge | `src/lib/nav/navPythonBridge.ts` → `callNavGateway` |
| Gateway | `python_core/gateway/nav_gateway.py` |
| Host-binding | `src/lib/nav/hostBinding.ts` + `python_core/ainovel_host_guard.py` |
| Mode mặc định | `AINOVEL_HOST_BINDING=enforce` (CLI standalone từ chối; chỉ App host được spawn) |
| HTTP | `/api/navtools/*` (gateway, youtube-seo, upscale, bg_remove, subtitle, …) |
| Binary | **CẤM** phụ thuộc `NAVTools.exe` ngoài repo |

Gateway thiếu / fail → hard-fail message rõ — không silent fallback tool lạ.

### 1.4 State (Zustand)

| Hạng mục | Path / quy tắc |
|----------|----------------|
| Store | `src/store/useNovelStore.ts` + slices |
| Slices | `storyActions`, `credentialActions`, `mediaAssetActions`, `ttsCastActions`, `channelActions` |
| Initial | `novelInitialState.ts` → `INITIAL_STATE` |
| Types | `novelTypes.ts` |
| Selectors | `useNovelStoreSelectors.ts` (`selectIsPro` / `Vip` / `Trial` / …) |
| Persist | `novelStorePersistence.ts` + `persistStorage.ts` (partialization; credentials tách) |
| Reset dự án | `PROJECT_RESET_POINT` + `resetStore()` — **xóa canvas**, **giữ** keys/settings/TTS/media paths/entitlement |

**Hydration (sự thật hiện tại):**

- `isHydrated` **mặc định `true`** trong `INITIAL_STATE` — **cấm** kẹt màn «Đang nạp trạng thái bộ nhớ» vô hạn.
- Rehydrate persist vẫn chạy nền; durable merge có `projectResetEpoch` để Làm Mới không bị đè bởi snapshot cũ giàu nội dung hơn.
- Component **không** được giả định “chưa hydrate = spinner chặn cả workspace”. Khi đọc data nhạy cảm (credentials, plan), ưu tiên selector + sync hook (`useEntitlementSync`).

**Boot ban đầu (chưa Làm Mới):**

| Field | Giá trị |
|-------|---------|
| `giai_doan` | `2` (workspace; Setup mở từ Sidebar — không kẹt modal boot) |
| `setup.chu_de` / `phong_cach` | `''` — user **phải chọn** trước write/gen |
| `setup.so_tu_chuong` | `4250` |
| `ten_tac_pham` | `'Dự án mới'` (sau Làm Mới → `''`) |
| `danh_sach_chuong` | Ch.1 + Ch.2 empty (sau Làm Mới → `[]`) |
| `lorebook` | `INITIAL_LOREBOOK` khung sản xuất **trung tính** (sau Làm Mới → `''`) |
| `imageProvider` / `videoProvider` | **`flow`** / **`flow`** |
| `imageModel` | `GEM_PIX_2` |
| `videoModel` | `veo_3_1_t2v_fast` |
| `videoDuration` | `8` (Flow: 4 \| 6 \| 8) |
| `wpm` / `secondsPerBeat` | `140` / `6` |
| `ttsConfig.platform` | **`vina_voice`** |
| Commercial | `is_pro/is_trial = false`, legacy `is_vip=false`, `credits = 100` |

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

- `allowedDevOrigins`: `127.0.0.1`, `localhost` (Electron dev HMR).
- **Không** còn rewrite/proxy `ainovel-gui :8080`.

### 1.6 Cấu trúc workspace (path hiện tại)

```
src/app/workspace/
├── page.tsx                 # Shell workspace
├── ARCHITECTURE.md
├── chrome/Header.tsx        # Brand + badge FREE/TRIAL/PRO + toolbars
├── layouts/                 # AppShell, WindowControls
├── features/
│   ├── script/              # Setup, Sidebar, SceneCard, Editor, roster…
│   ├── media/               # Media Config, Flow accounts, DNA banner
│   ├── tts/                 # TTS modal, RoleCast, catalog tabs
│   ├── youtube/             # SEO, thumb, safe checklist
│   ├── ainovel/             # AI Novel dashboard + engine toolbar
│   ├── project/             # Import, Ship, CapCut export
│   ├── channels/            # Channel switcher, job queue
│   ├── license/             # BrandLogoButton + LicenseModal (Bản quyền)
│   ├── settings/            # Credentials, settings panel
│   ├── toolbox/             # Labs (ẩn mặc định), video editor, bypass, batch SRT
│   ├── download/            # Download registry
│   └── onboarding/          # Onboarding banner
├── hooks/                   # useWriteChapter, useImagePromptActions, useTTS,
│                            # useEntitlementSync, useProAccess, …
├── modules/                 # write/scene/setup/image/video/tts + apiClient
├── shared/                  # Toast, Confirm, CustomSelect, FloatingMenu
├── config/
└── utils/
```

| Lớp | Trách nhiệm |
|-----|-------------|
| `features/*` | UI only — gọi hooks |
| `hooks/*` | Orchestrate UI state + modules + store |
| `modules/*` | Gọi API (`postGenerate`, `API.*`), pure client business |
| `lib/*` | Shared server/client logic |
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

- Brand logo → `features/license/BrandLogoButton` (mở **Bản quyền / License**).
- Badge gói (ưu tiên): **TRIAL → PRO → FREE** (+ credits khi FREE).
  - **TRIAL** = cyan (trial active, `is_trial`).
  - **PRO** = vàng (license Pro trả phí, không trial).
  - Pro tháng/năm/trọn đời đều dùng badge **PRO**.
- Channel switcher + job queue.
- Mở thư mục lưu; Media / TTS toolbar; CapCut export; Toolbox host; Settings.

### 2.3 Sidebar (`features/script/Sidebar.tsx`)

- Tên tác phẩm, dàn ý, lorebook (accordion).
- **Roster nhân vật** + `CharacterProfileForm` (khuyết điểm bắt buộc khi setup đủ hồ sơ).
- **Làm Mới Dự Án** → wipe canvas, giữ settings (`docs/RESET_POINT.md`).
- Chapter list / outline.

### 2.4 Content panel

- **Setup** (`SetupPhase` / `YoutubeSetupPhase`): chủ đề + phong cách + mô tả + số chương/từ + WPM scale.
- Sticky chapter nav + word-gate (`so_tu_chuong`).
- **Editor / SceneCard**: tag `[CẢNH N: …]`, Gen Prompt Studio (emerald), TTS duration ưu tiên, prompt rows image/video.
- YouTube SEO / thumb / safe checklist.
- Tab AI Novel: engine dashboard + start flow native.

### 2.5 License / Bản quyền

| UI | Path |
|----|------|
| Logo + badge | `features/license/BrandLogoButton.tsx` |
| Modal kích hoạt | `features/license/LicenseModal.tsx` |
| Card (settings) | `features/settings/LicenseActivationCard.tsx` (nếu còn wire) |
| Sync boot | `hooks/useEntitlementSync.ts` |
| UI gate | `hooks/useProAccess.ts` + `lib/commercial/featureMatrix.ts` |

Token: `localStorage.ainovel.entitlementToken` → header `x-ainovel-entitlement` (`buildClientApiHeaders`).

---

## 3. COMMERCIAL / ENTITLEMENT (SỰ THẬT)

### 3.1 Gói & ma trận

Nguồn: `src/lib/commercial/featureMatrix.ts` · docs: `docs/COMMERCIAL.md`, `docs/PRICING.md`.

| Tier | Ý nghĩa ngắn |
|------|----------------|
| `free` | Viết / outline / prompt / gen ảnh BYOK / TTS Edge-Piper cơ bản |
| `trial` | 7 ngày / 1 HWID — như Pro · 5 lượt/ngày mục cơ bản · ≤3000 từ/chương · ≤10 chương |
| `pro` | License HWID — thêm integrations pipeline, multi-channel, toolbox, Flow multi-account |

Server gate (`assertProAccess`): **gen video**, **export CapCut**, **ship-pack**, **integrations/pipeline**.

### 3.2 Store flags

| Flag | Ý nghĩa |
|------|---------|
| `is_vip` | Chỉ tương thích snapshot/token cũ; chuẩn hóa thành Pro |
| `is_pro` | Pro-equivalent unlock (kể cả trial set true để mở quyền) |
| `is_trial` | **Đang trial** — badge UI = TRIAL, không hiện PRO trả phí |
| `credits` | Free: hữu hạn; trial ~50k; paid ~unlimited |

`setVipStatus(legacyVip, is_pro, is_trial?)` — code mới luôn truyền `legacyVip=false`; trial path: `setVipStatus(false, true, true)`.

### 3.3 Mode

| Môi trường | `AINOVEL_ENTITLEMENT_MODE` |
|------------|----------------------------|
| Dev / web | Mặc định **`open`** (Pro routes cho phép) |
| Electron **packaged** | Mặc định **`enforce`** nếu env chưa set (`main.js`) |
| Secrets | Packaged: `%APPDATA%/…/.env.commercial` |

`assertProAccess` (enforce): token Ed25519 + HWID **hoặc** trial token active. Fail-closed khi thiếu public key hợp lệ.

### 3.4 API commercial

| Endpoint | Việc |
|----------|------|
| `GET /api/commercial/status` | tier, trial, claims, matrix, pricing |
| `POST /api/entitlement/issue` | Cấp token (admin) |
| `POST /api/entitlement/activate` | Kích hoạt token / mã AINOVEL |
| `POST /api/entitlement/trial` | Bật trial 1 lần / HWID |
| `POST /api/entitlement/verify` | Verify |
| `GET/POST /api/entitlement/hwid` | HWID máy |
| `POST /api/entitlement/webhook` | Payment → code/token |
| `POST /api/entitlement/codes` | Admin codes |
| `POST /api/entitlement/payment-notify` | Báo admin (Telegram/Zalo flow) |

Seller CLI: `npm run license:issue` · vault `data/licenses/`.

Smoke: `npm run smoke:commercial`.

### 3.5 Cloud hybrid (Supabase — optional)

| Hạng mục | Path / hành vi |
|----------|----------------|
| Clients | `src/lib/supabase/*` — anon JWT + service_role server-only; graceful nếu thiếu env |
| Bridge | `src/lib/cloud/licenseBridge.ts` — Ed25519 issue/verify + order + trial + revoke |
| API | `/api/cloud/status`, `/api/cloud/orders`, `/api/cloud/orders/confirm`, `/api/cloud/license/*` |
| Admin UI | `/admin` (khi deploy) |
| SQL/RLS | `supabase/migrations/001_commercial_rls.sql` |
| Hybrid | **Không** Supabase → app verify Ed25519 offline; cấp mới vẫn cần seller/backend |

Docs deploy: `docs/SUPABASE_VERCEL_GUIDE.md`.

---

## 4. SETUP GENRE & BỐI CẢNH (BẮT BUỘC)

### 4.1 Nguồn chân lý thể loại

| Field store | Ý nghĩa |
|-------------|---------|
| `setup.chu_de` | Chủ đề (Setup UI) |
| `setup.phong_cach` | Phong cách |
| `genre` (payload) | Thường = `"${chu_de} / ${phong_cach}"` |
| `visualDnaPrompt` | Visual DNA (Media Config) — ưu tiên style ảnh |
| `mediaStylePreset` | Fallback cinematic **generic** (không ép thể loại) |
| `lorebook` | Luật thế giới user/AI — **không** auto-bịa “luật thế giới bịa mặc định” |

Helper: `src/lib/storyWriting.ts`

- `requireGenreLabelFromSetup` / `buildGenreLabelFromSetup`
- `lorebookForPrompt` — trống → hướng dẫn không bịa world default
- `writeEngineRoleLine` — role LLM theo genre Setup

### 4.2 API / client bắt buộc Setup

| Luồng | Thiếu Setup → |
|-------|----------------|
| GENERATE_IDEAS / OUTLINE / WRITE / REVISE / EVALUATE | 400 |
| EXPAND / REWRITE_SCENE | 400 |
| GENERATE_IMAGE_PROMPT / REGENERATE_PROMPT | 400 |
| GENERATE_CHARACTER_PROMPT* | 400 (cần style **hoặc** genre) |
| COMMIT_MEMORY / PLAN_ARC / CHAPTER_OUTLINE | 400 |
| Novel-engine draft/plan/commit | throw `setupGenrePayload` |
| Gen video client | throw nếu thiếu style+genre |

**CẤM** default string: `"forced genre default"`, `"luật thế giới ngoài Setup cực lạnh"`, `"forced cinematic genre default…"`.

### 4.3 Genre packs (optional UX)

`src/lib/genrePacks.ts` — pack **tùy chọn** (user chọn). Không phải default engine.

---

## 5. LUỒNG NGHIỆP VỤ

### 5.1 Pipeline sản xuất media (user từng bước)

```
Setup (chu_de + phong_cach + mo_ta)
  → Outline / Kế thừa di sản
  → Viết chương (WRITE_CHAPTER + word-gate + evaluate/revise)
  → (Optional) TTS scene → duration thật
  → Gen Prompt Studio → image_prompt + video_prompt + timestamps
  → Gen ảnh → identity lock + Flow/cast ingredients
  → Gen Video → Seedance I2V + start image
  → Ship pack / CapCut → path đĩa + FableCut timeline
```

Logic **ngầm** sau bước (không nút 1-click): FableCut rebuild, Seedance sequence, YouTube psych SEO, pipeline quality — xem `docs/integrations-hub.md` + `src/lib/pipeline/*`.

### 5.2 Zero-Legacy viết văn học

1. **Tên:** Hán Việt sắc sảo; cấm tên mòn (Lâm Khuyết…).
2. **Khuyết điểm:** mỗi NV phải có điểm yếu rõ — **không** ép trope khuyết tật cứng.
3. **Pacing:** cấm time-skip tuần/tháng; ưu tiên real-time, đa giác quan có chọn lọc, thoại đời.
4. **Phân cảnh:** tối thiểu `MIN_SCENE_COUNT` (3) tag `[CẢNH N: NỘI/NGOẠI…]`.
5. **Word-gate:** mục tiêu `so_tu_chuong` (~0.92 floor); continue nếu thiếu — `pipeline/wordBand.ts`.
6. **Humanize:** câu đùa người-nói-với-người (`youtubeSafe`) khi bật.
7. **NFC** trên mọi output script.
8. **Quality gate:** `pipeline/qualityGate` + UI `QualityGateBadge` trên SceneCard / ChapterList.

Handlers: `handlers/chapter.ts`, `scene.ts`, `outline.ts`, `ideas.ts`, `foundation.ts`.  
Client: `modules/writeModule.ts`, `sceneModule.ts`, `setupModule.ts` + hooks tương ứng.

### 5.3 Gen Prompt Studio (storyboard)

**Owner API:** `handlers/imagePrompt.ts`.  
**Client:** `hooks/useImagePromptActions.ts` → `modules/imageModule.ts`.

#### Điều kiện đầu vào (hard-fail)

- `style` = Visual DNA hoặc Media Style (`resolveMediaStyle`).
- `chu_de` / `phong_cach` / `genre` từ Setup.
- `wpm`, `secondsPerBeat` > 0.
- Duration scene > 0 (TTS hoặc WPM estimate hoặc nhập tay).

#### Pipeline server (tóm tắt)

1. Split kịch bản; cảnh >100 ký tự → split `,` / `，` / `-`, accumulator **không vế < 40 ký tự** (IRON B6).
2. Cap số shot: `maxShots ≈ totalDuration / secondsPerBeat` (ceiling an toàn) — **không** default cứng 16.
3. LLM JSON: `script_prompt` (VI), `image_prompt` + `video_prompt` (EN).
4. Repair AI cho slot thiếu — **không** local heuristic fill (B10).
5. Timestamp **`start-end`s** (vd. `0-8.5s`) — khớp TTS resync (`timestampSync.ts`).
6. Shot graph: `enforceShotGraphOnPrompts` (server) — **không** double-apply client.
7. Director formulas: `applyDirectorFormulasToPromptPair` với **styleHint + genre Setup**.
8. Seedance sequence: `applySequenceToVideoPrompts` — fail → **502**, không skip im lặng.

### 5.4 Gen ảnh

**Client:** `imageModule.generateImageAction` · **API:** `/api/generate-image`

- Identity lock EN từ `nhan_vat_prompts` khi tên xuất hiện.
- `face_ref` / concept sheet / cast ingredients (Flow, max 3).
- Provider mặc định **flow**; legacy: whisk, gemini/banana, openai, grok.
- **CẤM** swap provider khi fail (B10); chỉ xoay key cùng provider.
- Browser `engine=auto`: chỉ Chromium sạch — **CẤM** fallback Google Chrome ngầm.
- Sau batch: FableCut rebuild im lặng (`integrationsModule`).

### 5.5 Gen video

- Ưu tiên `video_prompt` đã Seedance; I2V từ ảnh scene.
- Client gửi `styleHint` + `genre` Setup + `secondsPerBeat`.
- Server `/api/generate-video` — **assertProAccess** (trial|pro).
- Duration per shot: **bắt buộc** số hợp lệ — **CẤM** `|| 5` / `|| 6` im lặng trong Seedance compile.

### 5.6 TTS

| Hạng mục | Sự thật |
|----------|---------|
| Default platform | `vina_voice` |
| Registry platforms (UI) | **Active:** `edge_tts`, `piper`, `omnivoice_local`, `vina_voice`, `capcut_tts`, `tiktok_tts`, `gemini_tts` · **Removed (hard-fail):** `vieneu_tts`, `openai_tts`, `google`, `elevenlabs`, `hotai_tts`, `vbee` · source: `src/lib/tts/activePlatforms.ts` |
| Route | `src/app/api/generate-tts/route.ts` + `ttsRegistry.ts` + `platforms/*` + `engines/*` |
| Multi-voice | `lib/voiceCast.ts` — gate **chỉ** `ttsConfig` voice/speed/pitch |
| **CẤM** | `sceneEmotion` trong multi-gate |
| `sceneEmotion` | Chỉ single-voice legacy path |
| Post-FX | speed/pitch **theo segment** |
| Cache | `lib/tts/previewCache`, scene audio cache |
| Key file | `sceneAssetKey` → `generatedAudioPaths` + duration thật |
| Sau TTS | resync timestamps nếu drift >15% |

Batch SRT / Tool Dịch: `/api/tts-batch-srt` + `lib/ttsBatchSrt/*` (Cap Gemini method — không DeepSeek).

### 5.7 YouTube / SEO

- `youtubePsych55` + anti-motif kênh.
- Thumb prompt EN gen như scene; checklist safe.
- **CẤM** hardcode 1 template SEO chết khi extract fail (B10).

### 5.8 Ship / CapCut / FableCut

- Ship pack resolve **path đĩa thật**.
- CapCut export: Pro gate `assertProAccess` khi enforce.
- CapCut thiếu binary → **báo lỗi**, không nhảy Edge.
- Artifact: `exports/integrations/fablecut/...`

### 5.9 Google Flow Bridge

| Thành phần | Path / port |
|------------|-------------|
| Extension | `extensions/ainovel-flow` |
| Bridge | `src/lib/flow-bridge` |
| WS | **9223** (`AINOVEL_FLOW_WS_PORT`) |
| HTTP | **8101** (`AINOVEL_FLOW_HTTP_PORT`) |
| API app | `/api/flow/*` |
| Default | `imageProvider=flow`, `videoProvider=flow` |
| Multi-account | Media Config + profiles `accounts_data/` |

Docs: `docs/flow-bridge.md`, `docs/flow-environment-setup.md`.

### 5.10 Pipeline content (P0–P2)

| Module | Path | Việc |
|--------|------|------|
| Quality gate | `lib/pipeline/qualityGate.ts` | Đánh giá chương / media-ready |
| Memory | `lib/pipeline/memoryAfterCommit.ts` | Foreshadow + memory pack |
| Preflight | `mediaPreflight` / `ttsMediaPreflight` | Chặn gen media/TTS khi thiếu điều kiện |
| Stage queue | `sceneStageQueue.ts` | Batch prompt/image/video jobs |
| Long-form arc | `longformArc.ts` | Arc/volume cho novel engine |
| Store | `pipelineStore.ts` | Snapshot portable + UI badges |

Smoke: `npm run smoke:pipeline`.

---

## 6. HỒ SƠ NHÂN VẬT

### 6.1 Schema (`lib/characterProfile.ts`)

| Field | Bắt buộc (setup đủ) | Ghi chú |
|-------|---------------------|---------|
| gioi_tinh, tuoi, dang_nguoi, vai_tro | Có | |
| quan_ao, so_thich, thoi_quen, dong_co | Có | |
| giong_thoai, tts_voice | Có | TTS per role |
| ngoai_hinh | Có | Face lock |
| dac_diem_nhan_dang | Có | Marks nhìn thấy được |
| **khuet_tat** | **Có** | **Khuyết điểm** (điểm yếu) — **không** = “trope khuyết tật cứng” |
| prompt | Có | Master EN identity |
| angle_prompts / expression_prompts | Sheet | 4 góc + 8 biểu cảm |
| face_ref | Sau gen concept | Path local |

Validate: `getCharacterProfileSetupStatus` + `CHAR_PROFILE_REQUIRED_FIELDS`.

### 6.2 Gen prompt NV

- `GENERATE_CHARACTER_PROMPT` → full sheet + `applyCharacterSheetFormulas(styleHint, genre)`.
- `GENERATE_CHARACTER_PROMPT_ONLY` → master only + formula.
- Style/genre từ Visual DNA + Setup — **không** hardcode cinematic natural realism.

### 6.3 Consistency khi gen ảnh scene

Quét tên trong `prompt`/`sentence` → `buildIdentityLockEnglish` + face_ref/concept → `characterPrompt` + ingredients Flow.

---

## 7. DOMAIN OWNERSHIP

```
script | tts | media-image | media-video | youtube | channels
toolbox-labs | ainovel-engine | credentials | export
```

Map: `docs/DOMAIN_MAP.md` + `src/contracts/domainOwnership.ts`.

| Domain | Owner chính |
|--------|-------------|
| script | features/script, write/scene/setup modules, generate handlers chapter/scene/outline/ideas/foundation |
| tts | features/tts, ttsModule, generate-tts, vinaVoice, voiceCast |
| media-image | imageModule, generate-image/providers, flow-bridge, imagePrompt/character handlers |
| media-video | videoModule, generate-video, seedance* |
| youtube | features/youtube, lib/youtube-safe, youtubePsych55 |
| channels | features/channels, channel store, ship-pack |
| ainovel-engine | features/ainovel, lib/novel-engine, api/ainovel |
| credentials | settings, license, entitlement, commercial |
| export | CapCut, ship-pack |
| toolbox-labs | toolbox (ẩn mặc định), navtools, bypass-engine, video-editor |

Cross-domain **chỉ** `@/contracts` hoặc HTTP.

---

## 8. API GENERATE — BẢNG HANDLER

`POST /api/generate` body: `{ requestType, apiKeys, model, payload }`.  
Route chỉ dispatch — logic trong `src/app/api/generate/handlers/`.

| Handler | requestTypes |
|---------|----------------|
| `visualDna.ts` | `ANALYZE_VISUAL_DNA` |
| `ideas.ts` | `GENERATE_IDEA(S)`, `ANALYZE_YOUTUBE_PLOT` |
| `outline.ts` | `GENERATE_OUTLINE`, `GENERATE_CHAPTER_OUTLINE`, `PLAN_ARC` |
| `chapter.ts` | `WRITE_CHAPTER`, `REVISE_CHAPTER`, `EVALUATE_CHAPTER`, `COMMIT_MEMORY` |
| `scene.ts` | `EXPAND_SCENE`, `REWRITE_SCENE` |
| `imagePrompt.ts` | `GENERATE_IMAGE_PROMPT`, `REGENERATE_PROMPT` |
| `character.ts` | `EXTRACT_CHARACTERS`, `GENERATE_CHARACTER_PROMPT`, `GENERATE_CHARACTER_PROMPT_ONLY` |
| `foundation.ts` | `COMPRESS_CONTEXT`, `IMPORT_FOUNDATION`, `SUMMARIZE_SCRIPT_OUTLINE` |

Client **bắt buộc** `postGenerate(requestType, payload)` từ `modules/apiClient.ts` — không copy-paste fetch keys.

HTTP map đầy đủ: `src/contracts/apiMap.ts` (`API.*`).

---

## 9. ASSET KEY & FILE ĐĨA

Từ `@/contracts` / `keys.ts` / `GLOSSARY.md`:

| Asset | Hàm | Ví dụ |
|-------|-----|--------|
| Audio / prompts scene | `sceneAssetKey(ch, sc)` | `3_2` |
| Ảnh prompt | `imageAssetKey(ch, sc, pi)` | `3_2_0` |
| Video prompt | `videoAssetKey(ch, sc, pi)` | `3_2_0_video` |
| Ảnh NV | `characterImageKey(name)` | `char_Hàn Dực` |
| Angle / expr | `characterAngleImageKey` / `characterExprImageKey` | |
| File audio | `localAudioFilename` | `chapter_3_scene_2.mp3` |
| File ảnh | `localImageFilename` | `chapter_3_scene_2_prompt_0.png` |

**CẤM** ghép key string ad-hoc.

Timestamps prompt: **`start-end`s** (vd. `12-18.5s`).  
Legacy duration-start chỉ parse tương thích; code mới **không** sinh format cũ.

---

## 10. BINARIES & ENTITLEMENT (tóm tắt ops)

| Binary | Path |
|--------|------|
| FFmpeg | `bin/ffmpeg.exe` và/hoặc `python_core/ffmpeg/` |
| Piper | `bin/piper/piper.exe` |
| Edge TTS | **chỉ** khi `platform === 'edge_tts'` |
| CapCut | detect `LOCALAPPDATA/CapCut/Apps` — thiếu → lỗi, không fallback |
| Chromium (Flow/Whisk) | portable / install qua `/api/flow/install-browser` — auto **không** nhảy Chrome hệ thống |

| Mode | Ý nghĩa |
|------|---------|
| `AINOVEL_ENTITLEMENT_MODE=open` | Dev/web — Pro routes cho phép |
| `=enforce` | Token Ed25519 / trial token; packaged Electron mặc định |

---

## 11. B10 — CẤM FALLBACK (CHECKLIST AGENT)

| Được phép | Cấm tuyệt đối |
|-----------|----------------|
| Xoay API key **cùng** provider | Đổi platform/engine/provider khi fail |
| Retry cùng endpoint/model/voice | Gen mẫu / demo / heuristic thay API |
| Hard-fail + message hành động | Soft-success, toast mơ hồ, fake media |
| | CapCut fail → Edge; Flow fail → Gemini ngầm |
| | Local director fill prompt khi AI fail |
| | `duration \|\| 5` / `beat \|\| 6` / genre default ngoài Setup |
| | Auto browser → Google Chrome khi cần Chromium sạch |
| | Trial badge gộp nhầm thành PRO trả phí (phải `is_trial`) |

**Show, don't tell:** trước khi báo xong media — file `.mp3`/`.mp4`/`.png` **tồn tại trên đĩa** + log terminal thật.

---

## 12. ĐỊNH CHẾ CHO MỌI AGENT (CISO / RUNTIME)

1. **Thực thi theo IRON_LAWS + AGENTS này** — không “đoán” kiến trúc legacy.
2. **Empirical Validation Loop:** sửa code → chạy lệnh thật → đọc log → auto-debug đến pass; **cấm** hallucinate test.
3. **Zero-Trust Logic Preservation:** không phá module đang chạy; feature mới modular; quét code cũ trước khi sửa.
4. **Setup / genre / style:** luôn wire từ store; hard-fail khi thiếu — **không** hardcode thể loại mặc định.
5. **Khuyết điểm NV:** bắt buộc điểm yếu; **không** ép trope khuyết tật cứng.
6. **Contracts:** key/API/DTO từ `@/contracts`; không invent.
7. **Hydration:** `isHydrated` mặc định true — không re-introduce spinner chặn boot; rehydrate durable vẫn an toàn.
8. **TTS multi:** không nhét `sceneEmotion` vào gate multi.
9. **Không 1-click gộp** Prompt+Ảnh+Video+TTS.
10. **Commercial:** trial ≠ paid Pro trên UI; server gate đúng featureMatrix.
11. **Next.js 16:** đọc `node_modules/next/dist/docs/` khi API framework khác training data.
12. **NAV host-binding:** không bẻ guard để chạy CLI toolbox standalone trên máy user production.
13. **Done Gate (chống ảo giác):** tuân `docs/AGENT_DONE_GATE.md` — cấm báo DONE khi chưa có log domain; xem §12b.

### 12b. AGENT DONE GATE (LOCKED — chống ảo giác khi báo xong)

Spec đầy đủ: [`docs/AGENT_DONE_GATE.md`](docs/AGENT_DONE_GATE.md).

| Nấc | Ý nghĩa | Cấm gọi “hoàn thành” nếu chỉ có nấc này |
|-----|---------|----------------------------------------|
| `IMPLEMENTED` | Đã sửa code | Có — chưa xong |
| `TYPECHECK_OK` | `npm run typecheck` exit 0 | Có — chưa xong feature |
| `SMOKE_OK` | smoke domain exit 0 | Chỉ được claim smoke, chưa DONE toàn task nếu thiếu media |
| `MEDIA_OK` | file `.mp3`/`.wav`/`.png`/`.mp4` trên đĩa size>0 | — |
| `DONE` | User-facing xong | Cần typecheck + smoke domain + gatekeeper PASS + log trích |

**Final Gatekeeper (Grok Build):**

1. Chạy domain verify (tối thiểu `npm run verify:agent-done` khi có diff).
2. `spawn_subagent` · `subagent_type: general-purpose` · skill **empirical-qa-auditor** (prompt + draft + logs).
3. Chỉ khi auditor (hoặc self-role Zero-Trust sau log) in **`VERDICT: PASS`** → được gửi DONE cho user.
4. **`VERDICT: REJECT`** → sửa + re-run; **cấm** đẩy lỗi cho user tự test.

| Legacy (Claude docs) | Grok Build |
|----------------------|------------|
| `invoke_subagent` | `spawn_subagent` |
| `run_command` | `run_terminal_command` |
| `define_subagent` | không dùng — dùng `subagent_type` có sẵn |

**CẤM từ trong báo cáo xong:** “có vẻ”, “giả sử”, “bạn tự test”, “should work”, chép MEMORY PASS không re-run.

**MEMORY evidence:** `- **YYYY-MM-DD:** claim. Proof: \`cmd\` → exit 0; note: <log>.`

---

## 13. CHECKLIST 30 GIÂY TRƯỚC KHI BÁO XONG / MERGE

- [ ] Có chạm `ainovel-gui` / `:8080`? → rollback
- [ ] Có import cross-domain lậu? → contracts/API
- [ ] Có hardcode thể loại mặc định / cinematic natural realism / local prompt fill?
- [ ] Setup `chu_de`+`phong_cach` có được truyền vào write/gen/engine?
- [ ] TTS multi-gate có dính `sceneEmotion`?
- [ ] Duration/beat thiếu có hard-fail (không `|| 5`)?
- [ ] NFC cho chuỗi VN user-facing?
- [ ] Trial UI có hiện **TRIAL** (không PRO) khi `is_trial`?
- [ ] License: có `f(token)` / private client / quota ngày? → rollback (xem `LICENSE_ONE_PATH.md`)
- [ ] Worker/temp: `finally` cleanup?
- [ ] Đã chạy smoke/typecheck/verify liên quan domain vừa sửa?
- [ ] **Done Gate:** `npm run verify:agent-done` (hoặc domain smokes) exit 0 + log trích trong reply?
- [ ] **Gatekeeper:** empirical-qa `VERDICT: PASS` (không tự PASS không log)?
- [ ] Trạng thái đúng nấc (`IMPLEMENTED` ≠ `DONE`)?

---

## 14. LỆNH VERIFY THƯỜNG DÙNG

| Lệnh | Việc |
|------|------|
| `npm run typecheck` | `tsc --noEmit` |
| `npm run smoke:core` | Smoke lõi |
| `npm run smoke:pipeline` | Pipeline P0–P2 |
| `npm run smoke:commercial` | Entitlement / trial / codes / one-path |
| `npm run smoke:license-one-path` | Policy ticket·ledger·crown (cấm f(token), cấm quota ngày) |
| `npm run smoke:vina` | Vina catalog 76 profile ↔ 76 WAV + JSON |
| `npm run verify:tts-integrity` | TTS audio quality + preview timeout budgets |
| `npm run verify:agent-done` | **Machine Done Gate** — auto domain từ git diff |
| `npm run verify:core` | Channel DNA + ship + publish + youtube-safe + output criteria |
| `npm run prepare:publish` | typecheck + smokes + verify:core |
| `npm run preflight:pack` | Gate pack + banner PACK_NOTES (LICENSE sole truth) |
| `npm run pack:ship` | Portable QA unsigned (+ smokes + postpack checklist) |
| `npm run postpack:checklist` | Kiểm artifact sau pack |

---

## 15. CON TRỎ FILE NHANH

| Nhu cầu | Path |
|---------|------|
| **Done Gate / chống ảo giác** | `docs/AGENT_DONE_GATE.md` |
| Quy luật thép | `docs/IRON_LAWS.md` |
| Domain map | `docs/DOMAIN_MAP.md` |
| Commercial | `docs/COMMERCIAL.md`, `docs/LICENSE_ONE_PATH.md`, `src/lib/commercial/licenseOnePath.ts`, `src/lib/entitlement.ts` |
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
| Pipeline | `src/lib/pipeline/*` |
| Workspace arch | `src/app/workspace/ARCHITECTURE.md` |
| License UI | `src/app/workspace/features/license/*` |
| Entitlement sync | `src/app/workspace/hooks/useEntitlementSync.ts` |
| Memory agent | `MEMORY.md` |

---

<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know
This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->
