# Workspace Architecture - Phan tang AI Novel

Muc tieu: layout, chrome, feature, module, shared tach biet de sua mot mien ma khong lam chong cheo sang mien khac.

## Contracts (quy chuan trao doi)

Nguon su that: `src/contracts/`

| File | Viec |
|------|------|
| `GLOSSARY.md` | Ten bien, field, key, checklist PR |
| `keys.ts` | Asset key (`sceneAssetKey`, `imageAssetKey`, `characterImageKey`) |
| `story.ts` | Chapter DTO <-> store (`so_chuong` <-> `chapter`) |
| `apiMap.ts` | Endpoint + `requestType` owner + client owner |

### Quy tac goi API / logic

1. Can HTTP -> dung path trong `API` (`@/contracts`), khong hardcode URL moi neu da co map.
2. `/api/generate` -> `requestType` map sang handler group (`GENERATE_REQUEST_OWNERS`). Route chi dispatch.
3. Client business: `modules/*` goi API; `features/*` goi hooks; hooks goi modules + store.
4. Logic chung: `lib/*` (owner ghi ro). Logic rieng: dung trong handler/module do.
5. 2 huong du lieu (UI<->API, channel<->workspace): adapter + store action — khong ghi key ad-hoc.

### Generate handlers (`src/app/api/generate/handlers/`)

| Handler | requestTypes |
|---------|----------------|
| `visualDna` | ANALYZE_VISUAL_DNA |
| `ideas` | GENERATE_IDEA(S) |
| `imagePrompt` | GENERATE_IMAGE_PROMPT, REGENERATE_PROMPT |
| `outline` | GENERATE_OUTLINE, GENERATE_CHAPTER_OUTLINE, PLAN_ARC |
| `chapter` | WRITE/REVISE/EVALUATE_CHAPTER, COMMIT_MEMORY |
| `scene` | EXPAND_SCENE, REWRITE_SCENE |
| `character` | EXTRACT_CHARACTERS, GENERATE_CHARACTER_PROMPT* |
| `foundation` | COMPRESS_CONTEXT, IMPORT_FOUNDATION |

### TTS engines (`src/app/api/generate-tts/`)

| Path | Owner |
|------|--------|
| `route.ts` | HTTP validate + multi-seg + mix |
| `providers.ts` | Barrel → `TTS_PROVIDERS` |
| `ttsRegistry.ts` | Platform registry map |
| `engines/*` | 1 file = 1 synthesis engine (edge, piper, gemini, …) |

### Client modules call API via `@/contracts` + `apiClient`

| Helper (`modules/apiClient.ts`) | Việc |
|---------------------------------|------|
| `API` | re-export path map từ contracts |
| `resolveMasterModelKeys` / `requireMasterModelKeys` | Chọn key theo model master |
| `postGenerate(requestType, payload, opts?)` | POST `/api/generate` — **dùng chung** write/scene/setup/character… |
| `postJson` | POST JSON generic |

Quy tắc: module business **không** copy-paste resolve keys + fetch; gọi `postGenerate`.

### Image API (`src/app/api/generate-image/`)

| Path | Owner |
|------|--------|
| `route.ts` | Validate body, face-ref, dispatch provider |
| `imageSave.ts` | Lưu local + drive |
| `chromePath.ts` | Tìm Chrome cho Whisk |
| `providers/openai.ts` | DALL-E only |
| `providers/grok.ts` | xAI Grok only |
| `providers/gemini.ts` | Imagen REST only → whisk nếu cookie |
| `providers/whisk.ts` | Google Labs Whisk headless only |

### Module LLM (client)

`writeModule`, `sceneModule`, `setupModule`, `characterModule`, `imageModule` (prompt LLM) → **`postGenerate`** only.

### HTTP map

Mọi path HTTP chuẩn nằm trong `src/contracts/apiMap.ts` (`API.*`). UI/features/modules/hooks dùng `import { API } from '@/contracts'`.

### Production hardening (đợt cải tiến)

| Thành phần | Path |
|------------|------|
| Error taxonomy | `src/lib/errors.ts` |
| Zod boundary | `src/contracts/validate.ts` |
| Smoke core | `npm run smoke:core` |
| CI | `.github/workflows/ci.yml` |
| Credential Health UI | `features/settings/CredentialHealthPanel` |
| Labs tools toggle | `toolboxRegistry` + `ToolboxHost` (ẩn mặc định) |
| Checklist dev | `CONTRIBUTING.md`, `docs/IMPROVEMENTS.md` |

### Write pipeline

| File | Owner |
|------|--------|
| `hooks/useWriteChapter.ts` | Stream UI + WRITE loop |
| `hooks/writeChapterHelpers.ts` | evaluate + memory commit |
| `hooks/writeChapterFinish.ts` | Post-write: revise, SEO hook, notify |

## So do tang

| Tang | Trach nhiem |
|------|-------------|
| `layouts/` | App shell, khung cua so, window controls. |
| `chrome/` | Header/toolbar composition. Chi host feature, khong om modal logic lon. |
| `features/` | UI theo mien nghiep vu: script, settings, toolbox, download, tts, media... |
| `hooks/` | React orchestration tren Zustand va modules. |
| `modules/` | Business action thuan, khong import React UI. |
| `store/` | Zustand state shape, actions, selectors. Khong nhan UI logic. |
| `shared/` | UI primitive dung chung nhu `ToastHost`, `CustomSelect`. |
| `utils/` | Helper thuan, repair/client utility. |
| `config/` | Ban do tang/domain de refactor sau nay khong lech ownership. |

## Feature ownership

| Feature | Folder | Owns |
|---------|--------|------|
| Settings | `features/settings` | Cookie, API keys, GPU/system settings. |
| Toolbox | `features/toolbox` | Nut cong cu, menu host, batch media tools. |
| Download | `features/download` | Crawler/download studio, platform registry, download modes. |
| Script | `features/script` | Sidebar, chapters, outline, character roster, scene cards. |
| TTS | `features/tts` | TTS config, role cast, voice tabs, TikTok sessions. |
| Media | `features/media` | Image/video toolbar and generated media controls. |
| Project | `features/project` | Import, CapCut, project-level actions. |
| Channels | `features/channels` | Channel switcher, job queue. |
| YouTube | `features/youtube` | SEO/Youtube-safe UI. |
| AI Novel | `features/ainovel` | Native AI Novel engine dashboard. |

## Toolbox / Download split

`features/toolbox/ToolboxHost.tsx` chi lam 3 viec:

1. Mo/dong menu cong cu.
2. Chon tool active theo `toolboxRegistry.ts`.
3. Mount modal/panel dung domain.

Crawler/download khong nam trong toolbox nua:

| Entry | Owner |
|-------|-------|
| Download platforms/modes | `features/download/downloadRegistry.ts` |
| Toolbox menu items | `features/toolbox/toolboxRegistry.ts` |

Quy tac provider tai xuong:

- Them provider moi nhu TeraBox thi bat dau tu `features/download/downloadRegistry.ts`.
- UI rieng cua provider neu lon thi dat duoi `features/download/providers/<provider>/`.
- Server bridge/provider thuc te phai nam o `src/app/api/*`, `src/lib/*`, hoac `python_core/*`, khong nhet vao Header/Toolbox.
- Khong bat option UI khi backend provider chua ho tro that. Hien tai `python_core/tai_ytdlp.py` dang ho tro `yt`, `tt`, `tw`, `rd`, `ig`.

## Import rules

1. `layouts` duoc render chrome/shared, khong om business feature.
2. `chrome/Header` duoc import cac toolbar host nho nhu `ToolboxHost`, `SettingsPanel`, `TtsToolbarButton`.
3. `features/A` khong import UI noi bo cua `features/B`, tru khi do la host cong khai qua `index.ts`.
4. `features/toolbox` chi duoc biet `DownloadStudioPanel` qua `features/download` barrel, khong biet platform/provider download.
5. `modules/*` khong import React component.
6. `hooks/*` goi modules + Zustand; UI goi hooks.
7. Provider-specific logic khong dat trong `Header`, `Sidebar`, hoac `ToolboxHost`.

## Duong dan chinh

| Cu / flat | Moi |
|-----------|-----|
| `components/Header.tsx` | `chrome/Header.tsx` |
| `components/AppShell.tsx` | `layouts/AppShell.tsx` |
| Header settings inline | `features/settings/SettingsPanel.tsx` |
| Header/toolbox crawler inline | `features/download/downloadRegistry.ts` |
| Toolbox item array inline | `features/toolbox/toolboxRegistry.ts` |
| Download platform options inline | `features/download/downloadRegistry.ts` |
| `components/Sidebar.tsx` | `features/script/Sidebar.tsx` |
| `components/YoutubeSafeChecklist.tsx` | `features/youtube/*` |
| `components/TTSConfigModal.tsx` | `features/tts/*` |
| `components/ToastHost.tsx` | `shared/ToastHost.tsx` |

## Modules / logic

| Module | Domain |
|--------|--------|
| `writeModule`, `sceneModule`, `setupModule` | Viet kich ban |
| `imageModule`, `videoModule` | Media generation |
| `ttsModule`, `castModule`, `castPreflight` | TTS / role cast |
| `modules/tts/credentials` | Resolve API keys theo TTS platform |
| `modules/tts/preview` | TTS preview cache + preview self-heal |
| `modules/tts/generateHelpers` | Pure helper cho generate path/key/TikTok session/emotion |
| `modules/tts/multiVoiceRunner` | Multi-voice scene runner: resume partial cache, worker pool, concat |
| `modules/tts/types` | Shared TTS progress / voice segment types |
| `folderModule`, `projectModule`, `apiKeyModule`, `cookieModule` | Project / credentials |
| `integrationsModule`, `engineModule` | Pipeline / native engine |
| `notifyModule` | Toast / notification |

## Page contract

`page.tsx` la orchestrator mong: hydrate -> `AppShell` -> `Header` -> setup phase hoac workspace phase. Khong dat business generation dai trong page; day logic sang hooks/modules.

## File da tach nho

| File goc | Tach thanh |
|----------|------------|
| `chrome/Header.tsx` | `features/settings/SettingsPanel.tsx`, toolbar hosts |
| `features/toolbox/ToolboxHost.tsx` | `toolboxRegistry.ts` |
| `features/media/*` | `MediaToolbarButton.tsx` |
| `features/tts/*` | `TtsToolbarButton.tsx`, `TikTokSessionsPanel.tsx` |
| `features/project/*` | `CapCutExportButton.tsx` |
| `features/youtube/*` | `SeoField.tsx`, `YoutubeThumbPanel.tsx` |
| `features/script/SceneCard.tsx` | `ScenePromptRow.tsx` |
| `features/tts/TTSConfigModal.tsx` | `CreateVoiceTab`, `CloneVoiceTab`, `EngineVoiceTab`, `TikTokSessionsPanel`, `ttsSelectStyles` |
| `features/script/Sidebar.tsx` | `ChapterList`, `OutlineAccordions`, `CharacterRoster` |
| `features/script/CharacterRoster.tsx` | `CharacterProfileForm` |
| `features/tts/RoleCastStudioModal.tsx` | `rolecast/RoleCastRolesPanel`, `RoleCastBoardPanel` |
| `features/ainovel/AINovelDashboard.tsx` | `EngineToolbar` |
| `hooks/useTTSActions.ts` | `ttsActionHelpers` |
| `features/script/SceneCard.tsx` | `SceneTtsBar` (scene TTS / role cast / partial cache) |
| `features/tts/TTSConfigModal.tsx` | `hooks/useVoiceCatalogPrep`, `hooks/useCloneStack`, `hooks/useTikTokSessions` |
| `utils/mediaSelfRepair.ts` | `media-self-heal/types`, `media-self-heal/issue` |
| `hooks/useTTSActions.ts` | `ttsActionHelpers` chapter job/audio helpers |
| `modules/ttsModule.ts` | `modules/tts/credentials` |
| `lib/youtubeSafe.ts` | `lib/youtube-safe/config` |
| `store/useNovelStore.ts` usage | `store/useNovelStoreSelectors` |
| `lib/youtubeSafe.ts` | `lib/youtube-safe/assets` |
| `lib/youtubeSafe.ts` | `lib/youtube-safe/humanJokes` |
| `lib/youtubeSafe.ts` | `lib/youtube-safe/humanize`, `mediaRules`, `ttsGate` |
| `modules/ttsModule.ts` | `modules/tts/preview` |
| `modules/ttsModule.ts` | `modules/tts/generateHelpers` |
| `modules/ttsModule.ts` | `modules/tts/multiVoiceRunner`, `modules/tts/types` |
| `store/useNovelStore.ts` | `store/persistStorage` |
| `store/useNovelStore.ts` | `store/channelStoreHelpers` |
| `store/useNovelStore.ts` | `store/novelInitialState`, `store/novelStorePersistence` |
| `store/useNovelStore.ts` | `store/channelActions` |
| `lib/youtubeSafe.ts` | `lib/youtube-safe/text`, `timeline`, `checklist`, `seoMeta`, `exportPack` |
| `api/generate-tts/route.ts` | `api/generate-tts/audioUtils`, `api/generate-tts/providers` |
| `api/generate/route.ts` | `api/generate/modelClients` |

## Store slices (`src/store/`)

| File | Owns |
|------|------|
| `novelTypes.ts` | `NovelState` / `NovelActions` / domain types |
| `useNovelStore.ts` | Thin compose shell + re-exports |
| `novelInitialState.ts` | `INITIAL_STATE` |
| `novelStorePersistence.ts` | Zustand persist migrate/merge/partialize |
| `persistStorage.ts` | Dual local/durable storage |
| `storyActions.ts` | Setup, chapters, lore, YouTube-safe flags, world |
| `credentialActions.ts` | API keys, cookies, TikTok sessions, VIP |
| `mediaAssetActions.ts` | Generated assets + media config (channel DNA mirror) |
| `ttsCastActions.ts` | TTS config + voice cast roles |
| `channelActions.ts` | Multi-channel snapshot/switch/DNA |
| `channelStoreHelpers.ts` | DNA patch helpers |

## Hook slices

| File | Owns |
|------|------|
| `hooks/useTTSActions.ts` | Scene play/generate TTS + React state |
| `hooks/chapterTtsActions.ts` | Chapter queue TTS + cast preflight report |
| `hooks/ttsActionHelpers.ts` | Pure TTS job/credential helpers |
| `hooks/useWriteChapter.ts` | Write orchestration + stream UI |
| `hooks/writeChapterHelpers.ts` | Memory commit + editor evaluate |

## Uu tien tach tiep

1. `api/generate/route.ts` -> split request handlers/services.
2. `features/youtube/YoutubeSafeChecklist.tsx` -> split score panels + generated pack preview.
3. `features/ainovel/AINovelDashboard.tsx` -> split dashboard state + engine widgets.
4. `api/generate-image/route.ts` / `generate-tts/providers.ts` khi chạm domain đó.
