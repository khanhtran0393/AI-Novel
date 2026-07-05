# Feature Specification: Core Workspace

## 1. Feature Name
001-core-workspace

## 2. Overview
The Core Workspace is the primary user interface and global state management hub of the AI Novel & Script Generator. It provides a split-view (3:7 ratio) environment where writers can manage their story outline, character profiles, and the main writing canvas simultaneously without losing context.

## 3. User Stories
- As a writer, I want a split-screen workspace so I can view my character profiles while reading the generated novel.
- As a writer, I want my progress (chapters, outlines, API keys) saved locally so I don't lose them when refreshing the browser.
- As a writer, I want to easily navigate between chapters using a sticky navigation bar so I don't have to scroll up endlessly.
- As a writer, I want a visual progress bar (Word-Gate) to track my current word count against my target goal.

## 4. Acceptance Criteria
- [x] The UI MUST be divided into a 3:7 ratio.
- [x] The left sidebar MUST contain collapsible accordions for Lorebook, Outline, and Characters.
- [x] Global state MUST use Zustand with `persist` middleware.
- [x] The application MUST check for `isHydrated` before rendering state-dependent components to avoid Next.js hydration errors.
- [x] A sticky header must be visible at the top, allowing for quick chapter jumping and exporting.
