# Implementation Plan: Automations & Headless Engine

## 1. Architecture Map
- **Image Automations:** `src/app/workspace/modules/imageModule.ts` and background worker scripts.
  - Implements the Puppeteer Stealth scripts.
  - Orchestrates concurrent fetches and cookie rotation (`promptIndex % cookies.length`).
- **TTS Automations:** `src/app/workspace/modules/ttsModule.ts`
  - Interfaces with various TTS APIs (Edge TTS, etc.).
  - Saves returned audio blobs to the `Cache Storage API`.
- **System Integrations:** `src/app/workspace/modules/folderModule.ts`
  - Utilizes Node.js `child_process` and `fs` to interact with Windows Explorer.

## 2. Technical Decisions
- **Puppeteer Profile Management:** Since multiple concurrent browsers can consume massive amounts of disk space and RAM, each worker will create a temporary profile named after the Scene ID. In the `finally` block of the execution Promise, the directory must be aggressively wiped.
- **Next.js Webpack Exclusions:** Turbopack/Webpack cannot bundle native Node extensions easily. We must add `puppeteer`, `puppeteer-core`, `puppeteer-extra`, and `puppeteer-extra-plugin-stealth` to the `serverExternalPackages` config in `next.config.ts`.
- **TTS Hashing:** TTS requests are hashed. If a hash exists in the Cache API, a local Blob URL is returned instead of triggering a network request.

## 3. Fallback Strategies
- If `explorer.exe` fails (e.g. running on Linux or Vercel), the folder opener gracefully falls back to opening the configured Google Drive URL in a new tab.
