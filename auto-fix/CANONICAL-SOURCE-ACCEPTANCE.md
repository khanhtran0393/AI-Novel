# Canonical Source Acceptance Record

**Canonical source identity: ACCEPTED**

**M1 readiness: BLOCKED**

This record accepts a reproducible Git checkout as canonical Electron source. It does not accept the packaged `resources/app` payload and does not grant Auto-Fix runtime, write, command, build, signing, release, rollout, or rollback authority.

## Registered identity

- Repository: `https://github.com/khanhtran0393/AI-Novel.git`
- Canonical branch: `nova-logic`
- Immutable baseline: `d936dc4054bfc1e38d0e01e345010d02b8f4ebf0`
- Electron entry point: `nova/main.plain.js`
- Machine-readable record: `config/canonical-source.json`

`repository-adapter.js` accepts a checkout only when the manifest and live read-only Git evidence agree: normalized `origin`, `origin/nova-logic`, baseline commit, baseline ancestry, tracked required paths, and files present in the worktree.

## Evidence completed on 2026-08-27

- [x] Repository URL, branch, and immutable source baseline recorded.
- [x] Primary checkout and `origin/nova-logic` resolved to the baseline SHA.
- [x] Independent clean clone created at `D:\AI Video Studio Source`.
- [x] Lockfile-based `npm ci` completed from the independent clone.
- [x] `package-lock.json` lockfile v3 and `electron-builder.json` are tracked.
- [x] Syntax checks passed for 97 JavaScript files.
- [x] IPC inventory passed with 86 channels and 15 progress events.
- [x] Parity checks passed for 7 protected/plain pairs.
- [x] Foundation tests passed.
- [x] Unpacked Windows packaging completed with publishing disabled (`--publish never`).
- [x] Local artifact hashes captured: executable `fbdfbd5c44b856cdbca01aa14d9837a41f3b8dfbfaa6ce2cdc40f4d68b28366d`; ASAR `7f62d918ece51947b54edbb547d5997f9ec709e956cd9c3414d884eb25c2a132`.
- [x] Auto-updater publishing remains unconfigured/disabled by default.

## Evidence still required for M1

- [ ] CI host, controlled-runner execution, retained logs/artifacts, and required-check evidence (workflow definitions now exist).
- [ ] Protected canonical/release branch rules (`.github/BRANCH-PROTECTION.md` defines but does not enforce them).
- [ ] Signed commit or approved equivalent source-provenance policy.
- [ ] Successful CI execution of install, checks, tests, build, artifact, and security gates.
- [ ] Successful artifact provenance binding version, commit SHA, hashes, runner, and build inputs (generation and GitHub attestation are defined but unexecuted).
- [ ] Controlled signing setup and evidenced release/signing/rollout/rollback governance (`RELEASE-GOVERNANCE.md` defines the required process only).
- [ ] Completed and approved security review of Electron IPC, updater, Chrome cookie/token, native process, and MCP boundaries (`SECURITY-REVIEW.md`).

## Security status

The initial 2026-08-27 production audit found one high-severity transitive advisory at `electron-updater@6.8.9 -> js-yaml@4.3.0` (`GHSA-5p4m-2wfm-xmqj`, affected `<4.3.1`). The lockfile now resolves `js-yaml@4.3.2`; a fresh `npm ci`, `npm audit --omit=dev`, all application checks/tests, and an unpacked Windows build passed locally with publishing disabled. This remediates the known dependency advisory, but local evidence does not replace the still-blocked CI security gate or subsystem security review.

Canonical identity acceptance is therefore complete, while M1 and every authority transition remain blocked.
