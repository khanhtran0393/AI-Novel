# Printfilm adoptions — phương án đã chốt (LOCKED)

> **Status: LOCKED 2026-07-22**  
> Nguồn so sánh: [printfilm](https://github.com/khanhtran0393/printfilm) (AI 漫剧工场) vs AI Novel.  
> Chỉ **mượn ý phù hợp DNA AI Novel** — không fork stack Vite/SPA/GitCC/IndexedDB.

## Quyết định tổng

| # | Ý Printfilm | Quyết định | Status trong app |
|---|-------------|------------|------------------|
| P1 | Costume / wardrobe + scene ref | **ADOPT** — mở rộng roster NV + key đĩa | Schema + UI wardrobe + gen still + scene library |
| P2 | Keyframe start/end → video | **ADOPT optional** — không thay TTS timeline | `use_end_frame` + dual still hard-fail + Flow `*_fl` sibling |
| P3 | Phase 01–04 wizard | **REJECT skeleton** · **ADOPT checklist mềm** | `projectProgress` live strip |
| P4 | Model registry GitCC-style | **REJECT thin-client** · **ADOPT status media rõ** | Media toolbar status |
| — | Docker + static SPA | **REJECT** path chính | — |
| — | Codebase gọn như SPA | **REJECT** làm mục tiêu product | — |

## Nguyên tắc bắt buộc

1. **Giữ trục AI Novel:** Setup → viết/TTS → prompt → ảnh → video → ship (không 1-click gộp).
2. **B10:** thiếu end-frame / model FL → hard-fail; **cấm** auto-swap provider/model.
3. **Storage:** disk + `contracts/keys` — **cấm** IndexedDB project hub kiểu Printfilm.
4. **TTS duration** vẫn là chân lý timeline; keyframe **không** thay audio.
5. **Không** Phase 01–04 khóa màn hình.

## P1 — Wardrobe (costume variants) + scene location library

- Field: `NhanVatProfile.wardrobe_variants[]` + `active_wardrobe_id?`
- Mỗi variant: `id`, `name`, `description`, `visualPrompt?`, `image_key?`
- Key ảnh: `characterWardrobeImageKey(name, wardrobeId)` → `char_Name_wardrobe_id`
- Identity lock: `buildIdentityLockEnglish` + active wardrobe
- **Gen still:** `composeWardrobeSheetPrompt` + `handleGenerateWardrobeImage` (UI form NV)
- Cast ingredients: ưu tiên wardrobe active trước concept sheet
- **Scene library:** `scene_location_assets[]` + `SceneLocationLibrary` (sidebar)
  - Key: `sceneLocationImageKey(name)` → `loc_Name`
  - Gen still môi trường (không nhân vật)
- **Không** bắt buộc wardrobe/location để setup complete

## P2 — Optional start/end frame

- `PromptAsset.use_end_frame?: boolean`
- `PromptAsset.end_image_key?: string` (mặc định: ảnh prompt kế / trước)
- Gen video: dual stills bắt buộc khi Start+End / range 2 frame — **hard-fail** nếu thiếu
- Flow: `resolveFirstLastModel(model, true)` khi có 2 still khác nhau (sibling `*_fl`, **không** đổi provider)
- Server Flow: `endImage` → endpoint startAndEndImage + `hasEndFrame`
- Timestamp / duration vẫn từ TTS / beat

## P3 — Project progress checklist (mềm)

- Module: `src/lib/projectProgress.ts`
- UI: `ProjectProgressStrip` — gợi ý bước, **không** block workspace
- Bước suy ra từ store thật (setup, outline, write, TTS, prompt, image, video, export path)

## P4 — Media status

- Toolbar Ảnh/Video: hiển thị provider + model + Flow ready
- Không thay Settings / multi-key / Flow multi-account bằng registry GitCC

## P5 — Script mode: Short / Manhua (pipeline logic)

**Quy trình:** Setup → Outline → Write → TTS → Prompt → Ảnh → Video → Ship (app).  
**Logic:** short/manhua khi `scriptMode === 'short_manhua'`.

| Lớp | Hành vi |
|-----|---------|
| `setScriptMode` | Soft: `so_tu≈1200`, `secondsPerBeat≈4`, `videoDuration≈6` |
| Outline / WRITE / REVISE | Craft + min 4 / max 8 cảnh + word-gate short |
| EXPAND / REWRITE scene | `buildShortManhuaSceneBlock` — thoại + action visible |
| Gen Prompt | `buildShortManhuaImagePromptBlock` — still/motion short |
| Quality gate | min scenes short + soft hints (dialogue / length) |
| DNA | `[CẢNH]`, Setup genre, B10 — không Phase wizard |

## Cấm (explicit reject)

- Wizard Phase cứng Script→Assets→Director→Export
- Deploy Docker static SPA thay Next+Electron+Python
- API-only GitCC proxy làm backend duy nhất
- Export ZIP-only thay CapCut/FableCut/ship

## Con trỏ code

| Hạng mục | Path |
|----------|------|
| Wardrobe schema + compose | `src/lib/characterProfile.ts` |
| Scene location library | `src/lib/sceneLocationLibrary.ts` · `features/script/SceneLocationLibrary.tsx` |
| Asset keys | `src/contracts/keys.ts` |
| Prompt keyframe fields | `src/store/novelTypes.ts` → `PromptAsset` |
| FL model resolve | `src/lib/flow-bridge/modelCatalog.ts` · `useImagePromptActions` |
| Progress | `src/lib/projectProgress.ts` |
| UI strip | `src/app/workspace/features/project/ProjectProgressStrip.tsx` |
| Media status | `src/app/workspace/features/media/MediaToolbarButton.tsx` |
| Smoke | `npx tsx scripts/smoke-printfilm-adoptions.mts` |
