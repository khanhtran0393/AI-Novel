# M1 Security Review Plan and Evidence Register

**Status: INCOMPLETE / BLOCKED**

Dependency audit remediation is complete for the known `js-yaml` advisory, but a dependency scan is not a substitute for subsystem review. Each item below requires a named reviewer, date, commit SHA, findings, remediation disposition, and evidence link before `securityReview` can pass.

## Required review boundaries

| Boundary | Required evidence | State |
|---|---|---|
| Electron main/preload/renderer | Context isolation, sandbox/navigation/window-open policy, exposed preload surface, IPC sender/origin validation, channel authorization, input validation | BLOCKED |
| Updater and installer | Feed configuration, TLS/trust boundary, signature verification, downgrade/replay behavior, publish defaults, update and rollback tests | BLOCKED |
| Credentials, cookies, tokens, sessions | Storage location, encryption/access control, logging/redaction, lifecycle/deletion, renderer exposure, migration boundary | BLOCKED |
| Native processes | Executable allowlist, argument construction, shell usage, path validation, timeout/resource controls, inherited environment, output limits | BLOCKED |
| Chrome/CDP and MCP | Authentication, bind address, port isolation, origin/client authorization, tool schemas, filesystem/network scope, secret handling | BLOCKED |
| Dependencies and build chain | `npm ci`, production audit, Dependabot triage, pinned CI actions, build-input review, provenance verification | PARTIAL |

## Review method

1. Review the exact canonical commit in a clean checkout.
2. Inventory entry points and trust transitions before judging individual functions.
3. Record exploitable findings separately from hardening recommendations.
4. Require regression tests for remediated findings where practical.
5. Re-run syntax, IPC, parity, foundation, control-plane, audit, and package gates.
6. Obtain repository-owner/human security approval for every high-risk boundary.

No checklist entry may be inferred as complete from the presence of this document or a green CI run. Until all boundaries have evidence and approval, `securityReview` remains `BLOCKED` and all Auto-Fix authorities remain disabled.
