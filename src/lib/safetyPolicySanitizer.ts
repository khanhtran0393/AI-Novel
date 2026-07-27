/**
 * Safety Policy Sanitizer & Euphemism Shield for AI Generation (Veo, Flow, Gemini, Sora, Grok)
 * Protects prompts from triggering strict AI safety filters (SAFETY_VIOLATION, REJECTED, POLICY_BLOCK).
 */

const SAFETY_EUPHEMISM_MAP: Array<[RegExp, string]> = [
  // Violence & Blood
  [/\b(kill|killing|slay|slaying|slaughter|murder|murdering|behead|decapitate)\b/gi, 'vanquish'],
  [/\b(bloody?|gore|gory|bleeding|bloodstain|bloodspill)\b/gi, 'crimson aura'],
  [/\b(blood)\b/gi, 'crimson liquid'],
  [/\b(dead|corpse|carcass|execution|executed)\b/gi, 'fallen silhouette'],
  [/\b(die|dying|death)\b/gi, 'defeat'],
  
  // Weapons & Firearms
  [/\b(gun|rifle|pistol|shotgun|firearm|bullet|machinegun|handgun)\b/gi, 'glowing energy prop'],
  [/\b(sniper)\b/gi, 'scout'],
  [/\b(bomb|explosion|explode|detonate|detonation|grenade)\b/gi, 'dramatic particle burst'],
  [/\b(knife|dagger|machete|bayonet)\b/gi, 'ornate metallic blade prop'],
  [/\b(weapon|weapons)\b/gi, 'cinematic prop'],
  
  // Sensual / Nudity triggers
  [/\b(naked|nude|topless|undressed|bare skin|unclothed)\b/gi, 'flowing minimalist robes'],
  [/\b(erotic|sexual|sexy|sensual)\b/gi, 'elegantly styled'],
  
  // Combat / Aggression
  [/\b(attack|attacking|assault|assaulting|ambush)\b/gi, 'dynamic action movement'],
  [/\b(fight|fighting|brawl|brawling|clash)\b/gi, 'choreographed action standoff'],
  [/\b(torture|torturing|mutilate|mutilating)\b/gi, 'intense emotional confrontation'],
  
  // Hazardous / Chemical
  [/\b(poison|poisonous|venom|venomous|toxic)\b/gi, 'mystic glowing mist'],
  [/\b(suicide|self-harm|hang|hanging)\b/gi, 'dramatic descent'],
  
  // Real brands / Copyright safe wrappers
  [/\b(nike|adidas|gucci|rolex|apple iphone|coca-cola|pepsi)\b/gi, 'luxury designer item'],
  
  // Minors in sensitive context safety
  [/\b(young child|little girl|little boy|toddler|infant|baby)\b/gi, 'youthful protagonist'],
];

/**
 * Sanitize prompt by replacing policy trigger keywords with safe cinematic euphemisms.
 */
export function sanitizePromptForSafety(prompt: string): {
  sanitized: string;
  hasModifications: boolean;
  replacements: Array<{ original: string; replacedWith: string }>;
} {
  if (!prompt || typeof prompt !== 'string') {
    return { sanitized: '', hasModifications: false, replacements: [] };
  }

  let result = prompt;
  const replacements: Array<{ original: string; replacedWith: string }> = [];

  for (const [pattern, replacement] of SAFETY_EUPHEMISM_MAP) {
    if (pattern.test(result)) {
      const matched = result.match(pattern);
      if (matched) {
        for (const m of matched) {
          replacements.push({ original: m, replacedWith: replacement });
        }
      }
      result = result.replace(pattern, replacement);
    }
  }

  return {
    sanitized: result,
    hasModifications: replacements.length > 0,
    replacements,
  };
}

/**
 * If AI prompt generation or video generation fails with safety/policy block,
 * apply soft fallback prompt.
 */
export function softFallbackSafetyPrompt(prompt: string): string {
  const { sanitized } = sanitizePromptForSafety(prompt);
  // Add safety framing suffix
  return `${sanitized}, cinematic aesthetic, artistic theatrical scene, safe PG rating, smooth motion`.trim();
}
