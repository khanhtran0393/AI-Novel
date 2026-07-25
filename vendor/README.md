# Vendored integrations (ship-ready)

Packages copied for runtime so the app does **not** require `D:\repo` on customer machines.

| Folder | Source | Used for |
|--------|--------|----------|
| `FableCut/` | FableCut-main | Timeline `project.json` side-pack (ngầm) |
| `watch/` | claude-video-main/skills/watch | Post-video QC (report only) |

**XinChao-Cut** (full multi-track editor, GUI replaces CapCut button): `tools/xinchao-cut/` — nguyên cấu trúc repo (Vite + backend + src-tauri). Không đặt trong `vendor/` vì là app editor độc lập.

Resolution order (`src/lib/integrations/paths.ts`):

1. Env override (`AINOVEL_FABLECUT_DIR`, …)
2. `vendor/*` (this folder)
3. `D:\repo\*` (dev only)

Seedance logic is **in-process TypeScript** (`src/lib/integrations/seedance*`) — no full Skill OS copy required.
