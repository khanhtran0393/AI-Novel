# Project memory (AI Novel) — snapshot runtime

> **Chân lý ngắn:** ghi nhớ theo **code + package.json + release-notes**, không theo log phiên cũ.  
> Spec dài: `AGENTS.md` · Done Gate: `docs/AGENT_DONE_GATE.md` · Pack: `docs/PACK_NOTES.md` · Update: `docs/APP_UPDATE.md`

**Cập nhật:** 2026-07-26 · **version:** `1.0.12` · **artifact:** `dist-qa-unsigned/AI-Novel-1.0.12-x64.exe` (803 586 753 B) · **GitHub feed v1.0.12 PASS** · Supabase fallback yml vẫn 1.0.0 (413) · go-live **SOFTWARE READY** (residual: Authenticode only)

---

## 0. License one-path harden + ship 1.0.12 (2026-07-25/26)

**Không phải bug:** `is_pro=true` + `is_trial=true` = Trial Pro-equivalent (badge TRIAL).

**Code:** Telegram fail-closed + blank token · issue paths ledger-only · activate no vault fallback · verify hash/exp · stale ticket → HWID ledger + clear local · Paid Pro retires local Trial · promote exp = min(token, ledger).

**Ledger HWID f925b0ff…:** 1× pro active · hash ba0f85ec… · exp 2026-07-27 · trial vault retired.

**Ship proof:**
- `pack:ship` EXIT 0 · postpack checklist failed=[]
- `release:ship-update` githubPublished=true · supabasePublished=false (413 size)
- `release:github:verify` PASS · tag v1.0.12
- `telegram:deploy-bridge` configured=true supabaseLedger=true
- `commercial:go-live-status` → SOFTWARE READY — ONLY AUTHENTICODE REMAINS
- typecheck + smoke:license-ledger + one-path + telegram-admin PASS

**Residual:** CSC_* Authenticode; Supabase Storage limit ≥500MB rồi re-publish fallback; white-machine tay.

---

## 1. Snapshot hiện tại

| Hạng mục | Giá trị |
|----------|---------|
| Product | Ai Novel desktop (Next 16 + Electron 43 + React 19) |
| `package.json` | **1.0.12** |
| Release notes | `resources/commercial/release-notes.json` (1.0.12 license harden) |
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

*Ghi chú phiên dài / debug one-off: append mục ngắn phía dưới đây khi cần; **không** nhồi lại dump 1000+ dòng. Ưu tiên bảng + path + lệnh proof.*
