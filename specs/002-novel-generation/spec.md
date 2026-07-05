# Feature Specification: Novel Generation Engine

## 1. Feature Name
002-novel-generation

## 2. Overview
The Novel Generation Engine is the core writing mechanism of the application. It utilizes a sophisticated prompt structure combined with state-of-the-art AI to generate detailed, multi-sensory scenes for a post-apocalyptic narrative. It includes a Typing Effect feature to render text organically and a Zero-Legacy validation layer.

## 3. User Stories
- As a writer, I want to write the next part of the chapter without losing the context of previous chapters (using short-term and long-term memory).
- As a writer, I want to force the AI to not skip time or summarize, so the scene remains detailed and highly sensory (Real-Time Pacing).
- As a writer, I want to rewrite the entire chapter if the generated content is unsatisfactory, by passing an `overwrite` parameter.
- As a writer, I want the generated text to stream character by character to create an immersive typing effect.

## 4. Acceptance Criteria
- [x] Must support multi-layer memory: Lorebook (Layer 1), Scrolling Summary (Layer 2), Short-term Memory (Layer 3).
- [x] Must use `.normalize('NFC')` to preserve Vietnamese unicode diacritics during the typing effect.
- [x] Must parse generated scenes to assign scene tags like `c1-01`, `c1-02` dynamically.
- [x] Must prevent "Time Skips" by strictly instructing the AI via system prompts.
