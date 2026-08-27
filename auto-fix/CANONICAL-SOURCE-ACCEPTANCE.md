# Canonical Source Acceptance Checklist

**Current result: BLOCKED**

This checklist prevents the packaged Electron payload from being treated as the canonical application source. It must be completed by a human owner before M1 can move from `BLOCKED`.

## Required evidence

- [ ] Repository URL/identity and owner are recorded.
- [ ] Full source history or a documented immutable source baseline is available.
- [ ] The exact source commit is reproducible from a clean checkout.
- [ ] The source repository contains the declared Electron build configuration (`electron-builder.json` or an approved equivalent).
- [ ] Dependency installation succeeds from a clean checkout using a lockfile.
- [ ] CI host, runner identity, workflow files, logs and retention policy are identified.
- [ ] Protected `main` and release branch rules are configured.
- [ ] Repair branch/worktree convention `ai-fix/<bug-id>` is documented and enforced outside this read-only control plane.
- [ ] Syntax/static checks, tests and build verification run successfully in CI.
- [ ] Artifact metadata includes version, source commit SHA, hash and build provenance.
- [ ] Security scan and dependency review are recorded.
- [ ] Release/signing/rollout/rollback owners and approval boundaries are documented.

## Known `nova-logic` blockers

The inspected candidate commit is `34d9dff53a613ecfe5ad420e71733de1e9557447`. It remains an external candidate, not canonical source, because:

- the declared `electron-builder.json` is missing;
- dependency installation/build completion has not been established;
- no CI workflow was found;
- release, signing, rollout and rollback governance is incomplete;
- security review of Electron IPC, updater, Chrome cookie/token, native process and MCP boundaries is incomplete.

No control-plane component may change those source files or infer acceptance from the packaged `resources/app` directory.
