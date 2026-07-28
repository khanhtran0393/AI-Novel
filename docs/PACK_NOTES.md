# PACK NOTES — AI NOVEL DESKTOP BUILD & PACKAGING STANDARD

> **Mục đích:** Tài liệu chuẩn hóa checklist, điều kiện tiên quyết (Hard Stop-Gates) và quy trình từng bước để đóng gói (pack) các phiên bản Desktop App (QA & Commercial Release) cho các đợt phát hành tiếp theo.  
> **Cập nhật lần cuối:** 2026-07-28  
> **Tài liệu liên quan:** `docs/IRON_LAWS.md`, `docs/SECURITY_HARDENING_IMPLEMENTATION_PLAN.md`, `docs/COMMERCIAL.md`.

---

## I. CÁC ĐIỀU KIỆN TIÊN QUYẾT TRƯỚC KHI PACK (HARD STOP-GATES)

CẤM xuất bản (publish) hoặc bàn giao bản build cho người dùng nếu vi phạm bất kỳ điều kiện nào sau đây:

1. 🛑 **Zero Type Errors**: `npm run typecheck` bắt buộc trả về 0 lỗi.
2. 🛑 **Commercial & License Pass**: Toàn bộ chuỗi test `smoke:commercial`, `smoke:anti-tamper`, `smoke:labyrinth`, `smoke:license-trust` phải PASS 100%.
3. 🛑 **Zero Missing Binaries**: File `electron.exe` phải tồn tại trong `node_modules\electron\dist\`. (Nếu thiếu, phải chạy `node node_modules/electron/install.js` trước).
4. 🛑 **Chữ ký số Authenticode**: Bản thương mại (`pack:commercial`) bắt buộc phải có chữ ký hợp lệ (`Status = Valid`) trên file `.exe` chính và installer.
5. 🛑 **Không rò rỉ Source Code**: Artifact thương mại không được chứa file `.ts`, `.tsx`, `.py` dư thừa, `scratch/`, `test-results/` hoặc source map trong ASAR.

---

## II. CHECKLIST ĐÓNG GÓI CHUẨN (BƯỚC VÀO SẢN XUẤT)

### 🧹 Bước 1: Dọn dẹp môi trường & Cache
```powershell
# Xóa cache tạm trước khi build để tránh phình dung lượng
rm -rf .next/dev/cache
rm -rf scratch
rm -rf test-results
rm -rf exports
```

### 🔍 Bước 2: Kiểm tra biên dịch & Typecheck
```powershell
# 1. Typecheck toàn bộ dự án
npm run typecheck

# 2. Kiểm tra bảo mật dependency mức HIGH (phải pass)
npm audit --omit=dev --audit-level=high
```

### 🧪 Bước 3: Chạy chuỗi Smokes kiểm thử tự động
```powershell
# 1. Smokes nghiệp vụ cốt lõi (Tạo kịch bản, DTO, Media offline)
npm run smoke:core
npm run smoke:pipeline

# 2. Smokes bản quyền & Anti-tamper
npm run smoke:commercial
npm run smoke:anti-tamper
npm run smoke:labyrinth
npm run smoke:license-trust

# 3. Security Hardening & IP Protection
node scripts/smoke-electron-security.cjs
npm run smoke:re-harden
npm run smoke:crown-ip
```

### 📦 Bước 4: Tiến hành Đóng gói (Build Packaging)

#### Lựa chọn A — Bản QA Nội bộ (Unsigned Build)
```powershell
npm run pack:unsigned:qa
# Kiểm tra chạy thử bản unpacked
npm run smoke:unpacked-desktop
```

#### Lựa chọn B — Bản Thương mại Phát hành (Commercial Signed Build)
```powershell
# Thiết lập môi trường chữ ký số
$env:CSC_LINK = "path\to\cert.p12"
$env:CSC_KEY_PASSWORD = "your_password"

# Preflight & Build Commercial
npm run preflight:pack:signed
npm run pack:commercial

# Audit quét cấu trúc artifact sản phẩm
npm run audit:package -- dist/win-unpacked
```

### 🔏 Bước 5: Xác minh Chữ ký & Phát hành
```powershell
# Xác minh chữ ký số của sản phẩm xuất ra
Get-AuthenticodeSignature "dist/win-unpacked/AI Novel.exe"
Get-AuthenticodeSignature "dist/AI-Novel-*-x64.exe"

# Kiểm tra release feed
npm run release:feed:verify
```

---

## III. BẢNG CẤU HÌNH VÀ CÁC PROFILE BUILD

### 1. Phân biệt các Build Profile
| Profile | Command | Cấu hình Entitlement | Mục đích |
|---------|---------|---------------------|----------|
| **Dev Desktop** | `npm run dev:desktop` | `open` (Dev Mode) | Lập trình & Test UI/UX |
| **QA Unsigned** | `npm run pack:unsigned:qa` | `open` / `enforce` | Test nội bộ / QA tester |
| **Commercial Signed** | `npm run pack:commercial` | `enforce` (Strict License) | Release giao khách hàng |

### 2. Cấu hình Env Bản Thương Mại (`resources/commercial/public.env`)
Bắt buộc có các cờ bảo vệ sau khi đóng gói:
```env
AINOVEL_ENTITLEMENT_MODE=enforce
AINOVEL_HOST_BINDING=enforce
AINOVEL_TRIAL_ENABLED=true
AINOVEL_TRIAL_DAYS=7
AINOVEL_UPDATE_CHECK_ON_LAUNCH=true
AINOVEL_UPDATE_ALLOW_PRERELEASE=false
```

---

## IV. XỬ LÝ SỰ CỐ KHI BUILD/PACK THẤT BẠI (RECOVERY)

### 1. Lỗi `Missing electron.exe` khi khởi động Dev
- **Hiện tượng:** Console báo `[!] Missing electron.exe - run: npm install`.
- **Khôi phục nhanh:**
  ```powershell
  node node_modules/electron/install.js
  ```

### 2. Lỗi Kẹt Cổng / Crash Process
- **Khai tử process cũ kẹt port 3000:**
  ```powershell
  netstat -ano | findstr :3000
  taskkill /F /PID <PID_BAO_LOI>
  ```

### 3. Build bị kẹt cache cũ hoặc corrupt `.next`
- **Xóa và khôi phục:**
  ```powershell
  npm run crown:restore
  rm -rf .next
  rm -rf dist
  npm run pack:unsigned:qa -- --verbose
  ```

---

## V. TỔNG HỢP CÁC CẢI TIẾN HIỆU NĂNG ĐÃ THỰC THI

Để đảm bảo chất lượng khi pack các version tiếp theo, hệ thống đã được tối ưu các điểm chính:
1. **Flow Bridge Security**: Token 32-byte ngẫu nhiên mỗi lần mở app, pin Origin WebSocket, khóa Proxy Allowlist chỉ tới host Google Flow.
2. **UI Re-render**: Header dùng primitive `tierTag` (`TRIAL` | `PRO` | `FREE`) triệt tiêu re-render thừa.
3. **Reconciler 1-Pass**: `reconcileMissingMediaAssets` chỉ quét file 1 lần sau 2s boot workspace (tiết kiệm 66% I/O đĩa).
4. **SessionStorage Status Cache**: Caching 30s status LA Studio, loại bỏ độ trễ 15s khi reload app.
5. **API Memory Cache**: Caching `apikey.txt` và `findChromePath()` cấp module (TTL 60s), không đọc đĩa lặp lại trên mỗi request gen media.

---

*Ghi chú: Mọi thay đổi trong quy trình pack bắt buộc phải cập nhật file này và `scripts/preflight-pack.mjs` đồng thời.*
