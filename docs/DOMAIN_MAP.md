# Domain ownership map (logical tree)

**Không** mass-move folder. Map này định **ai sở hữu gì** để agent/dev không chồng chéo.

> Quy luật thép: [`IRON_LAWS.md`](./IRON_LAWS.md) · Giải phẫu: [`../AGENTS.md`](../AGENTS.md)  
> Nguồn máy đọc được: `src/contracts/domainOwnership.ts`

---

## Cây domain

```text
AI Novel
├── script           → viết kịch bản / outline / scene / foundation
├── tts              → TTS / role cast / batch SRT / vina
├── media-image      → gen prompt + gen ảnh + Flow stills
├── media-video      → gen video + Seedance + Flow video
├── youtube          → SEO / psych / safe checklist / thumb
├── channels         → multi-channel DNA + ship context
├── toolbox-labs     → labs ẩn, download, bypass, video-editor, navtools
├── ainovel-engine   → native engine tab + disk .ainovel-app
├── credentials      → keys, cookies, license, entitlement, health
└── export           → CapCut / ship-pack (server Pro gate)
```

---

## Ownership chi tiết (path thật)

### script

| Layer | Path |
|-------|------|
| UI | `workspace/features/script/*` |
| Hooks | `useWriteChapter`, `useSceneActions`, `useSetupActions`, `useCharacterActions` |
| Modules | `writeModule`, `sceneModule`, `setupModule`, `characterModule` |
| API handlers | `api/generate/handlers/{chapter,outline,scene,ideas,foundation,character,visualDna}` |
| Store | `store/storyActions` |
| Lib | `lib/storyWriting`, `lib/characterProfile`, `lib/pipeline/*` (quality/memory/wordBand) |

**APIs:** `API.generate` · **Contracts:** `story`, `keys`, `validate`

### tts

| Layer | Path |
|-------|------|
| UI | `workspace/features/tts/*`, `toolbox/TtsBatchSrtModal` |
| Hooks | `useTTSActions`, `chapterTtsActions`, `ttsActionHelpers` |
| Modules | `ttsModule`, `modules/tts/*`, `castModule`, `castPreflight` |
| API | `api/generate-tts/*`, `api/tts-batch-srt`, `api/vina-voice/*`, `api/concat-audio` |
| Lib | `lib/voiceCast`, `lib/voiceCatalog`, `lib/vinaVoice`, `lib/tts/*`, `lib/ttsBatchSrt` |
| Store | `store/ttsCastActions` |

**APIs:** `generateTts`, `concatAudio`, `ttsBatchSrt`, `ttsVoices`, `vinaVoice*`  
**Default platform:** `vina_voice`

### media-image

| Layer | Path |
|-------|------|
| UI | `workspace/features/media/*` |
| Hooks | `useImagePromptActions` |
| Modules | `imageModule`, `characterModule` (prompt sheet) |
| API | `api/generate-image/*`, `api/flow/*`, handlers `imagePrompt` + `character` |
| Lib | `lib/flow-bridge/*` |

**APIs:** `generateImage`, `generate` (prompt), `flow*`  
**Default provider:** `flow` · **Keys:** `imageAssetKey`, `characterImageKey`

### media-video

| Layer | Path |
|-------|------|
| Modules | `videoModule` |
| API | `api/generate-video`, `api/flow/*` |
| Lib | `lib/flow-bridge/*`, `lib/integrations/seedance*` |

**APIs:** `generateVideo`, `flow*` · **Server gate:** `assertProAccess`  
**Default provider:** `flow`

### youtube

| Layer | Path |
|-------|------|
| UI | `workspace/features/youtube/*` |
| Lib | `lib/youtube-safe/*`, `lib/youtubeSafe.ts`, `lib/youtubePsych55.ts`, `lib/youtubeSource.ts` |
| API | `api/youtube-source`, `navtools.youtubeSeo` |

### channels

| Layer | Path |
|-------|------|
| UI | `workspace/features/channels/*` |
| Store | `store/channelActions`, `channelStoreHelpers` |
| Lib | `lib/channelModel`, `lib/channelBridge` |
| API | `api/ship-pack` (kèm channel DNA) |

### toolbox-labs

| Layer | Path |
|-------|------|
| UI | `workspace/features/toolbox/*`, `features/download/*` |
| API | `api/navtools/*`, `api/bypass-engine`, `api/video-editor`, `api/download-video`, … |
| Lib | `lib/bypass-engine/*`, `lib/nav/*`, `lib/capassistant/*` |

**Ẩn mặc định** qua `toolboxRegistry` + `ToolboxHost`.  
**Host-binding:** toolbox CLI không chạy standalone ngoài App.

### ainovel-engine

| Layer | Path |
|-------|------|
| UI | `workspace/features/ainovel/*` |
| Modules | `engineModule` |
| Lib | `lib/novel-engine/*` |
| API | `api/ainovel/*` |
| Disk | `.ainovel-app/` |

### credentials

| Layer | Path |
|-------|------|
| UI | `workspace/features/settings/*`, `features/license/*`, `features/onboarding/*` |
| Hooks | `useEntitlementSync`, `useProAccess`, `useApiKeyActions`, `useCookieActions` |
| Lib | `lib/entitlement`, `lib/commercial/*`, `lib/credentialHealth`, `lib/secrets`, `lib/onboarding` |
| API | `api/entitlement/*`, `api/commercial/status`, `api/get-cookie`, `api/health/runtime`, `api/system-info` |
| Store | `credentialActions` (`setVipStatus`, keys, cookies) |

### export

| Layer | Path |
|-------|------|
| UI | `workspace/features/project/*` (CapCut, Ship, Import) |
| API | `api/export-capcut`, `api/ship-pack` |
| Lib | `lib/shipPack`, `lib/integrations/fablecut` |

**Server gate:** `assertProAccess` khi `ENTITLEMENT_MODE=enforce`.

---

## Quy tắc cứng

1. Cross-domain **chỉ** qua `@/contracts` hoặc HTTP API.
2. `features/A` không import sâu UI nội bộ `features/B` (trừ barrel `index.ts` công khai).
3. `modules/*` không import React component.
4. `hooks/*` gọi modules + store; `features/*` gọi hooks.
5. Pro/Trial server gates: `assertProAccess` — xem `featureMatrix` minTier.
6. Asset key **chỉ** từ `src/contracts/keys.ts`.

---

## Cross-cutting (không phải domain riêng nhưng bắt buộc biết)

| Concern | Path |
|---------|------|
| Pipeline quality / stage / arc | `src/lib/pipeline/*` |
| Integrations ngầm | `src/lib/integrations/*` + `docs/integrations-hub.md` |
| Toast / confirm | `lib/toastBus`, `shared/ToastHost`, `shared/ConfirmHost` |
| Persist | `store/persistStorage`, `novelStorePersistence`, `electron/durableStore` |
