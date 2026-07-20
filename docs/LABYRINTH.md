# Labyrinth — ma trận lỗi đa tầng (anti-bypass)

**Mục tiêu:** khi nghi **tamper/bypass**, deny premium bằng **một root** (`INTEGRITY_OR_BYPASS`) và **nhiều surface layer** (hydra) để tăng chi phí RE.  
**Không** phải đường license thứ hai. One-path vẫn là: vé · sổ cái · crown IP (`LICENSE_ONE_PATH.md`).

Code: `src/lib/commercial/labyrinth/*` · Wire: `antiTamper.ts`, `proGateHard.ts` · Status: `labyrinth` trên `GET /api/commercial/status`.

---

## 1. Quy tắc thép

| Được | Cấm |
|------|-----|
| Cascade **chỉ** khi `tamper_suspected` | Hydra message cho user Pro hợp pháp |
| User sạch → **một** lỗi rõ (token/HWID/exp) | Xóa project / corrupt store |
| Sticky progressive: packaged / `enforce` / `AINOVEL_LABYRINTH=1` | Soft-success gen video/media (B10) |
| Decoy `unlockProLocal` luôn fail-closed | UI gọi decoy để cấp Pro |
| Crown IP vẫn cloud + ticket | `f(token)` / private client |

Kill-switch: `AINOVEL_LABYRINTH=0` tắt sticky cascade (signals vẫn có thể ghi từ anti-tamper).

---

## 2. Tầng surface (cùng root)

| Layer | Message (VN) | Origin điển hình |
|-------|----------------|------------------|
| **T1** | License token không verify… | token_verify, pro_access |
| **T2** | Kiểm tra toàn vẹn license (keyring/canary)… | anti_tamper, integrity, keyring |
| **T3** | Xác thực kép license thất bại | recheck, seat, hwid_rebind |
| **T4** | Phiên bản quyền cần xác thực lại… | heartbeat / ledger |
| **T5** | Dịch vụ bản quyền không khả dụng — liên hệ hỗ trợ… | progressive max |

Sticky: lần deny tamper thứ *n* có thể tăng layer (base + attempt), tối đa T5, rồi **ổn định**.

---

## 3. Decoy (honeypot)

| Symbol | Việc |
|--------|------|
| `unlockProLocal` | Luôn `{ ok:false, pro:false }` + signal |
| `applyLicenseDatFile` | Cascade deny |
| `deriveModuleKeyFromToken` | Throw FORBIDDEN one-path |
| `forceOpenEntitlementMode` | Return false + signal |
| Env `AINOVEL_CRACK_ME` / `FORCE_PRO` / `BYPASS_LICENSE` / `UNLOCK_ALL` | anti-tamper reason + fail |

**Agents:** không wire decoy vào LicenseModal / Zustand / feature gates thật.

---

## 4. Mesh thật (không thay)

```
assertRuntimeIntegrity
  → keyring ready
  → assertAntiTamper (+ canary + decoy env)
  → reVerifyTokenIndependent
  → assertPro / assertFeature
  → heartbeat · seat · hwid rebind
  → reCheckClaims
```

Labyrinth chỉ **bọc surface message + signal** khi fail thuộc tamper.

---

## 5. Smoke

```powershell
npm run smoke:labyrinth
npm run smoke:anti-tamper
```

---

## 6. Status JSON

`GET /api/commercial/status` → `labyrinth: { version, signalCount, sessionCount, recentCodes, stickyCascade }`.  
Không leak token / HWID thô / nội dung dự án.
