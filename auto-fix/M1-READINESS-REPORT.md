# M1 Readiness Report

**Status: BLOCKED**

**Evidence date: 2026-08-27**

## Scope

This report covers Git/CI readiness only. Canonical source acceptance is necessary but not sufficient for M1. Nothing in this report grants runtime, source-write, command, build, signing, release, rollout, or rollback authority.

## Confirmed evidence

- Workspace: `D:\AI Video Studio`
- Canonical remote: `https://github.com/khanhtran0393/AI-Novel.git`
- Canonical branch: `nova-logic`
- Immutable baseline and `origin/nova-logic`: `d936dc4054bfc1e38d0e01e345010d02b8f4ebf0`
- Machine-readable registration: `config/canonical-source.json`
- Independent validation clone: `D:\AI Video Studio Source`
- Source/build files: `package.json`, lockfile v3, `electron-builder.json`, `nova/main.plain.js`, and `nova/preload.js` are tracked.
- Clean install: `npm ci` passed.
- Application checks: syntax 97 files, IPC 86 channels/15 events, parity 7 pairs, and foundation tests all passed.
- Packaging: unpacked Windows build passed with publishing disabled using `--publish never`.
- Local artifact evidence: `AI Video Studio.exe` SHA-256 `fbdfbd5c44b856cdbca01aa14d9837a41f3b8dfbfaa6ce2cdc40f4d68b28366d` (the executable name is now consistent with build output); `app.asar` SHA-256 `7f62d918ece51947b54edbb547d5997f9ec709e956cd9c3414d884eb25c2a132`. Packaged smoke test passed at 2026-08-27T08:29.
- Repository adapter: confirms manifest against live Git remote, remote-tracking branch, baseline ancestry, approval evidence, and required tracked files without exposing arbitrary Git execution.

## Remaining blockers

- CI definitions now exist for clean install, policy/control-plane/application checks, production audit, unsigned unpacked Windows packaging, machine-readable hashes, evidence retention, and post-merge GitHub artifact attestation. No workflow run/log has yet confirmed the controlled-runner evidence or required-check contexts.
- `nova-logic` protection is not configured or verified; `.github/BRANCH-PROTECTION.md` records the required rules.
- Existing source commits are unsigned. Post-merge artifact attestation is defined, but no successful attestation exists yet and the equivalent source-provenance decision remains unapproved.
- Signing/release/rollout/rollback controls are documented in `RELEASE-GOVERNANCE.md`; controlled signing infrastructure, protected environment, named approvals, and exercised rollback evidence remain absent.
- The known high-severity transitive `js-yaml` advisory is locally remediated by lockfile resolution `4.3.2`; CI security evidence is pending.
- `SECURITY-REVIEW.md` defines the required IPC, updater, credentials/session, native-process, Chrome/CDP, MCP, and build-chain review, but the broader review and human approval remain incomplete.

## Gate behavior

Generate the local machine-readable report with:

```powershell
node auto-fix/scripts/readiness.js .
```

During implementation the report is expected to be `FAIL` because the worktree is dirty. In a clean checkout, the CLI intentionally supplies no external evidence, so CI, retention, branch protection, provenance, signing, release governance, and security review remain `BLOCKED`. Missing or inconclusive checks never count as `PASS`, and successful local validation or the mere presence of workflow/documentation files is not represented as operational evidence.

## Authority confirmation

All authorities in `config/policy.json` remain `false`; `runtimeEnabled` remains `false`; mode remains `observe-only`. The control plane is not imported by or connected to the Electron application.
