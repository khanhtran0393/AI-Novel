# AI Novel — Defense-in-Depth (commercial desktop)

Agent-facing truth for release hardening. **Do not encrypt the git source repo.** Protect the packaged customer build.

## Trust model

| Surface | Trust |
|---------|--------|
| Renderer / Zustand / localStorage | Untrusted |
| Local Next API on customer PC | Honest-customer barrier only (can be patched) |
| Ed25519 public verify | OK offline |
| Seller private key / admin / service_role | **Never** on customer |
| Online license API / Supabase / Vercel | Authority for issue / trial / revoke |

## Eight layers

| Layer | What | Where |
|-------|------|--------|
| **L0** | Feature matrix truth (`serverGated`) | `src/lib/commercial/featureMatrix.ts` |
| **L1** | Ed25519 tokens `AINOVEL2.*` | `src/lib/entitlement.ts` |
| **L2** | Server hard mesh `requireFeature` → `assertFeatureAccessHard` | `apiGate.ts` + `proGateHard.ts` + API routes |
| **L3** | Packaged **multi-signal** force enforce | `packagedAttestation.ts` + `main.js` + `getEntitlementMode()` |
| **L4** | Electron: sandbox, DevTools off, fuses, path policy | `main.js`, `scripts/electron-fuses.cjs` |
| **L5** | HWID multi-version + dual-accept | `getHwid` / `getHwidCandidates` |
| **L6** | Online heartbeat / revoke when reachable | `licenseHeartbeat` + cloud verify |
| **L7** | Release audits | `ship-check`, `audit:package`, smokes |
| **L8** | RE friction (3-phase) | shell harden + strip maps + IP catalog |

---

## RE protection — 3 phases (L8)

Không hứa “không crack được”. Mục tiêu: **giảm surface lộ logic + tăng chi phí RE + giữ authority trên Vercel**.

### Phase A — Strip & reduce surface (shipped)

| Hạng mục | Implementation |
|----------|----------------|
| No browser source maps | `next.config.ts` → `productionBrowserSourceMaps: false` |
| Exclude maps / docs / scripts / agent md from ASAR | `package.json` → `build.files` negations |
| Shell minify on pack | `beforePack` → `scripts/electron-before-pack.cjs` |
| Restore sources after pack | `afterPack` → `scripts/electron-after-pack.cjs` (then fuses) |
| Audit RE leaks | `scripts/audit-packaged-artifact.cjs` (`.map`, `.ts`, `scripts/`, `AGENTS.md`, …) |
| Preview without mutate | `npm run harden:shell:preview` |

Engine: **esbuild** nếu cài (devDependency optional); fallback **conservative** comment/blank strip (`scripts/lib/shell-minify.cjs`).

Skip harden: `AINOVEL_RE_HARDEN=0`.

### Phase B — Friction (partial — this release)

| Hạng mục | Status |
|----------|--------|
| Minify + mangle Electron shell (`main` / `preload` / `electron/*`) | **On** during pack (restore workspace after) |
| Electron fuses + ASAR integrity | **On** (`electron-fuses.cjs` via afterPack chain) |
| Full asarmor encryption | **Deferred** — conflicts with embedded ASAR integrity hash; env `AINOVEL_ASARMOR=1` reserved |
| Selective obfuscate of Next commercial chunks | **Not** whole `src/` — local Next still honest-barrier |
| Python: only approved gateway set | Already enforced by `extraResources` + audit allowlist |

### Phase C — Cloud authority & IP catalog (shipped)

| Hạng mục | Implementation |
|----------|----------------|
| IP catalog (local vs Vercel) | `src/lib/commercial/ipCatalog.ts` |
| Heartbeat on **all** paid `assertFeatureAccess` | `src/lib/entitlement.ts` |
| Stricter online window (expanded mesh) | `onlineRevalidate.ts` + `STRICT_ONLINE_FEATURES` |
| Strict features | `tts_premium`, `gen_video`, `export_capcut`, `ship_pack`, `integrations_pipeline`, `toolbox_labs`, `multi_channel`, `flow_multi_account` |
| Grace | Offline **48h** after OK; first-run **12h**; strict **6h**; kill-switch `AINOVEL_STRICT_ONLINE=0` |
| **Seedance IP on Vercel** | `POST /api/cloud/ip/seedance` + `seedanceCloudBridge.ts` |
| **Psych IP on Vercel** | `POST /api/cloud/ip/psych` + `psychCloudBridge.ts` |
| Shared cloud auth | `cloudIpAuth.ts` — Ed25519 + claim HWID (not Vercel host) |
| Wire surfaces | imagePrompt, generate-video, chapterPipeline, ship/export, integrations, youtube-meta |
| Live smoke | `npm run smoke:cloud-ip-live` |
| Packaged desktop | Cloud for compile / paid director / sequence / psych (pinned license host) |
| Free offline | Director pair **local** without token; sequence Pro → hard-fail packaged |
| Kill-switch | `AINOVEL_SEEDANCE_CLOUD=0`, `AINOVEL_PSYCH_CLOUD=0` force local; `=1` force cloud |
| Hard mesh | `requireFeature` = integrity + anti-tamper + dual re-verify + feature + heartbeat |
| Host-binding | Per-spawn secret + scrubbed child env; packaged forces enforce |
| Shell mangle | **esbuild** minify+mangle on pack (`devDependency`) |

**Must stay on Vercel / seller:** issue token, private key, revoke, trial anti-abuse, orders, admin, Seedance/Psych IP for packaged Pro.  
**Stay local:** free write/pipeline, free director without token, user canvas, offline Ed25519 verify, media disk.

**Honest residual:** formula source remains in monorepo (Vercel host needs it); packaged **execution** is cloud-first so Pro sequence needs license API + token.

---

## Packaged mode lock (L3)

When `app.isPackaged`, **multi-signal** (clearing one env is not enough):

1. `AI_NOVEL_PACKAGED=1` + `AINOVEL_PUBLISH=1` + `AINOVEL_ELECTRON_PACKAGED=1`
2. `AINOVEL_PACKAGED_ATTEST=ainovel-pkg-<16hex>` (build path stamp)
3. `AINOVEL_ENTITLEMENT_MODE=enforce` **always** (ignores process env + `.env.commercial`)
4. `AINOVEL_HOST_BINDING=enforce`
5. `AINOVEL_ALLOW_LOCAL_TRIAL=0`
6. Customer env whitelist **excludes** MODE and local-trial
7. Seller secrets stripped from `process.env`
8. `getEntitlementMode()` / `isPackagedCustomerRuntime()` use multi-signal (`packagedAttestation.ts`)

## Server-gated features (L2)

Hard path: `requireFeature` → `assertFeatureAccessHard` (dual re-verify).  
Premium-only: `assertPremiumAccessHard` (video / CapCut / ship).  
Toolbox: `requireToolboxAccess` → `toolbox_labs`.

| Feature | minTier | API surfaces |
|---------|---------|----------------|
| `tts_premium` | trial | `/api/generate-tts` (≠ edge/piper), `/api/tts-batch-srt`, `/api/audio-studio` |
| `gen_video` | trial | `/api/generate-video`, `/api/render-video` |
| `export_capcut` | trial | `/api/export-capcut` |
| `ship_pack` | trial | `/api/ship-pack` |
| `integrations_pipeline` | pro | `/api/integrations/*` (not free write/image) |
| `toolbox_labs` | pro | navtools (≠ youtube-seo), video-editor, bypass, dub-tools, process-video, **all** capassistant, rpa-*, isolate/split/watermark/download/transcribe/self-heal |
| `multi_channel` | pro | `/api/suggest-channels` (+ UI); psych cloud IP |
| `flow_multi_account` | pro | 2nd+ Flow account create / multi farm ops |

**Free remains:** write, outline, prompt, image BYOK, Edge/Piper TTS, single Flow account.

UI gates (`useProAccess`) are **cosmetic**. Security = API asserts + packaged heartbeat (+ strict online for Pro IP).

## HWID (L5)

- Multi-version candidates (`getHwid` / `getHwidCandidates`)
- Verify accepts machine candidates (`hwidMatchesClaim`)
- Seller CLI `npm run license:issue -- --hwid …` requires HWID

## Electron (L4 + L8 shell)

- `nodeIntegration: false`, `contextIsolation: true`, `sandbox: true`
- Packaged: `devTools: false` + block F12 / Ctrl+Shift+I|J|C
- **Pack chain:** `beforePack` (shell harden) → pack ASAR → `afterPack` (restore sources + fuses)
- Fuses: RunAsNode off, inspect CLI off, asar integrity, OnlyLoadAppFromAsar when supported
- `ainovel-open-path`: block System32 / WinSxS; allow user media roots

## What this does **not** claim

- Uncrackable offline Electron (asar can still be extracted by experts)
- Obfuscation of entire `src/` as a security boundary
- Credits / `is_pro` in localStorage as authorization
- Full asarmor by default (integrity fuse takes priority)

## Verify

```powershell
npm run ship:check
npm run smoke:commercial
node scripts/smoke-electron-security.cjs
npm run smoke:re-harden
npm run smoke:ip-catalog
npm run smoke:seedance-cloud
npm run typecheck
```

After pack: `npm run audit:package -- <win-unpacked>`  
Optional: `AINOVEL_REQUIRE_SHELL_HARDEN=1` forces audit to require re-harden banner in `main.js`.

## Related

- `docs/COMMERCIAL.md` — Free / Trial / Pro product
- `docs/IRON_LAWS.md` — product iron laws
- `src/lib/commercial/ipCatalog.ts` — Phase C catalog
- `AGENTS.md` § Commercial / Entitlement
