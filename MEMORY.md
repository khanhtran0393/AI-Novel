# Project memory (AI Novel)

## Labyrinth multi-layer cascade (2026-07-20)

- **Code:** `src/lib/commercial/labyrinth/*` (signals, cascade, decoy)
- **Wire:** `antiTamper` (decoy env + signal), `proGateHard` (denyThroughCascade), status `labyrinth`
- **Policy:** one root `INTEGRITY_OR_BYPASS`; progressive T1–T5 only when tamper; legitimate = single message
- **Kill-switch:** `AINOVEL_LABYRINTH=0`; force sticky: `=1`
- **Docs:** `docs/LABYRINTH.md` · smoke `npm run smoke:labyrinth`
- **Cấm:** UI dùng decoy unlock; soft-success media; hydra cho user Pro sạch

## License One-Path complete (2026-07-20)

- **Policy:** `docs/LICENSE_ONE_PATH.md` + `src/lib/commercial/licenseOnePath.ts`
- **Model:** ticket · ledger · crown IP — **cấm** f(token) / private client
- **Quota request/ngày:** **REJECTED** (`dailyQuota: false`, `LICENSE_OUT_OF_SCOPE.daily_request_quota_supabase`)
- **Wired:** status `onePath`, cloudIpAuth + seedance + psych policy pin, `API.cloudIpPsych`, LicenseModal one-path note
- **Backdoors closed:** vina-voice synthesize/clone/runtime/engine/warm → `tts_premium`; generate-video gate after body parse
- **Noise:** entitlement canary `kid=deadbeef*` no longer console.warn spam
- **Smoke:** `npm run smoke:license-one-path` in `smoke:commercial` PASS; typecheck PASS
- **Agent:** không re-introduce quota ngày / f(token)

## Defense remaining gaps closed (2026-07-20)

- CapAssistant full + isolate/split/watermark/download/transcribe/self-heal/translate-srt gated
- `/api/youtube-meta` + writeChapterFinish → psych IP; youtube-seo psych path when no Gemini / preferPsych
- `seatPresence.ts` concurrent seats window 15m; `hwidRebind.ts` fingerprint drift; activate clears rebind
- Wired into proGateHard dual path

## Defense mesh upgrade (2026-07-20) — full hardening pass

- **Hard mesh:** `requireFeature` → `assertFeatureAccessHard` (integrity + anti-tamper + dual re-verify + feature + heartbeat)
- **Multi-signal packaged:** `packagedAttestation.ts` + main sets ELECTRON_PACKAGED + PACKAGED_ATTEST + HOST_BINDING=enforce
- **Grace tightened:** offline 48h / first-run 12h / strict 6h; STRICT includes tts/video/capcut/ship + Pro IP
- **Gated leftover APIs:** video-editor, bypass-engine, video-dub-tools, tts-batch-srt, audio-studio, process/render-video, capassistant, rpa-*
- **Host-binding:** per-spawn secret + scrubbed child env; anti-tamper rejects HOST_BINDING=open packaged
- **Psych cloud IP:** `/api/cloud/ip/psych` + `psychCloudBridge.ts`; ipCatalog youtube_psych → cloud_authority
- Docs: DEFENSE_LAYERS + ATTACK_SURFACE updated; smokes hardening + ip-catalog extended

## RE protection 3-phase (2026-07-20)

- **Phase A:** `productionBrowserSourceMaps: false`; pack excludes `**/*.map`, docs, scripts, agent md, `.next/types`, `.next/**/*.ts`; `beforePack` shell harden + `afterPack` restore + fuses
- **Phase B:** **esbuild** minify+mangle Electron shell (devDep); asarmor deferred; audit RE leaks
- **Phase C:** `ipCatalog` + `onlineRevalidate` + **Seedance cloud IP** `POST /api/cloud/ip/seedance` via `seedanceCloudBridge` (packaged → Vercel pin; free no-token director local; sequence Pro fail-closed)
- Wire: `imagePrompt` director+sequence, `integrations/seedance` compile_clip + default compile
- Smokes: `smoke:re-harden` (engine esbuild), `smoke:ip-catalog`, `smoke:seedance-cloud`, `scripts/smoke-seedance-cloud-live.mts`
- Kill-switch: `AINOVEL_RE_HARDEN=0`, `AINOVEL_STRICT_ONLINE=0`, `AINOVEL_SEEDANCE_CLOUD=0|1`
- **Ops 2026-07-20:** Vercel prod Ready → alias `ai-novel-flax.vercel.app` has `/api/cloud/ip/seedance`; QA pack `dist-qa-unsigned` audit PASS `shellHardened:true` (esbuild)
- **Cloud IP auth:** shared `cloudIpAuth.ts` — `requireHwidMatch:false` + optional body.hwid vs claim (seedance + psych)
- **Wire complete:** generate-video resolve/mark clip, chapterPipeline, ship/export, imagePrompt, integrations/seedance
- Live: `npm run smoke:cloud-ip-live` (seedance + psych) against `ai-novel-flax.vercel.app`
- **Code-close 2026-07-20:** fresh `next build` + repack QA; `audit:package` PASS `shellHardened:true` esbuild; live cloud-ip PASS
- Artifact: `dist-qa-unsigned/AI-Novel-1.0.0-x64.exe` (~140MB) + `win-unpacked`
- One-shot verify: `npm run pack:unsigned:qa:verify`
- **Not code:** Authenticode cert / signed NSIS production only

## Defense-in-depth layers (2026-07-20)

- **L3 force enforce:** packaged always `AINOVEL_ENTITLEMENT_MODE=enforce`; customer env cannot set MODE/local trial; `getEntitlementMode()` locks on `AI_NOVEL_PACKAGED`/`AINOVEL_PUBLISH`.
- **L2 API mesh:** `src/lib/commercial/apiGate.ts` — TTS premium (not edge/piper), navtools (not youtube-seo free), integrations/*, Flow multi create, suggest-channels.
- **L4:** packaged `devTools: false` + F12 block; pack chain `beforePack` re-harden → `afterPack` restore + fuses; shell open path system-dir block.
- **L5 HWID v2:** MachineGuid + dual-accept v1 tokens.
- **Docs:** `docs/DEFENSE_LAYERS.md` · smokes extended commercial + electron-security.

## Hardening remaining vectors (2026-07-20)

- **HWID v3** multi-signal (MachineGuid+vol+CPU); dual-accept v2/v1
- **Heartbeat** packaged: online revoke kill; offline grace 72h; first-run 24h; no kill on missing DB row
- **proGateHard** dual-path on video/capcut/ship + runtimeIntegrity
- Smoke: `smoke:hardening` PASS

## Adversarial anti-tamper (2026-07-20)

- Hacker view → harden: `antiTamper.ts` kid+SPKI pin, packaged no open/owner/secrets, verify canary
- Wired into assertTier / assertFeature / activate; status `antiTamper`; docs `ATTACK_SURFACE.md`
- Smoke: `npm run smoke:anti-tamper` PASS (reject swapped public key)

## License trust pin (2026-07-20)

- `src/lib/commercial/licenseTrust.ts`: host pin license API + optional TLS SPKI pin + update feed host pin
- Proxy dùng `fetchPinnedLicenseApi`; packaged fail-closed empty keyring (`assertVerificationKeyringReady`)
- main.js: customer cannot expand `LICENSE_API_HOSTS` / `TLS_PINS`; smoke `npm run smoke:license-trust`
- Ed25519 remains source of truth vs fake keys

## Commercial admin complete (2026-07-20)

- **API** `GET /api/cloud/license/list` (admin key) · **UI** `/admin` list/filter/revoke/issue HWID
- **Docs** `docs/COMMERCIAL_ADMIN.md` · backup `npm run commercial:backup-seller`
- Paid activate promote trial→pro + status Pro (prior fix)
- Authenticode still human: buy cert — only ship blocker for signed installer

## Activate OK but badge TRIAL (2026-07-20)

- **Cause:** Supabase còn row `plan=trial` cho HWID; activate/`verifyLicenseCloud` lấy claims cloud trial đè token Pro → badge TRIAL.
- **Fix:** `promoteHwidLicenseToPaidPro` (trial→pro); activate paid token luôn promote + trả `plan:pro`; status ưu tiên paid offline token; LicenseModal/sync Pro trước trial.
- Empirical: activate → `plan=pro`; status → `tier=pro tokenValid=true trial.active=false`.

## Activate fail kid mismatch (2026-07-19)

- **Cause:** Telegram đã cấp key **HMAC cũ** (`eyJ….sig` 43 chars) — app chỉ verify **Ed25519 `AINOVEL2.<kid>.…`**. Lỗi UI hiện `kid=ROhq…` (thực ra là signature HMAC bị parse nhầm) vs keyring `3ac9c18a6691a09e`.
- **Fix:** diagnose legacy HMAC trong activate + LicenseModal; bridge approveText bắt buộc AINOVEL2; `issueProLicenseForPlan` (alias `issueHmacForPlan`); redeploy bridge `ainovel-telegram-bridge.vercel.app` với `PRIVATE_KEY_B64` seller kid `3ac9c18a6691a09e`.
- **Seller pair OK:** `%LOCALAPPDATA%\AI Novel Seller\entitlement-private.pem` ↔ `resources/license/public-keys/3ac9c18a6691a09e.pem`.
- Khách dán lại key **bắt đầu `AINOVEL2.`** (key HMAC/eyJ… vứt).

## Go-live status (2026-07-19 late)

- **softwareReady: true** · **authenticodeReady: false** (no CSC_LINK / WIN_CSC_* on machine)
- Docs: `docs/COMMERCIAL_GO_LIVE.md` · scripts: `commercial:go-live-status`, `commercial:complete`
- prepare:publish PASS · smoke-unpacked Free 403 PASS · license:issue Ed25519 PASS
- Residual only: buy Windows code-signing cert → build:desktop or tag v1.0.0 CI

## Commercial complete local (2026-07-19)

- **prepare:publish PASS** (fixed ELECTRON_RUN_AS_NODE breaking credential vault smoke via `scripts/run-electron-smoke.cjs`)
- **release:source staged** required packaging files for `audit:release-source`
- **release:verify** still needs Authenticode env (CSC_LINK / WIN_CSC_*) — no code-sign cert on machine
- **pack:unsigned:qa** produced `dist-qa-unsigned/AI-Novel-1.0.0-x64.exe` + win-unpacked
- **audit-packaged-artifact PASS** (public keys, no private markers)
- **smoke-unpacked-desktop PASS**: enforce, free, video 403
- **Pro activate E2E PASS**: issue AINOVEL2 → activate → tier pro → video not 403 (400 validation)
- Customer `.env.commercial` public-only (license API + update feed)
- Feed verify PASS; Telegram bridge + ai-novel-flax ready
- Residual for production publish: buy/configure Windows Authenticode → `npm run build:desktop` / tag `v1.0.0` CI

## Commercial readiness audit (2026-07-19)

- **ship:check PASS** (fixed python_core filters: `!ffmpeg/**`, `!MediaCrawler/**`, `!assets/**`)
- **smoke:commercial PASS** (Ed25519 + multiseat)
- **License:** issue `AINOVEL2.<kid>.…` + verify same HWID + tamper reject; feature matrix Free/Trial/Pro OK
- **Prod API** `https://ai-novel-flax.vercel.app` enforce, publicKey+signer, readyForCommercial
- **Telegram bridge** webhook live; desktop activates offline Ed25519 (server HWID ≠ client — by design)
- **Security:** credentialVault DPAPI, public.env no secrets, asar+signing gates, electron security smoke PASS
- **Ops remaining for full sell:** code-sign cert on build machine, white-machine install once, optional update artifact on feed

## Telegram Vercel bridge LIVE (2026-07-19)

- **URL:** `https://ainovel-telegram-bridge.vercel.app`
- **Webhook:** `/api/entitlement/telegram-webhook` (getWebhookInfo confirmed)
- **Code:** `deploy/telegram-bridge/` slim Next; deploy `npm run telegram:deploy-bridge`
- **Secrets:** Ed25519 `AINOVEL_ENTITLEMENT_PRIVATE_KEY_B64` (seller PEM base64, kid `3ac9c18a6691a09e`) + bot token/chat/webhook secret — **không** dùng HMAC secret để cấp license
- Full monorepo Vercel blocked (1.4GB / CVE next) — bridge only is intentional
- Redeploy 2026-07-19: webhook live; Cấp Key → AINOVEL2 only

## Commercial full ship pack (2026-07-19)

- **Updater:** `electron/updater.js` + main/preload `ainovelUpdater`; dep `electron-updater`; env `AINOVEL_UPDATE_*`; builder `publish.generic` placeholder URL.
- **Multi-seat:** `activationVault` maxSeats/seats + `releaseSeat` / `setMaxSeats`; API `/api/entitlement/seats`; CLI `license:transfer`; issue `--seats N`.
- **Seller log:** `sellerLog` + webhook/issue/transfer append `data/licenses/seller-orders.jsonl`.
- **Ops scripts:** `commercial:secrets`, `commercial:setup-env`, `ship:check`, `commercial:white-machine`.
- **Docs:** `docs/COMMERCIAL_OPS.md`, `.env.commercial.example`; SHIP/INSTALL/COMMERCIAL updated.
- **Ops still human:** buy Authenticode cert, host CDN feed, fill Telegram/Vercel secrets, white-machine tick.

## Docs truth rewrite (2026-07-19) — full set

- **Rewrote for runtime truth:** `AGENTS.md`, `docs/IRON_LAWS.md`, `docs/DOMAIN_MAP.md`, `docs/RESET_POINT.md`, `docs/COMMERCIAL.md`, `docs/integrations-hub.md`, `src/app/workspace/ARCHITECTURE.md`, `src/contracts/domainOwnership.ts` (credentials + license/cloud).
- **Key truths agents must not reverse:** native engine (no ainovel-gui/:8080); NAV host-binding; `isHydrated` default **true**; badge FREE/TRIAL/PRO/VIP + `is_trial`; packaged Electron entitlement **enforce**; Flow 9223/8101; pipeline `src/lib/pipeline/*`; license = logo modal `features/license`.
- Prefer these docs over any older session memory.

## VIP badge bug (2026-07-19)

- **Cause:** `shouldGrantOwnerUnlimited()` returned true when `MODE=open` → status `ownerUnlimited` → sync `setVipStatus(true,true)` → badge VIP.
- **Fix:** owner unlimited **only** `AINOVEL_OWNER_UNLIMITED=1`. MODE=open no longer elevates UI.
- `.env.local` set to `enforce` for commercial test; restart Next after env change.

## Cleanup safe junk (2026-07-19)

- Deleted non-runtime: `OpenMontage/` (~696MB, excluded from Electron package), `scratch/`, root `test_webhook*.ts`, `tsconfig.tsbuildinfo`.
- Kept: `src`, `public`, `bin`, `data`, `accounts_data`, `python_core`, `node_modules`, `.next`, `vendor`.

## Product tiers = Free | Trial | Pro only (2026-07-19)

- **No VIP product:** lifetime / owner / open synthetic / paid issue all → **Pro** (`is_vip=false`, `plan:'pro'`).
- Legacy VIP tokens collapse on verify/normalize → Pro.
- Header/logo: TRIAL | PRO | FREE (no VIP chip).
- `resolvePlanTier`: open/ownerUnlimited/`is_vip` → **pro**.

## Commercial logic unify (2026-07-19)

- HMAC claims: `is_trial` + `plan: 'trial'|'pro'|'vip'`; `issueTrialToken` sets trial; paid issue sets plan pro/vip.
- `resolvePlanTier`: **trial before is_pro**; `storeFlagsToTier` helper.
- Server: `resolveRequestAccess` / `assertTierAtLeast` / `assertFeatureAccess`; pipeline uses **pro** feature gate; video/capcut/ship stay trial+.
- Status + `useEntitlementSync`: cloud trial token → tier **trial** + store `is_trial`.
- Cloud trial mirrors local `startTrial` vault.
- Credits: trial deducts; paid pro/vip unlimited.
- UI: Toolbox/multi-channel/Flow multi gate via `can(feature)`; CapCut/License copy fixed.


## Supabase + Vercel cloud hybrid (2026-07-19)

- **SQL/RLS:** `supabase/migrations/001_commercial_rls.sql` (profiles, devices, orders, licenses, audit).
- **Clients:** `src/lib/supabase/*` — anon JWT + service_role server-only; graceful if env missing.
- **Bridge:** `src/lib/cloud/licenseBridge.ts` — HMAC issue/verify + order confirm + trial + revoke.
- **API:** `/api/cloud/status|orders|orders/confirm|license/*` · Admin UI `/admin`.
- **Desktop:** License modal prefers cloud trial; commercial status exposes supabase + cloudRevoked.
- **Hybrid:** no Supabase → local Zalo/HMAC still works. Deploy: set NEXT_PUBLIC_SUPABASE_* + SERVICE_ROLE + same ENTITLEMENT_SECRET on Vercel.

## Commercial publish readiness (2026-07-18)

- **Model:** License + BYOK + Free/Trial/Pro/VIP — `src/lib/commercial/*` · master `docs/COMMERCIAL.md`.
- **Entitlement:** enforce fail-closed; HWID; trial fallback in `assertProAccess`; **no** force owner Pro on rehydrate/persist; boot `useEntitlementSync`.
- **API:** issue|verify|hwid|activate|trial|webhook|codes + `/api/commercial/status`.
- **UI:** `features/license` LicenseModal (logo); Header FREE/TRIAL/PRO/VIP; CapCut/Ship/Toolbox Pro gray; video headers entitlement.
- **Trial badge fix (2026-07-19):** Trial sync still sets `is_pro=true` (Pro-equivalent rights) **and** `is_trial=true`. Header/logo badge shows **TRIAL** (cyan), not paid **PRO**. Store field `is_trial`; `setVipStatus(vip, pro, trial?)`.
- **Seller:** `npm run license:issue` · vault `data/licenses/`.
- **Legal:** LEGAL_TOS / PRIVACY / THIRD_PARTY / FLOW_DISCLAIMER · INSTALL_SUPPORT · PRICING.
- **Packaged Electron:** MODE=enforce; `%APPDATA%/.../.env.commercial`.
- **Smoke:** `npm run smoke:commercial` PASS · remaining ops: code-sign + update feed.

## Pipeline P0–P2 packages (2026-07-17)

- **Code:** `src/lib/pipeline/*` — Quality Gate, Memory/foreshadow, Media Preflight, Stage job helpers, Long-form arc.
- **P0 wire:** `writeChapterFinish` + `commitChapterMemory` → `evaluateChapterQuality` / `enrichMemoryAfterCommit`; `writeModule` + engine draft inject `lorebookWithMemoryPack`.
- **P1 wire:** `useImagePromptActions` preflight prompt/image/video (+ `ensureChapterQuality` lazy for legacy chapters). Job queue still `jobQueue` + `createStageBatchJob` available.
- **P2 wire:** `runner.ts` uses `buildLayeredRouteExtras` (no hardcode null); editor tools `markArcSummaryDone` / volume; auto layered when `so_chuong >= 2*chaptersPerArc`.
- **Smoke:** `npm run smoke:pipeline` (= `smoke-pipeline-p0-p2.mjs` + `smoke-pipeline-import.mts`) PASS (+ stage batch + TTS preflight).
- **P1 TTS:** `assertTtsMediaPreflight` in `useTTSActions` + `chapterTtsActions`; chapter batch uses `createStageBatchJob(stage=tts)`.
- **P1 stage queue:** `handleGenerateAllImages/Videos` → `createStageBatchJob` + `runStageBatch` (no raw createBatchJob).
- **P0 UI:** `QualityGateBadge` on SceneCard (full/compact) + ChapterList (dot); `subscribePipelineStore` for live updates.
- **Conflict fixes (2026-07-17):** Unified word-band = Setup `so_tu_chuong` (`wordBand.ts` + rules aligned; strip dual `chapter_words`). `mediaReady` = hardErrors===0 only. Engine commit same as workspace. Portable `pipelineSnapshot` + `applyPortablePipelineSnapshot`; `clearPipelineStore` on Làm Mới. TTS soft-warns consolidated into one confirm/toast.
- **Prior media:** Seedance continuity / FableCut vendor / Watch QC / VieNeu v3turbo / MiroFish arc hooks remain as before.
- **Media e2e (2026-07-17):** `npm run test:pipeline-e2e` — continuity `usedContinuation=true`, FableCut TTS-sync, Watch native frames≥3, VieNeu synth, HTTP chapter 200, MiroFish **403** outside outline.

## Toolbox host-binding (2026-07-17) — no encryption yet

- **Goal:** NAV/toolbox CLIs refuse standalone (Terminal/double-click); only App host may spawn.
- **TS:** `src/lib/nav/hostBinding.ts` → `issueHostToken` / `hostBindingChildEnv`; wire `navPythonBridge` + `video-dub-tools`.
- **Py:** `python_core/gateway/host_binding.py` + `ainovel_host_guard.py`; `nav_gateway.py` checks before dispatch; toolbox CLIs `import ainovel_host_guard`.
- **Env:** `AINOVEL_HOST_TOKEN` (HMAC), mode `AINOVEL_HOST_BINDING=enforce|open`, secret shares entitlement default.
- **Not done yet:** Nuitka/Cython, Pro grayed UI for Toolbox — later.

## Tool Dịch SRT (toolbox) — Cap Gemini method (no DeepSeek)

- **Method Cap:** parse SRT → chỉ text → batch **50** cue → neo ` || ` → Gemini REST → unbatch → gắn lại timestamp. Lệch count → tách đôi lô retry.
- **Không DeepSeek / không cookie RPA** — chỉ API key Gemini (Cài đặt).
- **UI:** bảng # · time · gốc | đã dịch; 14 style; Chia mặc định 50 (5–100).
- **API:** `action=translateOnly` → `googleStudioTranslate.ts`. Menu: **Tool Dịch SRT**.

## IRON B10 — No content/logic fallback (except API keys)

- **CẤM** đổi platform/engine/provider/voice ngầm khi fail (CapCut→Edge, Flow→Gemini, auto→Chrome…).
- **CẤM** gen mẫu / fake success / silent catch che lỗi.
- **ĐƯỢC** xoay API key cùng provider (429/401).
- Lỗi → message thẳng để CISO sửa. Spec: `docs/IRON_LAWS.md` §B10.
- Browser `engine=auto`: chỉ Chromium sạch; stock Chrome chỉ khi user chọn `engine=chrome`.
- **Audit B10 purge:** `docs/B10_FALLBACK_AUDIT.md` — Edge không đổi voice; youtube 1 nguồn transcript; sampleOptimize/profileFilter/warmDaemon/render-video/open-folder/downloadText/CapAssist; runtime không `|| edge_tts`.

## Google Flow Bridge (FlowAgent deep-dive applied)

- **Default:** `imageProvider=flow`, `videoProvider=flow`
- **4 blocks:** queue multi-worker · WS 9223 · face-lock inject · retry 5×/30s + slide account + token 45′
- **Face-lock:** `promptInjector.ts` (nguyên văn FlowAgent English system prompt)
- **Gen Prompt (2026-07-15):** Cấm hardcode genre/style mạt thế trong director/Seedance. Style = Visual DNA/Media Style; genre = Setup `chu_de`+`phong_cach`. B10: không local-fill prompt; thiếu config/AI fail → toast/API error rõ. Timestamp unified `start-end s`. Shot graph chỉ server.
- **Write engine (2026-07-15):** `storyWriting.requireGenreLabelFromSetup` + `lorebookForPrompt` + `writeEngineRoleLine`. WRITE/REVISE/EVALUATE/EXPAND/REWRITE/OUTLINE/IDEAS bám Setup; không fallback “Luật thế giới mạt thế”. Initial setup `chu_de`/`phong_cach` rỗng — user phải chọn.
- **Pass 3 (2026-07-15):** novel-engine `setupGenrePayload`; OUTLINE/PLAN_ARC/COMMIT hard-require Setup; INITIAL_LOREBOOK production-only; NV **khuyết điểm** bắt buộc (không “khuyết tật mạt thế”); seedance duration hard-fail; soft idea/noi_dung fallback removed.
- **AGENTS.md (2026-07-15):** viết lại toàn bộ theo runtime hiện tại — native engine, B10, Setup genre, khuyết điểm, Gen Prompt pipeline, domain tree, checklist 30s; gỡ nội dung cũ (CapCut→Edge, path hooks sai, mạt thế hardcode).
- **UI lag (2026-07-15):** full `useNovelStore()` trên YoutubeSafeChecklist / SceneTtsBar / EditorPanel / CharacterProfileForm gây re-render toàn cây; fix selectors/shallow. Persist debounce 450ms cho localStorage+durable (flush on leave). SceneCard memo so sánh regen theo scene.
- **GUI đứng / crash (2026-07-17):** (1) page.tsx full store → selector-only. Lazy-mount Media/TTS. (2) **YoutubeSafeChecklist** `useShallow` + object literal `{}` trong selector → React 19 `getSnapshot` infinite loop / Maximum update depth. Fix: primitive selectors + `EMPTY_CHAPTER_HOOK` stable. SettingsPanel JSX bad split rolled back.
- **Upscale:** 2K/4K image + FHD/4K video · output `public/*` + `image_output` / `veo_output`
- **Login UX:** kill profile trước khi launch (tránh Chrome bỏ --load-extension) → login → harvest token (reload Flow) → đóng login + background
- **1 profile = 1 phiên login:** UI bấm Đăng nhập trên card → `accountId` vào bootstrap; Chrome `--user-data-dir=accounts_data/<id>` + extension inject `?accountId=`; cấm bootstrap global “chạy ra ngoài” profile
- **1 profile = 1 unit quản lý:** Bridge/Extension/Token/Project/Login nằm trên card profile (snapshot fields `bridgeRunning|extensionConnected|loginSessionOpen|projectReady` per account) — không dải status global
- **Thêm trình duyệt mới:** `freshSession` + `prepareBlankLoginProfile` wipe cookies → browser trống; `flowKeyAccountId` cấm sơn token profile A lên B; UI không gọi “đăng nhập lại account cũ”
- **Write lock:** `useWriteChapter` finally nhả `dang_tai` khi genId còn sở hữu; nút Sinh chương khóa theo `isStreaming` (không theo dang_tai global) — gen hồ sơ NV không chặn viết chương
- **Button independence:** mỗi API button busy riêng (isStreaming / expanding / rewriting / generatingChar* / isGeneratingOutline / CapCut exporting) — CẤM dang_tai khóa chéo
- **API key rotate:** `src/lib/apiKeyRotate.ts` RR mỗi request + cooldown RPM(~70s)/RPD(~45m); wire `modelClients` Gemini/OpenAI/Grok/Groq (B10: chỉ xoay key cùng provider)
- **Edge voice catalog (2026-07-15):** purge 94 dead ShortNames vs MS list; remain 116; live probe 115/116 OK (Dmitry flaky timeout). Scripts: `scripts/fix-edge-catalog.mjs`, `scripts/probe-edge-voices.mjs`, `scripts/audit-global-tts-voices.mjs`. Vina 76/76 samples OK.
- **TTS Engine preview audit (2026-07-16):** Edge/Gemini/Piper/VieNeu/Vina 100% nghe thử OK. Omni: trim ref >450KB→12s clip + `request_timeout_s` 360 (server default 120→504); Vina prefer CPU on GTX 1050 Ti 4GB (`data/cache/vina_ort_ep.json`). CapCut: thiếu sscronet.dll (cài CapCut PC Apps). TikTok: cần SessionID. Probe: `scripts/probe-voices-resume.mjs` → `scratch/voice-probe-progress.json`.
- **Flow video upload (2026-07-15):** API reject `imageInput` on `/v1/flow/uploadImage`. Schema = FlowAgent `upload_image`: `{ clientContext:{tool,projectId}, imageBytes, fileName, isHidden:false, isUserUploaded:true, mimeType }` → media.name. Purge `.next` legacy-imageInput chunks when fixing.
- **Stuck spinner:** Chrome 120+ chặn --load-extension → dùng Ungoogled/Brave/portable (FlowAgent), không CDP
- **Engine:** auto|ungoogled|brave|chrome|mullvad · `browserResolver.ts` · `tools/browsers/README.md`
- **Auto bootstrap:** `/api/flow/bootstrap` · docs `flow-bridge.md` + `flow-agent-architecture.md`
- Smoke: `npx tsx scripts/smoke-flow-payload.mts` · `smoke-flow-bootstrap.mts`
- **NO_FLOW_KEY (2026-07-15):** Bridge `flowKeyPresent=true` nhưng extension SW `flowKey=null` → gen video fail. Fix: (1) extension restore storage + nhận `params.flowKey` từ bridge; (2) `requestViaExtension` luôn gửi Bearer; (3) `inject_flow_key` + hot-sync `background.js` profile; (4) queue ưu tiên account giữ live token. Cần reload Chrome profile / Đăng nhập lại sau patch.
- **Key quota preventive (2026-07-15):** `apiKeyRotate.ts` — **tránh chạm trần** không burst: (1) dãn lượt `minInterval = 60s/RPM` (mặc định 6s), (2) headroom 85% soft, (3) RR ưu tiên key ít dùng, (4) hard ceiling RPM 10 / RPD 250, (5) hết pool → `KeyQuotaWaitError` CHỜ. Env: `AI_NOVEL_KEY_RPM_LIMIT`, `AI_NOVEL_KEY_RPD_LIMIT`, `AI_NOVEL_KEY_MIN_INTERVAL_MS`, `AI_NOVEL_KEY_HEADROOM`. Panel Credential + `/api/key-quota`.
- **Flow video first-gen preflight:** `flowSessionPreflight.ts` — GET status → toast → bootstrap forceChrome nếu thiếu ext/token → toast login/ready. Gắn `generateVideoAction` + hooks. Server gen-video/image: bắt buộc extensionConnected **và** flowKeyPresent (cấm xanh ảo).
- **Prompt-only video:** queue pure T2V only (B10 — không auto-still→I2V). Default model `veo_3_1_t2v_fast` (không ultra).
- **Flow model matrix (2026-07-15):** `modelCatalog.ts` align labs.google — duration **4|6|8s** (default 8), native **720p**, HD/4K via upsampler; credits Pro Lite≈10 Fast≈20 / Ultra Lite≈5 Fast≈10 / LP=0; keys R2V `veo_3_1_r2v_*`, I2V lite/LP/fl, image `GEM_PIX_2`/`NARWHAL`. API `GET /api/flow/models` + Media Config dropdown. Smoke: `node scripts/smoke-flow-model-catalog.mjs`.
- **Desktop crash fix (2026-07-16):** Electron `requestSingleInstanceLock` + port adopt/free (`ensurePortReady`); `Khoi_Dong_App.bat` + `scratch/clean_startup.js` free 3000/8101/9223; normal window close → exit 0; crash log `%APPDATA%\ai-novel-script-generator\electron-crash.log`. **Vina thrash:** soft RSS **4800MB** (was 2200), min uptime 180s, recycle cooldown 5m, skip if inflight — stops ready→recycle→exit -1 loop.
- **GUI stuck spinner (2026-07-16):** Splash window early (trước `next.prepare`); load **`/workspace`** trực tiếp (skip `/` redirect); place + focus **primary display** (tránh màn 2); `did-fail-load` retry; hydrate timeout Electron 1.5s; không adopt orphan Next mặc định.
- **Stuck “Đang nạp trạng thái bộ nhớ” (2026-07-16):** **GỠ GATE** — `isHydrated: true` default; merge rehydrate không set false; workspace **không** return spinner chờ hydrate. `dualStorage.getItem` cấm `getStoreSync`. Rehydrate chạy nền, UI vào ngay.
- **Stuck Setup modal (2026-07-16):** Root cause = late rehydrate **ghi đè `giai_doan:2` → `1`**. Fix: merge prefer phase 2; close patches localStorage; page `setupDismissed` latch; INITIAL `giai_doan:2` (Setup chỉ mở từ Sidebar); portal X `onPointerDown`.
- **Project per profile (2026-07-15 fix sync):** mỗi account có `projects[]` + `projectId` riêng. Sync harvest → bind profile (không paint all). UI dropdown từ `a.projects` / `projectsByAccount`. API trả `accountProjects`. Cấm `abc-111` (`isPlausibleProjectId`); boot sanitize clear fake. Re-sync không đè selection user nếu payload thiếu projectId thật. Gen **không** mượn project account khác (B10).
- **Session inherit (2026-07-15):** 1 profile = 1 Chrome `user-data-dir` (cookies/cache/fingerprint). Login xong → `inheritAccountSession`: harvest token+email+credits+projects → `SESSION_BUNDLE.json` + `flowKeysByAccount`. Gen/API **chỉ** socket+Bearer của đúng accountId (B10). API `POST /api/flow/accounts` action=`inherit`. UI nút **Inherit** + auto sau login.
- **Account capability parity (2026-07-15):** *Account làm được → app làm & nhận được.* `accountProxy.proxyAsAccount` + `downloadAsAccount` (Bearer/cookie qua extension `download_binary` + sink `:8101/internal/receive-binary`). Queue gen download media bằng account; sau gen refresh credits. API `POST /api/flow/proxy`. `capabilities` trên account (canImage/Video, proxyParity, cookies).

## Nút Làm Mới Dự Án — RESET POINT (locked)

- **Contract:** [`docs/RESET_POINT.md`](docs/RESET_POINT.md)
- **Canvas trống:** `ten_tac_pham=''`, `lorebook=''` (UI «Chưa có Lorebook.»), `danh_sach_chuong=[]`
- **Cài đặt giữ nguyên:** API keys, cookies, TTS/media settings, save paths, youtubeSafe, userRules
- **Code:** `resetStore()` + `projectResetEpoch` + `allowIntentionalStoreReset` + `commitIntentionalProjectResetFromLocal`
- **Bug đã fix:** durable `pickRichest` từng khôi phục lore/chương/tên từ backup cũ → hydrate ưu tiên `projectResetEpoch`
- **Cấm:** restore default lore, «Dự án mới», Ch.1/Ch.2 sau Làm Mới
