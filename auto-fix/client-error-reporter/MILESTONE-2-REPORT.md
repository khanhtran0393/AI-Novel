# Milestone 2 — Client Error Reporter

STATUS: PASS

## Scope

Implements the client-side error reporting layer from the master specification
(section 6, 7, 8, 28) as a **standalone, disconnected module**. It is not yet
wired into the packaged Electron application: `electron-builder.json` ships only
`nova/**/*`, M1 remains BLOCKED, and the repo operating rules forbid modifying
the running app merely to enable Auto-Fix. Production wiring is deferred to a
later milestone that passes the integration and security gates.

## Components

| File | Responsibility |
|------|----------------|
| `sanitizer.js` | Privacy sanitization on top of `auto-fix/redaction.js`: JWT/AWS/GitHub/Slack token patterns, bearer/basic credential redaction, local-path normalization. |
| `event-buffer.js` | Bounded in-memory event ring buffer with sequence ids and copy-on-snapshot. |
| `fingerprint.js` | Stable technical fingerprint: exception type + normalized message + normalized stack frames + originating module (SHA-256, 32 hex chars). Volatile tokens (hex addresses, numbers, paths, emails) are normalized away so many reports collapse to one fingerprint. |
| `environment.js` | Environment fingerprint: platform, OS build, arch, runtime versions, configuration hash. Locale/timezone identifiers are intentionally NOT collected (only numeric UTC offset). |
| `queue.js` | Persistent local JSON-array queue for offline reporting, with in-window dedup per fingerprint, max-size trimming, and per-fingerprint rate limiting. |
| `uploader.js` | HTTPS JSON POST transport (http supported for tests) with retry and exponential backoff. |
| `reporter.js` | Orchestrator: `recordEvent`, `captureException`, `report` (never throws), `flush`, and injectable global handlers (`uncaughtException`/`unhandledRejection`). |

## Verification

All tests are `assert`-based Node scripts following the repo convention
(`... tests: passed`, non-zero exit code on failure).

```
sanitizer tests: passed
event-buffer tests: passed
fingerprint tests: passed
environment tests: passed
queue tests: passed
uploader tests: passed
reporter tests: passed
```

Run with:

```powershell
node auto-fix/client-error-reporter/test/sanitizer.test.js
node auto-fix/client-error-reporter/test/event-buffer.test.js
node auto-fix/client-error-reporter/test/fingerprint.test.js
node auto-fix/client-error-reporter/test/environment.test.js
node auto-fix/client-error-reporter/test/queue.test.js
node auto-fix/client-error-reporter/test/uploader.test.js
node auto-fix/client-error-reporter/test/reporter.test.js
```

or

```powershell
npm --prefix auto-fix/client-error-reporter test
```

All modules also pass `node --check` syntax validation.

## Security notes

- No passwords, tokens, cookies, private keys, or arbitrary filesystem contents
  are collected; explicit redaction is applied before any data enters the event
  buffer or report.
- The reporter never crashes the host application: `report()` swallows its own
  failures and the uploader runs as a background promise.
- No new npm dependencies; only Node built-ins and the existing control-plane
  `redaction.js` are used. This keeps the supply chain unchanged.
- The module exposes no upload endpoint by default; an endpoint must be
  injected (`endpoint` or `transport` option), and no secrets are embedded.

## Known limitations

- Not integrated into `nova/main.plain.js`; a real packaged client would need a
  gated wiring step, an upload endpoint, and an installation id source.
- Fingerprint stability is heuristic and should be reconciled with the
  server-side fingerprinter in Milestone 4.
- The local queue file path defaults to `process.cwd()`; a production wiring
  must pass an explicit path under Electron's `userData`.

## Next milestone

MILESTONE 3 — CRASH SERVER (API, database, crash ingestion, authentication,
rate limiting, deduplication).