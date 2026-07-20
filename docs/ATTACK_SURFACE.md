# Attack surface & hardening (seller read)

Góc nhìn **hacker / reverse engineer** trên bản desktop đóng gói.  
Mục tiêu: hiểu sẽ bị đập ở đâu, và app đã chặn gì.

## Giả định attacker

- Có file cài / `app.asar`
- Biết JS, Electron, có thể patch / proxy / spoof HWID
- **Không** có private key Ed25519 seller (nếu có = game over license)

## Attack tree (thường gặp)

| # | Tấn công | Mục tiêu | App chặn? | Ghi chú |
|---|----------|----------|-----------|---------|
| 1 | Server giả cấp key | Token Pro | **Có** | Ed25519 + public key app |
| 2 | Đổi `AINOVEL_LICENSE_API_URL` | MITM license | **Có** | Host pin allowlist |
| 3 | Thay file `public-keys/*.pem` bằng key attacker | Tự issue token | **Có** | Kid + SPKI pin (`antiTamper`) |
| 4 | `MODE=open` / `OWNER_UNLIMITED` trên packaged | Mở Pro | **Có** | Force enforce + anti-tamper |
| 5 | Patch `setVipStatus(true)` / localStorage | Badge Pro | UI only | API vẫn `assertProAccess` |
| 6 | Gọi `/api/generate-video` không token | Video free | **Có** | Server gate |
| 7 | Extract asar + nop `assertProAccess` | Full crack | **Một phần** | Fuses ASAR integrity; dual-path hard mesh; vẫn crackable nếu patch exe |
| 8 | Spoof HWID = token máy khác | Share license | **Siết** | HWID v3 đa tín hiệu + dual v2/v1 |
| 9 | Dùng admin key / private trên máy khách | Issue local | **Có** | Strip env packaged + anti-tamper |
| 10 | `/api/entitlement/issue` trên packaged | Mint key | **Có** | `assertSellerRuntime` 404 |
| 11 | Token rác / sửa payload | Fake claims | **Có** | verify + canary |
| 12 | Trial cloud kẹt đè Pro | Không lên Pro | **Đã fix** | promote trial→pro |
| 13 | Offline forever sau revoke | Dùng token đã revoke | **Siết** | Heartbeat online + cache revoked; grace 48h/12h/6h |
| 14 | Nop một hàm assertProAccess | Video free | **Siết** | `assertPremiumAccessHard` + `assertFeatureAccessHard` mesh |
| 15 | Clear only `AI_NOVEL_PACKAGED` | Fake dev open | **Siết** | Multi-signal attest (ELECTRON_PACKAGED + ATTEST + layout) |
| 16 | Gọi toolbox API không Pro (video-editor/bypass/…) | Free labs | **Có** | `requireToolboxAccess` hard mesh |
| 17 | `HOST_BINDING=open` packaged | Standalone Python | **Siết** | Force enforce + anti-tamper reject open |
| 18 | Leak process secret vào child env | Reuse host token | **Siết** | Per-spawn secret + scrubbed env allowlist |
| 19 | CapAssistant/util API không gate | Free toolbox | **Có** | Toàn bộ capassistant + isolate/split/… → toolbox |
| 20 | 1 license nhiều máy online | Share seat | **Siết** | `seatPresence` concurrent window |
| 21 | Clone disk / HWID spoof mạnh | Drift fingerprint | **Siết** | `hwidRebind` + activate clear |
| 22 | SEO psych chỉ local client | IP extract | **Siết** | `/api/youtube-meta` + cloud psych actions |

## Lớp phòng thủ hiện có

```
[1] Ed25519 AINOVEL2          — authenticity token
[2] Host pin license API      — không gọi server lạ
[3] TLS pin optional          — SPKI (bảo trì cert)
[4] Keyring kid+SPKI pin      — không thay public key
[5] Fail-closed empty keyring — thiếu key → không Pro
[6] Packaged multi-signal     — enforce + attest (not one env)
[7] Seller endpoint 404       — không issue trên app khách
[8] Feature hard mesh         — requireFeature → assertFeatureAccessHard
[9] Electron fuses            — no inspect / asar integrity
[10] Anti-tamper canary       — verify không “always true”
[11] Host-binding per-spawn   — scrubbed env + force enforce packaged
[12] Cloud IP Seedance/Psych  — packaged Pro execution authority
[13] Strict online expanded   — trial revenue + Pro IP features
```

## Attacker “thắng” khi nào (trung thực)

1. **Patch binary/asar** bỏ *toàn bộ* assert + hard gate + integrity (cần bypass fuse + resign).  
2. **Lộ private key** seller / bridge.  
3. **Crack shared** + user offline vĩnh viễn sau first-run (heartbeat có cửa sổ offline, không chặn forever offline sau khi đã online-OK trong grace).

Không có desktop license 100% chống crack; mục tiêu là **đắt hơn mua bản quyền** + revoke online.

## Hardening bổ sung (2026-07-20)

| Vector | Fix |
|--------|-----|
| Spoof HWID 1 tín hiệu | **HWID v3**: MachineGuid + volume serial + CPU + arch; dual-accept v2/v1 |
| Patch 1 hàm `assertProAccess` | **`assertPremiumAccessHard`** dual-path (video/capcut/ship) |
| Offline forever sau crack | **Heartbeat** packaged: online revoke; offline grace 72h; first-run 24h |
| Nop anti-tamper pins | **runtimeIntegrity** kiểm tra pin structure |
| Revoke | Online `valid:false` → deny + cache revoked |

Env (packaged / public.env optional):

```
AINOVEL_HEARTBEAT_GRACE_SEC=172800
AINOVEL_HEARTBEAT_FIRST_RUN_SEC=43200
AINOVEL_STRICT_ONLINE_GRACE_SEC=21600
```

Defaults if unset: **48h** / **12h** / **6h** strict.

## Sau khi rotate key

```powershell
npm run commercial:secrets
node scripts/print-keyring-pins.mjs
# Cập nhật EMBEDDED_KEYRING_* trong src/lib/commercial/antiTamper.ts
# Ship build mới + redeploy telegram-bridge PRIVATE_KEY_B64
```

## Smoke

```powershell
npm run smoke:anti-tamper
npm run smoke:license-trust
npm run smoke:commercial
```
