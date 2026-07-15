# Danh sách cải tiến (Production hardening)

| # | Hạng mục | Status |
|---|----------|--------|
| 1 | Smoke core + scripts | ✅ (+ golden path offline) |
| 2 | CI GitHub Actions | ✅ |
| 3 | Zod validate API nóng | ✅ (+ **mọi** GENERATE requestType payload) |
| 4 | Error taxonomy | ✅ (+ correlationId trên JSON lỗi) |
| 5 | Credential Health UI | ✅ (+ runtime probe FFmpeg/dirs) |
| 6 | Labs tools flag | ✅ |
| 7 | CONTRIBUTING checklist | ✅ |
| 8 | Playwright contracts (`npm run test:e2e`) | ✅ |
| 9 | Pro/VIP server entitlement HMAC | ✅ (gate: ship-pack, export-capcut, generate-video, integrations/pipeline) |
| 10 | TTS platforms split (`platforms/*`) | ✅ |
| 11 | Domain ownership map (logical) | ✅ |
| 12 | Structured log + `correlationId` (hot APIs) | ✅ |
| 13 | Secret mask (toast + slog redact) | ✅ |
| 14 | Runtime health API `/api/health/runtime` | ✅ |
| 15 | Job center export error report | ✅ |
| 16 | Project **portable** multi-máy (strip secret + relative paths) | ✅ |
| 17 | Store ↔ DTO adapters (chapter, setup, characters) | ✅ |
| 18 | Onboarding core-loop + demo 1 chương | ✅ |
| 19 | Empty workspace hint (chưa outline/content) | ✅ |
| 20 | Optional Labs isolation docs | ✅ `docs/OPTIONAL_LABS.md` |
| 21 | Client API headers (correlation + entitlement token) | ✅ `apiClient.buildClientApiHeaders` |
| 22 | **Iron laws + full contracts unification** | ✅ `docs/IRON_LAWS.md` LOCKED · `keys`/`apiMap`/`GLOSSARY` · call-sites workspace+API |

## Lệnh xác minh

```bash
npm run verify:ci
# = typecheck + smoke:core + playwright e2e
```

`smoke:core` gồm:
1. Cấu trúc contracts / handlers / engines
2. **Golden path offline**: Playwright contracts + mock media + FFmpeg/edge probe
3. `tsc --noEmit`

## Entitlement

| Env | Ý nghĩa |
|-----|---------|
| `AINOVEL_ENTITLEMENT_MODE=open` | Default desktop/dev — Pro routes luôn cho phép |
| `AINOVEL_ENTITLEMENT_MODE=enforce` | Bắt token `x-ainovel-entitlement` hoặc `body.entitlementToken` |
| `AINOVEL_ENTITLEMENT_SECRET` | HMAC secret |
| `POST /api/entitlement/issue` | Cấp token |
| Client | `localStorage.ainovel.entitlementToken` → header tự gắn |

Routes gated: `export-capcut`, `ship-pack`, `generate-video`, `integrations/pipeline`.

## Portable project

- **Cài đặt → Project portable**: Export (strip secret) / Backup full / Import JSON
- Media binary: copy vào `public/audio|images|video` theo `mediaIndex`
- API helpers: `src/lib/projectPortable.ts`

## Observability

- Header `x-correlation-id`
- Log JSON `slog()` (redact secret)
- Jobs panel: **Report** copy error report

## Health

- Client credentials + server `GET /api/health/runtime`

## Backlog còn lại (ngoài scope code thuần)

- Playwright **full UI** browser (cần Next/Electron live server)
- Golden path **live TTS Edge** (network, opt-in)
- Payment gắn issue entitlement token (commercial)
- Mass-move `domains/` folders (ROI thấp)
- Tách git submodule Voice Studio / OpenMontage (ops, không bắt buộc)

## Contracts (sau unification #22)

- Import: `import { sceneAssetKey, API, … } from '@/contracts'`
- Cấm ghép tay `` `${chapter}_${sceneIndex}` ``
- Chi tiết: `src/contracts/GLOSSARY.md` · `docs/IRON_LAWS.md`

Các mục trên **không chặn** coi app đã production-harden cho core loop local-first.
