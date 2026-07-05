# Implementation Plan: Core Workspace

## 1. Architecture Map
- **Coordinator:** `src/app/workspace/page.tsx`
  - Initializes state rehydration (`isHydrated`).
  - Renders Layout: `Sidebar` (30%) + `ContentTab` (70%).
- **State Management:** `src/store/useNovelStore.ts`
  - Defines `NovelState` and `NovelActions`.
  - Uses `persist` to store state in LocalStorage.
- **UI Components:**
  - `src/app/workspace/components/Header.tsx`
  - `src/app/workspace/components/Sidebar.tsx`
  - `src/app/workspace/components/ContentTab.tsx`

## 2. Data Models
### `NovelState`
- `chuong_dang_chon`: number (1-indexed)
- `danh_sach_chuong`: Chuong[]
- `nhan_vat`: string[]
- `apiKey`: string
- `isHydrated`: boolean
- `pipeline_step`: 'outline' | 'script' | 'commit'

### `Chuong`
- `so_chuong`: number
- `tieu_de`: string
- `dan_y`: string
- `noi_dung`: string
- `trang_thai`: 'empty' | 'writing' | 'ready'

## 3. Implementation Details
- Ensure all custom hooks (`useSetupActions.ts`, `useWriteChapter.ts`) are decoupled from UI components.
- The Sidebar uses standard HTML `<details>` and `<summary>` or Tailwind equivalent for accordions to avoid blocking modals.
