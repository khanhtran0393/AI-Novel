# Multi-Channel + Ship Recipes (A/B/C)

## Goal
One **Story Graph** workspace can serve many **channel identities** without cloning the whole app.

| Layer | Role |
|-------|------|
| Story Graph | Chapters, cast, lore, media assets (live workspace) |
| Channel DNA | Name, niche, visual DNA, narrator voice, TTS platform, aspect defaults, anti-reuse memory |
| Ship Recipe | `radio` \| `short` \| `longform` export pack |

## Ship modes

| Mode | Aspect | Visual | Output focus |
|------|--------|--------|--------------|
| `radio` | 16:9 | optional | multi-voice TTS + SRT + SEO |
| `short` | 9:16 | required | short script + vertical shots |
| `longform` | 16:9 | required | full hook + chapter + storyboard pack |

## Store API (`useNovelStore`)
- `activeChannelId`, `channels`
- `createChannel(name, { cloneFromActive })`
- `switchChannel(id)` — snapshot current → restore target + DNA
- `updateChannel` / `deleteChannel`
- `setDefaultShipMode` / `applyActiveChannelDna` / `rememberChannelMotif`
- TTS voice/platform + visual DNA dual-write to active channel

## UI
- Header: **ChannelSwitcher** (list, create empty/clone, DNA panel, mode chip, **Ship**)
- **ShipPackModal** → `POST /api/ship-pack`

## Files
- `src/lib/channelModel.ts` — profiles + recipes
- `src/lib/channelBridge.ts` — snapshot ↔ workspace
- `src/lib/shipPack.ts` — pure pack builder
- `src/app/api/ship-pack/route.ts` — write under `exports/ship-packs/` or `savePathRoot`
- Verify: `npx tsx src/scripts/verify-channel-ship.mjs`
