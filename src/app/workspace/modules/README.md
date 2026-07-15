# modules/ — Business logic (không React UI)

Mỗi file = **một domain hành động**. UI (features/*) và hooks/* gọi vào đây.

**Hợp đồng tên / API / key:** import từ `@/contracts` (xem `src/contracts/GLOSSARY.md`).
Cần HTTP → path trong `API` + `requestType` đúng `GENERATE_REQUEST_OWNERS` / `CLIENT_OWNERS`.

| File | Nhiệm vụ |
|------|----------|
| `writeModule.ts` | Sinh / viết chương, arc plan |
| `sceneModule.ts` | Sửa / mở rộng / rewrite cảnh |
| `setupModule.ts` | Setup outline / template |
| `imageModule.ts` | Gen prompt ảnh, gen ảnh, regen |
| `videoModule.ts` | Gen video |
| `ttsModule.ts` | TTS scene orchestration / self-heal entry |
| `tts/*` | TTS credentials, preview, generate helpers, multi-voice runner |
| `castModule.ts` | Gán vai giọng |
| `castPreflight.ts` | Kiểm tra cast trước khi gen |
| `characterModule.ts` | Hồ sơ NV, concept prompt |
| `folderModule.ts` | Mở / chọn thư mục |
| `projectModule.ts` | Backup / project ops |
| `apiKeyModule.ts` | CRUD API keys |
| `cookieModule.ts` | Cookie Studio / TikTok session |
| `integrationsModule.ts` | Pipeline timeline silent, enrich |
| `engineModule.ts` | Engine checkpoints |
| `notifyModule.ts` | Thông báo |

## API services split

| Path | Nhiệm vụ |
|------|----------|
| `src/app/api/generate-tts/audioUtils.ts` | WAV header, split text, FFmpeg concat/effects/duration |
| `src/app/api/generate-tts/providers.ts` | TTS provider registry + provider-specific synthesis |
| `src/app/api/generate-tts/route.ts` | Request validation, multi-segment orchestration, save/mix response |
| `src/app/api/generate/modelClients.ts` | JSON repair, text/vision model clients, retry wrapper |
| `src/app/api/generate/route.ts` | Story/media request orchestration |

## Quy tắc

1. **Không** import `*.tsx` / React components.
2. Nhận plain params, trả plain result / throw Error.
3. Side-effect (fetch, fs) được phép; UI không nhét fetch lặp lại nếu đã có module.
