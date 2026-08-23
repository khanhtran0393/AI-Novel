# Project memory (AI Novel) — snapshot runtime

> **Chân lý ngắn:** ghi nhớ theo **code + package.json + release-notes**, không theo log phiên cũ.  
> Spec dài: `AGENTS.md` · Done Gate: `docs/AGENT_DONE_GATE.md` · Pack: `docs/PACK_NOTES.md` · Update: `docs/APP_UPDATE.md`

**Cập nhật:** 2026-08-07 · **version:** `1.1.6` · **artifact:** `dist-qa-unsigned/AI-Novel-1.1.6-x64.exe` · **Pack 1.1.6 theo PACK_NOTES 4 bước:** open mode toàn bộ · dọn cache browser · auto-update unsigned · full verify chain PASS (`audit:package`, anti-tamper, labyrinth, re-harden, crown-ip, defense-pack, postpack).


---
## Nova Studio GUI Overlay (2026-08-16)

- **Mục tiêu:** chuyển GUI AI Novel sang phong cách **Nova Studio** (nền tối ấm + accent cam + Be Vietnam Pro) — giữ nguyên kiến trúc Next 16 / React 19 / Tailwind v4 / Electron / Zustand.
- **Design tokens:** Nova đã được trích vào `src/app/globals.css` (`--nova-*`); bổ sung `--nova-text-2`, font-face **Be Vietnam Pro** (bundle local `public/fonts/be-vietnam-pro/*.woff2`, Electron offline), remap `@theme inline`: `zinc` → bề mặt/viền/chữ Nova, `emerald` → family accent cam, `amber` → vàng ấm Nova; shadow `shadow-nova-glow(-sm)/btn/card`.
- **layout.tsx:** bỏ `next/font/google` Geist (hết phụ thuộc mạng lúc build), `lang="vi"`.
- **Hex cũ:** `#ff7b00`→`var(--nova-accent)`; slate video-editor → `--nova-surface*`; `#050505`→`--nova-bg`; inline style SceneCard/ContentTab → `var(--nova-green)` (success) / `var(--nova-accent)` (incomplete).
- **Repair v→a:** 7 file video-editor + FlowAgentStudioModal bị hỏng sẵn trong working tree (`v`→`a`: `dia`, `hoaer`, `aoid`…) → restore từ HEAD + áp lại Nova palette; typecheck hết lỗi.
- **Ship-check fix:** `docs/NPM_DEPENDENCY_NOTICE.json` version 1.1.6 → 1.1.7 khớp `package.json`.
- **Proof:** `npm run typecheck` → exit 0; `npm run build` → compiled 38.2s + TS pass; runtime computed-style: bodyFont="Be Vietnam Pro", bodyBg rgb(15,15,18), emeraldBtn rgb(224,122,70)=#e07a46, fontLoaded=true; `npm run verify:agent-done` → **VERDICT: PASS** (typecheck, smoke:vina, tts-integrity, pipeline, license-one-path, core, ship:check đều exit 0).



## 0. Security Audit & Pre-Release Hardening 1.0.15 (2026-07-27)

- **IPC Security:** `main.js` (`isAllowedShellOpenPath`) updated to reject remote UNC paths (`\\\\` / `//`), preventing NTLM coercion / remote share shell execution.
- **Test Alignment:** `smoke-commercial.mjs` synced to active route contracts; `smoke-telegram-admin.mts` day presets synced (`[1, 3, 7, 15, 30]`).
- **Notices Sync:** `npm run commercial:notices` generated 279 third-party packages notice for v1.0.15.
- **Verification:** `verify:agent-done` (typecheck + license-one-path + ship:check) **PASS**.

---

## 1. Snapshot hiện tại

| Hạng mục | Giá trị |
|----------|---------|
| Product | Ai Novel desktop (Next 16 + Electron 43 + React 19) |
| `package.json` | **1.0.15** |
| Release notes | `resources/commercial/release-notes.json` (1.0.15 security & entitlement harden) |
| Pack / feed | **NSIS 1.0.12** local · **GitHub v1.0.12** · Supabase yml residual 1.0.0 |
| Feed auto-update | Dual: GitHub Releases primary · Supabase Storage fallback (unsigned OK) |
| Entitlement packaged | `enforce` · sole truth Supabase `licenses` by HWID · token Ed25519 offline verify |
| Engine viết | **native-ts** `src/lib/novel-engine/*` — **CẤM** `ainovel-gui.exe` / proxy `:8080` |
| Default media | `imageProvider=flow` · `videoProvider=flow` · models GEM_PIX_2 / veo_3_1_t2v_fast · duration 8s (Flow 4\|6\|8) |
| Default TTS | `edge_tts` + `vi-VN-HoaiMyNeural` (Free). LA Studio / premium = Trial·Pro |
| Active TTS | `edge_tts`, `piper`, `omnivoice_local`, `la_studio`, `capcut_tts`, `tiktok_tts`, `gemini_tts` (`src/lib/tts/activePlatforms.ts`) |
| Export timeline | Nút **CapCut** → pack XinChao-Cut (`tools/xinchao-cut`) + soft cutsdk/FableCut; API `POST /api/export-capcut` (+ alias `/api/export-xinchao`) |
| Hydration | `isHydrated` **default true** — cấm spinner chặn workspace vô hạn |

### Pipeline user (từng bước — không 1-click gộp)

```
Setup (chu_de + phong_cach)
  → Outline / Viết chương (word-gate + quality gate)
  → TTS scene (duration thật) [tuỳ]
  → Gen Prompt Studio → Gen ảnh → Gen Video
  → Ship / CapCut (XinChao-Cut)
```

### Commercial (tóm tắt)

| Tier | Ý nghĩa |
|------|---------|
| Free | Viết / outline / prompt / ảnh BYOK / TTS Edge·Piper; credits hữu hạn |
| Trial | 7 ngày · 1 HWID · Pro-equivalent tạm · 5 lượt/ngày · ≤3000 từ · ≤10 chương · badge **TRIAL** |
| Pro | License HWID · video · CapCut · ship · multi-channel · toolbox · Flow multi-account |

Badge UI: **TRIAL → PRO → FREE**. `is_trial` không gộp nhầm PRO trả phí.

---

## 2. Domain & ownership (không đoán)

| Domain | Owner chính |
|--------|-------------|
| script | `features/script`, write/scene/setup modules, generate handlers |
| tts | `features/tts`, generate-tts, voiceCast, chapter TTS export |
| media-image | imageModule, generate-image, flow-bridge |
| media-video | videoModule, generate-video, seedance, video-api (HeyGen detect) |
| youtube | youtubeSource + source-ingest (YT+web, không Flow browser), psych55, safe |
| channels | multi-channel DNA + ship |
| export | CapCut/XinChao-Cut + ship-pack |
| credentials | license, entitlement, keys |
| ainovel-engine | native-ts + `/api/ainovel/*` |

Map: `docs/DOMAIN_MAP.md` · `src/contracts/domainOwnership.ts`  
Cross-domain **chỉ** `@/contracts` hoặc HTTP.

---

## 3. Runtime cứng (LOCKED)

### 3.1 B10 — cấm fallback nội dung

- Chỉ được **xoay API key cùng provider**.
- Cấm: đổi platform/engine/provider ngầm · gen mẫu · soft-success · CapCut fail → Edge · Flow fail → Gemini · `duration \|\| 5` · genre default ngoài Setup.

### 3.2 Setup genre

- `setup.chu_de` + `setup.phong_cach` **bắt buộc** cho write / gen prompt / engine.
- Thiếu → 400 / throw — **không** hardcode thể loại.

### 3.3 Flow bridge

| | |
|--|--|
| Code | `src/lib/flow-bridge/*` + `extensions/ainovel-flow` |
| WS / HTTP | **9223** / **8101** |
| Boot app | Chỉ `GET /api/flow/status` — **không** mở Chrome khi mở app |
| Login | User bấm Media Config → bootstrap `forceChrome` |
| Quit | `killAllFlowBrowsers` — chỉ profile Flow (`accounts_data` / `flow-profiles` / `browser-profiles`), không đụng Chrome cá nhân |
| Video | Default **async 202** + poll `/api/flow/task?finalize=1` · `maxDuration` 900s |
| Proxy | UI per profile Media Config · `resolveAccountProxy` |
| Focus | Extension soft-wake (`stealFocus:false`) trừ challenge `/sorry/` |
| Docs | `docs/flow-bridge.md` |

### 3.4 GUI / Electron anti-freeze

| Lớp | Cơ chế |
|-----|--------|
| Main | Boot store cache 60s · **không** `commitWrite` trên `sendSync` · persist IPC schedule async |
| Preload | `getItem` hard-timeout **1500ms** · credential migrate 1×/session |
| Renderer | `runWithPersistMuted` batch · deferred stringify debounce · appWork / off-thread host |
| Off-GUI | `electron/workHost.cjs` + `workBridge.js` · `src/lib/appWork/*` (utilityProcess → Worker fallback) |
| Wire off-GUI | image/video/character modules · `postJson` · Flow progress poll |
| Ops đơ | **Đóng hẳn Electron + mở lại**; **không** `pack:ship` khi đang dùng app (tranh :3000) |

### 3.5 Export CapCut / XinChao-Cut

- UI: `XinChaoCutExportButton` / `CapCutExportButton` (nhãn CapCut) trong Header.
- Primary pack: `buildXinChaoPack` · runtime vendored `tools/xinchao-cut` (không junction repo ngoài trên gói khách).
- Scripts: `xinchao:qa` · `xinchao:build:verified` · `smoke:xinchao` · `smoke:xinchao:runtime` · `smoke:xinchao:native`.
- Docs: `docs/integrations-hub.md` § CapCut runtime.

### 3.6 Media reconcile (1.0.11)

- `src/lib/mediaDiskReconcile.ts` + store `reconcileMissingMediaAssets`.
- Auto: workspace mount + trước CapCut export · toast warn path ảo.
- API: `POST /api/media/reconcile`.

### 3.7 Key rotate

- Auth cooldown **20 phút** (không còn 6h “giữ nhịp”).
- Classify 403 quota vs auth; pool reason **auth**.
- `clearAllKeyCooldowns` khi `setApiKeys`.

### 3.8 License one-path

- Sole truth: row Supabase `licenses` **active** theo **HWID** → Pro/Trial; revoke/delete/expired → **Free** dù crypto token còn verify.
- Machine store (free quota / local trial meta): `%USER_DATA%/.ainovel-license/` (+ HKCU secondary) — sống sót portable wipe.
- Cấm: `f(token)` quota ngày client · private key trong gói khách · `ENTITLEMENT_MODE=open` trên `public.env` ship.
- Docs: `docs/LICENSE_ONE_PATH.md`.

### 3.9 Auto-update (≥1.0.10 code path)

1. Mở app packaged → check feed  
2. Tự tải nền  
3. **Không** cài khi đóng  
4. **Lần mở sau** → NSIS **`/S`** silent (`spawnSilentNsis`)  
5. Modal changelog `UpdateSuccessModal` — không Setup wizard  

Cài tay double-click `.exe` vẫn có UI (đúng). Docs: `docs/APP_UPDATE.md`.

---

## 4. Release notes gần đây (tóm)

| Ver | Ngày | Tiêu đề |
|-----|------|---------|
| **1.0.11** | 2026-07-25 | Ghost media reconcile · key rotate 20m · Flow I2V compress/warm · T2V async · TTS walk schema |
| **1.0.10** | 2026-07-24 | Silent NSIS update · oneClick · không Setup wizard |
| **1.0.9** | 2026-07-24 | Quit app → kill Flow browser · pack typecheck xinchao exclude |
| **1.0.8** | 2026-07-24 | Flow progress/captcha/upload · model hints · Piper VN +3 · outline UX |
| **1.0.7** | 2026-07-23 | Piper ship path · LA Studio download URL · memory/cast hard-fail |
| **1.0.6** | 2026-07-23 | License tier 1 nguồn · Free clamp Setup · workflow UX |
| **1.0.5** | 2026-07-22 | White-machine TTS `/audio/*` · pack ship baseline |

Chi tiết item: `resources/commercial/release-notes.json`.

---

## 4b. Flow login double-window (2026-07-25)

**Bug user:** xóa profile → browser tự mở → mở thêm 1 cửa sổ → cửa sổ kia tự tắt (đặc biệt khi thử Chrome fallback).

**Root cause:**
1. `bootstrap` extension-slow path `launchChrome(forceClean:true)` kill cửa sổ login + spawn lần 2
2. `token_captured` spawn background **thêm** sau `closeLoginSessionAfterCapture` (đã relaunch)
3. Login args có `--new-window` → cửa sổ trống thừa

**Fix:** giữ cùng cửa sổ khi extension chậm; crash mới recovery 1 lần; single-owner background; bỏ `--new-window`. Smoke: `smoke-flow-no-extra-login-tab` · `smoke-flow-login-close`. **Không** fallback Chrome ngầm (B10) — dùng Brave/portable.

## 4c. Flow profile hard-delete + audit (2026-07-25)

**Bug:** `deleteAccount` chỉ xóa `data/flow-bridge/accounts.json` → sót `accounts_data/<id>` (orphan cookies/extension).

**Live audit máy này:**
- Store: 1 profile `acc_mrxr6w87_ur1ba` · email `khanhtran0393@gmail.com` · bind/meta/URL khớp
- Browser exe: **Playwright Chromium** (ms-playwright) — **không** có Brave cài trên máy
- Orphan cũ `acc_mrxppajc_*` / `acc_mrxppz60_*` đã purge

**Fix:** `purgeAccountProfile` + `deleteAccountHard` + API/runtime clear bearer. Smoke: `scripts/smoke-flow-profile-purge.mts` PASS.

---

## 5. Tính năng đã có (không phải WIP)

| Vùng | Sự thật ngắn |
|------|----------------|
| Character bible | Sheet: 4 góc + biểu cảm + pose · `chieu_cao`/`phu_kien`/`mau_sac` · style từ Setup |
| Character sheet disk | Unique filename per NV · auto `face_ref` + `generatedImages` |
| Gen video button | Default 1 clip/prompt; «Nối Video» chỉ khi Start+End + 2 still |
| External video API | Catalog + detect (HeyGen…) · Media Config dán key · store `externalVideoApis` |
| Flow model pick | Toast + panel yêu cầu theo model (I2V/T2V/R2V) |
| Chapter TTS | Force full chapter → `chapter_N_full.mp3` + `.srt` · persist mute anti-freeze |
| Credits Free/Trial | Batch gen preflight `assertBatchCreditsOrToast` — hết tín dụng toast rõ |
| Telegram admin | Day keys 3/7/15/30 · menu/buttons · pending-escape · deploy-bridge |
| YouTube source | Caption chain python/timedtext/yt-dlp — **không** dùng Flow browser |
| Multi-source rewrite | `/api/source-ingest` · YT giữ nguyên chain · Web = direct HTML extract · Jina optional `AINOVEL_SOURCE_JINA=1` · Proof: `npx tsx scripts/smoke-source-ingest.mts` |
| Defense pack | Grace offline · ASAR integrity · deny log · labyrinth/anti-tamper smokes |
| Word gate | Band theo `so_tu_chuong` · condense overshoot · Free quality gate |

---

## 6. Ops / sự thật vận hành (còn đúng)

| Tình huống | Cách xử lý |
|------------|------------|
| Electron Not Responding / HTTP :3000 timeout | Kill process · **không pack:ship song song** · mở lại app |
| Flow ext/key đỏ | Media Config → bootstrap `forceChrome` · token ~1h |
| Gemini 403 / quota | User thay key Settings · cooldown auth 20m sau 1.0.11 |
| GEM_PIX_2 INVALID_ARGUMENT | Message gợi ý NARWHAL — **không** silent swap model |
| I2V upload chậm/timeout | Ảnh start nén mạnh (threshold ~450KB) · timeout dài hơn · warm tab |
| Ghost audio/ảnh trong UI | Reconcile disk (1.0.11) hoặc xóa path store trỏ file mất |
| Cửa sổ XinChao hang | Đóng Electron · `npm run xinchao:install` / `xinchao:dev` nếu thiếu runtime |
| User kẹt bản update cũ | Cài tay 1 lần từ Releases (≥1.0.10 silent path); sau đó auto |
| Trial ghost badge | Sole truth Supabase — vault local không được “đẻ” TRIAL khi ledger trống |
| Dev Pro routes | `ENTITLEMENT_MODE=open` dev — **≠** gói khách `enforce` |

---

## 7. Verify / smoke hay dùng

| Lệnh | Việc |
|------|------|
| `npm run typecheck` | `tsc --noEmit` |
| `npm run verify:agent-done` | Done Gate theo git diff |
| `npm run smoke:core` / `smoke:pipeline` / `smoke:commercial` | Lõi / pipeline / entitlement |
| `npm run smoke:license-one-path` | Ticket·ledger·crown policy |
| `npm run smoke:vina` / `verify:tts-integrity` | TTS catalog / quality |
| `npx tsx scripts/smoke-media-reconcile-and-keys.mts` | Ghost media + key rotate |
| `npx tsx scripts/smoke-boot-no-freeze.mts` | Boot main không block HTTP |
| `npx tsx scripts/smoke-gui-jank-guards.mts` | Anti-jank contracts |
| `npx tsx scripts/smoke-flow-video-async.mts` | Flow video async path |
| `npx tsx scripts/smoke-xinchao-export.mts` | CapCut/XinChao pack |
| `npx tsx scripts/smoke-update-silent.mts` | Silent NSIS update |
| `npx tsx scripts/walk-user-workflow-live.mts` | Walk live user path (cần server + keys) |
| `npm run pack:ship` | NSIS QA full + postpack |
| `npm run release:ship-update` | Publish feed sau pack |

**Done Gate ladder:** `IMPLEMENTED` → `TYPECHECK_OK` → `SMOKE_OK` → `MEDIA_OK` → `DONE`.  
Typecheck xanh ≠ feature xong. Media claim cần file đĩa size>0 + log terminal.

---

## 8. Bằng chứng gần (rút gọn — không hallucinate)

### 2026-07-25 — live walk + fix-all

- Script: `walk-user-workflow-live.mts` + retest tay.
- **PASS:** boot · Setup · ch1 ~1400w · TTS Piper/Edge file đĩa · Flow image NARWHAL PNG · CapCut pack.
- **Fix:** media reconcile · key rotate 20m · I2V compress/timeout · imageModel alias.
- Proof smokes: `smoke-media-reconcile-and-keys` · `tsc --noEmit` 0.

### 2026-07-24 — pack + GUI + Flow video

- Pack **1.0.10** silent update · postpack PASS.
- Boot freeze: main không commitWrite sync · smoke-boot-no-freeze.
- Flow I2V/T2V live: mp4 trên `public/video/` (I2V async task + T2V bridge).
- Off-GUI workHost + appWork · gui-jank-guards PASS.
- XinChao export smoke + open-editor harden.

### 2026-07-22…23 — commercial / license / TTS ship

- License sole truth Supabase HWID · trial unlock Pro gates · machine store wipe-safe.
- Telegram admin + payment messageId.
- Piper ship path gói khách · word gate · YouTube rewrite/caption chain.

---

## 9. WIP working tree (chưa coi là đã ship 1.0.11)

Git status snapshot đầu phiên: **nhiều file modified/untracked** trên `main` (Flow, media reconcile, XinChao, appWork, video-api, smokes, docs…).

| Ý nghĩa | Hành động |
|---------|-----------|
| Code 1.0.11 đã có notes | Cần **`npm run pack:ship`** + (nếu user update) **`release:ship-update`** |
| Artifact đĩa vẫn 1.0.10 | User cài tay / feed chưa nhận 1.0.11 cho đến khi pack+publish |
| Agent báo DONE | Phải smoke domain + log — cấm chép mục 8 khi chưa re-run |

---

## 10. Con trỏ nhanh

| Nhu cầu | Path |
|---------|------|
| Done Gate | `docs/AGENT_DONE_GATE.md` |
| Iron laws | `docs/IRON_LAWS.md` |
| Domain | `docs/DOMAIN_MAP.md` |
| Pack 4 bước | `docs/PACK_NOTES.md` |
| Update | `docs/APP_UPDATE.md` |
| Commercial | `docs/COMMERCIAL.md` · `LICENSE_ONE_PATH.md` |
| Flow | `docs/flow-bridge.md` |
| Integrations | `docs/integrations-hub.md` |
| Contracts | `src/contracts/*` |
| Workspace arch | `src/app/workspace/ARCHITECTURE.md` |
| Giải phẫu full | `AGENTS.md` |

---

## 11. Tích hợp Bài học từ LaoTonTransDub (Upgrade Pipeline)

Sau khi phân tích giải phẫu phần mềm **LaoTonTransDub (v1.0.8)**, dự án tích hợp 4 chiến lược định hướng sản xuất video & kịch bản:

1. **Prompt Presets cho Văn phong & Tone kịch bản (Style Presets)**:
   - Đưa hệ thống văn phong (*Võ hiệp giang hồ, Phim cổ trang, Hài hước nhẹ nhàng, Kinh dị căng thẳng, Kể chuyện tự nhiên*) vào System Prompt của Setup & AI Novel Engine.
2. **Tạo Sub & Burn-Sub tự động cho Video đầu-cuối (End-to-End Subtitle & Dubbing Pipeline)** (Thay thế điểm 2):
   - Tự động sinh file Sub `.srt`/`.ass` khớp mili-giây theo `generatedAudioPaths` của TTS.
   - Hỗ trợ **Sub Style Presets** (Phim Điện ảnh, TikTok / Shorts chữ vàng viền đen, Song ngữ Việt-Anh / Việt-Trung).
   - Tự động Muxing qua FFmpeg: ghép `Video + Voiceover TTS + Hardsub + BGM` xuất ra file `.mp4` hoàn chỉnh ăn liền (hoặc export dự án CapCut).
3. **Bộ lọc căn chỉnh Audio Mixer thông minh (Auto Ducking & Audio Balance)**:
   - Căn chỉnh tỉ lệ âm lượng giọng đọc vs nhạc nền BGM, tự động giảm BGM (ducking) khi có lời nói lồng tiếng (`mute_original_audio`, `music_volume_slider`, `original_volume_slider`).
4. **Module Video OCR & Trích xuất Kịch bản từ Video mẫu (Video-to-Script Ingestion)**:
   - Sử dụng Video OCR/STT bóc tách chữ & kịch bản thô từ video mẫu (Douyin, YouTube Shorts, Reels) làm dữ liệu đầu vào cho AI Novel chuyển thể thành kịch bản tác phẩm mới 100%.

---

*Ghi chú phiên dài / debug one-off: append mục ngắn phía dưới đây khi cần; **không** nhồi lại dump 1000+ dòng. Ưu tiên bảng + path + lệnh proof.*

---

## 12. Pack 1.1.6 theo PACK_NOTES (2026-08-07)

- **- 2026-08-07:** Pack ver **1.1.6** hoàn tất theo quy trình 4 bước (`docs/PACK_NOTES.md`). Proof: `npm run pack:ship` → log `C:\Users\Khanh\AppData\Local\Temp\cline\background-1786102942464-dhydqyd.log`: preflight PASS · Next build OK · xinchao native BUILD_OK · electron-builder NSIS `AI-Novel-1.1.6-x64.exe` 865.182.979 bytes · `latest.yml` version **1.1.6** sha512 `mTNjnSEYkKMCPb2oGQGDj0I9…` · audit:package PASS (15238 entries, private markers absent) · smoke anti-tamper/labyrinth/re-harden/crown-ip/defense-pack PASS · postpack checklist `failed:[]`. Artifact: **`d:\AI Novel\dist-qa-unsigned\AI-Novel-1.1.6-x64.exe`** (+ `win-unpacked/` portable). Done Gate: `npm run verify:agent-done` → `VERDICT: PASS` (typecheck 0 · smoke:vina 0 · verify:tts-integrity 0 · smoke:pipeline 0 · smoke:license-one-path 0 · smoke:core 0 · ship:check 0), report `scratch/agent-done-gate-report.json`. Nội dung 1.1.6: mở miễn phí toàn bộ (open mode) · dọn cache browser khi boot · auto-update unsigned (`AINOVEL_UPDATE_ALLOW_UNSIGNED=1`). Chưa publish feed (cần `release:ship-update` nếu user muốn auto-update).

---

## 12b. Clean-Room QA máy trắng (2026-08-07)


- **- 2026-08-07:** Bug A (SetupPhase spinbuttons invalid) verified **KHÔNG phải bug**. Proof: `node scripts/diag-bug-a-spinbuttons.mjs` → `output/diag-bug-a-result.json`: `modalOpen:true`, `so_chuong` value 2 (min 1, max 2, `:valid`, no invalid attr), `so_tu_chuong` value 600 (min 100, max 600, step 50, `:valid`); clamp test '99999' → afterInput `2`/`600`, afterBlur `2`/`600`. Note: clean-room packaged app (enforce/free).
- **- 2026-08-07:** Bug B (trial-error banner không hiện khi 401) verified **KHÔNG phải bug**. Proof: `node scripts/diag-bug-b-trial.mjs` → `output/diag-bug-b-result.json`: events `CLICKED(t=7) → ADDED(t=1827) → BANNER_PRESENT(t=2029)`, `finalPresent:true`, text `"⚠️ License server yêu cầu đăng nhập (401)…"`; `/api/entitlement/trial` + `/api/cloud/license/trial` đều 401 AUTH (cloud trial chưa mở). Note: `LicenseModal.tsx` `translateTrialError` map 401 đúng.
- **- 2026-08-07:** Done Gate clean-room QA PASS. Proof: `npm run verify:agent-done` → `VERDICT: PASS`; log `C:\Users\Khanh\AppData\Local\Temp\cline\background-1786083402802-l6ybzsb.log`: OK typecheck=0 · smoke:vina=0 · verify:tts-integrity=0 · smoke:pipeline=0 · smoke:license-one-path=0 · smoke:core=0 · ship:check=0. Note: clean-room torn down + Chrome CDP killed (không còn process rác).


---

## 13. Chuyển GUI/logic sang Nova Studio runtime (2026-08-21)

- **2026-08-21:** App `d:\AI Novel` chuyển GUI + logic chính sang **Nova Studio runtime nội bộ** (`nova/`, trích từ app.asar gốc v0.1.29). Proof: probe boot `electron scratch\nova-probe-main.js` → `FFMPEG_INFO {ffmpeg:true,ffprobe:true}` · `UPSCALE_PROBE ok:true (4 models)` · `MIGAN available:true` · `FLOWBRIDGE running:8792` · fs-log 412 dòng **0 path ngoài repo** (không đọc `D:\Nova Studio`). Boot qua `Khoi_Dong_App.bat` → window `Nova Studio` + HTTP nội bộ 127.0.0.1:47280 (HTTP 200, title Nova Studio) + bridges 8790/8791/8792. `node -e require('./nova/voice-native.js').probe()` → `root: D:\AI Novel\voice-studio, hasRoot:true`. Typecheck: `npm run typecheck` → exit 0 (sau khi xóa `.next` stale types). Note: GUI cũ `src/app/workspace/` + shell main.js/preload.js/index.js/main.jsc/splash đã xóa; package.json `main: nova/main.js` + `productName: chukienmedia-app` (userData `%APPDATA%\chukienmedia-app` kế thừa dữ liệu thật); `src/lib/voiceScriptClean.ts` thay import stringUtils cho route generate-tts; binaries nova trong .gitignore.
- **2026-08-21 (resume):** Đóng gói Nova portable PASS. Proof: `npx electron-builder --config nova\electron-builder.json --dir` → `dist-nova\win-unpacked\Nova Studio.exe` chạy độc lập: window `Nova Studio` + GUI HTTP 200 (127.0.0.1:47280) + bridges 8790/8791/8792; binaries đúng layout gốc `app.asar.unpacked\nova\*` (ffmpeg.exe, ffprobe.exe, onnxruntime-node, realesrgan + 4 models, migan.onnx, sqlite3.exe, flow-extension) — asar 6.5MB sau khi thêm `!node_modules/**` (lần 1 bị 298MB vì builder tự nhét root production deps; ffmpeg thiếu vì exclude sai trong files). Lần đầu packaged exe crash: do env `ELECTRON_RUN_AS_NODE=1` của agent IDE (bằng chứng `bad option: --enable-logging` = Node parser) — launcher .bat đã clear. Scripts mới: `npm run nova:pack:dir` / `nova:pack`. Note: legacy pack pipeline (`pack:ship`/`preflight:pack`) gắn shell cũ đã xóa — không dùng lại.
- **2026-08-22:** Clean-room QA Nova packaged (máy trắng thật) + 2 GUI patch + MCP. Proof: boot `dist-nova2\win-unpacked\Nova Studio.exe --remote-debugging-port=9333` sau wipe userData (Chromium Windows IGNORE env APPDATA — phải backup+rename `%APPDATA%\chukienmedia-app` thật) → CDP OK, userData tự tạo mới tinh. Driver Playwright connectOverCDP: **cấm browser.close() (giết app)**; nav ngoài viewport → scrollIntoView trước click; modal `.modal-bg.show` chặn click → đóng trước. Kết quả 3 suite (f1/f2/f3): 13 nav tool click PASS, 0 console error, 0 pageerror, 0 dialog; empty-topic gate đỏ "Nhập chủ đề / tiêu đề trước."; có topic không key → "Lỗi: API 500 claude not recognized" (BUG UX). PATCH 1 `nova-patch-esc-close` (Esc click nút `.modal-close` THẬT — bản đầu inject vào `<script src>` bị ignore, phải vào script cuối body); PATCH 2 `nova-patch-friendly-llm` (wrap callLLM → lỗi CLI/mạng/401 thành hướng dẫn VN). Verify lại trên máy trắng sau repack: `wrapper:true`, `esc closes:true`, lỗi hiện "Chưa cài / chưa đăng nhập gói Claude (CLI). Mở Cấu hình AI…". MCP mới `mcps/nova-clean-room/index.mjs` (stdio, 8 tools: setup_clean_room/launch_app/app_status/ui_eval/ui_click/ui_fill/ui_press_escape/teardown) — smoke PASS `node mcps/nova-clean-room/smoke.mjs` → INIT + TOOLS + TEARDOWN restoredRealUserData:true. EBUSY repack: VS Code giữ handle app.asar → đổi `directories.output` sang `dist-nova2`. Note: userData thật user đã khôi phục từ backup; build sạch nhất nằm ở `dist-nova2`.
- **2026-08-22 (unlock-all):** Xác nhận + đồng bộ mở khóa toàn bộ chức năng Nova. Audit gate GUI: mọi choke-point đã mở sẵn trong runtime gốc (`isAdmin()=>true`, `isPro()=>true`, `tierConfig()=>TIER_CONFIG.max`, `getMaxScenes/Profiles/Flow/Queue()=>Infinity`, `canAutoRun()=>true`, `isToolAllowed()=>true`, `state.userTier='max'`, `refreshTierFromCloud` force `max`) — TIER_CONFIG chỉ là bảng định nghĩa display. Bug duy nhất: UI guest — `renderTierBadge()` chỉ chạy sau auth → badge sidebar hiện "FREE" + nút "Nâng cấp Pro" dù đã unlock. PATCH 3 `nova-patch-unlock-sync` (gọi `renderTierBadge()` boot + interval 5s, force badge MAX nếu còn FREE). Proof live trên packaged `dist-nova2` sau repack + CDP eval `scratch\verify-unlock.mjs`: `userTier:max, isPro:true, isAdmin:true, tierName:Max, canAutoRun:true, toolAllowed:true, limits:null(=Infinity), tierBadge:"MAX 👑", upgradeBtnVisible:false, tierChipTop:"Admin"`. Không có gate server-side tier trong main process (decode chuỗi main.js không có khái niệm tier; llm-fetch/flow/voice/upscale không check gói).
