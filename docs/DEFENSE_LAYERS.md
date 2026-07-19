# AI Novel — Defense-in-Depth (commercial desktop)

Agent-facing truth for release hardening. **Do not encrypt the git source repo.** Protect the packaged customer build.

## Trust model

| Surface | Trust |
|---------|--------|
| Renderer / Zustand / localStorage | Untrusted |
| Local Next API on customer PC | Honest-customer barrier only (can be patched) |
| Ed25519 public verify | OK offline |
| Seller private key / admin / service_role | **Never** on customer |
| Online license API / Supabase | Authority for issue / trial / revoke |

## Eight layers

| Layer | What | Where |
|-------|------|--------|
| **L0** | Feature matrix truth (`serverGated`) | `src/lib/commercial/featureMatrix.ts` |
| **L1** | Ed25519 tokens `AINOVEL2.*` | `src/lib/entitlement.ts` |
| **L2** | Server `requireFeature` / `assertProAccess` | `src/lib/commercial/apiGate.ts` + API routes |
| **L3** | Packaged **force enforce** (env cannot open Pro) | `main.js` + `getEntitlementMode()` |
| **L4** | Electron: sandbox, DevTools off, fuses, path policy | `main.js`, `scripts/electron-fuses.cjs` |
| **L5** | HWID v2 (MachineGuid) + dual-accept v1 | `getHwid` / `getHwidCandidates` |
| **L6** | Online heartbeat / revoke when reachable | `useEntitlementSync` + cloud verify |
| **L7** | Release audits | `ship-check`, `audit:package`, smokes |
| **L8** | Optional friction only (not primary) | minify; no full-repo encrypt |

## Packaged mode lock (L3)

When `app.isPackaged`:

1. `AINOVEL_ENTITLEMENT_MODE=enforce` **always** (ignores process env + `.env.commercial`)
2. `AINOVEL_ALLOW_LOCAL_TRIAL=0`
3. Customer env whitelist **excludes** MODE and local-trial
4. Seller secrets stripped from `process.env`
5. `getEntitlementMode()` returns `enforce` if `AI_NOVEL_PACKAGED=1` or `AINOVEL_PUBLISH=1`

## Server-gated features (L2)

| Feature | minTier | API surfaces |
|---------|---------|----------------|
| `tts_premium` | trial | `/api/generate-tts` when platform ∉ `edge_tts`\|`piper` |
| `gen_video` | trial | `/api/generate-video` |
| `export_capcut` | trial | `/api/export-capcut` |
| `ship_pack` | trial | `/api/ship-pack` |
| `integrations_pipeline` | pro | `/api/integrations/*` (not free write/image) |
| `toolbox_labs` | pro | `/api/navtools/*` except `youtube-seo` (Free workspace SEO) |
| `multi_channel` | pro | `/api/suggest-channels` (+ UI) |
| `flow_multi_account` | pro | 2nd+ Flow account create / multi farm ops |

**Free remains:** write, outline, prompt, image BYOK, Edge/Piper TTS, single Flow account.

UI gates (`useProAccess`) are **cosmetic**. Security = API asserts.

## HWID (L5)

- **v2 (preferred):** MachineGuid + arch (`getHwid` / `getHwidV2`)
- **v1 (legacy):** hostname\|arch\|os\|release
- Verify accepts **either** candidate on this machine (`hwidMatchesClaim`)
- Seller CLI `npm run license:issue -- --hwid …` requires HWID

## Electron (L4)

- `nodeIntegration: false`, `contextIsolation: true`, `sandbox: true`
- Packaged: `devTools: false` + block F12 / Ctrl+Shift+I|J|C
- `afterPack` → `scripts/electron-fuses.cjs` (RunAsNode off, inspect CLI off, asar integrity)
- `ainovel-open-path`: block System32 / WinSxS; allow user media roots

## What this does **not** claim

- Uncrackable offline Electron (asar can still be extracted by experts)
- Obfuscation of entire `src/` as a security boundary
- Credits / `is_pro` in localStorage as authorization

## Verify

```powershell
npm run ship:check
npm run smoke:commercial
node scripts/smoke-electron-security.cjs
npm run typecheck
```

After pack: `npm run audit:package -- <win-unpacked>`

## Related

- `docs/COMMERCIAL.md` — Free / Trial / Pro product
- `docs/IRON_LAWS.md` — product iron laws
- `AGENTS.md` § Commercial / Entitlement
