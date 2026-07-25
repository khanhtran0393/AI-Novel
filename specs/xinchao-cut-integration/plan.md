# Implementation plan

1. Add a source-parity verifier with explicit generated/local exclusions.
2. Replace the external `node_modules` junction with a local lockfile install.
3. Add a small Electron runtime host for verifying the built XinChao-Cut SPA.
4. Add deterministic web/native build commands and include the native
   executable, backend tree, and `dist` in the Electron package.
5. Connect the existing CapCut IPC path to the native vendored runtime and fail
   explicitly when the editor cannot open.
6. Remove implicit aspect/duration defaults from the CapCut export seam.
7. Update workspace/domain/packaging documentation.
8. Run the runtime host smoke, editor tests/build, AI Novel domain gates, and an
   independent review.
