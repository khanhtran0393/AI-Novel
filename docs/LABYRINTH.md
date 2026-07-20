# Labyrinth — bypass detect · mirage · wrong-path

**Mục tiêu:** phát hiện bypass rộng hơn; khi nghi tamper:
1. Ghi signal + cascade nội bộ (`INTEGRITY_OR_BYPASS`)
2. **Mirage:** API premium HTTP **200 / ok** — path rỗng, không media thật
3. **Wrong-path:** chạy **sai hàm** bait (không Seedance/CapCut/ship thật)
4. **UI không khóa** — cracker ảo tưởng đã phá

**Không** path license thứ hai. One-path: vé · sổ cái · crown (`LICENSE_ONE_PATH.md`).

Code: `src/lib/commercial/labyrinth/*` · Wire: `antiTamper` + `bypassProbe`, `proGateHard`, `apiGate.responseForGateFailure`.

---

## 1. Quy tắc thép

| Được | Cấm |
|------|-----|
| Probe/cascade **chỉ** khi nghi tamper | Hydra / mirage cho user Pro hợp pháp |
| User sạch → **một** 403 rõ | Xóa project / corrupt store / khóa nút “cracker” |
| UI cosmetic có thể xanh sau patch | Soft-success **media file thật** (B10) |
| Decoy `unlockProLocal` fail-closed | UI wire decoy để cấp Pro |
| Crown IP cloud + ticket | `f(token)` / private client |

| Env | Việc |
|-----|------|
| `AINOVEL_MIRAGE=0` | Tắt ảo 200 |
| `AINOVEL_LABYRINTH=0` | Tắt sticky layer |
| `AINOVEL_MIRAGE=1` / `LABYRINTH=1` | Ép (dev/test) |
| Default packaged/`enforce` | Mirage bật khi tamper |

---

## 2. Expanded bypass probes (`bypassProbe.ts`)

`evaluateAntiTamper` = **keyring pin** + suite:

| Nhóm | Phát hiện |
|------|-----------|
| **Verify canary** | Token rác / JWT lookalike / Pro claims + sig giả / dual-call |
| **Packaged policy** | MODE open, OWNER, HOST_BINDING, secret seller |
| **Inject** | `NODE_OPTIONS` -r/--require, `ELECTRON_RUN_AS_NODE`, execArgv inspect |
| **License host** | URL ngoài pin / HTTP lạ |
| **Feature matrix** | free được video / CapCut / ship / toolbox |
| **One-path + decoy** | `unlockProLocal` patch Pro; crack env |
| **Clock** | time quá khứ/tương lai |
| **Export shape** | verify/mode không còn function |
| **Client** | status fail, window unlock hooks, storage flags |

---

## 3. Mirage + wrong-path

Tamper gate fail → `runWrongFeaturePath` + HTTP 200:

| Feature | Decoy handlers (bait) |
|---------|----------------------|
| gen_video | `director_apply_formulas_local`, `seedance_compile_clip_compat` |
| export_capcut | `fablecut_rebuild_timeline_v0` |
| ship_pack | `ship_pack_materialize_fast` |
| tts_premium | `tts_premium_render_batch` |
| toolbox | `nav_toolbox_dispatch_legacy` |

Client: `applyClientBypassProbes` → shadow → `executeClientWrongPremium` trước video/CapCut/ship.

Signals: `MIRAGE_SERVED`, `WRONG_PATH_RUN`, `BYPASS_PROBE`, …

---

## 4. Mesh

```
assertRuntimeIntegrity
  → keyring ready
  → assertAntiTamper (= pins + bypassProbe suite)
  → reVerify · assertPro/Feature · heartbeat · seat
         │ tamper
         ▼
  wrong-path handlers + mirage 200 (handler thật không chạy)
```

Legitimate fail → 403, `labyrinth: false`.

---

## 5. Smoke

```powershell
npm run smoke:labyrinth
npm run smoke:anti-tamper
```

---

## 6. Status JSON

`GET /api/commercial/status`:

- `antiTamper` — ok, reasons, bypassScore, bypassCategories, bypass
- `bypassProbe` — ok, findingCount, categories, score, topReasons
- `labyrinth` — signalCount, recentCodes, miragePolicy

Không leak token / HWID thô / nội dung dự án.
