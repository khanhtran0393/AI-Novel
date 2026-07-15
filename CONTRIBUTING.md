# CONTRIBUTING — AI Novel

## Core loop (không phá)

```
Setup → Outline → Viết chương → TTS → Prompt ảnh → Gen ảnh → Export
```

Toolbox Media/Crawler/Editor = **Labs** (ẩn mặc định).

## Checklist thêm chức năng

### Endpoint HTTP mới
1. Thêm path vào `src/contracts/apiMap.ts` (`API.*`)
2. Client: `import { API } from '@/contracts'` — **cấm** hardcode `'/api/...'`
3. Route: validate boundary (Zod nếu body phức tạp) + `toErrorJson` / `AppError`
4. Gắn `correlationIdFromRequest` + `slog` (hot path); **không** log raw API key/cookie — dùng `@/lib/secrets`
5. Health runtime: probe mới (nếu infra) → `src/lib/runtimeHealth.ts`

### `requestType` LLM (`/api/generate`)
1. Thêm key vào `GENERATE_REQUEST_OWNERS` trong `apiMap.ts`
2. Implement trong đúng handler group `src/app/api/generate/handlers/*`
3. Module client gọi `postGenerate('YOUR_TYPE', payload)` từ `modules/apiClient.ts`
4. Cập nhật `generateBodySchema` nếu cần enum

### TTS engine mới
1. `src/app/api/generate-tts/engines/<name>.ts`
2. Đăng ký trong `ttsRegistry.ts`
3. Smoke: platform + voice resolve

### Image provider mới
1. `src/app/api/generate-image/providers/<name>.ts`
2. Dispatch trong `generate-image/route.ts`
3. Thêm vào `IMAGE_PROVIDERS` + Zod enum nếu public

### Asset key / field
- Chỉ dùng `src/contracts/keys.ts` + adapters `story.ts`
- Xem `src/contracts/GLOSSARY.md`

## Lệnh bắt buộc trước khi coi là xong

```bash
npm run typecheck
npm run smoke:core
npm run test:e2e
```

Hoặc: `npm run verify:ci`

## Pro/VIP (server)

- Default: `AINOVEL_ENTITLEMENT_MODE=open` (desktop).
- Enforce: set `enforce` + secret; client gửi header `x-ainovel-entitlement`
  (tự gắn nếu `localStorage.ainovel.entitlementToken` — xem `buildClientApiHeaders`).
- Issue: `POST /api/entitlement/issue` (xem `src/lib/entitlement.ts`).
- Routes gated: ship-pack, export-capcut, generate-video, integrations/pipeline.

## Portable project

- Export/Import: Settings → Project portable (`src/lib/projectPortable.ts`).
- Không nhúng binary media vào JSON; chỉ path + `mediaIndex`.

## Domain ownership

Xem `docs/DOMAIN_MAP.md` / `src/contracts/domainOwnership.ts` — không import chéo domain.