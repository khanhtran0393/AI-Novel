/**
 * Reusable scene / location concept assets (Printfilm P1 scene library).
 * Disk keys via sceneLocationImageKey — not IndexedDB.
 */

import { sceneLocationImageKey } from '@/contracts';

export interface SceneLocationAsset {
  id: string;
  /** Location name (NFC), e.g. "Phố đêm mưa" */
  name: string;
  /** Time / weather / mood */
  atmosphere?: string;
  /** English visual prompt for environment still */
  visualPrompt?: string;
  /** generatedImages key (usually sceneLocationImageKey(name)) */
  image_key?: string;
  /** Local path after gen (optional mirror of generatedImages[image_key]) */
  referencePath?: string;
  updatedAt?: number;
}

export function emptySceneLocation(
  partial?: Partial<SceneLocationAsset>,
): SceneLocationAsset {
  const name = String(partial?.name || 'Địa điểm mới').normalize('NFC').trim();
  const id =
    String(partial?.id || `loc_${Date.now().toString(36)}`).trim() ||
    `loc_${Date.now().toString(36)}`;
  const image_key =
    String(partial?.image_key || sceneLocationImageKey(name)).trim() ||
    sceneLocationImageKey(name);
  return {
    id,
    name,
    atmosphere: String(partial?.atmosphere || '').trim(),
    visualPrompt: String(partial?.visualPrompt || '').trim() || undefined,
    image_key,
    referencePath: String(partial?.referencePath || '').trim() || undefined,
    updatedAt: partial?.updatedAt || Date.now(),
  };
}

export function normalizeSceneLocationAssets(
  raw?: SceneLocationAsset[] | null,
): SceneLocationAsset[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => {
      if (!item || typeof item !== 'object') return null;
      const name = String(item.name || '').normalize('NFC').trim();
      if (!name) return null;
      return emptySceneLocation({
        ...item,
        name,
        id: String(item.id || '').trim() || undefined,
      });
    })
    .filter((x): x is SceneLocationAsset => !!x);
}

/** Environment concept prompt for location still gen */
export function composeSceneLocationPrompt(
  loc: SceneLocationAsset,
  styleHint?: string,
): string {
  const style = String(styleHint || '').trim();
  const atmo = String(loc.atmosphere || '').trim();
  const vp = String(loc.visualPrompt || '').trim();
  return [
    'Cinematic environment concept still, establishing shot, no people or characters in frame',
    `Location: ${loc.name}`,
    atmo ? `Atmosphere / time: ${atmo}` : '',
    vp || 'grounded production design, natural lighting, clear architecture and materials',
    style ? `Visual style: ${style}` : '',
    'high detail, no text, no watermark, no logo',
  ]
    .filter(Boolean)
    .join('. ');
}
