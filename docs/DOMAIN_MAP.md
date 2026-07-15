# Domain ownership map (logical tree)

**Không** mass-move folder. Map này định **ai sở hữu gì** để agent/dev không chồng chéo.

> Quy luật thép toàn app (engine native, NAV, TTS, hydration…): [`IRON_LAWS.md`](./IRON_LAWS.md)

Nguồn máy đọc được: `src/contracts/domainOwnership.ts`

```text
AI Novel
├── script          → features/script, write/scene/setup modules, generate handlers
├── tts             → features/tts, ttsModule, generate-tts/platforms+engines
├── media-image     → imageModule, generate-image/providers
├── media-video     → videoModule, generate-video
├── youtube         → features/youtube, lib/youtube-safe
├── channels        → features/channels, channel store, ship-pack
├── toolbox-labs    → toolbox (ẩn mặc định), download, navtools
├── ainovel-engine  → features/ainovel, lib/novel-engine, api/ainovel
├── credentials     → settings, credentialHealth, entitlement
└── export          → CapCut / ship-pack (Pro gate server-side)
```

## Quy tắc

1. Cross-domain **chỉ** qua `@/contracts` hoặc API HTTP.
2. `features/A` không import sâu `features/B`.
3. Pro export: server `assertProAccess` (`AINOVEL_ENTITLEMENT_MODE=open|enforce`).
