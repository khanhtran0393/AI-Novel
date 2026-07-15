# Project memory (AI Novel)

## Google Flow Bridge (FlowAgent deep-dive applied)

- **Default:** `imageProvider=flow`, `videoProvider=flow`
- **4 blocks:** queue multi-worker · WS 9223 · face-lock inject · retry 5×/30s + slide account + token 45′
- **Face-lock:** `promptInjector.ts` (nguyên văn FlowAgent English system prompt)
- **Upscale:** 2K/4K image + FHD/4K video · output `public/*` + `image_output` / `veo_output`
- **Login UX:** kill profile trước khi launch (tránh Chrome bỏ --load-extension) → login → harvest token (reload Flow) → đóng login + background
- **Stuck spinner:** Chrome 120+ chặn --load-extension → dùng Ungoogled/Brave/portable (FlowAgent), không CDP
- **Engine:** auto|ungoogled|brave|chrome|mullvad · `browserResolver.ts` · `tools/browsers/README.md`
- **Auto bootstrap:** `/api/flow/bootstrap` · docs `flow-bridge.md` + `flow-agent-architecture.md`
- Smoke: `npx tsx scripts/smoke-flow-payload.mts` · `smoke-flow-bootstrap.mts`

## Nút Làm Mới Dự Án — RESET POINT (locked)

- **Contract:** [`docs/RESET_POINT.md`](docs/RESET_POINT.md)
- **Canvas trống:** `ten_tac_pham=''`, `lorebook=''` (UI «Chưa có Lorebook.»), `danh_sach_chuong=[]`
- **Cài đặt giữ nguyên:** API keys, cookies, TTS/media settings, save paths, youtubeSafe, userRules
- **Code:** `resetStore()` + `projectResetEpoch` + `allowIntentionalStoreReset` + `commitIntentionalProjectResetFromLocal`
- **Bug đã fix:** durable `pickRichest` từng khôi phục lore/chương/tên từ backup cũ → hydrate ưu tiên `projectResetEpoch`
- **Cấm:** restore default lore, «Dự án mới», Ch.1/Ch.2 sau Làm Mới
