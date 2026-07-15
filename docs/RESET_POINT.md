# Điểm Reset — Nút **Làm Mới Dự Án**

> **LOCKED CONTRACT.** Đây là điểm reset chính thức của app. Không đổi semantics khi refactor.

## Nguồn code (single source of truth)

| Layer | File / symbol |
|-------|----------------|
| Blank canvas | `src/store/novelInitialState.ts` → `cloneFreshProjectState()` / `PROJECT_RESET_POINT` |
| Keep settings | `src/store/credentialActions.ts` → `resetStore()` |
| Persist allow | `src/store/persistStorage.ts` → `allowIntentionalStoreReset()` |
| UI trigger | `src/app/workspace/hooks/useProjectActions.ts` → `handleResetProject` |
| Nút | Sidebar → **Làm Mới Dự Án** |

## Sau khi bấm — **WIPED (trống)**

| Field | Giá trị sau reset |
|-------|-------------------|
| `ten_tac_pham` | `''` (ô trống) |
| `lorebook` | `''` → UI: **「Chưa có Lorebook.」** |
| `danh_sach_chuong` | `[]` (không có nút chương) |
| `chuong_dang_chon` | `0` |
| `dan_y_tong_the` | `''` |
| `nhan_vat` / `nhan_vat_prompts` | `[]` / `{}` |
| `tom_tat_cuon_chieu` / `tri_nho_ngan_han` | trống |
| Generated media maps | `{}` (audio / prompt / ảnh / video) |
| YouTube rewrite source | url/title/text xóa |
| Chapter hooks / editor reviews / human edit | `{}` |

## Sau khi bấm — **KEPT (cài đặt nguyên)**

- Toàn bộ **API keys / cookies / TikTok session**
- Google Drive path + login identity
- **Settings panel**: TTS config, media style, DNA, providers/models, aspect, WPM, GPU
- Save paths (TTS / image / character / video)
- `youtubeSafe` flags, `userRules` (từ ngữ cấm/mệt)
- Entitlement PRO / credits

## Quy trình bắt buộc khi gọi reset

```ts
allowIntentionalStoreReset(60_000); // bypass wipe-guard persist
store.resetStore(); // sets projectResetEpoch = Date.now()
commitIntentionalProjectResetFromLocal(); // force local + IPC + HTTP
```

### Vì sao từng “quay lại” tên / lore / chương?

Lớp `dualStorage` hydrate bằng **điểm nội dung** (`pickRichest`). Bản disk cũ (full truyện) điểm cao hơn canvas trống → **đè lại** sau reload/HMR.

**Fix (locked):**
1. `projectResetEpoch` — lần Làm Mới ghi timestamp; hydrate **ưu tiên epoch cao hơn điểm nội dung**.
2. `forceOverwriteAllDurables` / `commitIntentionalProjectResetFromLocal` — ghi đè mọi backend ngay sau reset.

Không được nhồi lại lorebook mặc định, «Dự án mới», hay Chương 1–2 sau reset.
