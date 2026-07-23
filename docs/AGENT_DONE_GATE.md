# Agent Done Gate — Chống ảo giác khi báo hoàn thành

**LOCKED.** Mọi agent (Grok / Claude / Codex / Cursor) **cấm** báo “xong / PASS / hoàn thành” nếu chưa qua cửa ải này.

Liên quan: `AGENTS.md` §12–14 · skill `empirical-qa-auditor` · skill `check-work` · `docs/IRON_LAWS.md` B10.

---

## 1. Trạng thái được phép dùng (cấm gộp)

| Tag | Ý nghĩa | Cần bằng chứng |
|-----|---------|----------------|
| `IMPLEMENTED` | Đã viết/sửa code | Diff / file path |
| `TYPECHECK_OK` | `tsc` xanh | Log `npm run typecheck` exit 0 |
| `SMOKE_OK` | Smoke domain liên quan xanh | Log `npm run smoke:…` / `verify:…` exit 0 |
| `MEDIA_OK` | File media thật trên đĩa | Path + size > 0 (+ probe nếu TTS) |
| `SHIP_READY` | Đủ typecheck + smokes ship | `prepare:publish` hoặc subset đã định nghĩa |
| `DONE` | User-facing “hoàn thành” | **Tất cả** tag trên theo domain + Gatekeeper **PASS** |

**CẤM** dùng “DONE / hoàn thành / smoke PASS” khi chỉ có `IMPLEMENTED` hoặc chỉ typecheck.

---

## 2. Definition of Done (DoD) — checklist bắt buộc

Trước khi message cuối cho user chứa chứa “xong”:

1. [ ] **Checklist requirement** — liệt kê từng yêu cầu user (bullet).
2. [ ] **Lệnh thật trong cùng turn** — không viện dẫn “đã test phiên trước” nếu không re-run.
3. [ ] **Domain smoke** — đúng bảng §3.
4. [ ] **Media/TTS** — nếu claim audio/ảnh/video: file tồn tại, size > 0 (B10).
5. [ ] **Gatekeeper** — `spawn_subagent` (hoặc self-role **độc lập** Zero-Trust) với skill `empirical-qa-auditor` → `VERDICT: PASS|REJECT`.
6. [ ] **Log trích** — ≥ 3–15 dòng stdout/stderr thật trong báo cáo user.
7. [ ] **Cấm từ ảo** — không: “có vẻ”, “giả sử”, “bạn tự test”, “should work”.

---

## 3. Domain → lệnh tối thiểu

| Domain chạm | Lệnh bắt buộc (exit 0) |
|-------------|-------------------------|
| Bất kỳ `.ts`/`.tsx` | `npm run typecheck` |
| TTS / vina / preview / voice catalog | `npm run smoke:vina` **và** `npm run verify:tts-integrity` |
| Pipeline P0–P2 | `npm run smoke:pipeline` |
| Commercial / entitlement / license | `npm run smoke:commercial` hoặc ít nhất `smoke:license-one-path` |
| Core workspace / contracts | `npm run smoke:core` |
| Ship / pack claim | `npm run ship:check` (+ pack smokes nếu claim artifact) |
| Full “ready publish” | `npm run prepare:publish` |

Gom nhanh theo diff:

```bash
npm run verify:agent-done
# hoặc
npm run verify:agent-done -- --domains=tts,core
```

---

## 4. Final Gatekeeper (Grok Build map)

| Môi trường | Cách gọi |
|------------|----------|
| **Grok Build** | `spawn_subagent` · `subagent_type: general-purpose` · prompt = skill `empirical-qa-auditor` + bản nháp + log |
| Claude (legacy docs) | `invoke_subagent` / skill tương đương |
| Không spawn được | Master **tự** đóng role auditor **sau** khi đã có log; vẫn phải in `VERDICT: PASS|REJECT` riêng block |

**CẤM** tự viết `VERDICT: PASS` trước khi chạy lệnh.

Tool **không tồn tại** trên Grok: `invoke_subagent`, `define_subagent`, `send_message` (Claude-era).  
**Map:** `invoke_subagent` → `spawn_subagent` · `run_command` → `run_terminal_command`.

---

## 5. Empirical QA — tiêu chuẩn REJECT

`REJECT` ngay nếu bản nháp:

- Không có log terminal / exit code
- Log từ script mock/demo tự chế “Success”
- Claim media mà không có file đĩa
- Gộp typecheck = feature xong
- Copy MEMORY “PASS” không re-run
- Dùng từ thoái thác (“có vẻ”, “giả sử”)

`PASS` chỉ khi: requirement cover + log thật domain đúng + không mock.

---

## 6. MEMORY.md evidence format

Mỗi dòng PASS **bắt buộc** dạng:

```markdown
- **YYYY-MM-DD:** <claim ngắn>. Proof: `<command>` → exit 0; note: <1 dòng log>.
```

**CẤM:** `- Smoke: foo PASS` không command/exit.

---

## 7. check-work

User hoặc master có thể gọi skill `check-work` (`/check-work`):

- Phase A: trace requirement vs action
- Phase B: diff + typecheck + smoke
- Kết thúc: `VERDICT: PASS|FAIL`

Fail → sửa → lặp tối đa 3 vòng.

---

## 8. Script máy

| Script / npm | Việc |
|--------------|------|
| `npm run smoke:vina` | Catalog 76 profile ↔ 76 WAV + JSON parse |
| `npm run verify:tts-integrity` | Audio quality gate + preview timeout budgets |
| `npm run verify:agent-done` | Auto-pick domain từ git diff + chạy gate |
| `docs/AGENT_DONE_GATE.md` | Spec này |

---

## 9. Conflict resolution

Khi “làm xong A→Z” xung đột “chưa có log”:

1. **Ưu tiên empirical** — báo `IMPLEMENTED` + thiếu smoke, **không** báo DONE.
2. Chạy lệnh → log → gatekeeper → mới DONE.
3. Omnipotent axioms **không** cho phép bịa log hoặc PASS giả.
