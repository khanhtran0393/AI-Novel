# Optional / Labs packages (không thuộc Core loop)

Các thư mục sau **không** bắt buộc để chạy AI Novel desktop (Next + Electron):

| Path | Vai trò | Core? | Desktop pack? |
|------|---------|-------|---------------|
| `Voice Studio/` | App Next riêng cho voice clone / OmniVoice library | **Không** | **Excluded** (`!Voice Studio/**/*`) |
| `OpenMontage/` | Pipeline video Python + Remotion | **Không** | **Excluded** |
| `ainovel-cli-main/` | CLI Go (legacy); app dùng **native** `src/lib/novel-engine` | **Không** | **Excluded** |
| `python_core/MediaCrawler/` | Crawler phụ | Labs | (nằm trong python_core — không import app) |
| `exports/` | Artifact ship/audit local | Dev only | **Excluded** |

## Quy tắc

1. **Core loop** chỉ cần: `src/`, `bin/ffmpeg`, `node_modules` (edge-tts), `public/`.
2. Build desktop (`pack:portable` / `build:desktop`) **exclude**:
   - `OpenMontage/**/*`
   - `Voice Studio/**/*`
   - `ainovel-cli-main/**/*`
   - `exports/**/*`
3. UI Labs tools ẩn mặc định (`ainovel.showLabsTools`).
4. Agent/PR: **cấm** import chéo từ `Voice Studio/` hoặc `OpenMontage/` vào `src/` app chính.
   - TTS local: `src/lib/vinaVoice` / `omnivoiceLocal` / engines trong `src/app/api/generate-tts`.
5. Xóa folder Labs **không** làm hỏng app chính (zero coupling).

## Chỉ tiêu đầu ra (toolbar)

Cài đặt hàng **Ảnh / Video**, **TTS**, **CapCut** là **chỉ tiêu** cho ship / export:

| Toolbar | File / API |
|---------|------------|
| Ảnh / Video | `channel.outputDna`, ship `settings_criteria.json` |
| TTS | `channel.ttsDna`, TTS API body |
| CapCut | `POST /api/export-capcut` nhận `aspect`, `videoDuration`, `ttsConfig` |

Gate: `src/lib/shipGate.ts` — chặn Ship/CapCut khi thiếu credential engine đã chọn hoặc thiếu media bắt buộc.

## Verify

```bash
npm run verify:core      # DNA + ship + SEO + criteria
npm run rebuild:ship-packs
npm run test:e2e         # contracts + output-criteria + ship gate
npm run smoke:regen      # TTS live nếu server :3000 up
npm run verify:all       # all of the above
```

## Khi nào dùng Labs

- **Voice Studio**: clone giọng / thư viện sample lớn offline — chạy folder riêng.
- **OpenMontage**: experiment montage GPU-heavy — venv riêng.
- Không block CI/smoke nếu thiếu các folder này.
