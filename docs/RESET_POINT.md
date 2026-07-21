# Điểm Reset — Nút **Làm Mới Dự Án**

> **LOCKED CONTRACT.** Điểm reset chính thức. Không đổi semantics khi refactor.  
> Liên quan: [`IRON_LAWS.md`](./IRON_LAWS.md) A3a · [`AGENTS.md`](../AGENTS.md) §1.4

---

## Nguồn code (single source of truth)

| Layer | File / symbol |
|-------|----------------|
| Blank canvas | `src/store/novelInitialState.ts` → `cloneFreshProjectState()` / `PROJECT_RESET_POINT` |
| Keep settings | `src/store/credentialActions.ts` → `resetStore()` |
| Persist allow | `src/store/persistStorage.ts` → `allowIntentionalStoreReset()` |
| UI trigger | `src/app/workspace/hooks/useProjectActions.ts` → `handleResetProject` |
| Nút | Sidebar → **Làm Mới Dự Án** |
| Factory wipe | `factoryResetKeepPlan()` + `factoryResetClient.ts` → **Cài đặt (Settings)** → **Xóa tất cả** |

---

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
| Generated media maps | `{}` (audio / prompt / ảnh / video / variants / DNA) |
| YouTube rewrite source | url / title / text xóa |
| Chapter hooks / editor reviews / human edit | `{}` |
| `projectResetEpoch` | `Date.now()` (ưu tiên hydrate) |
| Pipeline snapshot (nếu có) | clear / không giữ canvas cũ |

---

## Sau khi bấm — **KEPT (cài đặt nguyên)**

- Toàn bộ **API keys / cookies / TikTok session**
- Google Drive path + login identity
- **Settings**: TTS config, media style, DNA, providers/models, aspect, WPM, GPU
- Save paths (TTS / image / character / video)
- `youtubeSafe` flags, `userRules` (từ ngữ cấm/mệt)
- **Entitlement** (`is_pro` / `is_trial` / credits; `is_vip` chỉ legacy) + token localStorage
- Multi-channel registry cấu hình (không canvas truyện)

---

## Nút **Xóa tất cả** (App mới tinh)

Khác **Làm Mới Dự Án**: wipe **cả settings + API keys + GPU/NVENC**, không chỉ canvas.

| | **Làm Mới Dự Án** | **Xóa tất cả** |
|--|-------------------|----------------|
| Canvas truyện | Xóa | Xóa |
| API keys / cookies | **Giữ** | **Xóa** |
| GPU / CUDA / NVENC (`useGpuAcceleration`) | **Giữ** | **Xóa** (về off) |
| TTS / media / path / channels | **Giữ** | **Xóa** (INITIAL) |
| Gói Free / Trial / Pro | **Giữ** | **Giữ** |
| Token `ainovel.entitlementToken` | **Giữ** | **Giữ** |

Code: `factoryResetKeepPlan` · `clearCredentialVault` · `clearAppLocalExtrasKeepEntitlement` · `allowIntentionalStoreReset` + durable commit.

---

## Boot ban đầu ≠ Làm Mới

| | Boot `INITIAL_STATE` | Sau **Làm Mới** |
|--|----------------------|-----------------|
| Tên | `'Dự án mới'` | `''` |
| Chương | Ch.1 + Ch.2 empty | `[]` |
| Lorebook | khung sản xuất trung tính | `''` |
| `giai_doan` | `2` (workspace) | về phase setup-ready |

**CẤM** sau reset: nhồi lore mặc định, «Dự án mới», hoặc tự tạo lại Ch.1/Ch.2.

---

## Quy trình bắt buộc khi gọi reset

```ts
allowIntentionalStoreReset(60_000); // bypass wipe-guard persist
store.resetStore(); // projectResetEpoch = Date.now()
commitIntentionalProjectResetFromLocal(); // force local + IPC + HTTP durables
```

### Vì sao từng “quay lại” tên / lore / chương?

Lớp dualStorage hydrate bằng **điểm nội dung** (`pickRichest`). Bản disk cũ (full truyện) điểm cao hơn canvas trống → **đè lại** sau reload/HMR.

**Fix (locked):**

1. `projectResetEpoch` — Làm Mới ghi timestamp; hydrate **ưu tiên epoch cao hơn điểm nội dung**.
2. `forceOverwriteAllDurables` / `commitIntentionalProjectResetFromLocal` — ghi đè mọi backend ngay sau reset.

---

## Checklist agent

- [ ] Reset có gọi `allowIntentionalStoreReset`?
- [ ] Có set `projectResetEpoch`?
- [ ] Có force durable overwrite?
- [ ] Có nhồi lore/chapter mặc định sau reset? → **cấm**
- [ ] Entitlement / keys vẫn giữ?
