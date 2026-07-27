/**
 * Character DNA & Identity Lock 2.0.
 * Generates multi-angle pose sheet prompts (Front, 45-deg, Side profile, Expressive)
 * and builds strict face anchor prompts for visual consistency across scenes.
 */

export interface CharacterPoseSheet {
  characterName: string;
  archetype: string;
  faceAnchorPrompt: string;
  angles: {
    frontView: string;
    threeQuarterView: string;
    sideProfileView: string;
    expressiveActionView: string;
  };
}

export function buildCharacterFaceAnchor(
  characterName: string,
  visualFeatures: string,
  archetype?: string,
): string {
  const name = String(characterName || '').trim();
  const features = String(visualFeatures || '').trim();
  const arch = String(archetype || 'Central Character').trim();

  return `[CHARACTER IDENTITY LOCK 2.0: "${name}"] (Archetype: ${arch}). Distinct facial features & clothing anchor: ${features}. Must strictly preserve face geometry, hair texture, eye color, and costume details across all generated frames and angles.`.trim();
}

export function generatePoseSheetPrompts(
  characterName: string,
  visualFeatures: string,
  archetype = 'Protagonist',
): CharacterPoseSheet {
  const name = String(characterName || 'Hero').trim();
  const features = String(visualFeatures || 'Sharp facial features, signature outfit, distinct hairstyle').trim();
  const faceAnchor = buildCharacterFaceAnchor(name, features, archetype);

  const baseStyle = `Cinematic character sheet, 8k resolution, highly detailed, photorealistic lighting, consistent identity of ${name}`;

  return {
    characterName: name,
    archetype,
    faceAnchorPrompt: faceAnchor,
    angles: {
      frontView: `${baseStyle}, Full Frontal View portrait of ${name}, looking directly at camera. Features: ${features}. Neutral expression, Studio lighting.`,
      threeQuarterView: `${baseStyle}, 45-degree Three-Quarter Angle portrait of ${name}. Features: ${features}. Dynamic slight smile, soft directional key light.`,
      sideProfileView: `${baseStyle}, 90-degree Side Profile view portrait of ${name}. Features: ${features}. Crisp jawline profile, rim light background.`,
      expressiveActionView: `${baseStyle}, Dramatic Expressive Action Shot of ${name} in intense emotional moment. Features: ${features}. Dynamic cinematic lighting.`,
    },
  };
}
