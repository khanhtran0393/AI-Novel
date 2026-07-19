# Go-live commercial — checklist một trang

Trạng thái phần mềm (local, 2026-07-19): **READY**.
Chặn ship installer production: **Windows Authenticode certificate** (chưa cấu hình trên máy dev / CI secrets).

---

## A. Đã xong (không cần lặp)

| Hạng mục                 | Lệnh / bằng chứng                                                                                             |
| ------------------------ | ------------------------------------------------------------------------------------------------------------- |
| Cổng phần mềm            | `npm run prepare:publish` PASS                                                                                |
| Feed update HTTPS        | `npm run release:feed:verify` PASS                                                                            |
| License Ed25519          | issue + activate Pro trên app đóng gói PASS                                                                   |
| Free gate                | video 403 khi FREE PASS                                                                                       |
| Credential DPAPI         | `npm run smoke:credential-vault` PASS                                                                         |
| Customer env public-only | `npm run commercial:setup-env -- --license-api https://ai-novel-flax.vercel.app --update-feed <feed> --force` |
| QA portable              | `dist-qa-unsigned/AI-Novel-1.0.0-x64.exe`                                                                     |
| API prod                 | `https://ai-novel-flax.vercel.app` ready                                                                      |
| Telegram bridge          | `https://ainovel-telegram-bridge.vercel.app/.../telegram-webhook`                                             |

Chạy gộp lại:

```powershell
npm run commercial:complete
```

---

## B. Việc **bạn** làm 1 lần — Authenticode

### 1) Mua cert

- Sectigo / DigiCert / SSL.com **Code Signing** (OV hoặc EV).
- Windows: file `.pfx` + mật khẩu; ghi **Common Name (publisher)** và **SHA1 thumbprint**.

### 2) Máy local

```powershell
$env:CSC_LINK = "D:\certs\ainovel.pfx"
$env:CSC_KEY_PASSWORD = "<mat-khau>"
$env:WIN_CSC_PUBLISHER_NAME = "<Exact certificate CN>"
$env:WIN_CSC_CERTIFICATE_SHA1 = "<40_HEX_THUMBPRINT>"

npm run release:verify   # phải PASS (strict + cert)
npm run build:desktop    # NSIS signed → dist\
npm run audit:package -- dist/win-unpacked
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/smoke-installed-desktop.ps1 -InstallerPath (Get-ChildItem dist\AI-Novel-*.exe | Select-Object -First 1 -ExpandProperty FullName)
```

### 3) GitHub Actions (khuyến nghị production)

Repo: remote `origin` · workflow `.github/workflows/release-desktop.yml` · tag `v1.0.0` (= `package.json` version).

| Nơi                             | Key                                                                                     |
| ------------------------------- | --------------------------------------------------------------------------------------- |
| Environment **signing** secrets | `WINDOWS_CSC_LINK` (base64 PFX hoặc path-compatible secret), `WINDOWS_CSC_KEY_PASSWORD` |
| Repository / env **vars**       | `WIN_CSC_PUBLISHER_NAME`, `WIN_CSC_CERTIFICATE_SHA1`                                    |
| Environment **production**      | required reviewers; `AINOVEL_ENTITLEMENT_ADMIN_KEY`, `SUPABASE_SERVICE_ROLE_KEY`; không đặt ở signing |

```powershell
git push origin codex/commercial-release-v1
# sau merge main (hoặc từ branch release):
git tag v1.0.0
git push origin v1.0.0
```

Workflow: build-sign → audit → smoke Free → (reviewer) Trial/updater → publish feed.

### 4) Máy trắng (signed only)

```powershell
npm run commercial:white-machine
```

Tick: Authenticode · FREE · Trial cloud · Pro 1 ngày · credential không lộ · uninstall.

Với máy có CapCut Desktop và CPython x64 + `cryptography==48.0.0`, chạy thêm `npm run smoke:capcut-live`; chỉ tick CapCut khi log trả MP3 thật, số byte và SHA-256.

---

## C. Cấp license hàng ngày (seller)

Private key: `%LOCALAPPDATA%\AI Novel Seller\entitlement-private.pem`

```powershell
npm run license:issue -- --hwid <HWID_16HEX> --expDays 365
# hoặc Telegram: khách bấm Đã thanh toán → admin ✅ Cấp Key
```

Khách: Logo → Bản quyền → dán `AINOVEL2.…` → Kích hoạt.

---

## D. Không làm

- Không ship `dist-qa-unsigned` cho khách trả phí (unsigned / SmartScreen).
- Không bake private key / admin / service-role vào installer.
- Không `release:publish` khi artifact chưa ký + chưa verify SHA/Authenticode.

---

## E. Lệnh tóm tắt

```powershell
npm run commercial:complete          # software gates
npm run commercial:go-live-status    # báo residual cert
# sau cert:
npm run build:desktop
```
