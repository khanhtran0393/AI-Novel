# Canonical Branch Protection Runbook

**Configuration status: NOT YET CONFIRMED ON GITHUB**

Apply an active GitHub ruleset to `nova-logic`. Repository files can document the required settings, but only a repository administrator can enforce and verify them.

## Required rules

- Block branch deletion and force pushes.
- Require changes through pull requests with at least one approval.
- Dismiss stale approvals and require review from Code Owners.
- Require all conversations to be resolved.
- Require the branch to be up to date before merge.
- Require these status checks exactly:
  - `M1 Validation / m1-validation`
  - `Windows Package / windows-package`
- Require signed commits or a reviewed equivalent source-provenance control.
- Do not grant routine bypass permission; any emergency bypass must be owner-approved and recorded.

The conditional `Windows Package / windows-attestation` job is intentionally not a pull-request required check. It runs only after a commit reaches `nova-logic`, where GitHub can issue signed artifact provenance without exposing an OIDC-capable job to untrusted pull-request code.

## Verification evidence

Record the ruleset URL or exported ruleset JSON, enforcement state, target branch, required-check names, approver, and verification date in `auto-fix/M1-READINESS-REPORT.md`. Until that evidence exists, the `branchProtection` and `sourceProvenance` readiness gates remain `BLOCKED`.
