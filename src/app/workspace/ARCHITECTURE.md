# Workspace Architecture — Phân tầng AI Novel

Mục tiêu: layout, chrome, feature, module, shared tách biệt để sửa một miền mà không chồng chéo miền khác.

> Chân lý app: [`AGENTS.md`](../../../AGENTS.md) · Thép: [`docs/IRON_LAWS.md`](../../../docs/IRON_LAWS.md) · Domain: [`docs/DOMAIN_MAP.md`](../../../docs/DOMAIN_MAP.md)  
> Cập nhật theo runtime **2026-07-19**

---

## Contracts (quy chuẩn trao đổi)

Nguồn sự thật: `src/contracts/`

| File | Việc |
|------|------|
| `GLOSSARY.md` | Tên biến, field, key, checklist PR |
| `keys.ts` | Asset key (`sceneAssetKey`, `imageAssetKey`, `videoAssetKey`, `characterImageKey`) |
| `story.ts` | Chapter DTO ↔ store (`so_chuong` ↔ `chapter`) |
| `apiMap.ts` | Endpoint `API.*` + `GENERATE_REQUEST_OWNERS` + `CLIENT_OWNERS` |
| `domainOwnership.ts` | Domain tree |
| `validate.ts` | Zod boundary generate payloads |

### Quy tắc gọi API / logic

1. Cần HTTP → path trong `API` (`@/contracts`), không hardcode URL mới nếu đã có map.
2. `/api/generate` → `requestType` map handler group. Route **chỉ dispatch**.
3. Client business: `modules/*` gọi API; `features/*` gọi hooks; hooks gọi modules + store.
4. Logic chung: `lib/*`. Logic riêng: trong handler/module đó.
5. Không invent asset key ad-hoc.

---

## Generate handlers (`src/app/api/generate/handlers/`)

| Handler | requestTypes |
|---------|----------------|
| `visualDna` | `ANALYZE_VISUAL_DNA` |
| `ideas` | `GENERATE_IDEA(S)`, `ANALYZE_YOUTUBE_PLOT` |
| `imagePrompt` | `GENERATE_IMAGE_PROMPT`, `REGENERATE_PROMPT` |
| `outline` | `GENERATE_OUTLINE`, `GENERATE_CHAPTER_OUTLINE`, `PLAN_ARC` |
| `chapter` | `WRITE_CHAPTER`, `REVISE_CHAPTER`, `EVALUATE_CHAPTER`, `COMMIT_MEMORY` |
| `scene` | `EXPAND_SCENE`, `REWRITE_SCENE` |
| `character` | `EXTRACT_CHARACTERS`, `GENERATE_CHARACTER_PROMPT*` |
| `foundation` | `COMPRESS_CONTEXT`, `IMPORT_FOUNDATION`, `SUMMARIZE_SCRIPT_OUTLINE` |

Client LLM: `postGenerate(requestType, payload)` từ `modules/apiClient.ts` only.

---

## TTS (`src/app/api/generate-tts/`)

| Path | Owner |
|------|--------|
| `route.ts` | HTTP validate + multi-seg + mix |
| `providers.ts` / `ttsRegistry.ts` | Platform registry |
| `platforms/*` | 1 platform = 1 adapter (vina_voice, edge_tts, piper, …) |
| `engines/*` | Lớp synthesis thấp (edge, piper, capcut, gemini, …) |

**Default store platform:** `vina_voice`.  
**Multi-gate:** chỉ `ttsConfig` — **cấm** `sceneEmotion` trong multi-gate.

---

## Image / Video API

| API | Path |
|-----|------|
| Image | `api/generate-image/` — providers: **flow**, gemini, whisk, openai, grok |
| Video | `api/generate-video` + Seedance + Flow |
| Flow bridge | `api/flow/*` · lib `lib/flow-bridge` · WS **9223** · HTTP **8101** |

**Default:** `imageProvider=flow`, `videoProvider=flow`.

---

## Sơ đồ tầng workspace

```
src/app/workspace/
├── page.tsx
├── chrome/Header.tsx
├── layouts/          # AppShell, WindowControls
├── features/         # UI theo domain
├── hooks/            # React orchestration
├── modules/          # Business thuần (không React UI)
├── shared/           # Toast, Confirm, CustomSelect, FloatingMenu
├── config/
└── utils/
```

| Tầng | Trách nhiệm |
|------|-------------|
| `layouts/` | App shell, khung cửa sổ |
| `chrome/` | Header composition — host feature, không ôm modal logic lớn |
| `features/` | UI theo miền nghiệp vụ |
| `hooks/` | Zustand + modules orchestration |
| `modules/` | Business action thuần |
| `shared/` | UI primitive dùng chung |
| `utils/` | Helper thuần |
| `config/` | Bản đồ tầng/domain |

`store/` nằm `src/store/` (ngoài workspace folder) — Zustand slices.

---

## Feature ownership (folder thật)

| Feature | Folder | Owns |
|---------|--------|------|
| Script | `features/script` | Sidebar, chapters, outline, roster, SceneCard, Setup, Editor |
| TTS | `features/tts` | TTS config modal, RoleCast, voice tabs, TikTok sessions |
| Media | `features/media` | Media config, Flow accounts/bootstrap, DNA banner, resource monitor |
| Project | `features/project` | Import, CapCut export, Ship pack |
| Channels | `features/channels` | Channel switcher, job queue |
| YouTube | `features/youtube` | SEO, thumb, safe checklist, prompt modal |
| AI Novel | `features/ainovel` | Native engine dashboard + toolbar |
| License | `features/license` | BrandLogoButton + LicenseModal (Bản quyền) |
| Settings | `features/settings` | API keys, GPU, credential health |
| Toolbox | `features/toolbox` | Labs host, bypass, Flow agent studio, batch SRT, video-editor |
| Download | `features/download` | Download registry / crawler modes |
| Onboarding | `features/onboarding` | Onboarding banner |

### Header hosts

`chrome/Header.tsx` import: `BrandLogoButton`, badge FREE/TRIAL/PRO, `ChannelSwitcher`, `JobQueuePanel`, `ToolboxHost`, `MediaToolbarButton`, `TtsToolbarButton`, `CapCutExportButton`, `SettingsPanel`.

---

## Toolbox / Download split

`ToolboxHost.tsx` chỉ:

1. Mở/đóng menu công cụ  
2. Chọn tool theo `toolboxRegistry.ts`  
3. Mount modal/panel đúng domain  

| Entry | Owner |
|-------|-------|
| Download platforms/modes | `features/download/downloadRegistry.ts` |
| Toolbox menu items | `features/toolbox/toolboxRegistry.ts` |

- Provider download mới → bắt đầu từ `downloadRegistry`.  
- Backend: `src/app/api/*`, `src/lib/*`, `python_core/*` — không nhét Header/Toolbox.  
- Không bật option UI khi backend chưa hỗ trợ thật.

---

## Import rules

1. `layouts` render chrome/shared — không ôm business feature.
2. `chrome/Header` được import toolbar host nhỏ.
3. `features/A` không import UI nội bộ `features/B` (trừ barrel công khai).
4. `modules/*` **không** import React component.
5. `hooks/*` gọi modules + Zustand; UI gọi hooks.
6. Provider-specific logic không đặt trong Header / Sidebar / ToolboxHost.

---

## Modules / logic (client)

| Module | Domain |
|--------|--------|
| `writeModule`, `sceneModule`, `setupModule`, `characterModule` | Viết kịch bản |
| `imageModule`, `videoModule` | Media generation |
| `ttsModule`, `modules/tts/*`, `castModule`, `castPreflight` | TTS / role cast |
| `folderModule`, `projectModule`, `apiKeyModule`, `cookieModule` | Project / credentials |
| `integrationsModule`, `engineModule` | Pipeline ngầm / native engine |
| `apiClient` | `postGenerate`, headers entitlement, key resolve |
| `notifyModule` | Toast |
| `mediaGenSlotStore`, `streamUiStore` | Progress UI slots |

---

## Hooks (chính)

| Hook | Owns |
|------|------|
| `useWriteChapter` + helpers/finish | Write loop + post-write |
| `useImagePromptActions` | Gen prompt studio + batch image/video entry |
| `useTTSActions` / `chapterTtsActions` | Scene + chapter TTS |
| `useSceneActions` / `useSetupActions` / `useCharacterActions` | Scene/setup/NV |
| `useEntitlementSync` | Boot/focus Free/Trial/Pro |
| `useProAccess` | Feature matrix UI gate |
| `useProjectActions` | Làm Mới, portable, … |
| `useFolderActions` / `useCookieActions` / `useApiKeyActions` | Paths / cookie / keys |

---

## Store slices (`src/store/`)

| File | Owns |
|------|------|
| `novelTypes.ts` | State/actions types (`is_trial` included) |
| `useNovelStore.ts` | Thin compose + persist |
| `novelInitialState.ts` | `INITIAL_STATE`, `PROJECT_RESET_POINT` |
| `novelStorePersistence.ts` | migrate/merge/partialize |
| `persistStorage.ts` | Dual local/durable |
| `storyActions.ts` | Setup, chapters, lore, world |
| `credentialActions.ts` | Keys, cookies, `setVipStatus(legacyVip, pro, trial?)` |
| `mediaAssetActions.ts` | Generated assets + media config |
| `ttsCastActions.ts` | TTS + voice cast |
| `channelActions.ts` | Multi-channel |
| `useNovelStoreSelectors.ts` | Selectors including `selectIsTrial` |

**Hydration:** `isHydrated` mặc định **true** — không spinner chặn boot.

---

## Page contract

`page.tsx` = orchestrator mỏng: `AppShell` → `Header` → workspace phases.  
Không đặt business generation dài trong page — đẩy hooks/modules.

---

## Production hardening

| Thành phần | Path |
|------------|------|
| Error taxonomy | `src/lib/errors.ts` |
| Zod boundary | `src/contracts/validate.ts` |
| Smoke core | `npm run smoke:core` |
| Commercial smoke | `npm run smoke:commercial` |
| Pipeline smoke | `npm run smoke:pipeline` |
| CI | `.github/workflows/ci.yml` (nếu có) |
| Credential Health | `features/settings/CredentialHealthPanel` |
| Labs toggle | `toolboxRegistry` + `ToolboxHost` |

---

## Ưu tiên khi đụng file lớn

1. Không phình `Header` / `SceneCard` / `TTSConfigModal` — tách panel con.
2. Handler generate đã split theo file — giữ 1 requestType ownership rõ.
3. TTS multi → `multiVoiceRunner` + `voiceCast`, không nhét logic vào SceneCard.
