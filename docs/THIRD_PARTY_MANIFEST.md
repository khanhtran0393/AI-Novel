# Third-party release manifest

This is the release gate for assets in the public commercial installer. An optional component marked `NOT PACKAGED` stays in the development workspace only and must not be copied into a customer build until its exact redistribution evidence is complete.

| Component | Bundled path | License / source status | Release status | Required action |
|---|---|---|---|---|
| Electron / Chromium | `node_modules/electron` | License texts supplied by the Electron distribution | READY | Package audit requires generated `LICENSES.chromium.html` and `LICENSE.electron.txt` beside the executable. |
| Next.js / React and npm runtime packages | `node_modules` / app ASAR | Version, integrity, source metadata and license are archived in `NPM_DEPENDENCY_NOTICE.json` | READY | Regenerate with `npm run commercial:notices` for every release; ship and audit the resulting notice. |
| FableCut | `vendor/FableCut` | MIT license in `vendor/FableCut/LICENSE`; Google Fonts families are listed with source pages, OFL 1.1, and exact shipped SHA-256 | READY | Keep `LICENSE`, `library/fonts/LICENSES.md`, `library/fonts/OFL.txt`, and `library/fonts/SHA256SUMS.txt` with the bundled copy. |
| FFmpeg custom binary | development-only `bin/ffmpeg.exe` / `python_core/ffmpeg` | Exact corresponding source/build record for the local binary is not archived | NOT PACKAGED | Public builds exclude both locations. Reintroduce only with exact source, configure flags, patches/build script, GPL/LGPL notices, and source-offer location. |
| Piper / eSpeak NG runtime | development-only `bin/piper` | Exact binary/model provenance and complete applicable license bundle are incomplete | NOT PACKAGED | Public builds exclude `bin`. Distribute separately only after recording exact versions and all applicable MIT/GPL/model notices. |
| Vina Voice ONNX model | development-only `src/python_core/models/vina_voice/*.onnx` | Ownership, training-data rights, redistribution license, and checksum provenance are not documented | NOT PACKAGED | The locked model directory and loader code remain, but public builds exclude ONNX weights. Obtain written commercial redistribution rights before bundling them. |
| Voice reference audio | development-only `python_core/assets` | Speaker consent and commercial redistribution provenance are not documented | NOT PACKAGED | Public builds exclude the whole directory. |
| MediaCrawler | development-only `python_core/MediaCrawler` | Repository license is non-commercial learning-only unless separate written authorization is obtained | NOT PACKAGED | Public builds exclude the whole directory. Obtain written commercial authorization before distribution. |
| Root font binaries | development-only `fonts` | Exact local binaries do not match the verified upstream Anton/Bangers files; SFU Futura provenance is not documented | NOT PACKAGED | Public builds exclude the whole directory. Replace with exact verified font files and matching license texts before bundling. |
| Flow browser extension | `extensions/ainovel-flow` | First-party code; target services remain subject to their own terms | READY-WITH-DISCLOSURE | Ship `LEGAL_FLOW_DISCLAIMER.md` and require users to use authorized accounts. |
| CapCut interoperability adapter | `capcut_api` | First-party adapter from project-owned source at commit `b19cc2afd71c9c92e0906f654d648b7b792d99d4`; provenance source in `capcut_provenance.json`; proprietary `LICENSE` and `NOTICE.md`; exact build output recorded in `capcut_runtime_manifest.json` | READY-WITH-DISCLOSURE | Package only adapter source and locally compiled `cronet_helper.dll`. Never package CapCut/Jianying, `sscronet.dll`, accounts, cookies, or voices. Customer installs CapCut and accepts its terms. |

## Release rule

The strict release check fails while any shipped row is marked `BLOCKED`. It also verifies that every `NOT PACKAGED` resource path is absent from the artifact. Evidence must be tied to the exact shipped SHA-256, not only to a similarly named upstream project.
