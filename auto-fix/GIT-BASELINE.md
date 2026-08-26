# Git Baseline for Auto-Fix

**Workspace:** `D:\AI Video Studio`
**Purpose:** Track the Auto-Fix control plane and implementation specification.
**Baseline date:** 2026-08-26

## Repository scope

The initial local Git repository tracks:

- `auto-fix/` policy, specification, roadmap, discovery, and control records;
- `build-project/package.json` and `build-project/package-lock.json`;
- `build-project/electron-builder.yml`;
- build helper source and build resource files that are safe to version.

## Explicit exclusions

The repository does not treat the current packaged application as canonical source. It excludes:

- `resources/app/` packaged application payload;
- `build-output/` and generated installers/artifacts;
- executable, DLL, PAK, BIN, ASAR, blockmap, and other generated binaries;
- dependency trees such as `node_modules/`;
- runtime account, token, cookie, settings, cache, and log data;
- signing keys, credentials, and environment files.

## Branch policy for this workspace

- Baseline branch: `main`.
- Active implementation branch: `feature/auto-fix-master-specification`.
- Future repair branches: `ai-fix/<bug-id>`.
- Production/release branches must not be changed by Auto-Fix.

## Current limitation

This Git repository is a control-plane/specification baseline, not confirmation that the packaged Electron application has become a reproducible canonical source checkout. The external `nova-logic` source branch remains under review because its declared `electron-builder.json` is missing and it has no CI workflow.

## Authority state

Creating this repository and branch is a manual project setup action. It does not enable Auto-Fix runtime, source write, command execution, build, signing, release, rollout, or rollback authority. Those controls remain OFF in `auto-fix/config/policy.json`.
