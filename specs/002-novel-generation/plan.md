# Implementation Plan: Novel Generation Engine

## 1. Architecture Map
- **Hook:** `src/app/workspace/hooks/useWriteChapter.ts`
  - Manages `streamText` and `isStreaming` state.
  - Implements `handleWriteChapter(overwrite: boolean)`
  - Runs a `setInterval` loop for Typing Effect.
- **Module API:** `src/app/workspace/modules/writeModule.ts`
  - Dispatches calls to `writeChapterAction`.
  - Injects `useMock` data if requested, or hits the real Gemini API.
- **Component:** `src/app/workspace/components/SceneCard.tsx`
  - Renders individual scenes generated from the parsed text.
  - Generates tags formatted as `cX-YY`.

## 2. Data Flow
1. User clicks "Viết tiếp" or "Viết lại".
2. `useWriteChapter` calls `writeModule` passing all 3 layers of memory.
3. API returns raw text.
4. `useWriteChapter` simulates typing effect by stepping through the string index.
5. `SceneCard` maps the text via `parseScenes` helper function to render distinct blocks.

## 3. Implementation Details
- The typing effect speed is 15ms per 10 characters (non-mock) or 25ms per 6 characters (mock) to simulate fast but readable generation.
- The `baseContent` is either appended to or replaced entirely based on the `overwrite` boolean.
