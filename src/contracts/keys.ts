/**
 * Asset / entity key builders — single source of truth.
 * UI, hooks, store, API must not invent parallel formats.
 *
 * Store maps (generatedAudioPaths, generatedPrompts, generatedImages, generatedVideos)
 * use these keys. Disk filenames are separate helpers below.
 */

/** Scene-level audio + prompt list key: "3_2" */
export function sceneAssetKey(chapter: number, sceneIndex: number): string {
  return `${Number(chapter)}_${Number(sceneIndex)}`;
}

/** Still image for one storyboard prompt: "3_2_0" */
export function imageAssetKey(
  chapter: number,
  sceneIndex: number,
  promptIndex: number,
): string {
  return `${Number(chapter)}_${Number(sceneIndex)}_${Number(promptIndex)}`;
}

/** Video clip for one prompt (legacy suffix used in store maps) */
export function videoAssetKey(
  chapter: number,
  sceneIndex: number,
  promptIndex: number,
): string {
  return `${imageAssetKey(chapter, sceneIndex, promptIndex)}_video`;
}

/** Derive video store key from an existing image key ("3_2_0" → "3_2_0_video") */
export function videoAssetKeyFromImageKey(imageKey: string): string {
  const k = String(imageKey || '');
  return k.endsWith('_video') ? k : `${k}_video`;
}

/** Character concept / identity still: "char_Name" (name already NFC preferred) */
export function characterImageKey(characterName: string): string {
  const name = String(characterName || '').normalize('NFC').trim();
  return `char_${name}`;
}

/**
 * Voice-cast role id for a named character — same wire format as characterImageKey.
 * Prefer this name in cast/TTS code for readability.
 */
export function characterRoleId(characterName: string): string {
  return characterImageKey(characterName);
}

export function characterAngleImageKey(
  characterName: string,
  angle: string,
): string {
  return `${characterImageKey(characterName)}_angle_${angle}`;
}

export function characterExprImageKey(
  characterName: string,
  emotion: string,
): string {
  return `${characterImageKey(characterName)}_expr_${emotion}`;
}

/**
 * Wardrobe / costume variant still for a character.
 * Example: char_Hàn Dực_wardrobe_battle
 */
export function characterWardrobeImageKey(
  characterName: string,
  wardrobeId: string,
): string {
  const id = String(wardrobeId || '')
    .normalize('NFC')
    .trim()
    .replace(/[^\w\-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 48);
  return `${characterImageKey(characterName)}_wardrobe_${id || 'default'}`;
}

/**
 * Scene location / environment concept still (reusable location library).
 * Example: loc_Phố đêm mưa
 */
export function sceneLocationImageKey(locationName: string): string {
  const name = String(locationName || '').normalize('NFC').trim();
  return `loc_${name}`;
}

/** Parse "chapter_scene" scene keys; returns null if not that shape */
export function parseSceneAssetKey(
  key: string,
): { chapter: number; sceneIndex: number } | null {
  const m = String(key || '').match(/^(\d+)_(\d+)$/);
  if (!m) return null;
  return { chapter: Number(m[1]), sceneIndex: Number(m[2]) };
}

/** Parse "chapter_scene_prompt" image keys; returns null if not that shape */
export function parseImageAssetKey(
  key: string,
): { chapter: number; sceneIndex: number; promptIndex: number } | null {
  const m = String(key || '').match(/^(\d+)_(\d+)_(\d+)$/);
  if (!m) return null;
  return {
    chapter: Number(m[1]),
    sceneIndex: Number(m[2]),
    promptIndex: Number(m[3]),
  };
}

/** True if key belongs to chapter N (prefix "N_" or exact chapter media) */
export function assetKeyBelongsToChapter(key: string, chapter: number): boolean {
  const prefix = `${Number(chapter)}_`;
  return key === String(chapter) || key.startsWith(prefix);
}

/** Prefix for filtering all store keys of a chapter: "3_" */
export function chapterAssetPrefix(chapter: number): string {
  return `${Number(chapter)}_`;
}

// ─── Disk filenames (local public/ + Drive export labels) ───────────────────

/** Local audio file: chapter_1_scene_0.mp3 */
export function localAudioFilename(
  chapter: number,
  sceneIndex: number,
  ext: 'mp3' | 'wav' = 'mp3',
): string {
  return `chapter_${Number(chapter)}_scene_${Number(sceneIndex)}.${ext}`;
}

/** Local still: chapter_1_scene_0_prompt_2.png (optional variant suffix) */
export function localImageFilename(
  chapter: number,
  sceneIndex: number,
  promptIndex: number,
  variantIndex?: number,
): string {
  const base = `chapter_${Number(chapter)}_scene_${Number(sceneIndex)}_prompt_${Number(promptIndex)}`;
  if (variantIndex !== undefined && variantIndex > 0) {
    return `${base}_v${variantIndex + 1}.png`;
  }
  return `${base}.png`;
}

/** Local animatic / scene video: chapter_1_scene_0_animatic.mp4 */
export function localVideoFilename(chapter: number, sceneIndex: number): string {
  return `chapter_${Number(chapter)}_scene_${Number(sceneIndex)}_animatic.mp4`;
}

/**
 * Human-readable Drive export name:
 * [Title]_Chuong_1_Canh_0.mp3 / _Prompt_2.png
 */
export function driveMediaFilename(
  scriptTitle: string,
  chapter: number,
  sceneIndex: number,
  opts: {
    kind: 'audio' | 'image' | 'video';
    ext?: string;
    promptIndex?: number;
  },
): string {
  const safe = String(scriptTitle || 'Truyen')
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
    .trim() || 'Truyen';
  const ch = Number(chapter);
  const sc = Number(sceneIndex);
  if (opts.kind === 'audio') {
    const ext = opts.ext || 'mp3';
    return `${safe}_Chuong_${ch}_Canh_${sc}.${ext}`;
  }
  if (opts.kind === 'image') {
    const pi = Number(opts.promptIndex ?? 0);
    return `${safe}_Chuong_${ch}_Canh_${sc}_Prompt_${pi}.png`;
  }
  return `${safe}_Chuong_${ch}_Canh_${sc}.mp4`;
}
