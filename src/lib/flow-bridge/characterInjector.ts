/**
 * Automatic Character R2V Prompt & Reference Injector for AI Novel.
 * Exact reference implementation from SuperAutoTools.
 *
 * Scans scenario prompts for character keywords (e.g. "Phoma", "Hero", "Nam chính"),
 * automatically matching registered character profiles and injecting their
 * reference media IDs into R2V Veo 3.1 payloads with `CHARACTER_REFERENCE` image usage types.
 */

export interface CharacterProfile {
  id: string;
  name: string;
  keywords: string[];
  referenceMediaIds: string[];
}

export interface InjectionResult {
  prompt: string;
  injectedMediaIds: string[];
  detectedCharacters: string[];
}

export class CharacterInjector {
  private catalog: Map<string, CharacterProfile> = new Map();

  registerCharacter(profile: CharacterProfile) {
    this.catalog.set(profile.id, profile);
  }

  injectForPrompt(prompt: string, existingMediaIds: string[] = []): InjectionResult {
    const textLower = prompt.toLowerCase();
    const detectedCharacters: string[] = [];
    const newMediaIds = [...existingMediaIds];

    for (const profile of this.catalog.values()) {
      const match = profile.keywords.some((kw) => textLower.includes(kw.toLowerCase()));
      if (match) {
        detectedCharacters.push(profile.name);
        for (const mid of profile.referenceMediaIds) {
          if (!newMediaIds.includes(mid)) {
            newMediaIds.push(mid);
          }
        }
      }
    }

    return {
      prompt,
      injectedMediaIds: newMediaIds,
      detectedCharacters,
    };
  }
}

export const characterInjector = new CharacterInjector();
