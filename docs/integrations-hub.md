# Tích hợp = logic ngầm (không nút riêng)

Người dùng thao tác **từng bước** như cũ để kiểm tra:

```
Gen Prompt Studio  →  Gen ảnh  →  Gen Video  →  TTS  →  Ship / CapCut
```

## Tự động (không có nút “Repo / Pipeline / 1-click”)

| Khi user bấm… | Logic ngầm |
|---------------|------------|
| **Gen Prompt Studio** | Shot graph + still formula + **Seedance sequence** (`video_prompt`, continuity) |
| **Viết lại prompt** | `compileStillImagePrompt` sau REGENERATE_PROMPT |
| **Gen Prompt AI (hồ sơ NV)** | `applyCharacterSheetFormulas` → master + 4 góc + biểu cảm |
| **Gen Prompt ONLY / Kế thừa di sản** | Cùng still formula cho `prompt` (và sheet nếu có) |
| **YouTube SEO Title / Thumb** | **55 quy luật tâm lý** (`youtubePsych55.ts`) + anti-motif kênh |
| **Gen ảnh** | `image_prompt` + identity; sau batch → **FableCut** rebuild |
| **Gen Video** | Seedance continuity + **auto take-review accept** + **Watch QC report-only** (async) |
| **TTS chương** | Sau xong → FableCut (**duration TTS thật**, không hardcode 5s) |
| **Plan Arc / Outline lore** | **MiroFish** hooks → lorebook (**chỉ** scope outline/lore/arc) |
| **Ship pack / CapCut** | Path đĩa + timeline |

Không có panel Repo Hub. Không gộp Prompt+Ảnh+Video+TTS thành một nút.

## Paths (ship-ready)

1. `vendor/FableCut`, `vendor/watch` (ưu tiên)
2. Env `AINOVEL_*_DIR`
3. `D:\repo\*` (dev only)

Seedance = TypeScript in-process (`src/lib/integrations/seedance*`).

## Artifact

- `exports/integrations/fablecut/…/project.json`
- `exports/integrations/watch/qc_*.md` (report-only)
- Ship: `…/fablecut/`

## Dev

```bash
npm run test:integrations
npm run test:chapter-pipeline
```
