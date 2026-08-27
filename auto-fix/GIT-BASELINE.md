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

## Canonical source registration

The same Git repository now contains the canonical Electron source under `nova/`. The approved remote, branch, immutable baseline, and required tracked files are registered in `config/canonical-source.json`:

- remote: `https://github.com/khanhtran0393/AI-Novel.git`;
- canonical branch: `nova-logic`;
- baseline: `d936dc4054bfc1e38d0e01e345010d02b8f4ebf0`;
- Electron entry point: `nova/main.plain.js`.

This supersedes the earlier packaged-output-only assessment. It does not make `resources/app/` canonical and does not complete M1: CI definitions exist, but successful run/required-check evidence, protected branches, approved provenance, security review, and controlled signing/release infrastructure remain blocked.

## Authority state

Creating this repository and branch is a manual project setup action. It does not enable Auto-Fix runtime, source write, command execution, build, signing, release, rollout, or rollback authority. Those controls remain OFF in `auto-fix/config/policy.json`.
