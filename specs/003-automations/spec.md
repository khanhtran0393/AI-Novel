# Feature Specification: Automations & Headless Engine

## 1. Feature Name
003-automations

## 2. Overview
The Automations & Headless Engine handles all background processing tasks required for the AI Novel & Script Generator. This includes parallel image generation using headless browsers, Text-to-Speech (TTS) synthesis and caching, and OS-level integrations for file management.

## 3. User Stories
- As a creator, I want to generate dozens of images simultaneously without freezing the UI.
- As a power user, I want the system to automatically rotate my Google cookies so my image generations are not rate-limited.
- As a user, I want to listen to TTS previews instantly if I have generated them before, saving bandwidth and time.
- As a desktop user, I want to click a button to instantly open the physical folder where my assets (audio/video/images) are saved.

## 4. Acceptance Criteria
- [x] Must implement a parallel worker system (Labs Whisk Parallel Engine) using `puppeteer-extra-plugin-stealth`.
- [x] Must automatically rotate Google Studio cookies if multiple are provided.
- [x] Must guarantee absolute cleanup of temporary Chrome profile directories (`fs.rmSync`) regardless of success or failure.
- [x] Must utilize the browser's native `Cache Storage API` for zero-latency offline TTS playback.
- [x] Must support spawning `child_process` to call `explorer.exe` for local folder navigation (fallback to Google Drive web UI if on a remote server).
