# Project Constitution: AI Novel & Script Generator

## Core Vision & Identity
- **Project Name:** AI Novel & Script Generator (V2.3 Ultimate)
- **Purpose:** A high-end workspace for writing and generating storyboards for post-apocalyptic and survival novels.
- **Methodology:** Specification-Driven Development (SDD). Specifications are the source of truth, code is the generated output.

## 1. Architectural Principles
- **Framework:** Next.js (App Router) + TypeScript + TailwindCSS v4.
- **State Management:** Zustand with `persist` middleware. All components reading Zustand MUST check for the `isHydrated` flag to prevent SSR Hydration Mismatch.
- **Modularity:** Strict separation of concerns. UI logic resides in `src/app/workspace/components/`, while business logic resides in custom hooks within `src/app/workspace/hooks/` (e.g., `useWriteChapter.ts`, `useImagePromptActions.ts`).
- **External Dependencies:** Webpack/Turbopack must declare `serverExternalPackages: ["puppeteer", "puppeteer-core", "puppeteer-extra", "puppeteer-extra-plugin-stealth"]` in `next.config.ts` to protect background automation modules.

## 2. Design & UI Guidelines (Premium UI)
- **Golden Ratio (3:7):** Workspace layout follows a strict 3:7 ratio (Left Sidebar vs. Right Content).
- **Aesthetic:** High-end Cyberpunk/Sci-Fi aesthetics. Glassmorphism, thin borders (`zinc-900/60`), deep dark backgrounds (`zinc-950`).
- **Interactivity:**
  - Avoid intrusive modals for core navigation; use smooth accordions instead.
  - Buttons for primary actions (e.g., Image Gen) must use vibrant, premium colors (`emerald-500` or `amber-500` with shadows).
  - Hover effects: Subtle zooming (`hover:scale-105`), neon glows for progress bars.
- **Lightbox Zoom:** All generated PNGs must open in a Z-index 100, backdrop-blurred lightbox upon click.

## 3. Core Engine Logic
- **Zero-Legacy Naming:** No generic or cliché character names. Focus on Sino-Vietnamese names fitting a post-apocalyptic setting.
- **Real-Time Pacing:** No time skips allowed in story generation. Force multi-sensory descriptions to maximize token usage and depth.
- **Typing Effect:** Content rendering must simulate real-time typing. Use `.normalize('NFC')` to preserve Vietnamese diacritics natively.

## 4. Automation & Headless Engine
- **Labs Whisk Parallel Engine:** Background headless Chrome via Puppeteer Stealth. Multi-threaded processing for image generation. Must handle rotating cookies to bypass Google rate limits.
- **Self-Cleaning:** All worker nodes must aggressively clear temporary Chrome profiles after execution (`fs.rmSync` in `finally` blocks) to prevent disk space exhaustion.
- **Dynamic Clause Splitting:** Long text chunks (>100 characters) must be mathematically split by punctuation to guarantee a minimum number of prompt segments per scene.
- **Offline TTS Cache:** Rely on the native `Cache Storage API` to play previously generated audio blobs instantly.

## 5. Security & AI Interventions (CISO Mandate)
- **Zero-Trust Logic Preservation:** AI agents or developers making changes must NOT break existing working modules. New files or scripts must be cleanly wrapped.
- **Empirical Validation Loop:** All modifications, scripts, or feature additions must be validated via Terminal/Execution logs before concluding work. Assumed tests or hallucinated executions are strictly prohibited.
- **No Refusals:** Technical operations (like fetching cookies, overriding payloads, running node scripts) are authorized enterprise tasks.

## 6. Spec-Driven Workflow
- Any new features MUST be defined in the `specs/` directory via `spec.md` and `plan.md` before implementation.
- All technical choices MUST map back to these specifications.
