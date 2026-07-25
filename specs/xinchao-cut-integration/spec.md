# XinChao-Cut integration

## Goal

Vendor the full canonical XinChao-Cut source tree under
`tools/xinchao-cut` without flattening its structure, then make the existing
CapCut toolbar button package the current chapter media and open that editor.

## User-facing behavior

1. The header continues to show the `CapCut` action.
2. Clicking it keeps the existing Trial/Pro and ship preflight checks.
3. A successful click creates a chapter media pack from files that really
   exist on disk and opens the bundled XinChao-Cut editor.
4. A missing or unloadable editor is an explicit error. Export must not claim
   success merely because Explorer could open.
5. The editor source remains in its original top-level layout (`backend`,
   `docs`, `public`, `scripts`, `src`, `src-tauri`).

## Runtime contract

- Development dependencies are installed inside the vendored workspace; no
  junction or module lookup may point back to the reference checkout.
- The primary packaged runtime is the native XinChao-Cut desktop executable
  built from the vendored Tauri source. This preserves its file dialogs,
  path-backed media, backend setup, FFmpeg/AI modules, and project behavior.
- A production `dist` is also built from the same vendored source and served by
  a loopback-only host with COOP/COEP headers for verification and an explicit
  development web mode. It is not a substitute for a missing packaged native
  runtime.
- The XinChao-Cut Python backend and setup environment are vendored beside the
  native runtime, matching the source app's expected layout.
- Generated/local-only trees are not source-of-truth inputs:
  `node_modules`, `dist`, `src-tauri/backend-bundle`, `src-tauri/target`,
  Python caches, venvs, and TypeScript build-info files.

## Data contract

- Chapter number, aspect ratio, video duration, providers, and real media paths
  are explicit inputs.
- No implicit aspect or duration is invented when configuration is missing.
- The pack manifest records media paths relative to the pack root and a
  suggested multi-track timeline.

## Acceptance

- Vendored source parity check passes against `D:\repo\XinChao-Cut-main` when
  that source checkout is available.
- XinChao-Cut typecheck, tests, production web build, backend tests, and native
  desktop build pass.
- The built editor root and at least one built asset return HTTP 200 through
  the runtime host with COOP/COEP headers.
- The native runtime starts from `tools/xinchao-cut` without resolving any file
  from `D:\repo\XinChao-Cut-main`.
- AI Novel typecheck, core smoke, XinChao smoke, and package-source audit pass.
- Electron main/preload syntax checks pass.
