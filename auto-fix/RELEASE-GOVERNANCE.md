# Signing, Release, Rollout, and Rollback Governance

**Status: BLOCKED — process defined; infrastructure and approvals not yet evidenced.**

This document defines controls required before a Nova Studio artifact can be signed or released. It does not grant Auto-Fix or GitHub Actions signing, publishing, release, rollout, or rollback authority.

## Separation of authority

- Pull-request CI may install, test, audit, and produce an unsigned unpacked artifact only.
- CI explicitly uses `--publish never` and disables code-sign identity auto-discovery.
- Build provenance may be generated after merge to `nova-logic`; provenance is not a release approval or code-signature.
- Production code-sign credentials must be held by an isolated signing service or protected environment, never by Auto-Fix, repository files, pull-request jobs, or general runners.
- A named human release owner must approve every signing and release operation.

## Required release evidence

Before release, record and independently verify:

1. reviewed source commit/tag and successful required checks;
2. dependency audit and completed subsystem security review;
3. reproducible build metadata, artifact hashes, and GitHub/Sigstore provenance;
4. code-sign certificate identity, timestamp verification, and key-custody control;
5. clean-machine install, launch, smoke, updater, and rollback tests;
6. release notes, compatibility/known-risk assessment, and human approvals.

## Rollout policy

- Start with an internal cohort, then a bounded canary cohort.
- Define health metrics and stop thresholds before rollout.
- Require an explicit human decision between stages; never promote solely because time elapsed.
- Keep publishing credentials and updater controls outside Auto-Fix.

## Rollback policy

- Preserve the last verified stable installer, hashes, signatures, and provenance.
- Define a tested rollback or forward-fix path before canary rollout.
- Trigger the kill switch on signature/provenance failure, crash regression, install/update failure, security incident, or health-threshold breach.
- Record initiator, reason, affected versions/cohorts, timestamps, and post-rollback validation.

The `signingSetup` and `releaseGovernance` readiness gates remain `BLOCKED` until controlled infrastructure, protected environment approvals, named owners, and test evidence are recorded in `M1-READINESS-REPORT.md`.
