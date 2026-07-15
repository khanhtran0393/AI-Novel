# Tích hợp = logic ngầm (không nút riêng)

Người dùng thao tác **từng bước** như cũ để kiểm tra:

```
Gen Prompt Studio  →  Gen ảnh  →  Gen Video  →  TTS  →  Ship / CapCut
```

## Tự động (không có nút “Repo / Pipeline / 1-click”)

| Khi user bấm… | Logic ngầm |
|---------------|------------|
| **Gen Prompt Studio** | Shot graph + **công thức still** (`image_prompt`) + **Seedance I2V** (`video_prompt`) trong `/api/generate` |
| **Viết lại prompt** | `compileStillImagePrompt` sau REGENERATE_PROMPT |
| **Gen Prompt AI (hồ sơ NV)** | `applyCharacterSheetFormulas` → master + 4 góc + biểu cảm |
| **Gen Prompt ONLY / Kế thừa di sản** | Cùng still formula cho `prompt` (và sheet nếu có) |
| **YouTube SEO Title / Thumb** | **55 quy luật tâm lý** (`youtubePsych55.ts`) + anti-motif kênh |
| **Gen ảnh** | Dùng `image_prompt` đã có identity/formula; sau batch → rebuild **FableCut** timeline (im lặng) |
| **Gen Video** | **Seedance** lại trong `/api/generate-video` (I2V); sau gen → FableCut |
| **TTS chương** | Sau xong → FableCut (đồng bộ duration audio) |
| **Lên cung** | MiroFish hooks → lorebook |
| **Ship pack / CapCut** | Resolve path đĩa + đính timeline |

Không có panel Repo Hub. Không gộp Prompt+Ảnh+Video+TTS thành một nút.

## Artifact

- `exports/integrations/fablecut/…/project.json`
- Ship: `…/fablecut/`

## Dev

```bash
npm run test:integrations
npm run test:chapter-pipeline
```
