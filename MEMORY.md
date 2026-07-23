
## Workflow UX deep audit + fix (2026-07-23)

- **Empirical:** Playwright free-mock walk — `Cổng từ 2327/600 · 388%`; outline path ép `so_tu>=500 else 4250` (phá Free); ch.3 Free không khóa UI; empty hint không hướng API key / Setup genre
- **Fix:** `normalizeSetupScaleForTier` trong freeLimitsPolicy + wire `setupModule`/`useSetupActions`; WordGate over-cap đỏ; ChapterList 🔒 Free≤2/Trial≤10; EmptyWorkspaceHint bước 1–4; Gen Prompt empty-scene + thứ tự TTS→Prompt; CapCut 🔒; lỗi media VN có dấu
- **Proof:** free 10/4250→2/600 · `smoke-free-limits` PASS · `typecheck` 0 · `test:e2e:ui` 3/3 · `smoke:core` PASS

## UX user-path fix pack (2026-07-23)

- **Scope:** License tier 1 nguồn · paid-notify success banner · ẩn Trial khi Pro · TTS modal Đóng/Esc/Free copy · onboarding wire + live banner · soft-gate Setup · Free clamp 600 từ · lỗi VN có dấu · e2e/smoke user-path
- **Proof:** `tsc --noEmit` exit 0 · `test:e2e:ui` 3/3 PASS · `smoke-license-user-path` VERDICT PASS · `smoke:core` PASS · `smoke:commercial` PASS
- **Key files:** `LicenseModal.tsx` · `TTSConfigModal.tsx` · `onboarding.ts` · `useWriteChapter.ts` · `e2e/ui-license-user-path.spec.ts`

## Dynamic Matrix Engine 900 + Retention (2026-07-23)

- **Scope:** V_topic⊗V_style compositional (30×30) · Fluid 3-layer (L3 mo_ta override) · Wave-Rhythm · Cliffhanger · End-screen prompt · mild shot tension chuyen_sau · Matrix CTR motifs · TTS cast hints (no SFX tags)
- **Code:** `src/lib/matrixEngine/*` · wire `chapter` WRITE+REVISE / `outline` / `scene` / `imagePrompt` · `writeModule` WRITE+REVISE sends `mo_ta` · SetupPhase catalog DRY · `endScreenPrompt` on ChapterHookAsset
- **Smoke:** `npm run smoke:matrix` · `npm run smoke:matrix:integration` · regression style-engine + high-ctr
- **Re-verify:** typecheck 0 · matrix PASS · integration PASS · style-engine OK · high-ctr USABILITY PATH PASS
- **Out:** Module 3 SFX/BGM tags (IRON cấm FX prose)
- **Note:** StyleEngine vẫn match phong_cach mạnh (vd Gothic → kinh_di); Matrix luôn inject song song (Topic không bị nuốt)

## High-CTR YouTube packaging MVP (2026-07-23)

- **Scope:** 4 thumb composition presets · 5 title formulas · mobile ≤70 · overlay 2–4 words · pack checklist (no fake CTR%)
- **Code:** `src/lib/youtube-safe/highCtr.ts` + wire `seoMeta` / `YoutubeSafeChecklist` / `YoutubeThumbPanel` / `writeChapterFinish`
- **Store:** `thumbCompositionId`, `seoTitleVariants` on `ChapterHookAsset` (persist via full `chapterHooks`)
- **UI mount:** `ContentTab` → `YoutubeSafeChecklist` → `YoutubeThumbPanel`
- **Usability smoke:** `scripts/smoke-high-ctr-packaging.mts` (Meta→5 formulas→4 composition→overlay→pack 7/7→checklist)
- **Proof (re-verify):** `smoke-high-ctr-packaging` PASS; `smoke-psych-seo` PASS; `verify-youtube-safe` PASS; `tsc --noEmit` exit 0

## Workspace: one Hook + Phần groups (2026-07-23)

- **User:** 2 hook · gate chặn media · quá nhiều cảnh · Phần phải thu gọn như cảnh.
- **Design:** Hook 990 = TTS/media YouTube; CẢNH 0 = cold open body.
- **UX:** 1 Hook card; body «Phần» 3 cảnh; **Phần collapse độc lập** (Mở/Thu gọn + chevron, default đóng; đóng Phần clear scene select); nav P1/P2.
- **Proof:** `smoke-scene-workspace-groups.mts` PASS; `tsc` 0.

## YouTube rewrite flow verify + fix (2026-07-23)

- **User report:** Link YouTube · viết lại tương tự lỗi trên ver 1.0.5.
- **Re-verify suite (all exit 0):**
  - `smoke-youtube-rewrite-unit.mts` PASS (offline id+error builder)
  - `smoke-youtube-rewrite-flow.mts` PASS (SKIP-NET if YouTube RATE_LIMITED)
  - `smoke-youtube-timedtext-fallback.mts` PASS (skip-net ok)
  - `smoke-youtube-outline-only.mts` PASS (2 ch, live Gemini)
  - `tsc --noEmit` exit 0
- **Fix:** PATH python first then resolvePythonExe; timedtext fallback; 429→RATE_LIMITED; outline auto-retry RPM; plot-only still allowed.
- **Honest limit:** YouTube can still RATE_LIMIT/IP_BLOCK — app returns clear fix UI, not silent fail.

## LA Studio Voice Clone save + preview (2026-07-23)

- **Bug:** Tab Voice Clone không lưu giọng / không list / không nghe thử dùng lại (API session-only).
- **Fix:** `laStudioClones.ts` disk `data/la-studio/user-clones`; POST always save; GET `userClones`; sample-audio serve `lsc_*`; UI list ▶/TTS/xóa; Omni + la_studio re-register on synth; preview Omni fail → ref sample (full gen hard-fail B10).
- **Proof (live HTTP :3000):**
  - `smoke-la-studio-clone-http.mts` PASS — POST save + GET list + sample 99404B + TTS preview 182652B + DELETE
  - `smoke-la-studio-clone-omni-tts.mts` PASS — Omni inference fail → `OmniVoice-UserCloneSample` preview file on disk
  - `smoke-la-studio-clone-e2e.mts` PASS; `tsc --noEmit` exit 0
- **Note env:** LA Studio desktop API offline; Omni clone synth 500 libtorchcodec — Nghe mẫu/preview vẫn OK.

## Gen Prompt empty array 502 (2026-07-23)

- **Toast:** «AI trả về mảng prompt rỗng… kiểm tra API key / model master»
- **Root chính:** `capSentences` return cùng ref khi N≤max → caller `raw.length=0; push(...capped)` xóa hết → AI gen 0 câu (log `cap shots 5 → 0`).
- **Root phụ:** Gemini `parts[0]` only; JSON prefer `{` trong array; empty `[]` không retry; RPM mislabeled empty.
- **Fix:** `capSentences` luôn `.slice()`; join Gemini parts; prefer `[`; normalize sâu + rate-limit stop; 429 rõ.
- **Proof:** `smoke-prompt-json-parse` PASS; `smoke-gen-prompt-handler` → status 200 · **5 prompts** (img/vid >600ch); `tsc` exit 0.

## Trial WRITE max_chapters false positive (2026-07-23)

- **Bug:** Trial gen «Sinh Chi Tiết Chương 1» fail toast «tối đa 10 chương» dù chỉ 1–2 chương.
- **Root:** `assertFreeWriteConstraints` dùng `p.chuong_hien_tai ?? p.so_chuong` — client gửi object chương → `Number(object)=NaN` → `isTrialChapterOutOfRange` luôn true.
- **Fix:** `resolveWriteChapterNum` trong `freeLimitsPolicy.ts` (đọc `chuong_hien_tai.so_chuong`; cấm fallback `so_chuong` planned).
- **Proof:** `npx tsx scripts/smoke-free-limits.mts` → exit 0 (section resolveWriteChapterNum).

## PACK_NOTES rewrite — 4 bước (2026-07-22)

- **Doc:** `docs/PACK_NOTES.md` — §0 thép · §1 lệnh · **§2 quy trình 4 bước** · **§3 phiếu tick** · §4 copy-paste · §5–10 ref (license/defense/store/pipeline/update)
- **Banner:** `scripts/preflight-pack.mjs` in 4 bước + 5 gate sau pack
- **Cross-ref:** SHIP_GUIDE §3b · PACKAGING_STANDARD · post-pack checklist · AGENTS table
- **Ý:** sửa main nhỏ → pack:ship full → test artifact MỚI đúng chỗ sửa + 5 gate; pack ≠ publish feed

## White-machine verify 1.0.5 (2026-07-22)

- **Pack:** `dist-qa-unsigned/AI-Novel-1.0.5-x64.exe` + win-unpacked; audit + postpack PASS
- **P0 fix:** `main.js` `tryServeRuntimePublic` — TTS `GET /audio/*` 200 on clean AppData (1.0.4 was 404)
- **Proof:** white boot Edge TTS len=24621 + AUDIO_PLAY_PATH PASS; `npm run verify:agent-done` PASS; go-live SOFTWARE READY (Authenticode residual only)
- **Report:** `scratch/white-machine-sim-report.md`
# Project memory (AI Novel)

## Telegram bot: menu + nút hoạt động (2026-07-22)

- **UX:** `setMyCommands` Menu góc trái; reply keyboard; inline `menu:*`; answerCallback ngay khi Cấp Key
- **Admin:** multi-id `CHAT_ID` (phẩy); `isAdminActor(chat|from)` — sửa nút chết do id không khớp
- **Pending:** Cấp key/Tra cứu/Thu hồi → tin tiếp theo
- **Proof:** `npx tsx scripts/smoke-telegram-admin.mts` → PASS
- **Deploy:** `npm run telegram:deploy-bridge` rồi `/start` trên bot

## Telegram bot: kích hoạt tay + lệnh quản lý (2026-07-22)

- **Feature:** Dán HWID → wizard gói; `/activate|/gen|/cap`; `/lookup` `/list` `/revoke` `/plans` `/status` `/help`
- **App:** `telegramAdminCommands.ts` + `telegramWebhookHandler.ts` + callback `pick:` / `revoke_confirm:`
- **Bridge parity:** `deploy/telegram-bridge/lib/bridge.ts`
- **Docs:** `COMMERCIAL_ADMIN.md` · `COMMERCIAL_OPS.md`
- **Proof:** `npx tsx scripts/smoke-telegram-admin.mts` → PASS; `tsc --noEmit` exit 0
- **Deploy live:** `npm run telegram:deploy-bridge` (seller)

## Payment-notify messageId + customer bot forward (2026-07-22)

- **User:** bấm thanh toán nhưng bot admin không nhận ticket.
- **Root:** mở bot trống ≠ ticket; bridge nuốt tin non-admin; soft success không siết messageId.
- **Fix:** UI success chỉ `ok+messageId`; fail mới deep-link `start=pay_plan_hwid`; fan-out admin ids; bridge `handleCustomerPaymentMessage`.
- **Proof:** probe messageId 59/60/61 PASS; playwright license UI PASS; `telegram:deploy-bridge` webhook live.

## LicenseModal trial 3s + báo Admin (2026-07-22)

- **Feedback:** Dùng thử im lặng (không báo chờ 3s); «Đã thanh toán» auto-open Zalo, không mở Tele.
- **Fix trial:** countdown 3s. **Paid:** xem mục messageId phía trên (không mở bot trống khi OK).
- **Files:** `LicenseModal.tsx`, `pricingPlans.ts` (telegramBot*), `payment-notify/route.ts` (telegramUrl).
- **User-path verify:** `npx tsx scripts/smoke-license-user-path.mts` PASS (live API `telegramUrl=t.me`); Playwright `e2e/ui-license-user-path.spec.ts` PASS (logo→trial chờ 3s→paid open t.me only).
- **Electron:** `window.open(https://t.me/…)` → `setWindowOpenHandler` → `shell.openExternal` (user OS mở Telegram).
- **Cooldown 429:** không re-open Tele (tránh spam) — đúng.

## Trial limits (2026-07-22)

- **Free unchanged:** 600 từ · 2 chương · 3 lượt/ngày
- **Trial:** như Pro · **7 ngày** · **5 lượt/ngày**/mục · **≤3000 từ**/chương · **≤10 chương**
- Code: `FREE_LIMITS` / `TRIAL_LIMITS` · `freeQuota` meters free+trial · UI LicenseModal + Setup

## Sole truth Supabase only — no ghost TRIAL (2026-07-22)

- **Bug:** vault local → badge TRIAL while licenses table empty (user screenshot)
- **Cause:** vaultTrial + resolve vault grant after empty ledger; insert user_id=HWID failed on uuid column silently before
- **Fix:** authority=supabase → vault NEVER grants; `insertLicenseRow` retries user_id=null if uuid; LicenseModal requires token + refresh from ledger
- **Seed:** `npx tsx scripts/seed-cloud-trial.mts` → row trial active + status fromSupabase
- **Proof:** after seed: found trial, tier=trial, fromVault=false, fromSupabase=true

## licenses.user_id = device HWID (2026-07-22)

- **Policy:** `licenses.user_id` stores app device code (HWID lowercase), not auth.users uuid
- **Code:** `licenseDeviceUserId()` · trial/issue/telegram/activate/promote all set `user_id=hwid`
- **SQL:** `supabase/migrations/003_licenses_user_id_device.sql` (drop FK + text + backfill)
- **Backfill:** `npx tsx scripts/backfill-license-user-id-device.mts` (after migration)
- **Note:** Live DB still uuid until 003 run in Supabase SQL Editor (no ACCESS_TOKEN on machine)

## Trial unlock Pro-equivalent gates (2026-07-22)

- **Bug:** enforce + Supabase no-row → Free; local trial vault ignored; force Free block killed trial without SERVICE_ROLE
- **Fix:** `resolveRequestAccessAsync` honors active trial vault after empty ledger; status `vaultTrial` + synthetic claims; local `startTrial` mints AINOVEL2 token; startCloudTrial ilike + already-Pro short-circuit
- **UI:** LicenseModal always set trial flags + keep if refresh demotes; copy lists Trial vs Pro-only
- **Matrix:** Trial = video/CapCut/ship/tts_premium; toolbox/multi_channel/flow_multi = Pro only
- **Proof:** `npx tsx scripts/smoke-trial-unlock.mts` PASS; diag-trial assertProAccess OK on real ledger

## Machine store survives portable wipe (2026-07-22)

- **Problem:** free-usage + local trial lived under `data/licenses/` in app folder → xóa app + giải nén lại = reset
- **Fix:** `licenseMachineStore.ts` → `%USER_DATA%/.ainovel-license/` (Electron) hoặc `~/.ainovel-license/` + migrate legacy; Windows HKCU secondary (`Software\AiNovel\MachineStore`)
- **Wire:** `freeQuota.ts`, `trial.ts`; seller vaults (activation-codes) vẫn app root
- **Pack notes:** `docs/PACK_NOTES.md` §2b + **§4 auto-update** + banner `preflight-pack.mjs` + `PACKAGING_STANDARD.md` §5 update
- **GUI fix:** freeQuota `existing`/`wordGoal` renamed trial/free scopes (Next “defined multiple times” → commercial/status fail)
- **Proof:** `npx tsx scripts/smoke-machine-store-wipe.mts` → PASS; `smoke-free-limits` PASS; freeQuota import OK; preflight banner prints machine store

## Pack notes anti-skip (2026-07-22)

- **Doc:** `docs/PACK_NOTES.md` — sole truth Supabase, pack:ship vs commercial, grace, checklist
- **Preflight:** banner full mỗi `npm run preflight:pack` / `pack:ship`
- **Standard:** PACKAGING_STANDARD.md §5b–5c + JSON v1.0.2 `packNotesDoc`
- **SHIP_GUIDE** §3b trỏ PACK_NOTES

## Defense pack wave (2026-07-22)

- **Grace:** offline 24h · first-run 6h · strict 3h · seat 10m
- **ASAR integrity:** default ON afterPack (fuse last); auto fallback OFF
- **Deny log:** `deny-events.jsonl` (hwid8 + reason)
- **Preflight:** LICENSE_API probe + TLS pin reminder + CSC note
- **Smoke:** `npm run smoke:defense-pack` · `postpack:checklist`
- **Still external:** Authenticode CSC cert; Vercel SERVICE_ROLE live; white-box revoke test by hand
- **Deferred (honest):** full asarmor encrypt; whole-src obfuscate

## License sole truth = Supabase HWID (2026-07-22)

- **Policy:** `licenses` row active by HWID = Pro/Trial; **delete/revoke/expired = Free** even if AINOVEL2 crypto still verifies
- **Bugfix:** `probeOnlineVerify` treated `valid:false`/missing row as online-OK → stale PRO after Supabase delete
- **Fix:** missing/none/revoked/expired → `revoked`; `useEntitlementSync` Free-first + clear token on cloudStatus none; enforce without SERVICE_ROLE (non-packaged) → Free
- **Pack notes:** preflight-pack banner + `PACKAGING_STANDARD.md` §5b + `SHIP_GUIDE` §3b + `LICENSE_ONE_PATH`
- **Proof:** typecheck; source assert probe no longer returns valid on valid:false

## LA Studio ship sample + pitch + global TTS (2026-07-22)

- **Ship:** sau tải family → `prepareFamilySamplesForShip` bake WAV vào `userData|data/la-studio-family-samples` (không phụ thuộc public/ asar); URL = `/api/la-studio/sample-audio?familyId&voiceId` (+ `bake=1` lần đầu); UI `ensureSamples=1`
- **Pitch:** slider Cao độ dưới Tốc độ LA Studio (−12…+12); gen FFmpeg khi `nativePitchApplied=false`
- **Global:** gen TTS dùng `store.ttsConfig` (platform·voice·speed·pitch·laStudioFamily) — `ttsModule` + `/api/generate-tts`
- **Proof:** discover withUrl full; sample URL starts with `/api/la-studio/sample-audio`; typecheck 0

## LA Studio family giọng mẫu (2026-07-22)

- **Root:** Family tỉa (VieNeu/Vibe/Vox/Omni/Kokoro82) thiếu WAV ▶; GET `/voices` await bake treo UI; `ensureFamilySamplePack` đè `voices.json` (mất VieNeu presets); Omni 0 WAV.
- **Fix:** discover scan `voices_v3_*.json` · không đè catalog thật · bake nền · gắn `samplePublicUrl` · UI badge ▶ mẫu + phát WAV instant · bake preset VieNeu + Omni.
- **Proof:** every family withUrl=full (Kokoro-VI 14, VieNeu 15, Omni 4, Vibe 5, Vox 5, K82 4); `typecheck` exit 0.

## Engine Voice library (2026-07-22)

- **Why “không có giọng mẫu”:** Engine tab chỉ có dropdown + 1 nút Nghe thử; LA Studio có list + ▶ từng hàng. Hầu hết engine **không** ship file WAV tĩnh (`previewUrl` hiếm) — nghe = **gen live** cùng pipeline TTS.
- **Fix:** `EngineVoiceTab` = Voice library scrollable + filter + ▶ per-row (`handlePreviewVoice(voiceId)` đã có sẵn).
- **Proof:** `npm run typecheck` exit 0; `verify:tts-integrity` ok; `smoke:vina` 76/76.

## LA Studio portable ship (2026-07-22)

- **Ship TTS:** `bin/la-studio-kokoro/` (~356MB) — Kokoro-VI CLI + onnx + voicepacks; **không** cần cài LA Studio trên máy khách
- **Pack:** `extraResources` → `resources/bin/la-studio-kokoro`; `beforePack` + `pack:commercial` / `pack:unsigned:qa` / `build:desktop` gọi `npm run prepare:la-studio-kokoro`
- **Resolve:** `AI_NOVEL_ROOT/bin/la-studio-kokoro` → cwd → `~/.lastudio/...` fallback; first-run download zip nếu thiếu (`laStudioKokoroEnsure.ts`)
- **Platform:** `la_studio` UI + synth CLI; optional desktop API ẩn nếu user có LA Studio.exe
- **Proof:** `npm run smoke:la-studio-tts` → source=bundled · RIFF WAV · `error_count=0`

## LA Studio «kết nối nhưng không nghe thử» (2026-07-22)

- **Root:** GET `/api/la-studio/voices` chờ `ensureLaStudioApiReady` poll **20s** (API offline); UI chọn giọng fake `default` («model đang load»)
- **Fix:** voices GET = probe 1.5s only + catalog Kokoro offline; preview không await spawn; default voice `diem_trinh`
- **Proof:** voices **1428ms** (was ~21s); preview `diem_trinh` **5158ms** `LAStudio-KokoroCLI` success; typecheck 0

## Style Engine Profiles — 5 niche hot (2026-07-23)

- Module: `src/lib/styleEngineProfiles.ts` — `tu_tien` | `do_thi_va_mat` | `mat_the_sinh_ton` | `kinh_di_huyen_nghi` | `cung_dau_ngon_tinh`
- Setup match (`chu_de`+`phong_cach`) → soft WPM/beat/visual; store `activeStyleEngineId`; chip SetupPhase
- WRITE/outline/scene + Gen Prompt shot intersect; SEO CTR title/thumb boost via youtube-meta path
- Format DNA (`scriptMode`) vẫn master cold-open policy / short WPM; niche = content DNA
- **Fix:** `allocateShotDurationsByMode` — when even duration outside style∩mode band, even-split + force exact sum (tránh lệch tổng TTS)
- Setup labels: `matrixEngine/catalog` (`MATRIX_THEMES`/`STYLES`) — chip + soft patch vẫn khớp 5 niche; coexists with `buildMatrixWriteBlock`
- Proof (re-verify): unit + integration + **hardened** (NFC, false+, sum 5×3×6×4, SEO×5, wiring) · pacing 28 · typecheck 0

## Short/Manhua pipeline logic (2026-07-22)

- **Quy trình app** + **logic short** xuyên: outline/write/revise/scene expand-rewrite/gen prompt/quality/media soft
- `scriptMode` pacing (Phong Cách Kịch Bản): `SCRIPT_MODE_PACING` — chuyen_sau coldOpen=off ~130WPM/7s; sang_van soft ~155/4.5s; short_manhua on ~170/3.5s + CẢNH 0 cold open
- `setScriptMode` → `scriptModeMediaSoftPatch` (wpm/beat/video/so_tu) mọi mode; WRITE inject pacing+coldOpen; Gen Prompt `allocateShotDurationsByMode` (tension weight short/sang)
- min scenes short=4; quality hint thiếu CẢNH 0; modules pass `scriptMode`
- Proof: `npx tsx scripts/smoke-printfilm-adoptions.mts` + `npm run typecheck` → exit 0 (2026-07-23)

## Purge mạt thế / forced-genre hardcode (2026-07-22)

- Removed genre pack `mat_the`; Setup chips Mạt Thế / Post-Apocalypse / Hậu Tận Thế / Tận Thế-Di cư
- Neutralized all runtime messages/prompts: no silent genre default (B10 kept)
- SEO default tags + psych lexicon no longer seed mạt thế; fixtures/scripts cleaned
- Legacy channel id `mat_the` → getGenrePack returns null (no crash)

## Printfilm adoptions locked (2026-07-22)

- **Doc:** `docs/PRINTFILM_ADOPTIONS.md` — P1 wardrobe · P2 optional start+end frame · P3 soft checklist · P4 media status · **P5 short_manhua scriptMode**; reject Phase wizard / Docker SPA / GitCC-only
- **P1:** wardrobe variants + gen still · scene location library
- **P2:** use_end_frame · dual-still hard-fail · Flow `*_fl` sibling
- **P3–P4:** progress strip · media provider chip
- **P5:** `scriptMode: short_manhua` · craft/outline/evaluate · Setup UI teal · gợi ý 1200 từ/chương
- **Smoke:** `npx tsx scripts/smoke-printfilm-adoptions.mts`

## OmniVoice Local engine + nghe thử (2026-07-22)

- **Root cause:** `resolveOmniPython` rơi về `python` hệ thống (C:\\Python314) → `No module named omnivoice_server` → Bật engine / Nghe thử fail
- **Fix:** ưu tiên `D:\\SuperAudioTools\\omnivoice-python` + `gpu_profile.json` + `omnivoice-server.exe`; cấm generic PYTHON_PATH không có omnivoice
- **Library:** `loadOmniLibrary` + `/api/tts/voices` đọc `D:\\SuperAudioTools\\omnivoice-library.json` (410) + refs/profiles SuperAudioTools; remap `E:\\SuperFreeVoice\\...`
- **Proof:** POST `/api/omnivoice/status` started online; preview alloy + clone (nhat/thanh-ngoc) RIFF WAV qua `/api/generate-tts` isPreview; catalog omni vi≈68; python path SuperAudioTools

## Agent Done Gate — chống ảo giác khi báo xong (2026-07-22)

- **Spec:** `docs/AGENT_DONE_GATE.md` · AGENTS §12b · status ladder `IMPLEMENTED`→`TYPECHECK_OK`→`SMOKE_OK`→`MEDIA_OK`→`DONE`
- **Scripts:** `npm run smoke:vina` · `verify:tts-integrity` · `verify:agent-done` (auto domain từ git diff; cấm false-positive `package.json`→ship)
- **Gatekeeper map Grok:** `invoke_subagent`→`spawn_subagent` · `run_command`→`run_terminal_command` · skill `~/.grok/skills/empirical-qa-auditor/SKILL.md` + check-work
- **Global:** `~/.grok/Agents.md` + `Claude.md` Final Gatekeeper rewritten
- **Proof:** `npm run verify:agent-done` → exit 0 · `VERDICT: PASS` · domains=core,tts,commercial,code · typecheck + smoke:vina 76/76 + verify:tts-integrity + smoke:license-one-path + smoke:core · report `scratch/agent-done-gate-report.json`
- **MEMORY rule:** mọi dòng PASS sau này phải `Proof: \`cmd\` → exit 0; note: …` — cấm “smoke PASS” không log

## Boot fail ASAR + main harden (2026-07-21)

- Symptom: packaged .exe exits immediately; stderr `ASAR Integrity Violation` + Next SWC ENOTDIR
- Cause: EnableEmbeddedAsarIntegrityValidation after rcedit icon; plus main.js minify race
- Fix: asar integrity fuse **off** by default (`AINOVEL_ASAR_INTEGRITY=1` opt-in); exclude `main.js` from re-harden minify
- Boot verified: win-unpacked 1.0.3 → API commercial/status **200**

## Packaged payment-notify → Telegram (2026-07-21)

- Cause: packaged strips TELEGRAM_* secrets; local notify failed with 503
- Fix: `payment-notify` proxies to license API when `isPackagedCustomerRuntime()`
- Vercel must have `AINOVEL_TELEGRAM_BOT_TOKEN` + `CHAT_ID`
- Rebuild ship exe after this fix

## Brand + packaging standard (2026-07-21)

- **Name:** Ai Novel · **Logo:** gold plane mark (`build/icon-source-logo.jpg`)
- Splash: logo only (no spinner) · Taskbar icon = logo · `npm run brand:icons`
- **Icon alpha (2026-07-22):** `generate-brand-icons.mjs` flood-fill + **circular soft-mask** + **PNG-in-ICO** (7 frames). Splash/UI prefer `splash-logo.png` / `icon.png`. Proof: `brand:icons` hasAlpha true, transparentPct ~65, blackishOpaque ~113, icoPngFrames 7. Packaged: patch `app.asar` electron/icon.* + rcedit exe; Windows icon cache may need unpin/reopen.
- **Pack 1.0.4 ship (2026-07-22):** `npm run pack:ship` → `dist-qa-unsigned/AI-Novel-1.0.4-x64.exe` (~461MB). Preflight PASS; brand alpha in asar icon.png tPct 65.2; audit:package PASS; anti-tamper/labyrinth/crown PASS. `smoke:re-harden` aligned: main.js NOT in SHELL_FILES (boot-critical). main.js workspace not stuck minify.
- **Unsigned install allowed** (`forceCodeSigning: false`, `ALLOW_UNSIGNED=1`)
- Standard files: `resources/commercial/PACKAGING_STANDARD.{json,md}`
- Pack: `npm run pack:ship` / `pack:unsigned:qa` (icons auto-regen)

## Updater GitHub Releases (2026-07-21)

- Public release-only repo: `khanhtran0393/AI-Novel-release-` (source stays private)
- `AINOVEL_UPDATE_PROVIDER=github` · owner/repo in `public.env` + `electron/updater.js`
- README pushed to release repo; `npm run release:github` needs `GH_TOKEN`
- Manual: attach `AI-Novel-*.exe` + `latest.yml` to Release tag `vX.Y.Z`
- Policy: download stage → install next launch; `AINOVEL_UPDATE_ALLOW_UNSIGNED=1`
- Docs: `docs/APP_UPDATE.md` · `release-repo/README.md`

## Updater fix — user tự update 100% path (2026-07-22)

- **Root causes:** (1) updater chỉ FEED_URL trong khi public.env=github; (2) `verifyUpdateCodeSignature=false` no-op; (3) re-harden **stale backup** ship updater cũ; (4) release thiếu `latest.yml`; (5) portable kém NSIS.
- **Fix code:** dual-feed github→Supabase; `async () => null`; re-harden always snapshot workspace; pack:ship = **NSIS**; FEED_URL bật trong public.env.
- **Ship 1.0.5:** `dist-qa-unsigned/AI-Novel-1.0.5-x64.exe` + GitHub `v1.0.5` có exe+latest.yml+blockmap. Proof: `release:github:verify` PASS; HEAD latest.yml/exe 200; asar has `listFeedCandidates`+`async ()=>null`.
- **Publish:** `npm run release:github:cred` (git credential) / `release:ship-update`. Supabase full exe có thể 413 (limit 50MB) — dual-feed fallback khi limit ≥500MB.
- **User bản <1.0.5:** cài tay 1 lần từ https://github.com/khanhtran0393/AI-Novel-release-/releases/tag/v1.0.5 — sau đó tự update.
- **Empirical proof (2026-07-22):** `npm run smoke:auto-update` — client 1.0.4 → feed 1.0.5; Phase A download 509552392B + sha512 match; Phase B electron-updater `Found version 1.0.5` + full download to `%LOCALAPPDATA%/ainovel-update-smoke/pending/`. VERDICT PASS.
- **latest.yml canonical (2026-07-22):** `scripts/lib/latestYml.mjs` — always `version:` + path match exe; `generate-update-manifest --strict`; pack/publish overwrite builder yml; fail if missing version.

## Xóa tất cả / factory reset (2026-07-21)

- Settings GUI **Xóa tất cả** → `factoryResetKeepPlan` + vault clear + extras LS wipe
- Wipes: canvas, keys, GPU/NVENC, TTS, media paths, channels → INITIAL
- **Keeps:** Free/Trial/Pro (`is_*`, credits) + `ainovel.entitlementToken`
- Docs: `docs/RESET_POINT.md` (section Xóa tất cả)

## Supabase ledger sole truth (2026-07-21)

- **Rule:** `licenses` active by HWID = Pro/Trial; **no active row** (delete / revoked / expired / never issued) = **Free** (ban or expired).
- **Removed:** status/verify self-heal INSERT from offline `AINOVEL2` token; `promoteHwidLicenseToPaidPro` **never INSERT**.
- **Activate:** only bind `token_hash` onto existing active row (or redeem pre-issued code). Missing row → 403.
- **Status:** pure read `resolveLicenseByHwid`; `clearLocalToken` when no cloud grant; cloud error fail-closed Free.
- **Files:** `commercial/status`, `licenseBridge.verifyLicenseCloud`, `entitlement/activate`, `LICENSE_ONE_PATH.md`, `COMMERCIAL.md`.

## Labyrinth + expanded bypass probe (2026-07-20)

- **Bypass probe:** `labyrinth/bypassProbe.ts` — multi canary, matrix free≠video, NODE inject, license host, clock, decoy, packaged policy
- **Client probe:** `clientBypassProbe.ts` + `useEntitlementSync` → shadow (UI không khóa)
- **Mirage + wrong-path:** `apiGate` / video / CapCut / ship; signals `MIRAGE_SERVED` / `WRONG_PATH_RUN`
- **Status:** `bypassProbe` + `antiTamper.bypassScore` · docs `LABYRINTH.md`
- **Smoke:** `npm run smoke:labyrinth` in `smoke:commercial` PASS (clean probes + mirage + wrong-path + client shadow)
- **UI:** video/CapCut/ship use `executeClientWrongPremium` when client shadow; UI not locked
- **Cấm:** mirage user sạch; media file thật khi mirage (B10)

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

## Telegram bridge ledger fix (2026-07-21)

- **Bug:** bridge chỉ ký `AINOVEL2…`, **không** ghi `licenses` → app One-Path reject: «không có license active trên Supabase».
- **Fix:** `issueAndPersist` + PostgREST insert/update; deploy env `SUPABASE_URL` + `SERVICE_ROLE`; message Telegram hiện `📒 Supabase licenses: OK|LỖI`.
- Live: `supabaseLedger=true` trên `ainovel-telegram-bridge.vercel.app`.
- **Ops:** key cũ (trước fix) phải **Cấp Key lại** cho HWID; dán đúng 1 dòng `AINOVEL2.…` đúng máy.

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

## Crown IP seal (toolbox anti-theft) — 2026-07-20

- **Phantom-X** + **Dịch SRT rules/prompt** → `resources/crown/*.seal` (AES-256-GCM); pack via `with-crown-sealed-build.cjs` stubs formula sources so plain logic not in app.asar.
- **Python analyzers** → afterPack seals `.py` → `.py.seal` (v2 stdlib keystream+HMAC) + thin stub; `ip_seal_loader.py`.
- Client UI uses `publicCatalog.ts` / `publicTranslateCatalog.ts` only (no seal/fs).
- Commands: `npm run crown:seal` · `smoke:crown-ip` · `AINOVEL_CROWN_PYTHON=0` skips py seal.

## NAV analyzer cloud + gateway compile — 2026-07-21

- **Cloud IP:** `navAnalyzerCrown.ts` + `navAnalyzerCloudBridge.ts` + `/api/cloud/ip/nav-analyzer` (script2prompt, storyboard). Packaged → cloud (BYOK Gemini). youtube_analyze stays local sealed.
- **Routes:** `navtools/script2prompt`, `navtools/storyboard` use bridge; fail-closed packaged.
- **Gateway compile:** `scripts/compile-python-gateway.cjs` — Nuitka/Cython/pyc for `ainovel_host_guard` + `gateway/host_binding`; afterPack runs on pack dir.
- Smoke: `npm run smoke:nav-analyzer-cloud` · `npm run compile:python-gateway`
- Env: `AINOVEL_NAV_ANALYZER_CLOUD=0|1`

## Full toolbox cloud IP stack — 2026-07-21

- **Bypass:** `bypassCloudBridge` + `/api/cloud/ip/bypass` (`compile_graph`); route wires precompiled → local FFmpeg. `AINOVEL_BYPASS_CLOUD`
- **Translate SRT:** `translateCloudBridge` + `/api/cloud/ip/translate` (`build_prompt`); tts-batch-srt passes token. `AINOVEL_TRANSLATE_CLOUD`
- **Strict online:** `toolbox_labs` already in STRICT_ONLINE_FEATURES (~6h)
- **Portable Python:** `resolvePythonExe` prefers `resources/python-runtime/python.exe`; README in that folder
- Smoke: `npm run smoke:toolbox-cloud-ip`

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
- **Gen Prompt (2026-07-15):** Cấm hardcode genre/style ngoài Setup trong director/Seedance. Style = Visual DNA/Media Style; genre = Setup `chu_de`+`phong_cach`. B10: không local-fill prompt; thiếu config/AI fail → toast/API error rõ. Timestamp unified `start-end s`. Shot graph chỉ server.
- **Write engine (2026-07-15):** `storyWriting.requireGenreLabelFromSetup` + `lorebookForPrompt` + `writeEngineRoleLine`. WRITE/REVISE/EVALUATE/EXPAND/REWRITE/OUTLINE/IDEAS bám Setup; không fallback “luật thế giới ngoài Setup”. Initial setup `chu_de`/`phong_cach` rỗng — user phải chọn.
- **Prose anti-stiff (2026-07-21):** Giữ nguyên TỪ CẤM + TỪ SÁO + time-skip/FX cấm. Cải thiện: role “nhà văn/biên kịch kể chuyện”; `buildProseCraftBlock` (nhịp câu, subtext, chi tiết đắt); humanize cho phép xen câu dài; open loop không máy; word-gate bù “chất lượng không nhồi”; `CONTINUE_TAIL_WORDS=1600` + craft nối giọng; joke 1–2 ở nhịp thở; EVALUATE trừ thô cứng; scene expand/rewrite mượt hơn.
- **Desktop brand icon/splash (2026-07-21):** Taskbar không đổi vì (1) BrowserWindow thiếu `icon`, (2) boot splash là data-URL spinner không load `electron/splash-logo.jpg`, (3) `pack:unsigned:qa` từng `signAndEditExecutable=false` → .exe không nhúng icon. Fix: `setAppUserModelId` + window icon; loadFile `electron/splash.html`; afterPack rcedit `build/icon.ico`; bỏ flag tắt edit exe; NSIS installer icons.
- **Boot logo 5s (2026-07-21):** `electron/splashBrand.js` — embed logo base64 + `createSplashGate` min 5000ms (`AINOVEL_SPLASH_MS`). `main.js` không nhảy `/workspace` cho đến server ready **và** đủ 5s. Pack: `brand:icons` + `brand:sync` + beforePack `syncBrandAssets` hard-fail thiếu logo; afterPack verify asar brand files. Lưu ý: re-harden minify có thể ghi đè main.js — afterPack restore; nếu kẹt hardened → `restoreShellFromBackup`.
- **Brand pack LOCKED (2026-07-21):** Spec `docs/BRAND_SPLASH.md`; chuẩn `PACKAGING_STANDARD.md` §1–2 + JSON splash.transparentWindow; ship-check/audit required brand files; beforePack gate transparent+splashBrand; `npm run smoke:brand-splash`. Splash = logo nổi trong suốt, không panel.
- **Pass 3 (2026-07-15):** novel-engine `setupGenrePayload`; OUTLINE/PLAN_ARC/COMMIT hard-require Setup; INITIAL_LOREBOOK production-only; NV **khuyết điểm** bắt buộc (không “trope khuyết tật cứng”); seedance duration hard-fail; soft idea/noi_dung fallback removed.
- **AGENTS.md (2026-07-15):** viết lại toàn bộ theo runtime hiện tại — native engine, B10, Setup genre, khuyết điểm, Gen Prompt pipeline, domain tree, checklist 30s; gỡ nội dung cũ (CapCut→Edge, path hooks sai, genre hardcode).
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
- **Global TTS Config bug (2026-07-21):** (1) data/vina-voices wiped + commit bbd24d5b deleted profiles_goc → Zero-Shot 0 profile; restored JSON from 24c710ba. (2) samples WAV still 0. (3) Free hid premium option while persist capcut/vina → blank select. Fix: keep current option + free→Edge heal; CapCut banner; prep fail→STATIC; clean-workspace no longer emptyDir vina catalog. Edge proof scratch/edge-preview-test.mp3 18576B. | **Pro TTS 403 (2026-07-22):** resolveRequestAccessAsync (Supabase) yêu cầu token → demote Free dù ledger HWID Pro; commercial/status vẫn PRO. Fix: HWID ledger primary (token optional), aligned status. Proof: access_no_token tier=pro, requireTts vina OK, freeLimitsApply=false. | Samples: NOT deleted by agent build — already empty; clean-workspace(bbd24d5b) wiped data/vina-voices; package.json !data/** excluded samples from exe. Fix: extraResources data/vina-voices + getVinaRoot AI_NOVEL_ROOT. Still need restore 76 WAVs (SAMPLES_REQUIRED.txt). | **Restored 2026-07-22:** 76/76 WAV via scripts/vina-voice/restore-samples-from-catalog.mjs (Edge VI/EN + ffmpeg). VERIFY withSample=76.
- **Nghe thử preflight (2026-07-22):** (1) Free quota: `isPreview` **không** `assertAndConsumeFreeQuota` (tránh 3 lần nghe thử = 429). (2) Client preflight chung `previewPreflight.ts` — chặn Free+premium, thiếu Gemini/OpenAI/TikTok/VBee/CapCut key-session trước API. (3) MIME seal hard-fail file <400B / HTTP≥400 (không nuốt lỗi rồi play URL rác). (4) TikTok multi-session backfill. Verify: `npx tsx scripts/verify-tts-preview-preflight.ts` + live Edge preview cache HIT 200.
- **Nghe thử chuẩn + chống rè (2026-07-22):** (1) Client/server NFE lockstep `VINA_PREVIEW_NFE_DEFAULT=20` (`previewDefaults.ts`). (2) Peak limiter ~−1 dBFS (engine + applyAudioEffects + Python ONNX). (3) MIME magic-byte seal cache v8. (4) Cache version `v3-peak-headroom-nfe20`. Live proof: Edge max−4.1dB, Vina max−1.0dB, Piper max−0.9dB; durable cache 19/19 speech-like. `npm run verify:tts-preview`.
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

- **2026-07-23:** Splash logo black void on transparent GPU — plate disc + box-shadow under PNG (no filter:drop-shadow); header logo circular zinc plate + cache v=alpha3. Proof: `npm run smoke:brand-splash` ok; splash HTML hasPlate+hasImg.
- **2026-07-23:** Taskbar Electron atom icon (dev): Windows uses electron.exe PE icon — `brand:patch-dev-icon` / brand:icons rcedit `build/icon.ico` into node_modules electron.exe; splashBrand prefers icon.ico on win32; main setIcon ICO + re-apply on show. Proof: electron.exe 235740672 (=packaged); resolve icon→electron/icon.ico; smoke:brand-splash ok.
