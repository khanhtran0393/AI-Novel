# Contracts — quy chuẩn tên & trao đổi dữ liệu

**Một nguồn sự thật** cho key, field, và ranh giới gọi API/module.
Mọi feature / hook / module / API **không** invent key/field ad-hoc.

## Nguyên tắc 4 dòng

1. **1 chức năng = 1 owner** (1 handler API hoặc 1 `*Module` / 1 `*Actions`).
2. **Cần HTTP → gọi đúng endpoint** trong `apiMap.ts` (không fetch URL string rải rác nếu đã có map).
3. **Logic riêng → hàm/file riêng**; **logic chung → `lib/*` hoặc `contracts/*`** với owner ghi rõ.
4. **2 hướng dữ liệu** (UI↔API, workspace↔channel, TTS↔prompt) → **1 DTO/key chuẩn + adapter** `to*` / `from*`.

## Tên biến / file (code mới)

| Thành phần | Quy tắc | Ví dụ |
|------------|---------|--------|
| Biến, hàm TS | `camelCase` EN | `chapterNumber`, `generateSceneTts` |
| Component | `PascalCase` | `SceneCard` |
| Type wire/DTO | `PascalCase` + `DTO` | `ChapterDTO` |
| Field persist store (legacy) | snake / VN giữ nguyên | `ten_tac_pham`, `so_chuong` |
| Enum / requestType | `SCREAMING_SNAKE` | `WRITE_CHAPTER` |
| File handler API | `handleX.ts` hoặc group | `handlers/chapter.ts` |

## Chỉ số (index)

| Khái niệm | Chuẩn | Ghi chú |
|-----------|--------|---------|
| Chương | `chapter` 1-based number | Store: `so_chuong` |
| Cảnh trong chương | `sceneIndex` 0-based | Hook TTS scene index |
| Prompt trong cảnh | `promptIndex` 0-based | |
| Nhân vật (tên hiển thị) | NFC string | Key dùng `char_${name}` |

## Asset key (bắt buộc dùng `contracts/keys`)

| Asset | Hàm | Key ví dụ |
|-------|-----|-----------|
| Audio / prompts scene | `sceneAssetKey(ch, sc)` | `3_2` |
| Ảnh 1 prompt | `imageAssetKey(ch, sc, pi)` | `3_2_0` |
| Video 1 prompt | `videoAssetKey(ch, sc, pi)` | `3_2_0_video` |
| Video từ image key | `videoAssetKeyFromImageKey(imgKey)` | `3_2_0_video` |
| Ảnh nhân vật / role id | `characterImageKey` / `characterRoleId` | `char_Hàn Dực` |
| Angle / emotion NV | `characterAngleImageKey` / `characterExprImageKey` | `char_X_angle_front` |
| Wardrobe NV | `characterWardrobeImageKey(name, id)` | `char_X_wardrobe_battle` |
| Scene location ref | `sceneLocationImageKey(name)` | `loc_Phố đêm mưa` |
| Prefix lọc chương | `chapterAssetPrefix(ch)` | `3_` |
| File đĩa audio | `localAudioFilename` | `chapter_3_scene_2.mp3` |
| File đĩa ảnh | `localImageFilename` | `chapter_3_scene_2_prompt_0.png` |
| File đĩa video | `localVideoFilename` | `chapter_3_scene_2_animatic.mp4` |
| Tên Drive export | `driveMediaFilename` | `Title_Chuong_3_Canh_2.mp3` |

**CẤM** ghép tay `` `${chapter}_${sceneIndex}` `` — luôn import từ `@/contracts`.

## Hai lớp field

| Lớp | Dùng khi | Ví dụ |
|-----|----------|--------|
| **Store / persist** | Zustand, localStorage | `ten_tac_pham`, `danh_sach_chuong` |
| **Wire / module / API payload** | fetch body, pure functions | `chapter`, `title`, `projectTitle` |

Đổi qua adapter trong `contracts/story.ts` — **không** map tay rải rác.

## Ai được ghi state media

Chỉ **store actions** (`mediaAssetActions`, `ttsCastActions`, `channelActions`, …).
UI/hook **không** ghi đè `generated*` bằng object tự chế key.

## Checklist PR chức năng mới

- [ ] Owner folder rõ
- [ ] Key/DTO từ `@/contracts`
- [ ] API: đúng path trong `API` / `apiMap` (modules: `import { API } from '@/contracts'`)
- [ ] Shared logic: file `lib` + comment *called by*
- [ ] Không import chéo `features/A` → nội bộ `features/B`
- [ ] TTS engine mới: thêm file `generate-tts/engines/<name>.ts` + đăng ký `ttsRegistry.ts`
- [ ] Generate LLM requestType mới: handler group đúng + `GENERATE_REQUEST_OWNERS`
