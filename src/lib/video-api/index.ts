export * from './types';
export {
  VIDEO_API_CATALOG,
  VIDEO_PROVIDER_OPTIONS,
  SUPPORTED_GENERATE_VIDEO_PROVIDERS,
  getVideoApiCatalogEntry,
} from './catalog';
export type {
  VideoApiCatalogEntry,
  SupportedGenerateVideoProvider,
} from './catalog';
export { detectVideoApiPlatform } from './detect';
export { generateHeygenVideo } from './heygen';

import { generateHeygenVideo } from './heygen';
import type {
  ExternalVideoGenerateInput,
  ExternalVideoGenerateResult,
  VideoApiProviderId,
} from './types';
import { getVideoApiCatalogEntry } from './catalog';

/**
 * Dispatch external BYOK video generate.
 * Only providers with dedicated adapters here (HeyGen).
 * Luma/Runway/Sora/Veo/Grok remain in /api/generate-video route (existing).
 */
export async function generateExternalVideo(
  input: ExternalVideoGenerateInput,
): Promise<ExternalVideoGenerateResult> {
  const id = input.providerId as VideoApiProviderId;
  const cat = getVideoApiCatalogEntry(id);
  if (id === 'heygen') {
    return generateHeygenVideo(input);
  }
  if (cat && !cat.generateSupported) {
    throw new Error(
      `[Video API] Provider "${id}" nhận dạng được nhưng chưa có adapter gen trong app. Dùng HeyGen / Luma / Runway / Sora / Veo / Grok / Flow.`,
    );
  }
  throw new Error(
    `[Video API] generateExternalVideo không xử lý "${id}" — route generate-video sẽ xử lý nếu được hỗ trợ.`,
  );
}

export function newExternalVideoApiId(): string {
  return `vap_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}
