# PACK NOTES — AI NOVEL DESKTOP BUILD & PACKAGING STANDARD

> **Mục đích:** Tài liệu chuẩn hóa checklist, điều kiện tiên quyết (Hard Stop-Gates) và quy trình từng bước để đóng gói (pack) các phiên bản Desktop App (QA & Commercial Release) cho các đợt phát hành tiếp theo.  
> **Cập nhật lần cuối:** 2026-07-29
> **Tài liệu liên quan:** `docs/IRON_LAWS.md`, `docs/SECURITY_HARDENING_IMPLEMENTATION_PLAN.md`, `docs/COMMERCIAL.md`.

---

## I. CÁC ĐIỀU KIỆN TIÊN QUYẾT TRƯỚC KHI PACK (HARD STOP-GATES)

CẤM xuất bản (publish) hoặc bàn giao bản build cho người dùng nếu vi phạm bất kỳ điều kiện nào sau đây:

1. 🛑 **Zero Type Errors**: `npm run typecheck` bắt buộc trả về 0 lỗi.
2. 🛑 **Commercial & License Pass**: Toàn bộ chuỗi test `smoke:commercial`, `smoke:anti-tamper`, `smoke:labyrinth`, `smoke:license-trust` phải PASS 100%.
3. 🛑 **Zero Missing Binaries**: File `electron.exe` phải tồn tại trong `node_modules\electron\dist\`. (Nếu thiếu, phải chạy `node node_modules/electron/install.js` trước).
4. 🛑 **Chữ ký số Authenticode**: Bản thương mại (`pack:commercial`) bắt buộc phải có chữ ký hợp lệ (`Status = Valid`) trên file `.exe` chính và installer.
5. 🛑 **Không rò rỉ Source Code**: Artifact thương mại không được chứa file `.ts`, `.tsx`, `.py` dư thừa, `scratch/`, `test-results/` hoặc source map trong ASAR.
6. 🛑 **FFmpeg nội bộ bắt buộc cho TTS/Media**: Bản QA/Commercial phải đóng kèm `bin/ffmpeg.exe` và `bin/ffprobe.exe` trong runtime packaged. Tuyệt đối không dựa vào FFmpeg cài sẵn trong `PATH` của máy dev. Trước khi giao user, chạy smoke trên bản unpacked/installed với `PATH` rỗng hoặc không có FFmpeg hệ thống để chắc chắn Piper/Edge/Vina TTS không báo `spawnSync ffmpeg ENOENT`.
7. 🛑 **Không phụ thuộc đường dẫn máy dev / repo ngoài**: Artifact và runtime packaged không được yêu cầu `D:\repo\...`, `D:\My app\...`, `C:\Users\Khanh\...`, `ainovel-gui.exe`, proxy `:8080`, hoặc dữ liệu mẫu để chạy. Mọi runtime cần thiết phải nằm trong app hoặc thư mục dữ liệu user hợp lệ.
8. 🛑 **Runtime nội bộ đầy đủ**: Trước khi pack phải xác nhận có đủ các runtime/module đang được UI gọi: `bin/piper`, `bin/piper_vn`, `bin/la-studio-kokoro` nếu bật, `resources/python-runtime`, `python_core/gateway`, `extensions/ainovel-flow`, `vendor/FableCut`, `tools/xinchao-cut`, `capcut_api`, `resources/license/public-keys`, `resources/commercial/public.env`.
9. 🛑 **YouTube transcript runtime bắt buộc**: Setup link YouTube phải có đủ `python_core/fetch_youtube_transcript.py` và `python_core/fetch_youtube_audio_transcript.py` trong artifact. Nếu bật đường YouTube/Agent-Reach, phải chạy `npm run smoke:youtube-transcript`; không được giao build báo `SCRIPT_MISSING` / "bản cài app thiếu thành phần lấy phụ đề".
10. 🛑 **License / Free / Trial / Pro đồng bộ một đường**: `docs/COMMERCIAL.md`, `resources/commercial/public.env`, `src/lib/commercial/freeLimitsPolicy.ts`, `featureMatrix.ts`, Telegram admin/bot và smoke phải cùng một chính sách: Trial days, Free quota, Trial quota, max chapter/word, badge ưu tiên `TRIAL → PRO → FREE`, và packaged default `AINOVEL_ENTITLEMENT_MODE=enforce`.
11. 🛑 **Smoke trên máy sạch, không phải máy dev**: Ít nhất một lượt smoke phải chạy trên bản unpacked/installed với profile Windows sạch: chưa có localStorage, chưa có `%APPDATA%` cũ, chưa có FFmpeg/Python/Chrome trong `PATH`, chưa có license/trial vault cũ, và không có source repo cạnh app.
12. 🛑 **Media thật phải decode được**: TTS sinh ra phải phát được và decode được bằng FFmpeg nội bộ; ảnh phải là file raster thật; video/ship pack phải `ffprobe`/full-decode được; CapCut/FableCut timeline phải dùng path file thật trên đĩa, không dùng placeholder/sample/URL tạm.
13. 🛑 **Flow / Browser / Profile ổn định**: Profile Flow chỉ được xem là ready khi có token + email verified + project/capability gen ảnh/video. Khi gen ảnh/video, browser phải chạy hidden/off-screen, không nháy cửa sổ khi đổi phiên gen; login browser phải tự đóng/ẩn sau khi đã bắt đủ cấu hình cần thiết. Nếu gặp Google `/sorry` / reCAPTCHA thật, app chỉ đưa Chromium/profile thật ra cho user xác minh + cooldown queue; **không auto-click / không solver / không spam retry**.
14. 🛑 **Không leak secrets / session**: Artifact không được chứa `.env` riêng tư, private key Ed25519, Supabase service role, Telegram bot token, API key thật, cookie/session Flow, `accounts_data/`, `data/licenses/` private vault, log có token, hoặc file backup seller secrets.
15. 🛑 **Update / Version / Manifest không lệch**: `package.json` version, manifest update, release notes, commercial public env, feed update và installer phải cùng version/kênh phát hành. Không được để app version mới nhưng feed/manifest cũ.
16. 🛑 **First-run support log bắt buộc**: Bản build phải tạo được log chẩn đoán ở user data, và mọi lỗi runtime phải có thông báo hành động rõ ràng: thiếu binary nào, thiếu quyền nào, thiếu key/provider nào, thiếu media path nào — không toast mơ hồ.

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

# 3. Gate phát hành tổng hợp: bắt drift version/feed/config/test trước khi pack
npm run ship:check -- --strict
npm run prepare:publish
```

### 🧪 Bước 3: Chạy chuỗi Smokes kiểm thử tự động
```powershell
# 1. Smokes nghiệp vụ cốt lõi (Tạo kịch bản, DTO, Media offline)
npm run smoke:core
npm run smoke:pipeline
npm run smoke:youtube-transcript

# 2. Smokes bản quyền & Anti-tamper
npm run smoke:commercial
npm run smoke:anti-tamper
npm run smoke:labyrinth
npm run smoke:license-trust
npx.cmd tsx scripts/smoke-free-limits.mts

# 3. Security Hardening & IP Protection
node scripts/smoke-electron-security.cjs
npm run smoke:re-harden
npm run smoke:crown-ip

# 4. Flow/browser profile: ready đúng dữ liệu, gen nền không nháy browser
npx.cmd tsx scripts/smoke-flow-background-session-contract.mts
```

### 📦 Bước 4: Tiến hành Đóng gói (Build Packaging)

#### Lựa chọn A — Bản QA Nội bộ (Unsigned Build)
```powershell
npm run pack:unsigned:qa
# Audit artifact + kiểm tra chạy thử bản unpacked
npm run audit:package -- dist/win-unpacked
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

# Runtime media/TTS gate: không được phụ thuộc FFmpeg trong PATH của máy dev
# Bắt buộc kiểm tra artifact có bin/ffmpeg.exe + bin/ffprobe.exe và TTS decode thật.
npm run smoke:unpacked-desktop
```

### 🔏 Bước 5: Xác minh Chữ ký & Phát hành
```powershell
# Xác minh chữ ký số của sản phẩm xuất ra
Get-AuthenticodeSignature "dist/win-unpacked/AI Novel.exe"
Get-AuthenticodeSignature "dist/AI-Novel-*-x64.exe"

# Kiểm tra release feed
npm run release:feed:verify
```

### ✅ Bước 6: Phiếu tick cuối trước khi gửi user

Người pack chỉ được bàn giao build khi phiếu này có đủ bằng chứng log/screenshot/file report:

- [ ] App mở được trên Windows profile sạch, không cần source repo, không cần `D:\repo`, không cần FFmpeg/Python/Chrome cài trong `PATH`.
- [ ] License flow pass đủ 3 trạng thái: Free đúng quota, Trial đúng ngày/quota và badge TRIAL, Pro paid đúng HWID và badge PRO.
- [ ] TTS pass bằng media thật: nghe thử, gen audio lưu PC, audio decode được bằng `bin/ffmpeg.exe` nội bộ, không `spawnSync ffmpeg ENOENT`.
- [ ] YouTube/Agent-Reach pass: bấm Phân tích với link YouTube public có CC, lấy được captions hoặc báo đúng lỗi video/mạng; không `SCRIPT_MISSING`.
- [ ] Ảnh/video pass bằng media thật: ảnh nhân vật/scene/thumbnail là file raster thật; video final có audio; full decode không lỗi.
- [ ] Flow profile pass: token + email + project/capability đầy đủ; browser login tự đóng/ẩn sau capture; gen nền không nháy cửa sổ; `/sorry`/captcha thật thì dừng chờ user xác minh và profile cooldown, không auto-click.
- [ ] CapCut/FableCut export pass: timeline dùng file thật trên đĩa, TTS khớp duration/timestamps, không path sample/placeholder.
- [ ] Security pass: không source map, không `.ts/.tsx/.py` dư trong artifact, không secret/session/private vault/log token.
- [ ] Update/sign pass: chữ ký hợp lệ, version/feed/release notes/manifest khớp nhau, updater không báo version cũ.
- [ ] Log hỗ trợ pass: lỗi thiếu runtime/provider/key/media phải chỉ rõ thiếu gì và cách sửa; không toast chung chung.

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
AINOVEL_TRIAL_DAYS=3
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

### 4. Lỗi TTS `spawnSync ffmpeg ENOENT` trên máy user
- **Hiện tượng:** Toast "Lỗi sinh TTS" ghi `audio bị từ chối vì FFmpeg không giải mã được audio: spawnSync ffmpeg ENOENT`, thường kèm `đã lưu 0/N đoạn`.
- **Nguyên nhân:** Runtime packaged không tìm thấy `ffmpeg.exe`. Máy dev có thể không lỗi vì đã cài FFmpeg trong `PATH`, nhưng máy user thường không có.
- **Khôi phục đúng:** Bản pack phải đóng kèm `bin/ffmpeg.exe` + `bin/ffprobe.exe`, và resolver runtime phải ưu tiên `process.resourcesPath/bin/*` / thư mục cạnh `.exe` trước khi fallback sang `ffmpeg` hệ thống.
- **Cấm bàn giao:** Không gửi build cho user nếu chỉ pass trên máy dev nhờ FFmpeg trong `PATH`. Phải test bản unpacked/installed trong môi trường không có FFmpeg hệ thống.

### 5. Lỗi YouTube `SCRIPT_MISSING` / "bản cài thiếu thành phần lấy phụ đề"
- **Hiện tượng:** Setup YouTube/Agent-Reach báo "Không lấy được phụ đề YouTube" và phần "Vì sao" ghi bản cài app thiếu thành phần lấy phụ đề.
- **Nguyên nhân:** Artifact thiếu `python_core/fetch_youtube_transcript.py` hoặc `python_core/fetch_youtube_audio_transcript.py`. Lỗi này thường không hiện trên máy dev vì source repo còn nằm cạnh app.
- **Khôi phục đúng:** Pack phải copy `src/python_core/fetch_youtube_*.py` vào `resources/python_core/`, sau đó chạy `npm run smoke:youtube-transcript` trên artifact sạch.
- **Cấm bàn giao:** Không gửi build nếu smoke chỉ pass nhờ `src/python_core` trong repo dev; phải xác minh trong `dist/win-unpacked/resources/python_core/`.

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
