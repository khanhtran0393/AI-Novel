import { NextResponse } from 'next/server';
import {
  buildContinueContext,
  evaluateWordGate,
  formatCharacterBible,
  formatSpentEntities,
  formatWorldState,
  normalizeSceneTags,
  truncateOutline,
  DEFAULT_WORD_GOAL,
  MIN_SCENE_COUNT,
} from '@/lib/storyWriting';
import {
  buildHumanizeScriptBlock,
  buildNarrativePsychBlock,
  buildShotDiversityBlock,
  buildSpeechFingerprintBlock,
  buildAudioReadabilityBlock,
  enforceShotGraphOnPrompts,
  resolveUserRules,
  scoreNarrativePsychScript,
  injectHumanJokeAsides,
  countHumanJokeAsides,
} from '@/lib/youtubeSafe';
import {
  applyCharacterSheetFormulas,
  applyDirectorFormulasToPromptPair,
  compileStillImagePrompt,
} from '@/lib/integrations/seedance';
import {
  CHAR_ANGLE_CAMERA,
  CHAR_EMOTION_FACE,
} from '@/lib/characterProfile';
import {
  callActiveModel,
  callActiveVision,
  cleanAndParseJson,
  generateJsonWithRetry,
  getLastWorkingApiKey,
} from '../modelClients';
import type { GenerateHandlerContext } from './types';

/**
 * Owner: generate/visualDna.ts
 * Only handles requestTypes assigned in contracts/apiMap GENERATE_REQUEST_OWNERS → visualDna
 */
export async function handleVisualDna(
  ctx: GenerateHandlerContext,
  requestType: string,
): Promise<NextResponse | null> {
  const { payload, keysToUse, model } = ctx;

  if (requestType === 'ANALYZE_VISUAL_DNA') {
    const images = Array.isArray(payload?.images) ? payload.images : [];
    const mode = String(payload?.mode || '').trim().toLowerCase();
    const isThumbCompetitor =
      mode === 'thumb_competitor' || mode === 'competitor_thumb' || mode === 'youtube_thumb';

    if (isThumbCompetitor) {
      // Single (or few) competitor YouTube thumbnail(s) → dense layout/style DNA
      if (images.length < 1 || images.length > 3) {
        return NextResponse.json(
          { error: 'Thumb DNA doi thu: can 1-3 anh thumbnail de phan tich.' },
          { status: 400 },
        );
      }

      const visionPrompt = `
You are a ruthless YouTube thumbnail art director reverse-engineering a competitor thumbnail's visual DNA.

Return ONLY one dense English visual-DNA fragment (120-200 words), no markdown, no bullets, no labels.
This fragment will be injected into a NEW thumbnail generation prompt so the new image mimics the competitor DNA EXACTLY while the SUBJECT/STORY content comes from a separate content prompt.

Extract and preserve every thumbnail-winning signal:
- overall composition grid, subject placement, rule-of-thirds or center-punch, negative space reserved for bold overlay text
- face crop ratio (how much of frame is face), eye line, expression intensity, micro-gesture
- color block strategy (high-contrast splits, neon accents, desaturated vs saturated zones)
- lighting recipe (rim, key direction, neon spill, under-light, high-key vs low-key)
- grade / LUT feel, contrast curve, skin treatment, edge clarity
- background treatment (bokeh, ruin haze, solid color punch, motion blur edges)
- prop scale, object urgency cues, depth layering, vignette or border habits
- CTR micro-patterns: partial reveal, off-frame gaze, threat shadow, paradox pairing
- avoid-list: what would break this DNA (generic stock look, cluttered UI chrome, weak face, muddy midtones)

Do NOT describe the story subject of the uploaded thumbnail as content to copy.
Do NOT invent character names or plot.
Do NOT include generic quality spam (8k, masterpiece, Unreal Engine).
Write as a reusable style/layout lock fragment only.
`;

      const aiResponse = await callActiveVision(visionPrompt, images, keysToUse, model);
      const visualDnaPrompt = aiResponse.replace(/```[\s\S]*?```/g, '').trim();
      return NextResponse.json({
        visualDnaPrompt,
        mode: 'thumb_competitor',
        usedApiKey: getLastWorkingApiKey(),
      });
    }

    if (images.length < 4 || images.length > 6) {
      return NextResponse.json({ error: 'Can 4-6 anh tham chieu de phan tich DNA thi giac.' }, { status: 400 });
    }

    const visionPrompt = `
  You are a strict senior art director extracting a reusable visual DNA from 4-6 reference images.

  Return only one dense English visual style prompt, no markdown, no bullet list, no labels.
  Write 150-230 words as one practical prompt fragment that can be prepended to image and video prompts.

  Preserve every visible style signal from the references. Cover all of these if present:
  - visual genre, medium, and rendering language
  - character design grammar, face/body treatment,wardrobe, material details, and pose energy
  - color palette, contrast, saturation, skin tone handling, and accent colors
  - lighting direction, softness, shadow behavior, reflections, glow, weather or atmosphere
  - camera distance, lens feeling, framing, angle, depth layering, and composition habits
  - environment/background treatment, props, architecture, texture language, surface wear, and scale
  - mood, emotion, pacing, cinematic rhythm, and the kind of realism or stylization used
  - avoid-list phrased naturally: what the generated image should not drift into

  Do not mention the uploaded images directly. Do not include generic quality tags such as 8k, highly detailed, photorealistic, Unreal Engine, masterpiece.
  Do not summarize into a short tag cluster. The output must be complete enough for a downstream image prompt to inherit the full visual identity without seeing the references.
  `;

    const aiResponse = await callActiveVision(visionPrompt, images, keysToUse, model);
    const visualDnaPrompt = aiResponse.replace(/```[\s\S]*?```/g, '').trim();
    return NextResponse.json({ visualDnaPrompt, usedApiKey: getLastWorkingApiKey() });
  }

  // --- NODE 0: GENERATE_IDEA ---

  return null;
}
