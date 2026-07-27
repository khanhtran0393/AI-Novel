# Tích hợp = logic ngầm (không nút 1-click)

Người dùng thao tác **từng bước** như cũ để kiểm tra:

```
Gen Prompt Studio  →  Gen ảnh  →  Gen Video  →  TTS  →  Ship / CapCut
```

> Thép: [`IRON_LAWS.md`](./IRON_LAWS.md) A5/B8 · Pipeline code: `src/lib/pipeline/*` · Seedance: `src/lib/integrations/*`

---

## Tự động (không có nút “Repo / Pipeline / 1-click”)

| Khi user bấm… | Logic ngầm |
|---------------|------------|
| **Gen Prompt Studio** | Shot graph + still formula + **Seedance sequence** (`video_prompt`, continuity) |
| **Viết lại prompt** | `compileStillImagePrompt` / formula sau `REGENERATE_PROMPT` |
| **Gen Prompt AI (hồ sơ NV)** | `applyCharacterSheetFormulas` → master + 4 góc + biểu cảm |
| **Gen Prompt ONLY / Kế thừa di sản** | Still formula cho `prompt` (và sheet nếu có) |
| **YouTube SEO Title / Thumb** | **55 quy luật tâm lý** (`youtubePsych55.ts`) + anti-motif kênh |
| **Gen ảnh** | `image_prompt` + identity; sau batch → **FableCut** rebuild im lặng |
| **Gen Video** | Seedance continuity + take-review + **Watch QC report-only** (async); **assertProAccess** |
| **TTS chương / scene** | Duration TTS **thật**; sau xong → FableCut resync; timestamp drift >15% → resync prompts |
| **Viết / commit chương** | Quality gate + memory/foreshadow (`pipeline/*`) |
| **Plan Arc / Outline lore** | **MiroFish** hooks → lorebook (**chỉ** scope outline/lore/arc) |
| **Ship pack / CapCut** | Path đĩa thật + timeline; **assertProAccess** khi enforce |

**Không** có panel Repo Hub. **Không** gộp Prompt+Ảnh+Video+TTS thành một nút.

---

## Pipeline P0–P2 (`src/lib/pipeline/*`)

| Module | Việc |
|--------|------|
| `qualityGate` / `ensureQuality` | Chấm chương / media-ready |
| `memoryAfterCommit` | Memory pack + foreshadow sau commit |
| `wordBand` | Dải từ theo `setup.so_tu_chuong` |
| `ttsMediaPreflight` / `mediaPreflight` | Chặn TTS/media khi thiếu điều kiện |
| `sceneStageQueue` | Batch job theo stage (prompt/image/video/tts) |
| `longformArc` | Arc/volume cho novel-engine runner |
| `pipelineStore` | Snapshot portable + UI `QualityGateBadge` |

Smoke: `npm run smoke:pipeline`.

---

## Paths (ship-ready)

1. `vendor/FableCut`, `vendor/watch` (ưu tiên)
2. Env `AINOVEL_*_DIR`
3. Dev-only absolute paths (không hardcode vào production logic)

Seedance = TypeScript **in-process** (`src/lib/integrations/seedance*`) — không binary ngoài.

---

## Artifact

| Loại | Path mẫu |
|------|----------|
| FableCut | `exports/integrations/fablecut/…/project.json` |
| Watch QC | `exports/integrations/watch/qc_*.md` (report-only) |
| Ship packs | `exports/ship-packs/…` |
| Seedance bake | `exports/integrations/…` (sequence persist) |
| CapCut pack | `exports/integrations/capcut/…` |

---

## Runtime CapCut nội bộ

- Source tham chiếu được vendored nguyên cấu trúc tại `tools/xinchao-cut`.
- Nút CapCut tạo pack từ media thật rồi mở `tools/xinchao-cut/XinChao-Cut.exe`.
- Frontend `dist`, backend Python, setup scripts và native Tauri runtime đều nằm trong bản cài AI Novel.
- Runtime không đọc `D:\repo\XinChao-Cut-main`, không dùng junction `node_modules`, và không soft-success khi editor không mở.
- Build/QA: `npm run xinchao:qa`, `xinchao:build:runtime`, `xinchao:build:verified`, `smoke:xinchao`, `smoke:xinchao:runtime`, `smoke:xinchao:native`.

---

## B10 khi tích hợp

- Seedance sequence fail → **502 / throw**, không skip im lặng.
- CapCut thiếu → lỗi CapCut, **không** nhảy Edge.
- Duration shot thiếu → hard-fail, **không** `|| 5`.
- Watch QC = report-only, không auto-rewrite media.

---

## Dev

```bash
npm run test:integrations
npm run test:chapter-pipeline
npm run smoke:pipeline
npm run test:pipeline-e2e
```
