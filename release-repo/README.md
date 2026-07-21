# AI Novel — Desktop Releases

**Public release-only repository** for **[Ai Novel](https://github.com/khanhtran0393/AI-Novel)**.

Source code stays in the private app repo. This repo holds **installers only** so the desktop app can auto-update without opening private source.

| | |
|--|--|
| App | **Ai Novel** |
| Owner | [khanhtran0393](https://github.com/khanhtran0393) |
| Releases | [Releases →](https://github.com/khanhtran0393/AI-Novel-release-/releases) |
| Updater | `electron-updater` · provider **github** · this repo |

---

## What is uploaded each version

| File | Purpose |
|------|---------|
| `AI-Novel-<version>-x64.exe` | Windows installer / portable package |
| `latest.yml` | electron-updater manifest (version, sha512, size) |
| `*.exe.blockmap` | Optional differential update map |

**Do not** commit source, secrets, API keys, or license private keys here.

---

## How users get updates

1. Open the packaged app  
2. App checks GitHub Releases on this repo  
3. Downloads the new `.exe` in the background  
4. **Next launch** applies the update (no prompt)

Requires a **published** (not draft) release with tag `vX.Y.Z` matching the app version.

---

## Publisher checklist (you)

```text
1. Bump version in the private app package.json  (e.g. 1.0.0 → 1.0.1)
2. Build:  npm run pack:unsigned:qa   (or signed build:desktop)
3. Generate latest.yml:  npm run release:manifest
4. Create GitHub Release on THIS repo:
   - Tag:    v1.0.1
   - Title:  1.0.1
   - Attach: AI-Novel-1.0.1-x64.exe  +  latest.yml
   - Publish release (not Pre-release, unless testing prerelease channel)
```

Or from the app machine (with `GH_TOKEN`):

```powershell
cd "D:\My app\AI Novel"
$env:GH_TOKEN = "ghp_..."   # repo scope on AI-Novel-release- only (ideal)
npm run release:github
```

---

## Security notes

- This repository is **public by design** (download without login).  
- Never put `GH_TOKEN`, Supabase service role, or entitlement private keys in releases.  
- Until Windows Authenticode is configured, builds may be **unsigned**; the app allows that via `AINOVEL_UPDATE_ALLOW_UNSIGNED=1`.  
- After code signing, re-publish signed builds and turn unsigned allow off.

---

## License / support

Product terms and support: see the main product documentation and in-app **Bản quyền** / License modal.  
This repo is distribution-only.

---

## Current channel

| Channel | Tag pattern | Notes |
|---------|-------------|--------|
| stable | `v1.0.0`, `v1.0.1`, … | Default for all users |
| pre-release | GitHub “Pre-release” flag | Only if app has prerelease enabled |

---

*Maintained for AI Novel desktop auto-update. Empty of application source.*
