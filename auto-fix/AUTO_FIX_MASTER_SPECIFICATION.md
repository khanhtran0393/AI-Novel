# AUTO_FIX_MASTER_SPECIFICATION

**Specification ID:** `AUTO_FIX_MASTER_SPECIFICATION`
**Version:** `0.1.0`
**Status:** Draft / implementation baseline
**Scope:** Auto-Fix control plane for AI Video Studio
**Current mode:** `observe-only`
**Last reviewed:** 2026-08-26

## 1. Purpose

This is the canonical implementation contract for building Auto-Fix in a controlled, auditable manner. It defines boundaries and gates; it does not grant runtime authority by itself.

The first implementation target is repository and specification readiness. Auto-Fix remains disconnected from the packaged Electron application until a later milestone explicitly passes integration and security gates.

## 2. Non-goals for the initial implementation

The initial implementation MUST NOT:

- modify `resources/app`, packaged application files, or production runtime code;
- enable autonomous diagnosis, source writing, arbitrary command execution, signing, publishing, rollout, updater control, or rollback;
- read or transmit passwords, cookies, access tokens, API keys, private keys, personal files, or unrestricted filesystem contents;
- provide arbitrary shell, delete, network, or native-process tools to an AI agent;
- claim that the packaged artifact is the canonical source repository.

## 3. Authority model

All authorities are denied unless an explicit, reviewed milestone changes policy and supplies tests plus an audit record.

| Authority | Initial state | Required boundary |
|---|---:|---|
| Runtime integration | OFF | Separate interface and integration review |
| Read source | OFF | Approved source checkout only |
| Write source | OFF | Isolated worktree and allowlisted paths |
| Execute commands | OFF | Named allowlist and isolated runner |
| Create branch | OFF | Repository/workspace gate |
| Commit | OFF | Human-approved diff and audit record |
| Build | OFF | Controlled CI runner only |
| Sign | OFF | Isolated signing service; no agent-held keys |
| Release/publish | OFF | Human approval and verified artifact |
| Rollout | OFF | Staged deployment, kill switch, monitoring |
| Rollback | OFF | Health verification and tested recovery |

## 4. Required control-plane components

1. **Policy** — machine-readable deny-by-default controls.
2. **Repository adapter** — identifies canonical checkout, revision, branch, and dirty state without changing it.
3. **Redaction/data boundary** — removes credentials, tokens, cookies, private keys, and sensitive local paths.
4. **Audit record** — append-only, bounded metadata; never secrets.
5. **Gate evaluator** — explicit `PASS`, `FAIL`, or `BLOCKED` with evidence.
6. **Tool registry** — future controlled tools with schemas and authorization; no arbitrary passthrough.
7. **Execution plane** — future isolated CI/reproduction environment, never a production client process.

## 5. Milestone 1 acceptance criteria: Git + CI readiness

M1 is **BLOCKED** until all Git, CI, security, provenance, and governance evidence is confirmed. Canonical source identity was registered on 2026-08-27, but identity acceptance alone is not M1 acceptance. M1 MUST provide:

- a Git repository with full source history or documented source baseline;
- protected `main` and release branch policy;
- branch/worktree convention: `ai-fix/<bug-id>`;
- reproducible dependency installation from a clean checkout;
- syntax/static checks, tests where available, and build verification;
- artifact generation with version, commit SHA, hash, and build metadata;
- CI logs and machine-readable results for every required gate;
- no Auto-Fix write, commit, signing, release, or rollout authority;
- a documented `BLOCKED`/`FAIL` result when a required gate cannot run.

The registered `nova-logic` baseline installs, passes local checks/tests, and produces an unpacked Windows build with publishing disabled. CI workflows and governance runbooks are now defined, but definitions are not operational evidence. Remaining blockers are recorded in `M1-READINESS-REPORT.md`: workflow-run/required-check and branch-protection evidence, approved source provenance, controlled signing/release infrastructure, and completed security review.

## 6. Change workflow

Every Auto-Fix change MUST follow this sequence:

1. Create or select an isolated branch/worktree.
2. Capture repository revision and approved scope.
3. Collect only minimized, redacted evidence.
4. Produce diagnosis and confidence without writing source.
5. Propose a minimal patch and list affected files.
6. Run reproduction, targeted, regression, security, and build gates.
7. Request human review for high-risk areas or any authority transition.
8. Record the decision and immutable evidence references.
9. Keep production/release branches unchanged until approved outside the agent.

A failed, missing, or inconclusive gate is not a pass. It produces `BLOCKED` or `FAIL` and prevents authority escalation.

## 7. Risk classification

The following areas are HIGH risk and always require human review:

- authentication, authorization, encryption, secrets, cookies, and tokens;
- Electron main/preload IPC and renderer isolation;
- updater, installer, signing, licensing, release, and rollback;
- native process, FFmpeg, Python, Chrome/CDP, and MCP boundaries;
- arbitrary filesystem, network, or OS access;
- changes to build, dependency, permission, or security configuration.

## 8. Required evidence for implementation work

Each milestone report MUST include:

- status: `PASS`, `FAIL`, or `BLOCKED`;
- exact repository path, branch, and commit SHA;
- files changed and reason for each change;
- commands run and exit codes;
- test, static-check, security, and build results;
- artifact hash/metadata where applicable;
- security notes, limitations, and next milestone;
- explicit confirmation that disabled authorities remain disabled.

## 9. Current implementation status

The following safe control-plane components are implemented under `auto-fix/`:

- policy loader/validator and deny-by-default authorization;
- read-only repository adapter;
- path allowlist and denied-root/sensitive-name boundary;
- bounded secret/local-path redaction;
- bounded append-only audit record writer with hash metadata;
- gate evaluator with explicit `PASS`, `FAIL`, and `BLOCKED` states;
- closed tool registry containing only read-only control-plane tools;
- machine-readable readiness CLI and tests.

The execution plane and runtime/application integration remain intentionally unimplemented. No implementation may infer authority from the existence of these modules.

## 10. Current decision

`AUTO_FIX_MASTER_SPECIFICATION` remains the implementation baseline and does not enable Auto-Fix. The Git remote/branch/baseline registered in `config/canonical-source.json` is accepted as canonical Electron source; the packaged `resources/app` directory is not. M1 readiness remains `BLOCKED` pending CI, protected branches, provenance, security, signing, and release-governance evidence. All runtime and change authorities remain disabled.
